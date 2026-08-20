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

const noStoreExts = new Set(['.html', '.js', '.json', '.gz']);

const visualSourceMap = new Map([
  ['./public/images/hero-turner.webp', 'https://maisonsturner.ca/app/uploads/2024/02/athenes-1-2000x1000.jpg'],
  ['./public/images/hero-turner.avif', 'https://maisonsturner.ca/app/uploads/2024/02/athenes-1-2000x1000.jpg'],
  ['./public/images/collection-chalet.webp', 'https://maisonsturner.ca/app/uploads/2024/02/oslo-1-1015x762.jpg'],
  ['./public/images/collection-chalet.avif', 'https://maisonsturner.ca/app/uploads/2024/02/oslo-1-1015x762.jpg'],
  ['./public/images/collection-plain-pied.webp', 'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg'],
  ['./public/images/collection-plain-pied.avif', 'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg'],
  ['./public/images/collection-two-storey.webp', 'https://maisonsturner.ca/app/uploads/2024/02/portofino-1-1015x762.jpg'],
  ['./public/images/collection-two-storey.avif', 'https://maisonsturner.ca/app/uploads/2024/02/portofino-1-1015x762.jpg'],
  ['./public/images/athenes-generated.avif', 'https://maisonsturner.ca/app/uploads/2024/02/athenes-1-2000x1000.jpg'],
  ['./public/images/prague-generated.avif', 'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg'],
  ['./public/images/oslo-generated.avif', 'https://maisonsturner.ca/app/uploads/2024/02/oslo-1-1015x762.jpg'],
]);

const preloadVisuals = [
  'https://maisonsturner.ca/app/uploads/2024/02/athenes-1-2000x1000.jpg',
  'https://maisonsturner.ca/app/uploads/2024/02/oslo-1-1015x762.jpg',
  'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg',
  'https://maisonsturner.ca/app/uploads/2024/02/portofino-1-1015x762.jpg',
];

const visualBaseline = {
  mode: 'restored-rich-layout',
  payload: 'original-b371',
  rule: 'Do not rebuild the stripped standalone layout. Preserve original responsive rhythm, logo proportion, typography scale, and section hierarchy.',
  acceptance: [
    'Hero keeps the earlier rich composition and Turner modular wordmark, not the stripped rebuild.',
    'Large hero and collection imagery use high-resolution Turner image URLs or approved equivalents.',
    'Catalogue cards, project-step details, FAQ, planner, and contact form render on mobile before interaction.',
    'Comparison tray can be hidden and cleared without covering planner/contact sections.',
    'Future edits are local repairs only unless a new visual direction is explicitly approved.',
  ],
};

function cleanPath(urlPath = '/') {
  return decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
}

function safePath(urlPath) {
  const normalized = normalize(cleanPath(urlPath) || 'index.html');
  return normalized.startsWith('..') ? null : join(root, normalized);
}

function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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

function patchVisualUrls(source) {
  let out = source;
  for (const [local, remote] of visualSourceMap) {
    out = out.replaceAll(local, remote);
  }
  return out;
}

function baselineHeadMarkup() {
  const baselineJson = JSON.stringify({ ...visualBaseline, preloadVisuals }).replaceAll('</script', '<\\/script');
  return `
<meta name="turner-baseline" content="${escapeHtmlAttr(`${visualBaseline.mode}/${visualBaseline.payload}`)}">
<link rel="preconnect" href="https://maisonsturner.ca" crossorigin>
<link rel="dns-prefetch" href="//maisonsturner.ca">
<link rel="preload" as="image" href="${escapeHtmlAttr(preloadVisuals[0])}" fetchpriority="high">
<script>window.__TURNER_BASELINE__=${baselineJson};</script>`;
}

const compareCss = `
.compare-actions{display:flex;align-items:center;gap:8px}.compare-actions .button{min-height:42px;padding-inline:18px}
.compare-mini-button,.compare-return{min-height:42px;padding:0 13px;color:var(--white);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:7px;cursor:pointer;font-size:.72rem;font-weight:800}
.compare-mini-button:hover,.compare-return:hover{background:rgba(255,255,255,.14)}
.compare-return{position:fixed;z-index:250;right:max(18px,calc((100vw - var(--shell))/2));bottom:18px;color:var(--white);background:var(--navy);box-shadow:var(--shadow-md)}
.compare-return[hidden]{display:none}@media(max-width:980px){.compare-actions{grid-column:1/-1}.compare-actions>*{flex:1}}@media(max-width:720px){.compare-return{right:10px;bottom:10px;left:10px;width:auto}}
`;

