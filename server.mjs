import http from 'node:http';
import { readFile, stat, mkdir, appendFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const gunzipAsync = promisify(gunzip);
const intakeDir = process.env.TURNER_DATA_DIR || join(root, '.turner-data');
const intakeFile = join(intakeDir, 'project-intake.jsonl');
const adminToken = process.env.TURNER_ADMIN_TOKEN || '';
const crmWebhookUrl = process.env.TURNER_CRM_WEBHOOK_URL || '';

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
const jsonMaxBytes = 64 * 1024;
const rateLimits = new Map();

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

const implementationStatus = {
  implemented: [
    'contact form submits to /api/project-intake instead of ending in a mock-only local toast',
    'project intake submissions are validated, rate-limited and persisted to .turner-data/project-intake.jsonl',
    'optional CRM forwarding is available via TURNER_CRM_WEBHOOK_URL',
    'budget calculations are available through /api/budget/summary',
    'runtime app configuration is available through /api/config',
    'fallback model, project-step and FAQ sections render when the original client script is delayed or blocked',
    'diagnostics expose remaining prototype-only pieces through /api/implementation-status',
  ],
  stillPrototype: [
    'model catalogue data remains prototype content until Turner approves official data',
    'budget values are still user-entered or sample values, not official pricing',
    'legal/privacy copy still needs production review before public launch',
    'payment, appointment scheduling and CRM authentication are intentionally out of scope',
  ],
};

const fallbackModels = [
  { name: 'Athènes', area: 576, type: 'Chalet', style: 'Contemporain', bedrooms: 1, baths: 1, garage: 'Non', image: 'https://maisonsturner.ca/app/uploads/2024/02/athenes-1-2000x1000.jpg', desc: 'Chalet compact et lumineux avec plafond généreux.' },
  { name: 'Prague', area: 1160, type: 'Plain-pied', style: 'Familial', bedrooms: 2, baths: 1, garage: 'Non', image: 'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg', desc: 'Plain-pied équilibré pour une vie simple et lumineuse.' },
  { name: 'Oslo', area: 980, type: 'Chalet', style: 'Scandinave', bedrooms: 2, baths: 1, garage: 'Non', image: 'https://maisonsturner.ca/app/uploads/2024/02/oslo-1-1015x762.jpg', desc: 'Expression scandinave chaleureuse et durable.' },
  { name: 'Portofino', area: 1760, type: 'Deux étages', style: 'Contemporain', bedrooms: 3, baths: 2, garage: 'Oui', image: 'https://maisonsturner.ca/app/uploads/2024/02/portofino-1-1015x762.jpg', desc: 'Présence architecturale forte pour la famille.' },
  { name: 'Liverpool', area: 1540, type: 'Deux étages', style: 'Familial', bedrooms: 3, baths: 2, garage: 'Oui', image: 'https://maisonsturner.ca/app/uploads/2024/02/portofino-1-1015x762.jpg', desc: 'Maison avec garage et zones bien séparées.' },
  { name: 'Turenne', area: 1320, type: 'Plain-pied', style: 'Contemporain', bedrooms: 3, baths: 2, garage: 'Non', image: 'https://maisonsturner.ca/app/uploads/2024/03/prague-1-1015x762.jpg', desc: 'Plain-pied lumineux avec circulation fluide.' },
];

function cleanPath(urlPath = '/') {
  return decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
}

function safePath(urlPath) {
  const normalized = normalize(cleanPath(urlPath) || 'index.html');
  return normalized.startsWith('..') ? null : join(root, normalized);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hashForLog(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(req, bucket, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const key = `${bucket}:${hashForLog(clientIp(req))}`;
  const existing = rateLimits.get(key) || [];
  const recent = existing.filter(timestamp => now - timestamp < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  rateLimits.set(key, recent);
  return true;
}

async function readBody(req, maxBytes = jsonMaxBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw Object.assign(new Error('Expected application/json'), { status: 415 });
  const text = await readBody(req);
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
    return parsed;
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON: ${error.message}`), { status: 400 });
  }
}

function normalizeString(value, maxLength = 4000) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value) {
  return normalizeString(value, 320).toLowerCase();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = normalizeString(value, 32).toLowerCase();
  return ['1', 'true', 'yes', 'oui', 'on', 'accepté', 'accepte', 'checked'].includes(text);
}

function normalizeFieldMap(payload) {
  const raw = payload.fields && typeof payload.fields === 'object' ? payload.fields : payload;
  const normalized = {};
  const aliases = [
    ['fullName', /(^|[^a-z])(nom|name|full.?name|nom.?complet)([^a-z]|$)/i],
    ['email', /(courriel|e.?mail|email)/i],
    ['phone', /(t[eé]l[eé]phone|phone|tel)/i],
    ['postalCode', /(code.?postal|postal|zip)/i],
    ['model', /(mod[eè]le|model|maison)/i],
    ['message', /(message|projet|besoin|terrain|questions|parlez)/i],
    ['consent', /(consent|accept|renseignements|privacy|confidentialit[eé])/i],
    ['website', /(website|site.?web|url|homepage)/i],
  ];

  for (const [key, value] of Object.entries(raw || {})) {
    const candidate = normalizeString(key, 120);
    const text = `${candidate} ${normalizeString(value, 120)}`;
    const alias = aliases.find(([, pattern]) => pattern.test(text));
    if (!alias) continue;
    normalized[alias[0]] = value;
  }

  return {
    fullName: normalizeString(payload.fullName ?? payload.name ?? normalized.fullName, 160),
    email: normalizeEmail(payload.email ?? payload.courriel ?? normalized.email),
    phone: normalizeString(payload.phone ?? payload.telephone ?? normalized.phone, 60),
    postalCode: normalizeString(payload.postalCode ?? payload.postal ?? normalized.postalCode, 24).toUpperCase(),
    model: normalizeString(payload.model ?? payload.modelInterest ?? normalized.model, 120),
    message: normalizeString(payload.message ?? payload.project ?? normalized.message, 3000),
    consent: normalizeBoolean(payload.consent ?? payload.privacyConsent ?? normalized.consent),
    website: normalizeString(payload.website ?? normalized.website, 200),
    source: normalizeString(payload.source || 'web-app', 80),
  };
}

function validateIntake(payload) {
  const intake = normalizeFieldMap(payload);
  const errors = [];
  if (intake.website) errors.push({ field: 'website', message: 'Spam trap filled.' });
  if (intake.fullName.length < 2) errors.push({ field: 'fullName', message: 'Le nom complet est requis.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intake.email)) errors.push({ field: 'email', message: 'Un courriel valide est requis.' });
  if (intake.message.length < 8) errors.push({ field: 'message', message: 'Décrivez brièvement le projet.' });
  if (!intake.consent) errors.push({ field: 'consent', message: 'Le consentement est requis pour préparer la demande.' });
  return { intake, errors };
}

async function persistIntake(record) {
  await mkdir(intakeDir, { recursive: true });
  await appendFile(intakeFile, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function maybeForwardIntake(record) {
  if (!crmWebhookUrl) return { enabled: false, delivered: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(crmWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
      signal: controller.signal,
    });
    return { enabled: true, delivered: response.ok, status: response.status };
  } catch (error) {
    return { enabled: true, delivered: false, error: error.name === 'AbortError' ? 'timeout' : 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function money(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const cleaned = normalizeString(value, 64).replace(/[^\d,.-]/g, '').replace(',', '.');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function percent(value, fallback = 8) {
  const parsed = Number.parseFloat(String(value ?? fallback).replace(',', '.'));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30, Math.max(0, parsed));
}

function calculateBudget(input = {}) {
  const lineItems = {
    houseQuote: money(input.houseQuote ?? input.quote ?? input['soumission maison']),
    land: money(input.land ?? input.terrain),
    foundation: money(input.foundation ?? input.excavation ?? input['excavation et fondation']),
    siteConnections: money(input.siteConnections ?? input.connections ?? input['raccordements et chantier']),
    options: money(input.options ?? input.finishes ?? input['finitions et options']),
    other: money(input.other ?? input['autres frais prévus']),
  };
  const subtotal = Object.values(lineItems).reduce((sum, value) => sum + value, 0);
  const contingencyPct = percent(input.contingencyPct ?? input.contingency ?? input['marge de sécurité'], 8);
  const contingencyAmount = Math.round(subtotal * contingencyPct / 100);
  const total = subtotal + contingencyAmount;
  const budgetTarget = money(input.budgetTarget ?? input.budget ?? input['budget cible']);
  const gap = budgetTarget ? budgetTarget - total : 0;
  return { lineItems, contingencyPct, subtotal, contingencyAmount, total, budgetTarget, gap, currency: 'CAD', disclaimer: 'Simulation informative seulement; ce résultat ne constitue pas une soumission officielle.' };
}

async function handleProjectIntake(req, res) {
  if (req.method === 'GET') {
    if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) return sendJson(res, 403, { ok: false, error: 'Admin token required.' });
    try {
      const text = await readFile(intakeFile, 'utf8');
      const records = text.trim().split('\n').filter(Boolean).slice(-50).map(line => JSON.parse(line));
      return sendJson(res, 200, { ok: true, records });
    } catch {
      return sendJson(res, 200, { ok: true, records: [] });
    }
  }

  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (!checkRateLimit(req, 'project-intake')) return sendJson(res, 429, { ok: false, error: 'Trop de demandes. Réessayez dans quelques minutes.' });

  const payload = await readJson(req);
  const { intake, errors } = validateIntake(payload);
  if (errors.length) return sendJson(res, 422, { ok: false, errors });

  const record = {
    id: `turner-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`,
    receivedAt: new Date().toISOString(),
    intake,
    budget: payload.budget ? calculateBudget(payload.budget) : null,
    meta: { ipHash: hashForLog(clientIp(req)), userAgent: normalizeString(req.headers['user-agent'], 240), referer: normalizeString(req.headers.referer, 300) },
  };

  await persistIntake(record);
  const crm = await maybeForwardIntake(record);
  return sendJson(res, 201, { ok: true, id: record.id, receivedAt: record.receivedAt, crm, message: 'Demande préparée. Elle est sauvegardée localement sur le serveur Turner.' });
}

async function handleBudgetSummary(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  const payload = await readJson(req);
  return sendJson(res, 200, { ok: true, summary: calculateBudget(payload) });
}

function apiConfig() {
  return {
    ok: true,
    brand: 'Maisons S. Turner',
    contact: { phone: '819 377-0570', tollFree: '1 800 567-9969', email: 'info@maisonsturner.ca', address: '1021, rue des Ateliers, Trois-Rivières, Québec' },
    capabilities: { projectIntake: true, localPersistence: true, crmWebhook: Boolean(crmWebhookUrl), budgetSummaryApi: true, adminListing: Boolean(adminToken), runtimeFallbacks: true },
  };
}

async function gunzipText(relativePath) {
  const bytes = await readFile(join(root, relativePath));
  return (await gunzipAsync(bytes)).toString('utf8');
}

function patchVisualUrls(source) {
  let out = source;
  for (const [local, remote] of visualSourceMap) out = out.replaceAll(local, remote);
  return out;
}

function baselineHeadMarkup() {
  const baselineJson = JSON.stringify({ ...visualBaseline, preloadVisuals }).replaceAll('</script', '<\\/script');
  return `\n<meta name="turner-baseline" content="${escapeHtml(`${visualBaseline.mode}/${visualBaseline.payload}`)}">\n<link rel="preconnect" href="https://maisonsturner.ca" crossorigin>\n<link rel="dns-prefetch" href="//maisonsturner.ca">\n<link rel="preload" as="image" href="${escapeHtml(preloadVisuals[0])}" fetchpriority="high">\n<script>window.__TURNER_BASELINE__=${baselineJson};</script>`;
}

function enhanceCompare(html) {
  if (!html.includes('id="hide-compare"')) {
    html = html.replace(
      '<button class="button button-primary" type="button" id="open-compare">Comparer</button>',
      '<div class="compare-actions"><button class="button button-primary" type="button" id="open-compare">Comparer</button><button class="compare-mini-button" type="button" id="hide-compare">Masquer</button><button class="compare-mini-button" type="button" id="clear-compare">Vider</button></div>'
    );
    html = html.replace('</aside>\n\n    <section class="transparency', '</aside>\n    <button class="compare-return" type="button" id="show-compare" hidden>Afficher comparaison</button>\n\n    <section class="transparency');
  }
  return html;
}

const compareCss = `
.compare-actions{display:flex;align-items:center;gap:8px}.compare-actions .button{min-height:42px;padding-inline:18px}.compare-mini-button,.compare-return{min-height:42px;padding:0 13px;color:var(--white);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:7px;cursor:pointer;font-size:.72rem;font-weight:800}.compare-mini-button:hover,.compare-return:hover{background:rgba(255,255,255,.14)}.compare-return{position:fixed;z-index:250;right:max(18px,calc((100vw - var(--shell))/2));bottom:18px;color:var(--white);background:var(--navy);box-shadow:var(--shadow-md)}.compare-return[hidden]{display:none}@media(max-width:980px){.compare-actions{grid-column:1/-1}.compare-actions>*{flex:1}}@media(max-width:720px){.compare-return{right:10px;bottom:10px;left:10px;width:auto}}
`;

const fallbackCss = `
/* Completion layer: only fills missing original-runtime sections. */
.turner-fallback-models{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:18px 0 40px}.turner-fallback-card{background:var(--white,#fff);border:1px solid var(--border,#eadfd4);border-radius:18px;overflow:hidden;box-shadow:0 14px 36px rgba(9,31,44,.09)}.turner-fallback-card img{width:100%;height:190px;object-fit:cover}.turner-fallback-card-body{padding:16px}.turner-fallback-card h3{font-family:var(--display-font, Georgia, serif);font-size:1.7rem;margin:.2rem 0}.turner-fallback-card p{color:var(--muted,#64707a);margin:.25rem 0 .8rem}.turner-fallback-tag{display:inline-flex;margin-top:-38px;margin-left:12px;position:relative;z-index:1;background:rgba(9,31,44,.88);color:white;border-radius:999px;padding:7px 10px;font-size:.72rem;font-weight:800}.turner-fallback-specs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.turner-fallback-specs span{background:var(--cream,#f6f1ea);border-radius:10px;padding:9px;text-align:center;font-size:.78rem}.turner-fallback-actions{display:flex;gap:8px}.turner-fallback-actions button{min-height:36px;border:1px solid var(--copper,#bd6740);border-radius:8px;background:white;color:var(--copper,#bd6740);font-weight:800;padding:0 13px}.turner-fallback-panel,.turner-fallback-faq{border:1px solid var(--border,#eadfd4);border-radius:16px;background:white;padding:22px;margin-top:14px}.turner-fallback-panel h3{font-family:var(--display-font, Georgia, serif);font-size:2rem;margin:.2rem 0}.turner-fallback-panel ul{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:8px}.turner-fallback-panel li{background:var(--cream,#f6f1ea);border-radius:10px;padding:10px}.turner-fallback-faq details{border:1px solid var(--border,#eadfd4);border-radius:12px;background:white;margin:10px 0;overflow:hidden}.turner-fallback-faq summary{cursor:pointer;font-weight:900;padding:15px 16px}.turner-fallback-faq p{padding:0 16px 16px;margin:0;color:var(--muted,#64707a);line-height:1.5}.turner-toast{position:fixed;z-index:500;left:16px;right:16px;bottom:16px;background:#071b27;color:white;border-radius:12px;padding:13px 16px;text-align:center;box-shadow:0 16px 44px rgba(0,0,0,.24)}html{scroll-behavior:smooth}body{text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.hero h1,.title,.section-title,.display{text-wrap:balance}body.turner-compare-visible{padding-bottom:96px}@media(max-width:720px){.turner-fallback-models{grid-template-columns:1fr}.turner-fallback-card img{height:210px}body.turner-compare-visible{padding-bottom:128px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
`;

function completionJs() {
  const modelsJson = JSON.stringify(fallbackModels).replaceAll('</script', '<\\/script');
  return `(() => {
    const models = ${modelsJson};
    const $ = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => [...r.querySelectorAll(s)];
    const text = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
    const sectionContaining = (...needles) => $$('section, main > div, main').find(node => needles.every(n => text(node).toLowerCase().includes(n.toLowerCase())));
    const toast = msg => { const n=document.createElement('div'); n.className='turner-toast'; n.textContent=msg; document.body.appendChild(n); setTimeout(()=>n.remove(), 5200); };
    function existingRealCards(section) {
      if (!section) return 0;
      return $$('article, .model-card, [data-model-id]', section).filter(n => !n.closest('[data-turner-fallback-models]')).length;
    }
    function ensureModelFallback() {
      const section = sectionContaining('6 modèles') || $('#modeles');
      if (!section || section.querySelector('[data-turner-fallback-models]') || existingRealCards(section) >= 3) return;
      const grid = document.createElement('div');
      grid.className = 'turner-fallback-models';
      grid.dataset.turnerFallbackModels = 'true';
      grid.innerHTML = models.map(m => '<article class="turner-fallback-card"><img src="'+m.image+'" alt="Modèle '+m.name+'" loading="lazy"><span class="turner-fallback-tag">'+m.type+' · '+m.style+'</span><div class="turner-fallback-card-body"><div style="display:flex;justify-content:space-between;gap:12px"><h3>'+m.name+'</h3><strong>'+m.area+' pi²</strong></div><p>'+m.desc+'</p><div class="turner-fallback-specs"><span><b>'+m.bedrooms+'</b><br>Ch.</span><span><b>'+m.baths+'</b><br>S.B.</span><span><b>'+m.garage+'</b><br>Garage</span></div><div class="turner-fallback-actions"><button type="button">Voir</button><button type="button" data-turner-fallback-compare="'+m.name+'">Comparer</button></div></div></article>').join('');
      const marker = $$('h1,h2,h3,p,div', section).find(n => /réinitialiser les filtres/i.test(text(n))) || section;
      if (marker === section) section.appendChild(grid); else marker.insertAdjacentElement('afterend', grid);
    }
    function ensureProjectFallback() {
      const section = sectionContaining('de votre terrain', 'terrain et budget');
      if (!section || /comprendre le terrain/i.test(text(section)) || section.querySelector('[data-turner-fallback-project]')) return;
      const panel = document.createElement('div');
      panel.className = 'turner-fallback-panel';
      panel.dataset.turnerFallbackProject = 'true';
      panel.innerHTML = '<small>ÉTAPE 01</small><h3>Comprendre le terrain, les besoins et la capacité budgétaire.</h3><ul><li>Rassembler les informations du terrain</li><li>Définir chambres, étages et sous-sol</li><li>Identifier les travaux faits par le client</li><li>Sélectionner un plan de départ</li></ul>';
      section.appendChild(panel);
    }
    function ensureFaqFallback() {
      const section = sectionContaining('questions utiles', 'premier rendez-vous') || sectionContaining('les réponses', 'rendez-vous');
      if (!section || /livrez-vous partout/i.test(text(section)) || section.querySelector('[data-turner-fallback-faq]')) return;
      const faq = document.createElement('div');
      faq.className = 'turner-fallback-faq';
      faq.dataset.turnerFallbackFaq = 'true';
      faq.innerHTML = '<details open><summary>01 Livrez-vous partout au Québec?</summary><p>Oui. La faisabilité et les coûts se valident selon l’emplacement et l’accès au terrain.</p></details><details><summary>02 Puis-je modifier un plan existant?</summary><p>Oui. Les modèles servent de point de départ; les adaptations se valident avec l’équipe Turner.</p></details><details><summary>03 Le planificateur donne-t-il un vrai prix?</summary><p>Non. Il prépare une discussion budgétaire, sans remplacer une soumission officielle.</p></details><details><summary>04 Qu’est-ce qui réduit les surprises?</summary><p>Des inclusions visibles, des responsabilités séparées et des étapes de projet expliquées avant l’engagement.</p></details>';
      section.appendChild(faq);
    }
    function compareSync() {
      const tray = $('#compare-tray');
      const show = $('#show-compare');
      const count = $$('.compare-chip').length || $$('[data-compare-id][aria-pressed="true"]').length;
      const visible = !!(tray && !tray.hidden);
      document.body.classList.toggle('turner-compare-visible', visible);
      if (show) show.textContent = 'Afficher comparaison' + (count ? ' (' + count + ')' : '');
    }
    function collectForm(form) {
      const fields = {};
      $$('input, select, textarea', form).forEach((field, index) => {
        if (field.type === 'submit' || field.type === 'button') return;
        const label = field.name || field.id || field.getAttribute('aria-label') || field.placeholder || field.closest('label')?.textContent || field.previousElementSibling?.textContent || 'field_' + index;
        fields[label] = field.type === 'checkbox' ? field.checked : field.value;
      });
      return fields;
    }
    function wireForms() {
      $$('form').forEach(form => {
        if (form.dataset.turnerApiWired || !/nom|courriel|parlez|projet|code postal|téléphone|telephone/i.test(text(form))) return;
        form.dataset.turnerApiWired = 'true';
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const button = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
          const previous = button?.textContent;
          if (button) { button.disabled = true; button.textContent = 'Préparation…'; }
          try {
            const response = await fetch('/api/project-intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: collectForm(form), source: 'contact-form' }) });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error((result.errors || []).map(e => e.message).join(' ') || result.error || 'Demande refusée');
            toast(result.message || 'Demande sauvegardée.');
            form.dataset.lastIntakeId = result.id;
          } catch (error) {
            toast(error.message || 'Impossible de préparer la demande.');
          } finally {
            if (button) { button.disabled = false; button.textContent = previous || 'Préparer ma demande →'; }
          }
        });
      });
    }
    function run() { ensureModelFallback(); ensureProjectFallback(); ensureFaqFallback(); wireForms(); compareSync(); }
    document.addEventListener('click', event => {
      if (event.target.closest('#hide-compare')) { const tray=$('#compare-tray'), show=$('#show-compare'); if (tray && show) { tray.hidden=true; show.hidden=false; compareSync(); } }
      if (event.target.closest('#show-compare')) { const tray=$('#compare-tray'), show=$('#show-compare'); if (tray && show) { tray.hidden=false; show.hidden=true; compareSync(); } }
      if (event.target.closest('#clear-compare')) { $$('[data-remove-compare]').forEach(button => button.click()); $$('[data-compare-id][aria-pressed="true"]').forEach(button => button.click()); const tray=$('#compare-tray'), show=$('#show-compare'); if (tray) tray.hidden=true; if (show) show.hidden=true; compareSync(); }
      queueMicrotask(run);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
    setTimeout(run, 120); setTimeout(run, 800); setTimeout(run, 1800);
  })();`;
}

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
  const completeJs = completionJs().replaceAll('</script>', '<\\/script>');
  return html
    .replace('</head>', `${baselineHeadMarkup()}\n<style>${css}\n${compareCss}\n${fallbackCss}</style></head>`)
    .replace('</body>', `<script>${safeJs}</script><script>${completeJs}</script></body>`);
}

function send(res, status, body, type = 'text/plain; charset=utf-8', cache = 'no-store, max-age=0') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2), mime['.json']);
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
    visuals: { sourceMapEntries: visualSourceMap.size, highResolutionTurnerSources: true, preloadCount: preloadVisuals.length, preloadedHero: preloadVisuals[0] },
    implementations: implementationStatus,
    completionLayer: { modelFallbacks: fallbackModels.length, projectFallback: true, faqFallback: true, contactApiBridge: true },
    decoded: { html: html.length, css: css.length, js: js.length },
    pid: process.pid,
    host,
    port,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const route = cleanPath(req.url || '/');
    if (route === '__health') return sendJson(res, 200, await health());
    if (route === '__baseline') return sendJson(res, 200, visualBaseline);
    if (route === '__visuals') return sendJson(res, 200, { sourceMap: [...visualSourceMap.entries()], preloadVisuals });
    if (route === 'api/config') return sendJson(res, 200, apiConfig());
    if (route === 'api/implementation-status') return sendJson(res, 200, { ok: true, ...implementationStatus });
    if (route === 'api/budget/summary') return handleBudgetSummary(req, res);
    if (route === 'api/project-intake') return handleProjectIntake(req, res);
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
    send(res, 200, body, mime[ext] || 'application/octet-stream', noStoreExts.has(ext) ? 'no-store, max-age=0' : 'public, max-age=3600');
  } catch (error) {
    sendJson(res, error.status || 500, { ok: false, error: error.message || 'Server error' });
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
