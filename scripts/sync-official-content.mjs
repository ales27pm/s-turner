import { load } from 'cheerio';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(root, 'data', 'official-content.json');
const temporaryPath = `${outputPath}.tmp`;
const origin = 'https://maisonsturner.ca';
const modelSitemapUrl = `${origin}/model-sitemap.xml`;
const featuredIds = ['athenes', 'prague', 'oslo', 'portofino', 'turenne', 'liverpool'];
const modelTypes = ['Chalet', 'Plain-pied', 'Deux étages'];
const modelStyles = ['Contemporain', 'Classique', 'Champêtre'];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 's-turner-content-sync/1.0' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 500));
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

function parseSitemap(xml) {
  const $ = load(xml, { xmlMode: true });
  return $('url').map((_, node) => {
    const entry = $(node);
    return {
      url: cleanText(entry.find('loc').first().text()),
      lastModified: cleanText(entry.find('lastmod').first().text()) || null,
    };
  }).get().filter(entry => entry.url.startsWith(`${origin}/modeles/`));
}

function parseNumber(value, field, url) {
  const match = cleanText(value).replaceAll(' ', '').match(/\d+/);
  if (!match) throw new Error(`Missing ${field} on ${url}`);
  return Number(match[0]);
}

function factualDescription(model) {
  const kind = model.type === 'Deux étages' ? 'maison à deux étages' : model.type.toLowerCase();
  const rooms = `${model.bedrooms} chambre${model.bedrooms > 1 ? 's' : ''} et ${model.bathrooms} salle${model.bathrooms > 1 ? 's' : ''} de bain`;
  return `${model.name} est un modèle ${kind} de style ${model.styles.join(' et ').toLowerCase()}, annoncé à ${model.area} pi² avec ${rooms}${model.garage ? ' et un garage' : ''}.`;
}

function parseModel(entry, html) {
  const $ = load(html);
  const name = cleanText($('.c-bannerSingle__content__info__title').first().text() || $('h1').first().text());
  const tags = $('.c-bannerSingle .c-tags__elem__link').map((_, node) => cleanText($(node).text())).get();
  const type = modelTypes.find(candidate => tags.includes(candidate));
  const styles = modelStyles.filter(candidate => tags.includes(candidate));
  const specs = {};

  $('.c-modelSpecs__list__elem').each((_, node) => {
    const item = $(node);
    specs[cleanText(item.find('.c-modelSpecs__list__elem--label').text()).toLowerCase()] = cleanText(item.find('.c-modelSpecs__list__elem--value span').text());
  });

  const id = new URL(entry.url).pathname.split('/').filter(Boolean).at(-1);
  const image = $('.c-bannerSingle__image img[src^="https://"]').first().attr('src');
  const sourceDescription = cleanText($('.c-bannerSingle__content__info__desc').first().text());
  const featureDetails = $('.c-modelAssets__elem').map((_, node) => {
    const item = $(node);
    return {
      title: cleanText(item.find('.c-modelAssets__elem__title').text()),
      copy: cleanText(item.find('.c-modelAssets__elem__text').text()),
    };
  }).get().filter(feature => feature.title && feature.copy).slice(0, 3);
  const planLevels = $('.c-modelDemo__config__info').map((_, node) => {
    const item = $(node);
    const values = item.find('.c-modelDemo__config__info__list li').map((__, valueNode) => cleanText($(valueNode).text())).get().filter(Boolean);
    const rooms = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      rooms.push({ name: values[index], dimensions: values[index + 1] });
    }
    return { name: cleanText(item.find('.c-modelDemo__config__info__category').text()), rooms };
  }).get().filter(level => level.name && level.rooms.length > 0);
  const virtualTourUrl = $('.c-bannerSingle a[href*="versom-vr.com"]').first().attr('href') || null;
  const model = {
    id,
    name,
    type,
    style: styles.join(' / '),
    styles,
    bedrooms: parseNumber(specs['chambre(s)'], 'bedrooms', entry.url),
    bathrooms: parseNumber(specs['salle de bain(s)'], 'bathrooms', entry.url),
    floors: parseNumber(specs['étage(s)'], 'floors', entry.url),
    garage: /^oui$/i.test(specs.garage || ''),
    area: parseNumber(specs.superficie, 'area', entry.url),
    imageUrl: image,
    sourceDescription,
    features: featureDetails.map(feature => feature.title),
    featureDetails,
    planLevels,
    sourceUrl: entry.url,
    sourceLastModified: entry.lastModified,
    virtualTourUrl,
  };
  model.description = factualDescription(model);

  if (!model.id || !model.name || !model.type || !model.styles.length || !model.imageUrl || !model.sourceDescription || model.featureDetails.length !== 3 || model.planLevels.length === 0) {
    throw new Error(`Incomplete model data on ${entry.url}`);
  }
  return model;
}

