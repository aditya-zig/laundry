import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Task-only preview for exported SPAs. Production hosting must separately
// configure and verify equivalent route rewrites; this does not deploy an app.
export async function createPreviewServer(directory) {
  const root = await realpath(directory);
  async function file(path) {
    try {
      const actual = await realpath(resolve(root, path));
      if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile()) return null;
      return { body: await readFile(actual), type: mime[extname(actual)] ?? 'application/octet-stream' };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    }
  }
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (code, body) => {
      response.statusCode = code;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return reply(405, 'Method not allowed');
    }
    let pathname;
    try {
      // Decode before normalization so encoded traversal cannot disappear.
      pathname = decodeURIComponent((request.url ?? '').split(/[?#]/)[0]);
    } catch { return reply(400, 'Invalid path'); }
    const segments = pathname.split('/');
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || segments.some(part => part === '..' || part === '.' || (part.startsWith('.') && part !== '.pnpm'))) {
      return reply(400, 'Invalid path');
    }
    try {
      let result = await file(pathname === '/' ? 'index.html' : pathname.slice(1));
      // Never return HTML for missing scripts, fonts, images or API requests.
      const reserved = /^\/(?:assets|_expo|api|v1)(?:\/|$)/.test(pathname);
      if (!result && !reserved && !extname(pathname) && (request.headers.accept ?? '').includes('text/html')) {
        result = await file('index.html');
      }
      if (!result) return reply(404, 'Not found');
      response.setHeader('Content-Type', result.type);
      response.setHeader('Content-Length', result.body.length);
      response.end(request.method === 'HEAD' ? undefined : result.body);
    } catch { reply(500, 'Preview unavailable'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [app, portText] = process.argv.slice(2);
  const port = Number(portText);
  if (!['customer', 'partner', 'ops'].includes(app) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Usage: node tools/verification/serve-web.mjs customer|partner|ops <port>');
  }
  const server = await createPreviewServer(resolve(`apps/${app}/dist`));
  server.listen(port, '127.0.0.1', () => console.log(`${app} task-only SPA preview on 127.0.0.1:${port}`));
}
