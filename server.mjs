import http from 'node:http';
import { readFile, stat, mkdir, appendFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseDirectory, parseFlag, parseHost, parseHttpUrl, parseOrigin, parsePort } from './scripts/runtime-config.mjs';
import { buildSitemapXml, renderCatalogPage, renderModelPage } from './lib/seo-pages.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = parsePort(process.env.PORT);
const host = parseHost(process.env.HOST);
const gunzipAsync = promisify(gunzip);
const intakeDir = parseDirectory(process.env.TURNER_DATA_DIR, { name: 'TURNER_DATA_DIR', fallback: join(root, '.turner-data') });
const intakeFile = join(intakeDir, 'project-intake.jsonl');
const adminToken = process.env.TURNER_ADMIN_TOKEN || '';
const crmWebhookUrl = parseHttpUrl(process.env.TURNER_CRM_WEBHOOK_URL, { name: 'TURNER_CRM_WEBHOOK_URL', optional: true });
const fallbackOnly = parseFlag(process.env.TURNER_FALLBACK_ONLY, { name: 'TURNER_FALLBACK_ONLY' });
const publicOrigin = parseOrigin(process.env.TURNER_PUBLIC_ORIGIN, { name: 'TURNER_PUBLIC_ORIGIN', fallback: 'https://maisonsturner.ca' });
const indexable = parseFlag(process.env.TURNER_INDEXABLE, { name: 'TURNER_INDEXABLE', fallback: true });
const officialContent = JSON.parse(await readFile(join(root, 'data', 'official-content.json'), 'utf8'));

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
let nextRateLimitSweep = 0;

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

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

const seoTitle = 'Maisons usinées au Québec | Maisons S. Turner';
const seoDescription = `Découvrez ${officialContent.models.length} modèles de maisons et chalets usinés personnalisables, fabriqués au Québec par Maisons S. Turner, avec un accompagnement clair du terrain aux clés.`;
const seoImage = preloadVisuals[0];

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
    'fallback model, comparison, project-step and FAQ experiences remain usable when the original client script is delayed or blocked',
    'diagnostics expose remaining prototype-only pieces through /api/implementation-status',
    `${officialContent.models.length} official model sheets are synchronized from the Turner sitemap with source provenance`,
    'official process, FAQ, module components, contact hours and verification links are included in the rendered application',
    'server-rendered SEO metadata, structured data, robots.txt and sitemap.xml are available without client-side JavaScript',
    `${officialContent.models.length} model pages and the catalogue index are rendered as crawlable HTML`,
  ],
  stillPrototype: [
    'budget values are still user-entered or sample values, not official pricing',
    'local intake storage and the privacy implementation still need production review before handling real submissions',
    'payment, appointment scheduling and CRM authentication are intentionally out of scope',
  ],
};

const fallbackModels = officialContent.models;
const fallbackProcessSteps = officialContent.processSteps;
const fallbackFaqItems = officialContent.faqItems;
const fallbackInclusionGroups = officialContent.inclusionGroups;

