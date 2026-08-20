import { readFile } from 'node:fs/promises';
import { renderModelPage } from '../lib/seo-pages.mjs';

const content = JSON.parse(await readFile(new URL('../data/official-content.json', import.meta.url), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(content.schemaVersion === 1, 'Unsupported official content schema.');
assert(!Number.isNaN(Date.parse(content.verifiedAt)), 'Official content verification timestamp is invalid.');
assert(content.models.length >= 40, `Expected at least 40 official models, found ${content.models.length}.`);
assert(content.processSteps.length === 5, 'The official five-step process is incomplete.');
assert(content.certifications.some(item => item.id === 'acq'), 'The ACQ source entry is missing.');
assert(content.inclusionGroups.every(group => group.items.length >= 4), 'An official inclusion group is incomplete.');

const ids = new Set();
for (const model of content.models) {
  assert(!ids.has(model.id), `Duplicate model id: ${model.id}`);
  ids.add(model.id);
  assert(model.name && model.type && model.styles.length > 0, `Incomplete identity for ${model.id}`);
  assert(model.area > 0 && model.bedrooms > 0 && model.bathrooms > 0 && model.floors > 0, `Invalid specifications for ${model.id}`);
  assert(model.imageUrl.startsWith('https://maisonsturner.ca/'), `Untrusted image source for ${model.id}`);
  assert(!('image' in model) && !('remoteImage' in model) && !('localImage' in model), `Legacy duplicate image fields remain for ${model.id}`);
  assert(model.sourceUrl === `https://maisonsturner.ca/modeles/${model.id}`, `Unexpected source URL for ${model.id}`);
  const seoHtml = renderModelPage({ model, content, publicOrigin: 'https://preview.example.com', indexable: true });
  const title = seoHtml.match(/<title>(.*?)<\/title>/)?.[1] || '';
  const description = seoHtml.match(/<meta name="description" content="(.*?)">/)?.[1] || '';
  assert(title.length > 30 && title.length <= 65, `SEO title length is invalid for ${model.id}: ${title.length}`);
  assert(description.length > 70 && description.length <= 160, `SEO description length is invalid for ${model.id}: ${description.length}`);
  assert((seoHtml.match(/<h1\b/g) || []).length === 1, `SSR model page does not have exactly one H1: ${model.id}`);
}

const expectedFeatured = {
  athenes: [576, 1, 1, false],
  prague: [1034, 2, 1, false],
  oslo: [1067, 2, 1, false],
  portofino: [1222, 2, 1, false],
  turenne: [1400, 2, 1, true],
  liverpool: [1075, 2, 1, false],
};
for (const [id, expected] of Object.entries(expectedFeatured)) {
  const model = content.models.find(candidate => candidate.id === id);
  assert(model, `Missing featured model: ${id}`);
  assert([model.area, model.bedrooms, model.bathrooms, model.garage].every((value, index) => value === expected[index]), `Featured model specifications changed unexpectedly: ${id}`);
}

console.log(`Official content snapshot passed: ${content.models.length} models, verified ${content.verifiedAt}.`);
