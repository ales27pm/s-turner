import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const gunzipAsync = promisify(gunzip);

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
  '.gz': 'application/octet-stream',
};

const noStoreExts = new Set(['.html', '.js', '.gz']);
const payloadStatus = new Map();

function requestPath(urlPath = '/') {
  return decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
}

function safePath(urlPath) {
  const normalized = normalize(requestPath(urlPath) || 'index.html');
  return normalized.startsWith('..') ? null : join(root, normalized);
}

function looksLikeBase64Gzip(text) {
  const compact = text.replace(/\s+/g, '');
  return compact.startsWith('H4sI') && /^[A-Za-z0-9+/=]+$/.test(compact);
}

async function decodePayload(relativePath) {
  const file = await readFile(join(root, relativePath));

  if (file.length >= 2 && file[0] === 0x1f && file[1] === 0x8b) {
    const decoded = (await gunzipAsync(file)).toString('utf8');
    payloadStatus.set(relativePath, { mode: 'gzip-bytes', bytes: file.length, decoded: decoded.length });
    return decoded;
  }

  const text = file.toString('utf8');
  const trimmed = text.trim();

  if (looksLikeBase64Gzip(trimmed)) {
    const base64Bytes = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
    const decoded = (await gunzipAsync(base64Bytes)).toString('utf8');
    payloadStatus.set(relativePath, { mode: 'base64-gzip-text', bytes: file.length, decoded: decoded.length });
    return decoded;
  }

  try {
    const decoded = (await gunzipAsync(file)).toString('utf8');
    payloadStatus.set(relativePath, { mode: 'gzip-fallback', bytes: file.length, decoded: decoded.length });
    return decoded;
  } catch {
    payloadStatus.set(relativePath, { mode: 'plain-text', bytes: file.length, decoded: text.length });
    return text;
  }
}

function stripPayloadScript(html) {
  return html.replace(/<script\s+src=["']\.\/app\.js["']\s+defer><\/script>/g, '');
}

async function renderApp() {
  const [rawHtml, css, js] = await Promise.all([
    decodePayload('payload/index.html.gz'),
    decodePayload('payload/styles.css.gz'),
    decodePayload('payload/app.js.gz'),
  ]);
  const safeJs = js.replaceAll('</script>', '<\\/script>');
  return stripPayloadScript(rawHtml)
    .replace('</head>', `<style data-payload="styles.css.gz">${css}</style></head>`)
    .replace('</body>', `<script data-payload="app.js.gz">${safeJs}</script></body>`);
}

async function payloadHealth() {
  await Promise.all([
    decodePayload('payload/index.html.gz'),
    decodePayload('payload/styles.css.gz'),
    decodePayload('payload/app.js.gz'),
  ]);
  return {
    ok: true,
    root,
    pid: process.pid,
    host,
    port,
    payloads: Object.fromEntries(payloadStatus.entries()),
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const cleanPath = requestPath(req.url || '/');

    if (cleanPath === '__health') {
      const body = JSON.stringify(await payloadHealth(), null, 2);
      send(res, 200, body, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      });
      return;
    }

    if (cleanPath === '' || cleanPath === 'index.html') {
      const html = await renderApp();
      send(res, 200, html, {
        'Content-Type': mime['.html'],
        'Cache-Control': 'no-store, max-age=0',
      });
      return;
    }

    let filePath = safePath(req.url || '/');
    if (!filePath) throw new Error('Bad path');

    try {
      if ((await stat(filePath)).isDirectory()) {
        const html = await renderApp();
        send(res, 200, html, {
          'Content-Type': mime['.html'],
          'Cache-Control': 'no-store, max-age=0',
        });
        return;
      }
    } catch {
      const ext = extname(filePath).toLowerCase();
      if (!ext) {
        const html = await renderApp();
        send(res, 200, html, {
          'Content-Type': mime['.html'],
          'Cache-Control': 'no-store, max-age=0',
        });
        return;
      }
      send(res, 404, 'Not found', {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    send(res, 200, body, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': noStoreExts.has(ext) ? 'no-store, max-age=0' : 'public, max-age=3600',
    });
  } catch (error) {
    send(res, 500, `Server error: ${error.message}`, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
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