function cleanPath(urlPath = '/') {
  try {
    return decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  } catch {
    throw Object.assign(new Error('Malformed URL path.'), { status: 400 });
  }
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

function publicUrl(pathname = '/') {
  return new URL(pathname, `${publicOrigin}/`).href;
}

function hashForLog(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function tokenMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedHash = createHash('sha256').update(expected).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

function hasAdminAccess(req) {
  const authorization = String(req.headers.authorization || '');
  return authorization.startsWith('Bearer ') && tokenMatches(adminToken, authorization.slice(7));
}

function hasAllowedBrowserOrigin(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  const originHeader = String(req.headers.origin || '').trim();
  if (!originHeader) return true;
  let origin;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(origin.protocol)) return false;
  const requestHost = String(req.headers.host || '').trim().toLowerCase();
  return Boolean(requestHost) && origin.host.toLowerCase() === requestHost;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(req, bucket, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  if (now >= nextRateLimitSweep) {
    for (const [storedKey, timestamps] of rateLimits) {
      if (!timestamps.some(timestamp => now - timestamp < windowMs)) rateLimits.delete(storedKey);
    }
    nextRateLimitSweep = now + windowMs;
  }
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
  const text = await readBody(req);
  if (!type.includes('application/json')) throw Object.assign(new Error('Expected application/json'), { status: 415 });
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
  await mkdir(intakeDir, { recursive: true, mode: 0o700 });
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
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!hasAdminAccess(req)) return sendJson(res, 403, { ok: false, error: 'Admin token required.' });
    let text;
    try {
      text = await readFile(intakeFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(res, 200, { ok: true, records: [] });
      throw error;
    }
    const records = text.trim().split('\n').filter(Boolean).slice(-50).map(line => JSON.parse(line));
    return sendJson(res, 200, { ok: true, records });
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'HEAD', 'POST']);
  const payload = await readJson(req);
  if (!hasAllowedBrowserOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Cross-origin browser submissions are not allowed.' });
  if (!checkRateLimit(req, 'project-intake')) return sendJson(res, 429, { ok: false, error: 'Trop de demandes. Réessayez dans quelques minutes.' });
  const { intake, errors } = validateIntake(payload);
  if (errors.length) return sendJson(res, 422, { ok: false, errors });

  const record = {
    id: `turner-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`,
    receivedAt: new Date().toISOString(),
    intake,
    budget: payload.budget ? calculateBudget(payload.budget) : null,
    privacy: { rawIpStored: false, ipHashApplied: true },
    meta: { ipHash: hashForLog(clientIp(req)), userAgent: normalizeString(req.headers['user-agent'], 240), referer: normalizeString(req.headers.referer, 300) },
  };

  await persistIntake(record);
  const crm = await maybeForwardIntake(record);
  return sendJson(res, 201, { ok: true, id: record.id, receivedAt: record.receivedAt, crm, message: 'Demande préparée. Elle est sauvegardée localement sur le serveur Turner.' });
}

async function handleBudgetSummary(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const payload = await readJson(req);
  return sendJson(res, 200, { ok: true, summary: calculateBudget(payload) });
}

function apiConfig() {
  return {
    ok: true,
    brand: officialContent.company.name,
    contact: officialContent.company,
    content: { verifiedAt: officialContent.verifiedAt, models: officialContent.models.length, sources: officialContent.sources, publicOrigin, indexable },
    capabilities: { projectIntake: true, localPersistence: true, crmWebhook: Boolean(crmWebhookUrl), budgetSummaryApi: true, adminListing: Boolean(adminToken), primaryClient: !fallbackOnly, runtimeFallbacks: true, officialContentSnapshot: true },
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

function replaceClientArray(source, name, value) {
  const startMarker = `  const ${name} = [`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf('\n  ];', start);
  if (start < 0 || end < 0) throw new Error(`The ${name} client array could not be replaced safely.`);
  return `${source.slice(0, start)}  const ${name} = ${JSON.stringify(value)};${source.slice(end + 5)}`;
}

function patchClientJs(source) {
  const legacyHandler = `    $('#contact-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      $('#contact-status').textContent = 'Prototype : votre demande est structurée localement. Aucune donnée n’a été envoyée.';
      showToast('Demande préparée — aucun envoi réel dans ce prototype.');
    });`;

  let output = source;
  if (output.includes('Prototype : votre demande est structurée localement.')) {
    if (!output.includes(legacyHandler)) throw new Error('The legacy contact handler could not be removed safely.');
    output = output.replace(legacyHandler, '');
  }

  output = replaceClientArray(output, 'models', officialContent.models);
  output = replaceClientArray(output, 'processSteps', officialContent.processSteps);
  output = replaceClientArray(output, 'faqItems', officialContent.faqItems);
  output = replaceClientArray(output, 'inclusionGroups', officialContent.inclusionGroups);
  output = output
    .replace('loading="eager"', 'loading="lazy"')
    .replace('const source = escapeHTML(model.localImage);', 'const source = escapeHTML(model.imageUrl);')
    .replace("if (state.filters.style && model.style !== state.filters.style) return false;", "if (state.filters.style && !(model.styles || [model.style]).includes(state.filters.style)) return false;")
    .replace("'Tous les modèles du prototype'", "'Catalogue officiel vérifié'")
    .replace('<button class="details-button" type="button" data-model-id="${model.id}">Voir le modèle →</button>', '<a class="details-button" href="/modeles/${escapeHTML(model.id)}/">Voir le modèle →</a>')
    .replace('models: models.map(({ remoteImage, localImage, ...model }) => model),', 'models: models.map((model) => ({ ...model })),')
    .replace('href="https://maisonsturner.ca/modeles/${model.id}"', 'href="${escapeHTML(model.sourceUrl)}"')
    .replace('La comparaison porte sur les données publiques utilisées dans ce prototype. Un conseiller doit confirmer les options et modifications possibles.', 'La comparaison porte sur les spécifications publiées par Turner. Les options doivent être confirmées avec un conseiller.');
  return output;
}

function baselineHeadMarkup() {
  const baselineJson = JSON.stringify({ ...visualBaseline, preloadVisuals }).replaceAll('</script', '<\\/script');
  return `\n<meta name="turner-baseline" content="${escapeHtml(`${visualBaseline.mode}/${visualBaseline.payload}`)}">\n<meta name="turner-content-verified-at" content="${escapeHtml(officialContent.verifiedAt)}">\n<link rel="preconnect" href="https://maisonsturner.ca" crossorigin>\n<link rel="dns-prefetch" href="//maisonsturner.ca">\n<link rel="preload" as="image" href="${escapeHtml(preloadVisuals[0])}" fetchpriority="high">\n<script>window.__TURNER_BASELINE__=${baselineJson};</script>`;
}

function seoHeadMarkup() {
  const canonical = publicUrl('/');
  const businessId = `${canonical}#business`;
  const websiteId = `${canonical}#website`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'HomeAndConstructionBusiness',
        '@id': businessId,
        name: officialContent.company.name,
        alternateName: 'Maisons S. Turner',
        url: canonical,
        image: seoImage,
        description: seoDescription,
        foundingDate: officialContent.company.foundedOn,
        telephone: '+1-819-377-0570',
        email: officialContent.company.email,
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1021, rue des Ateliers',
          addressLocality: 'Trois-Rivières',
          addressRegion: 'QC',
          postalCode: 'G9B 7J5',
          addressCountry: 'CA',
        },
        areaServed: { '@type': 'AdministrativeArea', name: 'Québec' },
        openingHoursSpecification: [
          { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], opens: '09:00', closes: '16:30' },
          { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Friday', opens: '09:00', closes: '16:00' },
          { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '12:00', closes: '16:00' },
        ],
        sameAs: ['https://maisonsturner.ca/'],
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        url: canonical,
        name: 'Maisons S. Turner',
        inLanguage: 'fr-CA',
        publisher: { '@id': businessId },
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        url: `${canonical}#faq`,
        inLanguage: 'fr-CA',
        mainEntity: officialContent.faqItems.map(item => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
    ],
  }).replaceAll('<', '\\u003c');
  return `<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_CA">
<meta property="og:site_name" content="Maisons S. Turner">
<meta property="og:title" content="${escapeHtml(seoTitle)}">
<meta property="og:description" content="${escapeHtml(seoDescription)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(seoImage)}">
<meta property="og:image:alt" content="Maison usinée contemporaine de Maisons S. Turner">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(seoTitle)}">
<meta name="twitter:description" content="${escapeHtml(seoDescription)}">
<meta name="twitter:image" content="${escapeHtml(seoImage)}">
<script type="application/ld+json">${structuredData}</script>`;
}

function enhanceSeo(html) {
  const originalHeading = '<h1 id="hero-title">Votre maison.<br />Vos choix.<br /><span>Un prix qui tient la route.</span></h1>';
  if (!html.includes(originalHeading)) throw new Error('The primary hero heading could not be updated safely.');
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(seoTitle)}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escapeHtml(seoDescription)}">`)
    .replace(originalHeading, '<h1 id="hero-title">Maisons usinées<br />personnalisées<br /><span>au Québec.</span></h1>');
}

