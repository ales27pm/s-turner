import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = String(19000 + Math.floor(Math.random() * 1000));
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const scratchDir = await mkdtemp(join(tmpdir(), 'turner-check-'));
const dataDir = join(scratchDir, 'custom-data');
const adminToken = 'turner-check-admin';
const fallbackOnly = process.argv.includes('--fallback-only');
const indexable = !process.argv.includes('--noindex');
const officialSnapshot = JSON.parse(await readFile(new URL('../data/official-content.json', import.meta.url), 'utf8'));
const crmRequests = [];
const crmServer = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    crmRequests.push({ method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(202, { 'content-type': 'application/json', connection: 'close' });
    res.end('{"ok":true}');
  } catch {
    res.writeHead(400);
    res.end();
  }
});
await new Promise((resolve, reject) => {
  crmServer.once('error', reject);
  crmServer.listen(0, host, resolve);
});
const crmWebhookUrl = `http://${host}:${crmServer.address().port}/project-intake`;

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    HOST: host,
    PORT: port,
    TURNER_DATA_DIR: dataDir,
    TURNER_ADMIN_TOKEN: adminToken,
    TURNER_CRM_WEBHOOK_URL: crmWebhookUrl,
    TURNER_FALLBACK_ONLY: fallbackOnly ? '1' : '0',
    TURNER_INDEXABLE: indexable ? '1' : '0',
    TURNER_PUBLIC_ORIGIN: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverExit = once(server, 'exit').catch(() => []);

let output = '';
server.stdout.on('data', chunk => {
  output += chunk.toString();
});
server.stderr.on('data', chunk => {
  output += chunk.toString();
});

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopServer() {
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  const stopped = await Promise.race([serverExit.then(() => true), sleep(3000).then(() => false)]);
  if (!stopped && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await serverExit;
  }
}

