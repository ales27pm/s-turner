import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};
const noStoreExts = new Set(['.html', '.js', '.json']);

function requestPath(urlPath = '/') {
  return decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
}

function safePath(urlPath) {
  const normalized = normalize(requestPath(urlPath) || 'index.html');
  return normalized.startsWith('..') ? null : join(root, normalized);
}

async function serveFile(req, res) {
  const route = requestPath(req.url || '/');
  if (route === '__health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
    res.end(JSON.stringify({ ok: true, mode: 'standalone-static', pid: process.pid, root, host, port }, null, 2));
    return;
  }

  let filePath = safePath(req.url || '/');
  if (!filePath) throw new Error('Bad path');

  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(root, 'index.html');
  }

  const ext = extname(filePath).toLowerCase();
  const body = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': noStoreExts.has(ext) ? 'no-store, max-age=0' : 'public, max-age=3600',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    await serveFile(req, res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`Server error: ${error.message}`);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the old server with: kill $(lsof -tiTCP:${port} -sTCP:LISTEN)`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => console.log(`Maisons S. Turner app: http://${host}:${port}`));