function robotsText() {
  if (!indexable) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\nSitemap: ${publicUrl('/sitemap.xml')}\n`;
}

function sitemapXml() {
  return buildSitemapXml({ content: officialContent, publicOrigin });
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

function enhanceContact(html) {
  const consent = '<label class="consent"><input type="checkbox" required />';
  if (!html.includes(consent)) return html;
  return html.replace(
    consent,
    '<label class="turner-honeypot" aria-hidden="true"><span>Ne pas remplir ce champ</span><input type="text" name="website" tabindex="-1" autocomplete="off" /></label>\n          <label class="consent"><input type="checkbox" name="consent" required />'
  );
}

function replaceSelectOptions(html, id, options) {
  const pattern = new RegExp(`(<select id="${id}"[^>]*>)[\\s\\S]*?(</select>)`);
  const markup = options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
  if (!pattern.test(html)) throw new Error(`The ${id} filter could not be updated safely.`);
  return html.replace(pattern, `$1${markup}$2`);
}

function enhanceOfficialContent(html) {
  const verifiedLabel = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'America/Toronto' }).format(new Date(officialContent.verifiedAt));
  const modelTypes = [...new Set(officialContent.models.map(model => model.type))];
  const modelStyles = [...new Set(officialContent.models.flatMap(model => model.styles))];
  const bedroomCounts = [...new Set(officialContent.models.map(model => model.bedrooms))].sort((left, right) => left - right);
  html = replaceSelectOptions(html, 'filter-type', [{ value: '', label: 'Tous' }, ...modelTypes.map(value => ({ value, label: value }))]);
  html = replaceSelectOptions(html, 'filter-style', [{ value: '', label: 'Tous' }, ...modelStyles.map(value => ({ value, label: value }))]);
  html = replaceSelectOptions(html, 'filter-bedrooms', [{ value: '', label: 'Toutes' }, ...bedroomCounts.map(value => ({ value: String(value), label: `${value} chambre${value > 1 ? 's' : ''}` }))]);

  const processTabs = officialContent.processSteps.map((step, index) => `<button type="button" role="tab" aria-selected="${index === 0}" data-step="${index}"><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(step.shortTitle)}</button>`).join('');
  html = html.replace(/<div class="process-tabs" role="tablist" aria-label="Étapes du projet">[\s\S]*?<\/div>\n        <div class="process-detail"/, `<div class="process-tabs" role="tablist" aria-label="Étapes du projet">${processTabs}</div>\n        <div class="process-detail"`);

  const certifications = [
    { label: `RBQ ${officialContent.company.licenseRbq}`, detail: 'Numéro recoupé avec le profil APCHQ', sourceUrl: officialContent.sources.apchqProfile, verificationUrl: officialContent.sources.rbqDirectory },
    ...officialContent.certifications,
  ];
  const certificationCards = certifications.map(item => `<article><a href="${escapeHtml(item.verificationUrl || item.sourceUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span><small>Consulter la source</small></a></article>`).join('');
  const certificationMarkup = `<section class="certifications" aria-label="Certifications, associations et vérifications"><div class="shell certification-grid reveal"><div class="certification-lead"><strong>Des normes.</strong><span>Des sources vérifiables.</span></div>${certificationCards}</div><p class="shell certification-note">Les licences, adhésions et accréditations peuvent évoluer. Consultez les répertoires liés avant de signer un contrat.</p></section>`;
  html = html.replace(/<section class="certifications"[\s\S]*?<\/section>/, certificationMarkup);

  html = html
    .replace('<span id="result-count">6 modèles</span>\n          <p id="active-filter-copy">Tous les modèles du prototype</p>', `<span id="result-count">${officialContent.models.length} modèles</span>\n          <p id="active-filter-copy">Catalogue officiel vérifié</p>\n          <p class="official-content-note">Fiches synchronisées le ${escapeHtml(verifiedLabel)} · <a href="/modeles/">Toutes les fiches</a> · <a href="${escapeHtml(officialContent.sources.modelSitemap)}" target="_blank" rel="noreferrer">Source Turner</a></p>`)
    .replace('aria-label="Visualisation conceptuelle d’une maison contemporaine"', 'aria-label="Maison modèle Athènes publiée par Maisons S. Turner"')
    .replace('alt="Maison modulaire contemporaine au bord d’un lac dans un paysage boisé québécois"', 'alt="Maison modèle Athènes dans un paysage boisé"')
    .replace('<div><strong>1021, rue des Ateliers</strong><span>Trois-Rivières, Québec G9B 7J5</span></div>', `<div><strong>1021, rue des Ateliers</strong><span>Trois-Rivières, Québec G9B 7J5</span></div><div class="contact-hours"><strong>Lun–jeu 9 h–16 h 30 · ven 9 h–16 h</strong><span>Samedi 12 h–16 h · dimanche fermé · sur rendez-vous</span><a href="${escapeHtml(officialContent.sources.contact)}" target="_blank" rel="noreferrer">Confirmer les heures</a></div>`)
    .replace('J’accepte que mes renseignements servent à répondre à cette demande.', `J’accepte que mes renseignements servent à répondre à cette demande, conformément à la <a href="${escapeHtml(officialContent.sources.privacy)}" target="_blank" rel="noreferrer">politique de confidentialité</a>.`)
    .replace('Synthèse de contenu pour le prototype. Le devis final demeure la source contractuelle.', `Synthèse de la page officielle « Composantes des modules », vérifiée le ${escapeHtml(verifiedLabel)}. Le devis final demeure la source contractuelle.`)
    .replace('© <span id="current-year"></span> Maisons S. Turner — Prototype de refonte', '© <span id="current-year"></span> Maisons S. Turner — Catalogue de travail sourcé')
    .replace('Licence RBQ : 8002-1710-85 · Visuels conceptuels à remplacer avant production', `Licence RBQ : ${escapeHtml(officialContent.company.licenseRbq)} · Données publiques vérifiées le ${escapeHtml(verifiedLabel)}`);
  return html;
}

const compareCss = `
.compare-actions{display:flex;align-items:center;gap:8px}.compare-actions .button{min-height:42px;padding-inline:18px}.compare-mini-button,.compare-return{min-height:42px;padding:0 13px;color:var(--white);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:7px;cursor:pointer;font-size:.72rem;font-weight:800}.compare-mini-button:hover,.compare-return:hover{background:rgba(255,255,255,.14)}.compare-return{position:fixed;z-index:250;right:max(18px,calc((100vw - var(--shell))/2));bottom:18px;color:var(--white);background:var(--navy);box-shadow:var(--shadow-md)}.compare-return[hidden]{display:none}@media(max-width:980px){.compare-actions{grid-column:1/-1}.compare-actions>*{flex:1}}@media(max-width:720px){.compare-return{right:10px;bottom:10px;left:10px;width:auto}}
`;

