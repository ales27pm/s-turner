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
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.gz': 'application/octet-stream'
};

const remoteVisuals = new Map([
  ['./public/images/hero-turner.webp', 'https://maisonsturner.ca/app/uploads/2024/02/athenes-1-2000x1000.jpg'],
  ['./public/images/collection-chalet.webp', 'https://maisonsturner.ca/app/uploads/2024/02/oslo-1-1015x762.jpg'],
  ['./public/images/collection-plain-pied.webp', 'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg'],
  ['./public/images/collection-two-storey.webp', 'https://maisonsturner.ca/app/uploads/2024/02/portofino-1-1015x762.jpg'],
]);

function cleanPath(urlPath = '/') {
  return decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
}
function safePath(urlPath) {
  const normalized = normalize(cleanPath(urlPath) || 'index.html');
  return normalized.startsWith('..') ? null : join(root, normalized);
}
async function gunzipText(relativePath) {
  const bytes = await readFile(join(root, relativePath));
  return (await gunzipAsync(bytes)).toString('utf8');
}
function enhanceCompare(html) {
  if (!html.includes('id="hide-compare"')) {
    html = html.replace(
      '<button class="button button-primary" type="button" id="open-compare">Comparer</button>',
      '<div class="compare-actions"><button class="button button-primary" type="button" id="open-compare">Comparer</button><button class="compare-mini-button" type="button" id="hide-compare">Masquer</button><button class="compare-mini-button" type="button" id="clear-compare">Vider</button></div>'
    );
    html = html.replace(
      '</aside>\n\n    <section class="transparency',
      '</aside>\n    <button class="compare-return" type="button" id="show-compare" hidden>Afficher comparaison</button>\n\n    <section class="transparency'
    );
  }
  return html;
}
function patchVisualUrls(html) {
  for (const [local, remote] of remoteVisuals) html = html.replaceAll(local, remote);
  return html;
}

const compareCss = `
.compare-actions{display:flex;align-items:center;gap:8px}.compare-actions .button{min-height:42px;padding-inline:18px}
.compare-mini-button,.compare-return{min-height:42px;padding:0 13px;color:var(--white);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:7px;cursor:pointer;font-size:.72rem;font-weight:800}
.compare-mini-button:hover,.compare-return:hover{background:rgba(255,255,255,.14)}
.compare-return{position:fixed;z-index:250;right:max(18px,calc((100vw - var(--shell))/2));bottom:18px;color:var(--white);background:var(--navy);box-shadow:var(--shadow-md)}
.compare-return[hidden]{display:none}@media(max-width:980px){.compare-actions{grid-column:1/-1}.compare-actions>*{flex:1}}@media(max-width:720px){.compare-return{right:10px;bottom:10px;left:10px;width:auto}}
`;
const compareJs = `(() => {
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const count=()=>$$('.compare-chip').length || $$('[data-compare-id][aria-pressed="true"]').length;
  const label=()=>{const b=$('#show-compare');if(b)b.textContent='Afficher comparaison'+(count()?' ('+count()+')':'');};
  document.addEventListener('click',e=>{
    if(e.target.closest('#hide-compare')){const t=$('#compare-tray'),b=$('#show-compare');if(t&&b){t.hidden=true;label();b.hidden=false;}}
    if(e.target.closest('#show-compare')){const t=$('#compare-tray'),b=$('#show-compare');if(t&&b){t.hidden=false;b.hidden=true;}}
    if(e.target.closest('#clear-compare')){const buttons=$$('[data-remove-compare]');if(buttons.length)buttons.forEach(b=>b.click());else $$('[data-compare-id][aria-pressed="true"]').forEach(b=>b.click());const t=$('#compare-tray'),s=$('#show-compare');if(t)t.hidden=true;if(s)s.hidden=true;}
    queueMicrotask(label);
  });
})();`;

async function renderApp() {
  const [rawHtml, css, js] = await Promise.all([
    gunzipText('payload/index.html.gz'), gunzipText('payload/styles.css.gz'), gunzipText('payload/app.js.gz')
  ]);
  let html = rawHtml.replace(/<script\s+src=["']\.\/app\.js["']\s+defer><\/script>/g, '');
  html = enhanceCompare(patchVisualUrls(html));
  const safeJs = js.replaceAll('</script>', '<\\/script>');
  return html.replace('</head>', `<style>${css}\n${compareCss}</style></head>`)
    .replace('</body>', `<script>${safeJs}</script><script>${compareJs}</script></body>`);
}
function send(res, status, body, type='text/plain; charset=utf-8', cache='no-store, max-age=0') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': cache}); res.end(body);
}
const server = http.createServer(async (req,res) => {
  try {
    const route = cleanPath(req.url || '/');
    if (route === '__health') return send(res,200,JSON.stringify({ok:true,mode:'restored-rich-layout',payload:'original-b371',visuals:'high-res-remote',pid:process.pid,host,port},null,2),mime['.json']);
    if (route === '' || route === 'index.html') return send(res,200,await renderApp(),mime['.html']);
    let filePath = safePath(req.url || '/');
    if (!filePath) return send(res,400,'Bad path');
    try { if ((await stat(filePath)).isDirectory()) return send(res,200,await renderApp(),mime['.html']); }
    catch { return send(res,404,'Not found'); }
    const ext = extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    send(res,200,body,mime[ext] || 'application/octet-stream',['.html','.js','.gz'].includes(ext)?'no-store, max-age=0':'public, max-age=3600');
  } catch(error) { send(res,500,`Server error: ${error.message}`); }
});
server.on('error', error => {
  if(error.code === 'EADDRINUSE') { console.error(`Port ${port} is already in use. Stop the old server with: kill $(lsof -tiTCP:${port} -sTCP:LISTEN)`); process.exit(1); }
  throw error;
});
server.listen(port,host,()=>console.log(`Maisons S. Turner app: http://${host}:${port}`));