const baselinePolishCss = `
/* Baseline-safe polish only: preserve the restored rich layout and avoid global redesign. */
html{scroll-behavior:smooth}body{text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.hero h1,.title,.section-title,.display{text-wrap:balance}img{image-rendering:auto}.collection-card,.collection-card-tall,.model-card,.card,.compare-tray{transform:translateZ(0)}body.turner-compare-visible{padding-bottom:96px}.compare-return{backdrop-filter:blur(12px)}@media(max-width:720px){body.turner-compare-visible{padding-bottom:128px}.collection-card,.collection-card-tall{min-height:clamp(260px,68vw,360px)}.model-card img,.collection-card img{width:100%;height:100%;object-fit:cover}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
`;

const compareJs = `(() => {
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const count=()=>$$('.compare-chip').length || $$('[data-compare-id][aria-pressed="true"]').length;
  const sync=()=>{const t=$('#compare-tray'),b=$('#show-compare');const visible=!!(t&&!t.hidden);document.body.classList.toggle('turner-compare-visible',visible);if(b)b.textContent='Afficher comparaison'+(count()?' ('+count()+')':'');};
  const observe=()=>{const t=$('#compare-tray');if(t)new MutationObserver(sync).observe(t,{attributes:true,attributeFilter:['hidden']});sync();};
  document.addEventListener('click',e=>{
    if(e.target.closest('#hide-compare')){const t=$('#compare-tray'),b=$('#show-compare');if(t&&b){t.hidden=true;sync();b.hidden=false;}}
    if(e.target.closest('#show-compare')){const t=$('#compare-tray'),b=$('#show-compare');if(t&&b){t.hidden=false;b.hidden=true;sync();}}
    if(e.target.closest('#clear-compare')){const buttons=$$('[data-remove-compare]');if(buttons.length)buttons.forEach(b=>b.click());else $$('[data-compare-id][aria-pressed="true"]').forEach(b=>b.click());const t=$('#compare-tray'),s=$('#show-compare');if(t)t.hidden=true;if(s)s.hidden=true;}
    queueMicrotask(sync);
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
})();`;

async function renderApp() {
  const [rawHtml, rawCss, rawJs] = await Promise.all([
    gunzipText('payload/index.html.gz'),
    gunzipText('payload/styles.css.gz'),
    gunzipText('payload/app.js.gz'),
  ]);
  let html = rawHtml.replace(/<script\s+src=["']\.\/app\.js["']\s+defer><\/script>/g, '');
  html = enhanceCompare(patchVisualUrls(html));
  const css = patchVisualUrls(rawCss);
  const safeJs = patchVisualUrls(rawJs).replaceAll('</script>', '<\\/script>');
  return html
    .replace('</head>', `${baselineHeadMarkup()}\n<style>${css}\n${compareCss}\n${baselinePolishCss}</style></head>`)
    .replace('</body>', `<script>${safeJs}</script><script>${compareJs}</script></body>`);
}

function send(res, status, body, type = 'text/plain; charset=utf-8', cache = 'no-store, max-age=0') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(body);
}

async function health() {
  const [html, css, js] = await Promise.all([
    gunzipText('payload/index.html.gz'),
    gunzipText('payload/styles.css.gz'),
    gunzipText('payload/app.js.gz'),
  ]);
  return {
    ok: true,
    ...visualBaseline,
    visuals: {
      sourceMapEntries: visualSourceMap.size,
      highResolutionTurnerSources: true,
      preloadCount: preloadVisuals.length,
      preloadedHero: preloadVisuals[0],
    },
    polish: {
      baselineMetaInjected: true,
      compareBodyOffset: true,
      reducedMotionSafe: true,
    },
    decoded: {
      html: html.length,
      css: css.length,
      js: js.length,
    },
    pid: process.pid,
    host,
    port,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const route = cleanPath(req.url || '/');
    if (route === '__health') return send(res, 200, JSON.stringify(await health(), null, 2), mime['.json']);
    if (route === '__baseline') return send(res, 200, JSON.stringify(visualBaseline, null, 2), mime['.json']);
    if (route === '__visuals') return send(res, 200, JSON.stringify({ sourceMap: [...visualSourceMap.entries()], preloadVisuals }, null, 2), mime['.json']);
    if (route === '' || route === 'index.html') return send(res, 200, await renderApp(), mime['.html']);

    const filePath = safePath(req.url || '/');
    if (!filePath) return send(res, 400, 'Bad path');

    try {
      if ((await stat(filePath)).isDirectory()) return send(res, 200, await renderApp(), mime['.html']);
    } catch {
      return send(res, 404, 'Not found');
    }

    const ext = extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    send(
      res,
      200,
      body,
      mime[ext] || 'application/octet-stream',
      noStoreExts.has(ext) ? 'no-store, max-age=0' : 'public, max-age=3600'
    );
  } catch (error) {
    send(res, 500, `Server error: ${error.message}`);
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the old server with: kill $(lsof -tiTCP:${port} -sTCP:LISTEN)`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => console.log(`Maisons S. Turner app: http://${host}:${port}`));