const fallbackCss = `
/* Completion layer: only fills missing original-runtime sections. */
.form-status[data-state="pending"]{color:var(--muted,#64707a)}.form-status[data-state="error"]{color:#a2382b}.form-status[data-state="success"]{color:var(--success,#26734d)}
.official-content-note{margin-top:4px;font-size:.78rem;color:var(--muted,#64707a)}.official-content-note a,.contact-hours a,.consent a{color:inherit;text-decoration:underline;text-underline-offset:3px}.certification-grid article a{display:flex;flex-direction:column;justify-content:center;width:100%;height:100%;color:inherit;text-decoration:none}.certification-grid article small{margin-top:5px;font-size:.68rem;text-transform:uppercase}.certification-note{padding-top:12px;padding-bottom:18px;font-size:.78rem;line-height:1.5}.model-card,.turner-fallback-card{content-visibility:auto;contain-intrinsic-size:520px}.contact-hours a{min-height:32px;margin-top:4px;font-size:.75rem}
.brand,.compare-toggle,.details-button,.quote-button,.text-button,.turner-fallback-actions button,.turner-fallback-actions a{min-height:44px}.model-actions a.details-button{display:inline-flex;align-items:center;font-size:.78rem;font-weight:780;text-decoration:none}.model-actions a.details-button:hover{text-decoration:underline;text-underline-offset:4px}.consent{min-height:44px}.consent input[type="checkbox"]{min-width:18px;min-height:18px}.range-field input[type="range"]{min-height:44px;touch-action:pan-y}@media(max-width:720px){footer a,footer button{display:flex;align-items:center;min-height:44px}.compare-mini-button,.compare-return{min-height:44px}.faq-question{grid-template-columns:34px minmax(0,1fr) 48px}.faq-plus{justify-self:center}}
.turner-honeypot{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important}.turner-fallback-models{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:18px 0 40px}.turner-fallback-card{background:var(--white,#fff);border:1px solid var(--border,#eadfd4);border-radius:8px;overflow:hidden;box-shadow:0 14px 36px rgba(9,31,44,.09)}.turner-fallback-card img{width:100%;height:190px;object-fit:cover}.turner-fallback-card-body{padding:16px}.turner-fallback-card h3{font-family:var(--display-font,Georgia,serif);font-size:1.7rem;margin:.2rem 0}.turner-fallback-card p{color:var(--muted,#64707a);margin:.25rem 0 .8rem}.turner-fallback-tag{display:inline-flex;margin-top:-38px;margin-left:12px;position:relative;z-index:1;background:rgba(9,31,44,.88);color:white;border-radius:999px;padding:7px 10px;font-size:.72rem;font-weight:800}.turner-fallback-specs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.turner-fallback-specs span{background:var(--cream,#f6f1ea);border-radius:8px;padding:9px;text-align:center;font-size:.78rem}.turner-fallback-actions{display:flex;gap:8px}.turner-fallback-actions button,.turner-fallback-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--copper,#bd6740);border-radius:8px;background:white;color:var(--copper,#bd6740);font-weight:800;padding:0 13px;text-decoration:none}.turner-fallback-panel,.turner-fallback-faq{border:1px solid var(--border,#eadfd4);border-radius:8px;background:white;padding:22px;margin-top:14px}.turner-fallback-panel h3{font-family:var(--display-font,Georgia,serif);font-size:2rem;margin:.2rem 0}.turner-fallback-panel ul{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:8px}.turner-fallback-panel li{background:var(--cream,#f6f1ea);border-radius:8px;padding:10px}.turner-fallback-faq details{border:1px solid var(--border,#eadfd4);border-radius:8px;background:white;margin:10px 0;overflow:hidden}.turner-fallback-faq summary{cursor:pointer;font-weight:900;padding:15px 16px}.turner-fallback-faq p{padding:0 16px 16px;margin:0;color:var(--muted,#64707a);line-height:1.5}.turner-toast{position:fixed;z-index:500;left:16px;right:16px;bottom:16px;background:#071b27;color:white;border-radius:8px;padding:13px 16px;text-align:center;box-shadow:0 16px 44px rgba(0,0,0,.24)}html{scroll-behavior:smooth}body{text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.hero h1,.title,.section-title,.display{text-wrap:balance}body.turner-compare-visible{padding-bottom:96px}@media(max-width:720px){.turner-fallback-models{grid-template-columns:1fr}.turner-fallback-card img{height:210px}body.turner-compare-visible{padding-bottom:128px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
`;

