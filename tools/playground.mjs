import path from 'node:path';
import { createServer } from 'vite';
import { ROOT, findGame, listGames, packGame } from './games.mjs';

// Starts the playground (playground/) on a local web server. Games are packed fresh from their
// folders on every load, and the page reloads when you save a game file.
export async function startPlayground({ port = 5173, host = false, quiet = false } = {}) {
  const watched = ['games', 'examples'].map((f) => path.join(ROOT, f) + path.sep);
  const server = await createServer({
    root: path.join(ROOT, 'playground'),
    configFile: false,
    logLevel: quiet ? 'silent' : 'warn',
    clearScreen: false,
    server: { port, host, strictPort: false, fs: { allow: [ROOT] } },
    plugins: [
      {
        name: 'mini-mayhem-games',
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            const url = new URL(req.url, 'http://localhost');
            const send = (status, body) => {
              res.statusCode = status;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-store');
              res.end(body);
            };
            if (url.pathname === '/mm/index.json') {
              return send(200, JSON.stringify(listGames().map(({ id, name, folder, dir, error }) => ({ id, name, folder, dir, error }))));
            }
            const m = url.pathname.match(/^\/mm\/([A-Za-z0-9_-]+)\.mm$/);
            if (!m) return next();
            try {
              send(200, packGame(findGame(m[1])));
            } catch (e) {
              send(400, JSON.stringify({ error: e.message }));
            }
          });
          vite.watcher.add(watched);
          vite.watcher.on('change', (file) => {
            if (watched.some((dir) => file.startsWith(dir))) vite.ws.send({ type: 'full-reload' });
          });
        },
      },
    ],
  });
  await server.listen();
  return server;
}
