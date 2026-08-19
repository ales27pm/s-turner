import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.gz': 'application/octet-stream'
};
function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const normalized = normalize(clean || 'index.html');
  return normalized.startsWith('..') ? null : join(root, normalized);
}
const server = http.createServer(async (req, res) => {
  try {
    let filePath = safePath(req.url || '/');
    if (!filePath) throw new Error('Bad path');
    try { if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html'); }
    catch { filePath = join(root, 'index.html'); }
    const body = await readFile(filePath);
    res.writeHead(200, {'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': extname(filePath)==='.html'?'no-cache':'public, max-age=3600'});
    res.end(body);
  } catch (error) {
    res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'}); res.end(`Server error: ${error.message}`);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Maisons S. Turner app: http://127.0.0.1:${port}`));