function completionJs() {
  const modelsJson = JSON.stringify(fallbackModels).replaceAll('</script', '<\\/script');
  const processStepsJson = JSON.stringify(fallbackProcessSteps).replaceAll('</script', '<\\/script');
  const faqItemsJson = JSON.stringify(fallbackFaqItems).replaceAll('</script', '<\\/script');
  const inclusionGroupsJson = JSON.stringify(fallbackInclusionGroups).replaceAll('</script', '<\\/script');
  return `(() => {
    const models = ${modelsJson};
    const processSteps = ${processStepsJson};
    const faqItems = ${faqItemsJson};
    const inclusionGroups = ${inclusionGroupsJson};
    const $ = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => [...r.querySelectorAll(s)];
    const number = new Intl.NumberFormat('fr-CA');
    const currency = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
    const fallbackCompared = new Set();
    const text = n => (n?.textContent || '').replace(/\\s+/g, ' ').trim();
    const sectionContaining = (...needles) => $$('section, main > div, main').find(node => needles.every(n => text(node).toLowerCase().includes(n.toLowerCase())));
    const escapeText = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
    const toast = msg => {
      const existing = $('#toast');
      if (existing) {
        existing.textContent = msg;
        existing.classList.add('is-visible');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => existing.classList.remove('is-visible'), 5200);
        return;
      }
      const node=document.createElement('div');
      node.className='turner-toast';
      node.setAttribute('role','status');
      node.textContent=msg;
      document.body.appendChild(node);
      setTimeout(()=>node.remove(),5200);
    };
    function openDialog(dialog) {
      if (!dialog) return;
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
      document.body.classList.add('dialog-open');
    }
    function closeDialog(dialog) {
      if (!dialog) return;
      if (typeof dialog.close === 'function' && dialog.open) dialog.close(); else dialog.removeAttribute('open');
      if (!$('dialog[open]')) document.body.classList.remove('dialog-open');
    }
    function modelById(id) { return models.find(model => model.id === id); }
    function ensureModelOptions() {
      $$('#contact-model, #budget-model').forEach(select => {
        if (select.options.length) return;
        select.innerHTML = '<option value="">À déterminer</option>' + models.map(model => '<option value="'+escapeText(model.id)+'">'+escapeText(model.name)+' — '+number.format(model.area)+' pi²</option>').join('');
      });
    }
    function existingRealCards(section) {
      if (!section) return 0;
      return $$('#model-grid .model-card', section).length;
    }
    function ensureModelFallback() {
      const section = $('#modeles') || sectionContaining('modèles');
      if (!section) return;
      const fallback = section.querySelector('[data-turner-fallback-models]');
      if (window.TurnerPrototype || existingRealCards(section) > 0) {
        if (fallback) fallback.remove();
        if (fallbackCompared.size) { fallbackCompared.clear(); updateFallbackCompareUi(); }
        return;
      }
      if (fallback) return;
      const grid = document.createElement('div');
      grid.className = 'turner-fallback-models';
      grid.dataset.turnerFallbackModels = 'true';
      grid.innerHTML = models.map(m => '<article class="turner-fallback-card" data-turner-fallback-model="'+escapeText(m.id)+'" data-type="'+escapeText(m.type)+'" data-styles="'+escapeText(m.styles.join('|'))+'" data-bedrooms="'+m.bedrooms+'" data-garage="'+String(m.garage)+'" data-area="'+m.area+'"><img src="'+escapeText(m.imageUrl)+'" alt="Modèle '+escapeText(m.name)+'" loading="lazy"><span class="turner-fallback-tag">'+escapeText(m.type)+' · '+escapeText(m.style)+'</span><div class="turner-fallback-card-body"><div style="display:flex;justify-content:space-between;gap:12px"><h3>'+escapeText(m.name)+'</h3><strong>'+number.format(m.area)+' pi²</strong></div><p>'+escapeText(m.description)+'</p><div class="turner-fallback-specs"><span><b>'+m.bedrooms+'</b><br>Ch.</span><span><b>'+m.bathrooms+'</b><br>S.B.</span><span><b>'+(m.garage?'Oui':'Non')+'</b><br>Garage</span></div><div class="turner-fallback-actions"><a href="/modeles/'+escapeText(m.id)+'/">Voir la fiche</a><button type="button" aria-pressed="false" data-turner-fallback-compare="'+escapeText(m.id)+'">Comparer</button></div></div></article>').join('');
      const marker = $('.catalog-toolbar', section) || section;
      if (marker === section) section.appendChild(grid); else marker.insertAdjacentElement('afterend', grid);
    }
    function renderFallbackProcess(index) {
      if (window.TurnerPrototype) return;
      const step = processSteps[index] || processSteps[0];
      const detail = $('#process-detail');
      if (!detail) return;
      detail.dataset.turnerFallbackProject = 'true';
      detail.innerHTML = '<span class="process-number">'+escapeText(step.label)+'</span><h3>'+escapeText(step.title)+'</h3><p>'+escapeText(step.copy)+'</p><ul class="process-checks">'+step.checks.map(item=>'<li>'+escapeText(item)+'</li>').join('')+'</ul>';
      $$('.process-tabs button').forEach((button,buttonIndex)=>{ const selected=buttonIndex===index; button.setAttribute('aria-selected',String(selected)); button.tabIndex=selected?0:-1; });
    }
    function ensureProjectFallback() {
      if (window.TurnerPrototype) return;
      const detail = $('#process-detail');
      if (!detail || detail.dataset.turnerFallbackProject) return;
      renderFallbackProcess(0);
    }
    function ensureFaqFallback() {
      const section = $('.faq') || sectionContaining('questions utiles', 'premier rendez-vous') || sectionContaining('les réponses', 'rendez-vous');
      if (!section) return;
      const fallback = section.querySelector('[data-turner-fallback-faq]');
      if ($$('#faq-list .faq-item').length) { fallback?.remove(); return; }
      if (fallback) return;
      const faq = document.createElement('div');
      faq.className = 'turner-fallback-faq';
      faq.dataset.turnerFallbackFaq = 'true';
      faq.innerHTML = faqItems.map((item,index) => '<details'+(index===0?' open':'')+'><summary>'+String(index+1).padStart(2,'0')+' '+escapeText(item.question)+'</summary><p>'+escapeText(item.answer)+'</p></details>').join('');
      const target = $('#faq-list') || section;
      target.appendChild(faq);
    }
    function ensureFallbackInclusions() {
      if (window.TurnerPrototype) return;
      const root = $('#inclusion-columns');
      if (!root || root.children.length) return;
      root.innerHTML = inclusionGroups.map(group => '<article class="inclusion-column"><h3>'+escapeText(group.title)+'</h3><p>'+escapeText(group.intro)+'</p><ul>'+group.items.map(item=>'<li>'+escapeText(item)+'</li>').join('')+'</ul></article>').join('');
    }
    function applyFallbackFilters() {
      if (window.TurnerPrototype) return;
      const grid = $('[data-turner-fallback-models]');
      if (!grid) return;
      const filters = {
        type: $('#filter-type')?.value || '',
        style: $('#filter-style')?.value || '',
        bedrooms: $('#filter-bedrooms')?.value || '',
        garage: $('#filter-garage')?.value || '',
        area: $('#filter-area')?.value || ''
      };
      let visible = 0;
      $$('[data-turner-fallback-model]',grid).forEach(card => {
        const area = Number(card.dataset.area);
        const matches = (!filters.type || card.dataset.type===filters.type) && (!filters.style || card.dataset.styles.split('|').includes(filters.style)) && (!filters.bedrooms || card.dataset.bedrooms===filters.bedrooms) && (!filters.garage || card.dataset.garage===filters.garage) && (!filters.area || (filters.area==='compact'&&area<900) || (filters.area==='medium'&&area>=900&&area<1200) || (filters.area==='large'&&area>=1200));
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      if ($('#result-count')) $('#result-count').textContent = visible+' modèle'+(visible>1?'s':'');
      if ($('#active-filter-copy')) $('#active-filter-copy').textContent = visible===models.length ? 'Catalogue officiel vérifié' : visible+' résultat'+(visible>1?'s':'')+' selon vos filtres';
      if ($('#empty-state')) $('#empty-state').hidden = visible !== 0;
    }
    function resetFallbackFilters() {
      if (window.TurnerPrototype) return;
      $('#finder-form')?.reset();
      applyFallbackFilters();
    }
    function budgetValue(selector) { return Math.max(0,Number($(selector)?.value)||0); }
    function updateFallbackBudget() {
      if (window.TurnerPrototype) return;
      const subtotal = ['#budget-house','#budget-land','#budget-foundation','#budget-site','#budget-options','#budget-other'].reduce((sum,selector)=>sum+budgetValue(selector),0);
      const rate = budgetValue('#budget-contingency');
      const contingency = subtotal*rate/100;
      const total = subtotal+contingency;
      const gap = budgetValue('#budget-target')-total;
      if ($('#contingency-label')) $('#contingency-label').textContent = rate+' %';
      if ($('#budget-subtotal')) $('#budget-subtotal').textContent = currency.format(subtotal);
      if ($('#budget-contingency-total')) $('#budget-contingency-total').textContent = currency.format(contingency);
      if ($('#budget-total')) $('#budget-total').textContent = currency.format(total);
      if ($('#budget-gap')) $('#budget-gap').textContent = currency.format(gap);
      $('#budget-gap-wrap')?.classList.toggle('positive',gap>=0);
      $('#budget-gap-wrap')?.classList.toggle('negative',gap<0);
    }
    function loadFallbackBudgetExample() {
      const values = {'#budget-model':'prague','#budget-target':575000,'#budget-house':325000,'#budget-land':85000,'#budget-foundation':65000,'#budget-site':28000,'#budget-options':22000,'#budget-other':12000,'#budget-contingency':8};
      Object.entries(values).forEach(([selector,value])=>{ if ($(selector)) $(selector).value=value; });
      updateFallbackBudget();
      toast('Exemple fictif chargé. Remplacez chaque montant par vos données.');
    }
    async function copyFallbackBudget() {
      const model = modelById($('#budget-model')?.value);
      const subtotal = ['#budget-house','#budget-land','#budget-foundation','#budget-site','#budget-options','#budget-other'].reduce((sum,selector)=>sum+budgetValue(selector),0);
      const rate = budgetValue('#budget-contingency');
      const total = subtotal+subtotal*rate/100;
      const summary = ['RÉSUMÉ DE PLANIFICATION — MAISONS S. TURNER','Modèle envisagé : '+(model?.name||'À déterminer'),'Budget cible : '+currency.format(budgetValue('#budget-target')),'Total simulé : '+currency.format(total),'Simulation indicative seulement — aucun prix officiel.'].join('\\n');
      try {
        await navigator.clipboard.writeText(summary);
      } catch {
        const textarea=document.createElement('textarea'); textarea.value=summary; textarea.style.position='fixed'; textarea.style.opacity='0'; document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
      }
      toast('Résumé copié dans le presse-papiers.');
    }
    function wireFallbackControls() {
      if (document.body.dataset.turnerFallbackControls) return;
      document.body.dataset.turnerFallbackControls = 'true';
      $('#finder-form')?.addEventListener('submit',event=>{ if (window.TurnerPrototype) return; event.preventDefault(); applyFallbackFilters(); });
      $$('#finder-form select').forEach(select=>select.addEventListener('change',()=>{ if (!window.TurnerPrototype) applyFallbackFilters(); }));
      $('#budget-form')?.addEventListener('input',()=>{ if (!window.TurnerPrototype) updateFallbackBudget(); });
      $('#budget-form')?.addEventListener('change',()=>{ if (!window.TurnerPrototype) updateFallbackBudget(); });
      $('#budget-form')?.addEventListener('reset',()=>{ if (!window.TurnerPrototype) setTimeout(updateFallbackBudget,0); });
      $$('.process-tabs button').forEach((button,index)=>button.addEventListener('keydown',event=>{
        if (window.TurnerPrototype || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;
        const next=(index+direction+processSteps.length)%processSteps.length;
        renderFallbackProcess(next);
        $$('.process-tabs button')[next]?.focus();
      }));
      window.addEventListener('scroll',()=>{ if (!window.TurnerPrototype) $('[data-header]')?.classList.toggle('is-scrolled',window.scrollY>10); },{passive:true});
    }
    function ensureFallbackShell() {
      if (window.TurnerPrototype) return;
      $$('.reveal').forEach(element=>element.classList.add('is-visible'));
      if ($('#current-year')) $('#current-year').textContent = new Date().getFullYear();
      ensureFallbackInclusions();
      wireFallbackControls();
      updateFallbackBudget();
    }
    function compareSync() {
      const tray = $('#compare-tray');
      const show = $('#show-compare');
      const count = $$('.compare-chip').length || $$('[data-compare-id][aria-pressed="true"]').length;
      const visible = !!(tray && !tray.hidden);
      document.body.classList.toggle('turner-compare-visible', visible);
      if (show) show.textContent = 'Afficher comparaison' + (count ? ' (' + count + ')' : '');
    }
    function updateFallbackCompareUi() {
      const tray = $('#compare-tray');
      if (!tray) return;
      const selected = models.filter(model => fallbackCompared.has(model.id));
      tray.hidden = selected.length === 0;
      const show = $('#show-compare');
      if (show && selected.length) show.hidden = true;
      const summary = $('#compare-summary');
      if (summary) summary.textContent = selected.length+' modèle'+(selected.length>1?'s':'')+' sélectionné'+(selected.length>1?'s':'');
      const chips = $('#compare-chips');
      if (chips) chips.innerHTML = selected.map(model => '<span class="compare-chip">'+escapeText(model.name)+' <button type="button" data-remove-fallback-compare="'+escapeText(model.id)+'" aria-label="Retirer '+escapeText(model.name)+'">×</button></span>').join('');
      const open = $('#open-compare');
      if (open) { open.disabled = selected.length < 2; open.title = selected.length < 2 ? 'Sélectionnez au moins deux modèles' : ''; }
      $$('[data-turner-fallback-compare]').forEach(button => {
        const active = fallbackCompared.has(button.dataset.turnerFallbackCompare);
        button.setAttribute('aria-pressed',String(active));
        button.textContent = active ? 'Sélectionné' : 'Comparer';
      });
      compareSync();
    }
    function toggleFallbackCompare(id) {
      if (fallbackCompared.has(id)) fallbackCompared.delete(id);
      else if (fallbackCompared.size >= 3) return toast('Vous pouvez comparer jusqu’à trois modèles.');
      else fallbackCompared.add(id);
      updateFallbackCompareUi();
    }
    function openFallbackCompare() {
      const selected = models.filter(model => fallbackCompared.has(model.id));
      if (selected.length < 2) return toast('Sélectionnez au moins deux modèles.');
      const content = $('#compare-dialog-content');
      if (!content) return;
      const rows = [['Type',model=>model.type],['Style',model=>model.style],['Superficie',model=>number.format(model.area)+' pi²'],['Chambres',model=>model.bedrooms],['Salles de bain',model=>model.bathrooms],['Garage',model=>model.garage?'Oui':'Non'],['Points forts',model=>model.features.join(' · ')]];
      content.innerHTML = '<div class="compare-dialog-content"><h2 id="compare-dialog-title">Comparer sans se perdre.</h2><p>La comparaison porte sur les spécifications publiées par Turner. Les options doivent être confirmées avec un conseiller.</p><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Critère</th>'+selected.map(model=>'<th><img class="compare-image" src="'+escapeText(model.imageUrl)+'" alt="">'+escapeText(model.name)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr><th>'+escapeText(row[0])+'</th>'+selected.map(model=>'<td>'+escapeText(row[1](model))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';
      openDialog($('#compare-dialog'));
    }
    function prepareFallbackQuote(id) {
      const model = modelById(id);
      ensureModelOptions();
      if (model && $('#contact-model')) $('#contact-model').value = model.id;
      const message = $('#contact-form textarea[name="message"]');
      if (model && message && !message.value.trim()) message.value = 'Je souhaite discuter du modèle '+model.name+' et des adaptations possibles pour mon projet.';
      $$('dialog[open]').forEach(closeDialog);
      $('#contact')?.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(() => $('#contact-form input[name="name"]')?.focus({preventScroll:true}),700);
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
        if (form.dataset.turnerApiWired || form.id !== 'contact-form') return;
        form.dataset.turnerApiWired = 'true';
        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (!form.reportValidity()) return;
          const button = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
          const status = $('#contact-status');
          const previous = button?.innerHTML;
          $$('[aria-invalid="true"]',form).forEach(field => field.removeAttribute('aria-invalid'));
          form.setAttribute('aria-busy','true');
          if (status) { status.textContent = 'Envoi de la demande…'; status.dataset.state = 'pending'; }
          if (button) { button.disabled = true; button.textContent = 'Envoi…'; }
          try {
            const response = await fetch('/api/project-intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: collectForm(form), source: 'contact-form' }) });
            const result = await response.json().catch(() => ({ok:false,error:'Réponse serveur invalide.'}));
            if (!response.ok || !result.ok) {
              const error = new Error((result.errors || []).map(item => item.message).join(' ') || result.error || 'Demande refusée');
              error.validationErrors = result.errors || [];
              throw error;
            }
            const message = result.message || 'Demande sauvegardée.';
            form.reset();
            if (status) { status.textContent = message; status.dataset.state = 'success'; }
            toast(message);
            form.dataset.lastIntakeId = result.id;
          } catch (error) {
            const message = error.message || 'Impossible de préparer la demande.';
            const selectors = {fullName:'[name="name"]',email:'[name="email"]',phone:'[name="phone"]',postalCode:'[name="postal"]',model:'[name="model"]',message:'[name="message"]',consent:'[name="consent"]'};
            (error.validationErrors || []).forEach(item => { const selector=selectors[item.field]; if (selector) form.querySelector(selector)?.setAttribute('aria-invalid','true'); });
            if (status) { status.textContent = message; status.dataset.state = 'error'; }
            toast(message);
          } finally {
            form.removeAttribute('aria-busy');
            if (button) { button.disabled = false; button.innerHTML = previous || 'Préparer ma demande <span aria-hidden="true">→</span>'; }
          }
        });
      });
    }
    function initialize() { ensureModelOptions(); ensureModelFallback(); ensureProjectFallback(); ensureFaqFallback(); ensureFallbackShell(); applyFallbackFilters(); wireForms(); compareSync(); }
    document.addEventListener('click', event => {
      if (!window.TurnerPrototype) {
        const menuToggle = event.target.closest('[data-menu-toggle]');
        if (menuToggle) {
          const nav=$('[data-mobile-nav]');
          const expanded=menuToggle.getAttribute('aria-expanded')==='true';
          menuToggle.setAttribute('aria-expanded',String(!expanded));
          menuToggle.setAttribute('aria-label',expanded?'Ouvrir le menu':'Fermer le menu');
          if (nav) nav.hidden=expanded;
        }
        const mobileLink = event.target.closest('[data-mobile-nav] a');
        if (mobileLink) {
          const toggle=$('[data-menu-toggle]'), nav=$('[data-mobile-nav]');
          if (toggle) { toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','Ouvrir le menu'); }
          if (nav) nav.hidden=true;
        }
        if (event.target.closest('#reset-filters') || event.target.closest('#empty-reset')) resetFallbackFilters();
        const collection=event.target.closest('[data-collection]');
        if (collection) {
          resetFallbackFilters();
          if (collection.dataset.collection==='garage' && $('#filter-garage')) $('#filter-garage').value='true';
          else if ($('#filter-type')) $('#filter-type').value=collection.dataset.collection;
          applyFallbackFilters();
          $('.catalog-toolbar')?.scrollIntoView({behavior:'smooth',block:'start'});
        }
        const processTab=event.target.closest('.process-tabs button[data-step]');
        if (processTab) renderFallbackProcess(Number(processTab.dataset.step));
        if (event.target.closest('#load-example')) loadFallbackBudgetExample();
        if (event.target.closest('#copy-summary')) copyFallbackBudget();
        if (event.target.closest('[data-open-inclusions]')) { ensureFallbackInclusions(); openDialog($('#inclusions-dialog')); }
      }
      const fallbackCompare = event.target.closest('[data-turner-fallback-compare]');
      if (fallbackCompare) toggleFallbackCompare(fallbackCompare.dataset.turnerFallbackCompare);
      const fallbackRemove = event.target.closest('[data-remove-fallback-compare]');
      if (fallbackRemove) toggleFallbackCompare(fallbackRemove.dataset.removeFallbackCompare);
      const fallbackQuote = event.target.closest('[data-turner-fallback-quote]');
      if (fallbackQuote) prepareFallbackQuote(fallbackQuote.dataset.turnerFallbackQuote);
      if (event.target.closest('#open-compare') && $('[data-turner-fallback-models]')) openFallbackCompare();
      const close = event.target.closest('[data-close-dialog]');
      if (close) closeDialog(close.closest('dialog'));
      if (event.target.matches('dialog')) closeDialog(event.target);
      if (event.target.closest('#hide-compare')) { const tray=$('#compare-tray'), show=$('#show-compare'); if (tray && show) { tray.hidden=true; show.hidden=false; compareSync(); } }
      if (event.target.closest('#show-compare')) { const tray=$('#compare-tray'), show=$('#show-compare'); if (tray && show) { tray.hidden=false; show.hidden=true; compareSync(); } }
      if (event.target.closest('#clear-compare')) { let remove=$('[data-remove-compare]'), guard=0; while(remove && guard++<10){remove.click();remove=$('[data-remove-compare]');} fallbackCompared.clear(); updateFallbackCompareUi(); const tray=$('#compare-tray'), show=$('#show-compare'); if (tray) tray.hidden=true; if (show) show.hidden=true; compareSync(); }
      if (window.TurnerPrototype && event.target.closest('[data-compare-id], [data-remove-compare]')) queueMicrotask(compareSync);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
  })();`;
}

