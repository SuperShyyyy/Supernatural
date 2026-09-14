/**
 * 零依赖静态服务器。
 *
 * 打包产物是纯前端应用（ES module），无法用 file:// 直接打开（模块脚本受 CORS 限制），
 * 因此随包提供一个最小服务器：只需要 Node，不需要任何 npm 依赖。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.env['PORT'] ?? 8321);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.map', 'application/json; charset=utf-8'],
]);

function safeJoin(base, target) {
  const resolved = resolve(base, `.${sep}${normalize(target)}`);
  // 目录穿越防护：解析后的路径必须仍在根目录内
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;
  return resolved;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  let filePath = safeJoin(root, decodeURIComponent(url.pathname));
  if (filePath === null) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');

    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME.get(extname(filePath)) ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`md-editer 已启动: http://127.0.0.1:${port}/`);
});
