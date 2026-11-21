import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = /^\/(?:demo\/|src\/|dist\/)[a-zA-Z0-9._/-]+$/;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(process.env.PORT || 8765);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/demo/index.html' : decodeURIComponent(url.pathname);
    if (request.method !== 'GET' || !allowed.test(pathname)) { response.writeHead(404).end(); return; }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
server.on('error', error => { console.error(`Unable to start demo: ${error.code}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port} (fictional data only)`));