async function renderApp() {
  const [rawHtml, rawCss, rawJs] = await Promise.all([
    gunzipText('payload/index.html.gz'),
    gunzipText('payload/styles.css.gz'),
    gunzipText('payload/app.js.gz'),
  ]);
  let html = enhanceSeo(rawHtml.replace(/<script\s+src=["']\.\/app\.js["']\s+defer><\/script>/g, ''));
  html = enhanceOfficialContent(enhanceContact(enhanceCompare(patchVisualUrls(html))));
  const css = patchVisualUrls(rawCss);
  const safeJs = fallbackOnly ? '' : patchVisualUrls(patchClientJs(rawJs)).replaceAll('</script>', '<\\/script>');
  const completeJs = completionJs().replaceAll('</script>', '<\\/script>');
  return html
    .replace('</head>', () => `${seoHeadMarkup()}\n${baselineHeadMarkup()}\n<style>${css}\n${compareCss}\n${fallbackCss}</style></head>`)
    .replace('</body>', () => `${safeJs ? `<script>${safeJs}</script>` : ''}<script>${completeJs}</script></body>`);
}

function send(res, status, body, type = 'text/plain; charset=utf-8', cache = 'no-store, max-age=0', headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': type,
    'Content-Length': payload.length,
    'Cache-Control': cache,
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : payload);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload, null, 2), mime['.json'], 'no-store, max-age=0', headers);
}