async function stopCrmServer() {
  if (!crmServer.listening) return;
  const closed = new Promise((resolve, reject) => crmServer.close(error => error ? reject(error) : resolve()));
  crmServer.closeAllConnections?.();
  await closed;
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Server exited early:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/`, { method: 'HEAD' });
      await response.body?.cancel();
      return;
    } catch {
      // Keep polling until the server accepts connections or exits.
    }
    await sleep(100);
  }
  throw new Error(`Server did not start:\n${output}`);
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${options.method || 'GET'} ${path} returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  return { response, body, raw };
}

try {
  await waitForServer();

  const response = await fetch(`${baseUrl}/`);
  assert(response.ok, `GET / returned ${response.status}`);
  assert(response.headers.get('x-content-type-options') === 'nosniff', 'Security headers are missing.');
  assert(response.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer policy is missing.');
  assert(response.headers.get('permissions-policy')?.includes('camera=()'), 'Permissions policy is missing.');

  const html = await response.text();
  const selectorHelperCount = (html.match(/const \$\$ =/g) || []).length;
  const rewrittenQuerySelectorAll = html.includes("const $ = (selector, root = document) => [...root.querySelectorAll(selector)]");
  assert(selectorHelperCount >= (fallbackOnly ? 1 : 2) && !rewrittenQuerySelectorAll, 'Rendered scripts were mutated during HTML insertion.');
  assert(html.includes('window.__TURNER_BASELINE__='), 'Rendered baseline metadata is missing.');
  assert((html.match(/<h1\b/gi) || []).length === 1 && html.includes('Maisons usinées<br />personnalisées'), 'The server-rendered page does not have one descriptive H1.');
  assert(html.includes('<title>Maisons usinées au Québec | Maisons S. Turner</title>'), 'SEO title is missing or incorrect.');
  assert(html.includes(`<link rel="canonical" href="${baseUrl}/">`), 'Canonical URL does not use the configured public origin.');
  assert(html.includes(`<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">`), 'Homepage robots metadata does not match TURNER_INDEXABLE.');
  assert(html.includes('<meta name="description" content="Découvrez 44 modèles') && !html.includes('Prototype interactif de l’expérience'), 'SEO description is missing or still describes a prototype.');
  assert(html.includes(`<meta property="og:url" content="${baseUrl}/">`) && html.includes('<meta name="twitter:card" content="summary_large_image">'), 'Open Graph or Twitter metadata is incomplete.');
  const structuredDataMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(structuredDataMatch, 'Schema.org structured data is missing.');
  const structuredData = JSON.parse(structuredDataMatch[1]);
  const business = structuredData['@graph']?.find(item => item['@type'] === 'HomeAndConstructionBusiness');
  assert(business?.address?.addressLocality === 'Trois-Rivières' && business?.areaServed?.name === 'Québec', 'Schema.org business location or service area is incorrect.');
  const faqSchema = structuredData['@graph']?.find(item => item['@type'] === 'FAQPage');
  assert(faqSchema?.mainEntity?.length === officialSnapshot.faqItems.length && faqSchema.mainEntity[0]?.acceptedAnswer?.text, 'Homepage FAQPage structured data is incomplete.');
  assert(html.includes("replace(/\\s+/g, ' ').trim()") && !html.includes("replace(/s+/g, ' ').trim()"), 'The rendered completion layer lost the whitespace-regex escape.');
  assert(!html.includes('setTimeout(run,') && !html.includes('queueMicrotask(run)') && html.includes("DOMContentLoaded', initialize, { once: true }"), 'The completion layer still performs repeated full DOM initialization.');
  assert(!html.includes('Aucune donnée n’a été envoyée.'), 'The obsolete mock contact handler is still rendered.');
  assert(html.includes("fetch('/api/project-intake'"), 'The contact API bridge is missing.');
  assert(html.includes('name="website"') && html.includes('name="consent"'), 'Contact anti-spam or consent fields are missing.');
  assert(html.includes('.turner-fallback-actions button,.turner-fallback-actions a{min-height:44px}'), 'Mobile fallback action targets are smaller than the completion layer contract.');
  assert(html.includes('"id":"prague","name":"Prague","type":"Plain-pied"') && html.includes('"area":1034'), 'Official Prague data is missing from the rendered catalogue.');
  assert(html.includes('"imageUrl":"https://maisonsturner.ca/') && !html.includes('"remoteImage":') && !html.includes('"localImage":'), 'Rendered model data still uses duplicate image fields.');
  const lastOfficialModel = officialSnapshot.models.at(-1);
  assert(html.includes(`"id":"${lastOfficialModel.id}","name":"${lastOfficialModel.name}"`), 'The full official catalogue is not rendered.');
  assert(html.includes('<option value="Deux étages">Deux étages</option>') && html.includes('<option value="Champêtre">Champêtre</option>') && html.includes('<option value="4">4 chambres</option>'), 'Official catalogue filters are incomplete.');
  assert(html.includes('data-step="4"') && html.includes('Production</button>'), 'The official five-step process is incomplete.');
  assert(html.includes('turner-content-verified-at') && html.includes('politique-de-confidentialite'), 'Official provenance or privacy links are missing.');
  if (fallbackOnly) {
    assert(!html.includes('window.TurnerPrototype = {'), 'Fallback-only rendering still includes the primary client.');
    assert(html.includes('ensureFallbackShell') && html.includes('updateFallbackBudget'), 'Fallback-only controls are incomplete.');
  } else {
    assert(html.includes('window.TurnerPrototype = {'), 'Primary client rendering is missing.');
    assert(html.includes('href="/modeles/${escapeHTML(model.id)}/"') && !html.includes('data-model-id="${model.id}"'), 'Primary catalogue cards do not link to crawlable model pages.');
  }

  const inlineScripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter(match => !/type=["']application\/ld\+json["']/i.test(match[1] || ''))
    .map(match => match[2])
    .filter(Boolean);
  assert(inlineScripts.length >= (fallbackOnly ? 2 : 3), 'Expected rendered scripts are missing.');
  for (const [index, source] of inlineScripts.entries()) {
    try {
      Function(source);
    } catch (error) {
      throw new Error(`Rendered inline script ${index + 1} does not compile: ${error.message}`);
    }
  }

  const headResponse = await fetch(`${baseUrl}/`, { method: 'HEAD' });
  assert(headResponse.status === 200, `HEAD / returned ${headResponse.status}`);
  assert((await headResponse.text()) === '', 'HEAD / returned a response body.');
  assert(Number(headResponse.headers.get('content-length')) > 0, 'HEAD / is missing the representation length.');

  const crawlerResponse = await fetch(`${baseUrl}/`, { headers: { 'user-agent': 'SiteGuru SEO crawler' } });
  const crawlerHtml = await crawlerResponse.text();
  assert(crawlerResponse.status === 200 && crawlerHtml.includes('Maisons usinées<br />personnalisées'), 'SEO crawler did not receive the server-rendered landing page.');
  assert(!crawlerHtml.includes('Cette expérience nécessite JavaScript'), 'SEO crawler received the obsolete JavaScript-only shell.');

  const robotsResponse = await fetch(`${baseUrl}/robots.txt`);
  const robots = await robotsResponse.text();
  assert(robotsResponse.status === 200 && robotsResponse.headers.get('content-type')?.startsWith('text/plain'), 'robots.txt is missing or has the wrong content type.');
  if (indexable) assert(robots.includes('User-agent: *') && robots.includes(`Sitemap: ${baseUrl}/sitemap.xml`), 'robots.txt does not advertise the configured sitemap.');
  else assert(robots === 'User-agent: *\nDisallow: /\n', 'robots.txt does not block indexing in preview mode.');

  const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`);
  const sitemap = await sitemapResponse.text();
  assert(sitemapResponse.status === 200 && sitemapResponse.headers.get('content-type')?.startsWith('application/xml'), 'sitemap.xml is missing or has the wrong content type.');
  assert(sitemap.includes(`<loc>${baseUrl}/</loc>`) && sitemap.includes('<lastmod>'), 'sitemap.xml does not contain the canonical homepage.');
  assert((sitemap.match(/<url>/g) || []).length === officialSnapshot.models.length + 2, 'sitemap.xml does not contain the homepage, catalogue, and every model page.');
  assert(sitemap.includes(`<loc>${baseUrl}/modeles/</loc>`) && sitemap.includes(`<loc>${baseUrl}/modeles/lisbonne/</loc>`), 'sitemap.xml is missing the catalogue or a model page.');
  assert(sitemap.includes(`<loc>${baseUrl}/modeles/vienne/</loc>`) && sitemap.includes('<lastmod>2026-03-09</lastmod>'), 'The official Vienne lastmod was not preserved in the sitemap.');

  const catalogResponse = await fetch(`${baseUrl}/modeles/`, { headers: { 'user-agent': 'SiteGuru SEO crawler' } });
  const catalogHtml = await catalogResponse.text();
  assert(catalogResponse.status === 200 && catalogHtml.includes('<h1>Modèles de maisons usinées</h1>'), 'The SSR model catalogue is missing its H1.');
  assert(catalogHtml.includes(`<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">`), 'Catalogue robots metadata does not match TURNER_INDEXABLE.');
  assert(catalogHtml.includes(`<link rel="canonical" href="${baseUrl}/modeles/">`) && catalogHtml.includes('"@type":"CollectionPage"') && catalogHtml.includes('"@type":"ItemList"'), 'The SSR catalogue metadata or structured data is incomplete.');
  assert((catalogHtml.match(/<article class="model-card">/g) || []).length === officialSnapshot.models.length, 'The SSR catalogue does not render every model in HTML.');
  assert(catalogHtml.includes(`href="${baseUrl}/modeles/lisbonne/"`) && !catalogHtml.includes('Cette expérience nécessite JavaScript'), 'The SSR catalogue lacks crawlable model links or still requires JavaScript.');

  const modelResponse = await fetch(`${baseUrl}/modeles/lisbonne/`, { headers: { 'user-agent': 'SiteGuru SEO crawler' } });
  const modelHtml = await modelResponse.text();
  assert(modelResponse.status === 200 && modelHtml.includes('<h1>Modèle de maison Lisbonne</h1>'), 'The Lisbonne SSR page is missing its H1.');
  assert(modelHtml.includes(`<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">`), 'Model robots metadata does not match TURNER_INDEXABLE.');
  assert(modelHtml.includes(`<link rel="canonical" href="${baseUrl}/modeles/lisbonne/">`) && modelHtml.includes('<meta name="description"'), 'The Lisbonne canonical or description is missing.');
  const modelStructuredDataMatch = modelHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const modelStructuredData = modelStructuredDataMatch ? JSON.parse(modelStructuredDataMatch[1]) : null;
  assert(modelStructuredData?.['@graph']?.some(item => item['@type'] === 'Product' && item.name === 'Modèle de maison Lisbonne'), 'The Lisbonne Product structured data is missing.');
  assert(modelStructuredData?.['@graph']?.some(item => item['@type'] === 'BreadcrumbList' && item.itemListElement.length === 3), 'The Lisbonne breadcrumb structured data is missing.');
  assert(!modelHtml.includes('<script src=') && !modelHtml.includes('Cette expérience nécessite JavaScript'), 'The model page relies on client-side rendering.');
  const modelHead = await fetch(`${baseUrl}/modeles/lisbonne/`, { method: 'HEAD' });
  assert(modelHead.status === 200 && (await modelHead.text()) === '' && Number(modelHead.headers.get('content-length')) > 0, 'HEAD for a model page is incorrect.');
  const missingModel = await fetch(`${baseUrl}/modeles/modele-inconnu/`);
  assert(missingModel.status === 404, `Unknown model returned ${missingModel.status} instead of 404.`);

  const missingPage = await fetch(`${baseUrl}/ceci-nexiste-pas`);
  assert(missingPage.status === 404, `Missing page returned ${missingPage.status} instead of 404.`);
  const missingHead = await fetch(`${baseUrl}/ceci-nexiste-pas`, { method: 'HEAD' });
  assert(missingHead.status === 404 && (await missingHead.text()) === '', 'HEAD for a missing page does not preserve 404 semantics.');

  const methodCheck = await requestJson('/api/config', { method: 'POST' });
  assert(methodCheck.response.status === 405, `POST /api/config returned ${methodCheck.response.status}`);
  assert(methodCheck.response.headers.get('allow') === 'GET, HEAD', 'POST /api/config returned an incorrect Allow header.');

  const config = await requestJson('/api/config');
  assert(config.response.status === 200 && config.body.content.models === officialSnapshot.models.length, 'Runtime config does not expose the official catalogue status.');
  assert(config.body.content.publicOrigin === baseUrl, 'Runtime config does not expose the configured public origin.');
  assert(config.body.content.indexable === indexable, 'Runtime config does not expose the configured indexing mode.');
  assert(config.body.capabilities.crmWebhook === true, 'Runtime config does not report the configured CRM webhook.');
  const officialContent = await requestJson('/api/official-content');
  assert(officialContent.response.status === 200 && officialContent.body.models.length === officialSnapshot.models.length, 'Official content API is incomplete.');
  assert(officialContent.body.models.some(model => model.id === 'turenne' && model.garage === true), 'Official content API changed a featured model specification.');
  assert(officialContent.body.inclusionGroups[0].items.length >= 20, 'Official module components are incomplete.');

  const malformedPath = await requestJson('/%E0%A4%A');
  assert(malformedPath.response.status === 400, `Malformed path returned ${malformedPath.response.status}`);

  const budget = await requestJson('/api/budget/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ budgetTarget: 575000, houseQuote: 382000, land: 85000, foundation: 52000, siteConnections: 18000, contingencyPct: 8 }),
  });
  assert(budget.response.status === 200 && budget.body?.ok, `Budget API returned ${budget.response.status}`);
  assert(budget.body.summary.subtotal === 537000, 'Budget subtotal is incorrect.');
  assert(budget.body.summary.contingencyAmount === 42960, 'Budget contingency is incorrect.');
  assert(budget.body.summary.total === 579960 && budget.body.summary.gap === -4960, 'Budget total or gap is incorrect.');

  const crossOriginIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://cross-origin.example', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ fullName: 'Cross Origin', email: 'cross-origin@example.invalid', message: 'Cette demande navigateur doit être refusée.', consent: true }),
  });
  assert(crossOriginIntake.response.status === 403, `Cross-origin intake returned ${crossOriginIntake.response.status}`);
  assert(crmRequests.length === 0, 'A rejected cross-origin intake reached the CRM webhook.');

  const formEncodedIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl, 'sec-fetch-site': 'same-origin' },
    body: 'fullName=Formulaire&email=formulaire%40example.invalid',
  });
  assert(formEncodedIntake.response.status === 415, `Form-encoded intake returned ${formEncodedIntake.response.status}`);
  assert(crmRequests.length === 0, 'A non-JSON intake reached the CRM webhook.');

  const malformedBudget = await requestJson('/api/budget/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"budgetTarget":',
  });
  assert(malformedBudget.response.status === 400, `Malformed budget JSON returned ${malformedBudget.response.status}`);
  const configAfterApiErrors = await requestJson('/api/config');
  assert(configAfterApiErrors.response.status === 200 && configAfterApiErrors.body.ok, 'Server stopped responding after a handled API error.');

  const invalidIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: 'incorrect', message: 'court', consent: false }),
  });
  assert(invalidIntake.response.status === 422, `Invalid intake returned ${invalidIntake.response.status}`);
  assert(invalidIntake.body.errors.length >= 4, 'Invalid intake did not report all required fields.');

  const validIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'turner-integration-check', origin: baseUrl, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ fields: { name: 'Test automatisé', email: 'test@example.invalid', phone: '555 0100', postal: 'G9B 7J5', model: 'prague', message: 'Demande créée par le contrôle local automatisé.', consent: true, website: '' }, source: 'integration-check' }),
  });
  assert(validIntake.response.status === 201 && validIntake.body?.ok, `Valid intake returned ${validIntake.response.status}`);
  assert(validIntake.body.id?.startsWith('turner-'), 'Valid intake is missing its identifier.');
  assert(validIntake.body.crm?.delivered === true && validIntake.body.crm.status === 202, 'Valid intake was not delivered to the CRM webhook.');

  const spamIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { name: 'Robot Test', email: 'robot@example.invalid', message: 'Cette demande doit être refusée.', consent: true, website: 'https://spam.invalid' }, source: 'integration-check' }),
  });
  assert(spamIntake.response.status === 422, `Honeypot intake returned ${spamIntake.response.status}`);
  assert(spamIntake.body.errors.some(error => error.field === 'website'), 'Honeypot intake did not report the spam field.');

  const intakePath = join(dataDir, 'project-intake.jsonl');
  const storedLines = (await readFile(intakePath, 'utf8')).trim().split('\n');
  assert(storedLines.length === 1, `Expected one stored intake, found ${storedLines.length}.`);
  const storedRecord = JSON.parse(storedLines[0]);
  assert(storedRecord.id === validIntake.body.id && storedRecord.intake.email === 'test@example.invalid', 'Stored intake does not match the accepted request.');
  assert(storedRecord.privacy?.rawIpStored === false && storedRecord.privacy?.ipHashApplied === true, 'Stored intake privacy metadata is incomplete.');
  assert(typeof storedRecord.meta.ipHash === 'string' && !('ip' in storedRecord.meta), 'Stored intake contains a raw IP or is missing its hash.');
  assert(((await stat(dataDir)).mode & 0o777) === 0o700, 'TURNER_DATA_DIR was not created with private directory permissions.');
  assert(((await stat(intakePath)).mode & 0o777) === 0o600, 'Stored intake file permissions are not private.');
  assert(crmRequests.length === 1 && crmRequests[0].url === '/project-intake', 'CRM webhook received an unexpected number of requests or path.');
  assert(crmRequests[0].body.id === storedRecord.id && crmRequests[0].body.privacy.rawIpStored === false, 'CRM webhook payload does not match the stored privacy-safe record.');

  const deniedListing = await requestJson('/api/project-intake');
  assert(deniedListing.response.status === 403, `Unauthenticated intake listing returned ${deniedListing.response.status}`);
  const incorrectListing = await requestJson('/api/project-intake', { headers: { authorization: 'Bearer incorrect-token' } });
  assert(incorrectListing.response.status === 403, `Incorrect admin token returned ${incorrectListing.response.status}`);
  const adminListing = await requestJson('/api/project-intake', { headers: { authorization: `Bearer ${adminToken}` } });
  assert(adminListing.response.status === 200 && adminListing.body.records.length === 1, 'Authenticated intake listing did not return the stored record.');

  console.log(`${fallbackOnly ? 'Fallback' : 'Primary'} HTML, official content, HTTP semantics, budget API, project intake, custom storage, and CRM webhook checks passed.`);
} finally {
  try {
    await stopServer();
  } finally {
    try {
      await stopCrmServer();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }
}
