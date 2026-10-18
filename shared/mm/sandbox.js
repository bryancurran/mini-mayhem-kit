// One QuickJS sandbox (its own runtime: memory, stack and a time limit per call). Used by the
// server and by browsers; whoever creates it passes in the loaded QuickJS module. Code inside can
// only see plain JavaScript plus a console that hands messages back here: no network, no timers,
// no page, no files.

const MAX_LOGS = 200;

export class SandboxError extends Error {}

export class Sandbox {
  constructor(QuickJS, { memory, stack = 1024 * 1024, onLog = null }) {
    this.rt = QuickJS.newRuntime();
    this.rt.setMemoryLimit(memory);
    this.rt.setMaxStackSize(stack);
    this.deadline = Infinity;
    this.rt.setInterruptHandler(() => performance.now() > this.deadline);
    this.vm = this.rt.newContext();
    this.fns = new Map();
    this.dead = false;
    this.logs = 0;

    const consoleObj = this.vm.newObject();
    for (const level of ['log', 'warn', 'error']) {
      const fn = this.vm.newFunction(level, (...args) => {
        if (onLog && this.logs++ < MAX_LOGS) {
          onLog(level, args.map((h) => String(this.vm.dump(h)).slice(0, 500)).join(' '));
        }
      });
      this.vm.setProp(consoleObj, level, fn);
      fn.dispose();
    }
    this.vm.setProp(this.vm.global, 'console', consoleObj);
    consoleObj.dispose();
  }

  fail(handle) {
    const e = this.vm.dump(handle);
    handle.dispose();
    const message = e && typeof e === 'object' ? `${e.name ?? 'Error'}: ${e.message ?? ''}${e.stack ? `\n${e.stack}` : ''}` : String(e);
    // Out of memory or out of time can leave the sandbox in a bad state; stop using it.
    if (/out of memory|interrupted|stack overflow/i.test(message)) this.dead = true;
    return new SandboxError(message);
  }

  // Runs a script (top-level declarations become globals, visible to later scripts).
  run(code, filename, ms) {
    if (this.dead) throw new SandboxError('sandbox stopped');
    this.deadline = performance.now() + ms;
    try {
      const r = this.vm.evalCode(code, filename);
      if (r.error) throw this.fail(r.error);
      r.value.dispose();
    } finally {
      this.deadline = Infinity;
    }
  }

  // Calls globalThis.__mm[name](arg) with a string argument; returns its string result.
  call(name, arg, ms) {
    if (this.dead) throw new SandboxError('sandbox stopped');
    let fn = this.fns.get(name);
    if (!fn) {
      const api = this.vm.getProp(this.vm.global, '__mm');
      fn = this.vm.getProp(api, name);
      api.dispose();
      this.fns.set(name, fn);
    }
    const argHandle = this.vm.newString(arg ?? '');
    this.deadline = performance.now() + ms;
    try {
      const r = this.vm.callFunction(fn, this.vm.undefined, argHandle);
      if (r.error) throw this.fail(r.error);
      const value = this.vm.typeof(r.value) === 'string' ? this.vm.getString(r.value) : null;
      r.value.dispose();
      return value;
    } finally {
      this.deadline = Infinity;
      argHandle.dispose();
    }
  }

  // Bytes in use, from QuickJS's own report.
  memoryUsed() {
    const line = this.rt.dumpMemoryUsage().match(/memory used\s+\d+\s+(\d+)/);
    return line ? Number(line[1]) : 0;
  }

  dispose() {
    if (!this.vm) return;
    for (const fn of this.fns.values()) fn.alive && fn.dispose();
    this.fns.clear();
    this.vm.dispose();
    this.rt.dispose();
    this.vm = null;
    this.rt = null;
    this.dead = true;
  }
}
