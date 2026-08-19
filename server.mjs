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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};
const noStoreExts = new Set(['.html', '.js', '.json']);

const preferredBrandCss = `
/* Preferred Turner identity: compact six-module mark + lighter editorial serif. */
.brand{gap:13px!important;letter-spacing:.22em!important;font-size:.82rem!important;line-height:1.35!important;font-weight:800!important}
.brand small{font-size:.48rem!important;letter-spacing:.2em!important;margin-top:2px!important}
.mark{width:38px!important;height:38px!important;display:grid!important;grid-template-columns:1fr 1fr!important;grid-template-rows:repeat(3,1fr)!important;gap:3px!important;position:relative!important}
.mark i{display:block!important}
.mark i:nth-child(1){grid-column:1;grid-row:1;background:#bd6740!important}
.mark i:nth-child(2){grid-column:2;grid-row:1;background:#d59a7a!important}
.mark i:nth-child(3){grid-column:1;grid-row:2;background:#f0e4d3!important}
.mark i:nth-child(4){grid-column:2;grid-row:2;background:#0b2332!important}
.mark:before,.mark:after{content:"";display:block}
.mark:before{grid-column:1;grid-row:3;background:#0b2332}
.mark:after{grid-column:2;grid-row:3;background:#e8e0d4}
.hero h1,.title,.finder h2,.value b,.collection h3,.count,.body h3,.benefit h3,.detail h3,.big{font-family:Baskerville,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif!important;font-weight:400!important}
.hero h1{letter-spacing:-.045em!important;line-height:.93!important}
.title{letter-spacing:-.04em!important;line-height:.94!important}
@media(max-width:850px){
  .nav{height:82px!important}
  .brand{font-size:.72rem!important;letter-spacing:.21em!important}
  .brand small{font-size:.43rem!important}
  .mark{width:42px!important;height:42px!important}
  .hero h1{font-size:clamp(3.45rem,14.5vw,5rem)!important;line-height:.91!important;letter-spacing:-.048em!important}
}
@media(max-width:390px){.hero h1{font-size:clamp(3.2rem,14vw,4.55rem)!important}}
`;

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
    res.end(JSON.stringify({ ok: true, mode: 'standalone-static', brand: 'preferred-editorial', pid: process.pid, root, host, port }, null, 2));
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
  let body = await readFile(filePath);
  if (ext === '.html') {
    const html = body.toString('utf8').replace('</head>', `<style id="preferred-turner-brand">${preferredBrandCss}</style></head>`);
    body = Buffer.from(html, 'utf8');
  }
  res.writeHead(200, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': noStoreExts.has(ext) ? 'no-store, max-age=0' : 'public, max-age=3600',
  });
  res.end(body);
}
const server = http.createServer(async (req, res) => {
  try { await serveFile(req, res); }
  catch (error) {
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