async function mapConcurrent(entries, concurrency, mapper) {
  const output = new Array(entries.length);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(entries[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return output;
}

function listAfterHeading($, title) {
  const heading = $('h2').filter((_, node) => cleanText($(node).text()) === title).first();
  return heading.nextAll('ul').first().find('li').map((_, node) => cleanText($(node).text()).replace(/^\*+/, '')).get().filter(Boolean);
}

async function buildSnapshot() {
  const [sitemapXml, componentsHtml] = await Promise.all([
    fetchText(modelSitemapUrl),
    fetchText(`${origin}/notre-offre/composantes-des-modules`),
  ]);
  const entries = parseSitemap(sitemapXml);
  if (entries.length < 40) throw new Error(`Expected at least 40 official models, found ${entries.length}.`);

  const models = await mapConcurrent(entries, 4, async (entry, index) => {
    const model = parseModel(entry, await fetchText(entry.url));
    console.log(`[${index + 1}/${entries.length}] ${model.name}`);
    return model;
  });

  const order = new Map(featuredIds.map((id, index) => [id, index]));
  models.sort((left, right) => {
    const leftOrder = order.has(left.id) ? order.get(left.id) : featuredIds.length;
    const rightOrder = order.has(right.id) ? order.get(right.id) : featuredIds.length;
    return leftOrder - rightOrder || left.name.localeCompare(right.name, 'fr-CA');
  });

  const components = load(componentsHtml);
  return {
    schemaVersion: 2,
    verifiedAt: new Date().toISOString(),
    sources: {
      modelSitemap: modelSitemapUrl,
      company: `${origin}/a-propos`,
      contact: `${origin}/nous-joindre`,
      process: `${origin}/notre-offre/les-etapes-de-votre-projet`,
      faq: `${origin}/faq`,
      components: `${origin}/notre-offre/composantes-des-modules`,
      certifications: `${origin}/a-propos/certifications`,
      privacy: `${origin}/politique-de-confidentialite`,
      apchqProfile: 'https://www.trouverunentrepreneur.com/profile/trois-rivieres/maisons-s-turner-inc',
      gcrDirectory: 'https://repertoire.garantiegcr.com/',
      rbqDirectory: 'https://www.pes.rbq.gouv.qc.ca/RegistreLicences/RechercheEntreprise',
    },
    company: {
      name: 'Maisons S. Turner inc.',
      foundedOn: '1994-03-03',
      licenseRbq: '8002-1710-85',
      address: '1021, rue des Ateliers, Trois-Rivières, Québec G9B 7J5',
      phone: '819 377-0570',
      tollFree: '1 800 567-9969',
      email: 'info@maisonsturner.ca',
      hours: [
        'Lundi au jeudi : 9 h à 16 h 30',
        'Vendredi : 9 h à 16 h',
        'Samedi : 12 h à 16 h',
        'Dimanche : fermé',
        'Également disponible sur rendez-vous',
      ],
    },
    certifications: [
      { id: 'gcr', label: 'GCR', detail: 'Garantie des maisons neuves annoncée par Turner', sourceUrl: `${origin}/a-propos/certifications`, verificationUrl: 'https://repertoire.garantiegcr.com/' },
      { id: 'apchq', label: 'APCHQ', detail: 'Entreprise répertoriée comme membre', sourceUrl: 'https://www.trouverunentrepreneur.com/profile/trois-rivieres/maisons-s-turner-inc' },
      { id: 'qai', label: 'QAI', detail: 'Usine certifiée selon CAN/CSA-A277', sourceUrl: `${origin}/a-propos/certifications` },
      { id: 'acq', label: 'ACQ', detail: 'Adhésion annoncée par Turner', sourceUrl: `${origin}/a-propos/certifications` },
      { id: 'ambmq', label: 'AMBMQ', detail: 'Adhésion annoncée par Turner', sourceUrl: `${origin}/a-propos/certifications` },
    ],
    processSteps: [
      { label: 'Étape 01', shortTitle: 'Terrain et budget', title: 'Situer le terrain, les besoins et le budget.', copy: 'Les dimensions, les services, les contraintes municipales et le relief orientent le choix du modèle et la planification du projet.', checks: ['Documenter le terrain', 'Définir les besoins', 'Établir la capacité budgétaire', 'Choisir un plan de départ'] },
      { label: 'Étape 02', shortTitle: 'Entente préliminaire', title: 'Personnaliser les choix et recevoir un plan final.', copy: 'Les matériaux, les couleurs et les modifications réalisables sont précisés avant la préparation du plan complet.', checks: ['Valider les modifications', 'Choisir les matériaux', 'Clarifier les inclusions', 'Recevoir le plan final'] },
      { label: 'Étape 03', shortTitle: 'Contrat officiel', title: 'Signer et verrouiller la planification.', copy: 'Le contrat officiel enclenche la fabrication et permet d’établir les jalons de production, de livraison et de chantier.', checks: ['Signer le contrat', 'Confirmer la portée', 'Établir l’échéancier', 'Coordonner les intervenants'] },
      { label: 'Étape 04', shortTitle: 'Production', title: 'Suivre la construction des modules en usine.', copy: 'Une visite permet de voir la maison prendre forme et de regrouper la documentation utile au projet.', checks: ['Lancer la production', 'Suivre les jalons', 'Visiter les modules', 'Regrouper les documents'] },
      { label: 'Étape 05', shortTitle: 'Livraison', title: 'Assembler, inspecter et remettre les clés.', copy: 'Les équipes réalisent le raccord de menuiserie et les travaux prévus, puis le superviseur effectue l’inspection de fin de mandat avec le client.', checks: ['Livrer les modules', 'Réaliser le raccord', 'Inspecter le mandat', 'Remettre les clés'] },
    ],
    faqItems: [
      { question: 'Livrez-vous partout au Québec?', answer: 'Oui. Turner indique livrer partout au Québec; la faisabilité et les coûts demeurent à confirmer selon l’emplacement et l’accès au terrain.' },
      { question: 'Puis-je modifier un plan existant?', answer: 'Oui. Certaines modifications peuvent être étudiées avec un conseiller selon le plan choisi et les contraintes du projet.' },
      { question: 'Puis-je prendre certains travaux en charge?', answer: 'Oui. Le client peut participer à certaines étapes afin d’ajuster la portée et le budget, à condition que les responsabilités soient précisées dans l’entente.' },
      { question: 'Excavation et fondation peuvent-elles être coordonnées?', answer: 'Oui. Turner indique pouvoir prendre ces étapes en charge ou travailler avec des sous-traitants choisis par le client.' },
      { question: 'Qu’est-ce qu’un raccord de menuiserie?', answer: 'Il relie les modules au chantier et complète les zones de jonction, notamment la toiture, l’isolation, le revêtement et les murs intérieurs selon le devis.' },
      { question: 'Peut-on visiter des maisons modèles?', answer: 'Oui. Plusieurs maisons modèles sont annoncées comme visitables aux bureaux de Trois-Rivières; confirmez le modèle et l’horaire avant le déplacement.' },
      { question: 'Le projet est-il couvert par une garantie?', answer: 'Turner annonce la garantie GCR pour les maisons qu’elle fabrique. Vérifiez toujours le statut courant et la portée applicable dans le répertoire GCR.' },
      { question: 'Puis-je construire sur mon propre terrain?', answer: 'Oui. Turner indique construire autant sur les terrains de ses clients que dans ses secteurs domiciliaires.' },
    ],
    inclusionGroups: [
      { title: 'Composantes annoncées', intro: 'Éléments indiqués par Turner, toujours selon le devis ou le plan.', items: listAfterHeading(components, 'Les composantes') },
      { title: 'Options possibles', intro: 'Travaux qui peuvent être ajoutés ou coordonnés après discussion avec un conseiller.', items: listAfterHeading(components, 'Options possibles') },
      { title: 'Par le client', intro: 'Éléments que la page officielle attribue normalement au propriétaire.', items: listAfterHeading(components, 'Par le client') },
    ],
    models,
  };
}

const snapshot = await buildSnapshot();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
await rename(temporaryPath, outputPath);
console.log(`Wrote ${snapshot.models.length} verified models to ${outputPath}`);
