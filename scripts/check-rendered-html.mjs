import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = String(19000 + Math.floor(Math.random() * 1000));
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), 'turner-check-'));
const adminToken = 'turner-check-admin';
const fallbackOnly = process.argv.includes('--fallback-only');
const officialSnapshot = JSON.parse(await readFile(new URL('../data/official-content.json', import.meta.url), 'utf8'));

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    HOST: host,
    PORT: port,
    TURNER_DATA_DIR: dataDir,
    TURNER_ADMIN_TOKEN: adminToken,
    TURNER_CRM_WEBHOOK_URL: '',
    TURNER_FALLBACK_ONLY: fallbackOnly ? '1' : '0',
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
  assert(!html.includes('Aucune donnée n’a été envoyée.'), 'The obsolete mock contact handler is still rendered.');
  assert(html.includes("fetch('/api/project-intake'"), 'The contact API bridge is missing.');
  assert(html.includes('name="website"') && html.includes('name="consent"'), 'Contact anti-spam or consent fields are missing.');
  assert(html.includes('.compare-toggle,.details-button,.quote-button,.text-button,.turner-fallback-actions button{min-height:44px}'), 'Mobile action targets are smaller than the completion layer contract.');
  assert(html.includes('"id":"prague","name":"Prague","type":"Plain-pied"') && html.includes('"area":1034'), 'Official Prague data is missing from the rendered catalogue.');
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
  }

  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
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

  const methodCheck = await requestJson('/api/config', { method: 'POST' });
  assert(methodCheck.response.status === 405, `POST /api/config returned ${methodCheck.response.status}`);
  assert(methodCheck.response.headers.get('allow') === 'GET, HEAD', 'POST /api/config returned an incorrect Allow header.');

  const config = await requestJson('/api/config');
  assert(config.response.status === 200 && config.body.content.models === officialSnapshot.models.length, 'Runtime config does not expose the official catalogue status.');
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

  const invalidIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: 'incorrect', message: 'court', consent: false }),
  });
  assert(invalidIntake.response.status === 422, `Invalid intake returned ${invalidIntake.response.status}`);
  assert(invalidIntake.body.errors.length >= 4, 'Invalid intake did not report all required fields.');

  const validIntake = await requestJson('/api/project-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'turner-integration-check' },
    body: JSON.stringify({ fields: { name: 'Test automatisé', email: 'test@example.invalid', phone: '555 0100', postal: 'G9B 7J5', model: 'prague', message: 'Demande créée par le contrôle local automatisé.', consent: true, website: '' }, source: 'integration-check' }),
  });
  assert(validIntake.response.status === 201 && validIntake.body?.ok, `Valid intake returned ${validIntake.response.status}`);
  assert(validIntake.body.id?.startsWith('turner-'), 'Valid intake is missing its identifier.');

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
  assert(((await stat(intakePath)).mode & 0o777) === 0o600, 'Stored intake file permissions are not private.');

  const deniedListing = await requestJson('/api/project-intake');
  assert(deniedListing.response.status === 403, `Unauthenticated intake listing returned ${deniedListing.response.status}`);
  const adminListing = await requestJson('/api/project-intake', { headers: { authorization: `Bearer ${adminToken}` } });
  assert(adminListing.response.status === 200 && adminListing.body.records.length === 1, 'Authenticated intake listing did not return the stored record.');

  console.log(`${fallbackOnly ? 'Fallback' : 'Primary'} HTML, official content, HTTP semantics, budget API, and project intake checks passed.`);
} finally {
  try {
    await stopServer();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}