function methodNotAllowed(res, allowed) {
  return sendJson(res, 405, { ok: false, error: 'Method not allowed.' }, { Allow: allowed.join(', ') });
}

function isReadRequest(req) {
  return req.method === 'GET' || req.method === 'HEAD';
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
    officialContent: { verifiedAt: officialContent.verifiedAt, models: officialContent.models.length, sources: officialContent.sources },
    seo: { title: seoTitle, description: seoDescription, publicOrigin, indexable, canonical: publicUrl('/'), robots: publicUrl('/robots.txt'), sitemap: publicUrl('/sitemap.xml'), structuredData: true, crawlableModelPages: officialContent.models.length },
    completionLayer: { primaryClientEnabled: !fallbackOnly, modelFallbacks: fallbackModels.length, projectFallback: true, faqFallback: true, contactApiBridge: true },
    decoded: { html: html.length, css: css.length, js: js.length },
    pid: process.pid,
    host,
    port,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const route = cleanPath(req.url || '/');
    if (route === '__health') return isReadRequest(req) ? sendJson(res, 200, await health()) : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === '__baseline') return isReadRequest(req) ? sendJson(res, 200, visualBaseline) : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === '__visuals') return isReadRequest(req) ? sendJson(res, 200, { sourceMap: [...visualSourceMap.entries()], preloadVisuals }) : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === 'robots.txt') return isReadRequest(req) ? send(res, 200, robotsText(), 'text/plain; charset=utf-8', 'public, max-age=3600') : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === 'sitemap.xml') return isReadRequest(req) ? send(res, 200, sitemapXml(), 'application/xml; charset=utf-8', 'public, max-age=3600') : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === 'api/config') return isReadRequest(req) ? sendJson(res, 200, apiConfig()) : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === 'api/official-content') return isReadRequest(req) ? sendJson(res, 200, { ok: true, ...officialContent }) : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === 'api/implementation-status') return isReadRequest(req) ? sendJson(res, 200, { ok: true, ...implementationStatus }) : methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === 'api/budget/summary') return await handleBudgetSummary(req, res);
    if (route === 'api/project-intake') return await handleProjectIntake(req, res);
    if (!isReadRequest(req)) return methodNotAllowed(res, ['GET', 'HEAD']);
    if (route === '' || route === 'index.html') return send(res, 200, await renderApp(), mime['.html']);
    if (route === 'modeles' || route === 'modeles/') return send(res, 200, renderCatalogPage({ content: officialContent, publicOrigin, indexable }), mime['.html']);
    const modelRoute = /^modeles\/([a-z0-9-]+)\/?$/.exec(route);
    if (modelRoute) {
      const model = officialContent.models.find(candidate => candidate.id === modelRoute[1]);
      if (!model) return send(res, 404, 'Not found');
      return send(res, 200, renderModelPage({ model, content: officialContent, publicOrigin, indexable }), mime['.html']);
    }

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

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping the Turner server.`);
  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, 5000);
  timeout.unref();
  server.close(error => {
    clearTimeout(timeout);
    if (error) console.error(`Server shutdown failed: ${error.message}`);
    process.exit(error ? 1 : 0);
  });
  server.closeIdleConnections?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

server.listen(port, host, () => console.log(`Maisons S. Turner app: http://${host}:${port}`));
