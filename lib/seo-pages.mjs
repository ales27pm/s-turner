const areaFormatter = new Intl.NumberFormat('fr-CA');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function publicUrl(publicOrigin, pathname = '/') {
  return new URL(pathname, `${publicOrigin}/`).href;
}

function dateOnly(value) {
  return Number.isNaN(Date.parse(value || '')) ? null : String(value).slice(0, 10);
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function metadataDescription(text, maximum = 158) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maximum) return clean;
  const shortened = clean.slice(0, maximum - 3).replace(/\s+\S*$/, '').trimEnd();
  return `${shortened}...`;
}

function businessNode(content, publicOrigin) {
  return {
    '@type': 'HomeAndConstructionBusiness',
    '@id': `${publicUrl(publicOrigin, '/')}#business`,
    name: content.company.name,
    alternateName: 'Maisons S. Turner',
    url: publicUrl(publicOrigin, '/'),
    telephone: '+1-819-377-0570',
    email: content.company.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '1021, rue des Ateliers',
      addressLocality: 'Trois-Rivières',
      addressRegion: 'QC',
      postalCode: 'G9B 7J5',
      addressCountry: 'CA',
    },
    areaServed: { '@type': 'AdministrativeArea', name: 'Québec' },
  };
}

function breadcrumbNode(items, canonical) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function breadcrumbMarkup(items) {
  return `<nav class="breadcrumbs" aria-label="Fil d'Ariane"><ol>${items.map((item, index) => `<li>${index === items.length - 1 ? `<span aria-current="page">${escapeHtml(item.name)}</span>` : `<a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>`}</li>`).join('')}</ol></nav>`;
}

function pageHead({ title, description, canonical, image, type = 'website', structuredData, indexable = true }) {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="preconnect" href="https://maisonsturner.ca" crossorigin>
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:locale" content="fr_CA">
  <meta property="og:site_name" content="Maisons S. Turner">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:alt" content="Maison usinée de Maisons S. Turner">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <script type="application/ld+json">${safeJson({ '@context': 'https://schema.org', '@graph': structuredData })}</script>`;
}

const pageCss = `
:root{--ink:#101820;--navy:#0a2f43;--copper:#b45c3b;--green:#356b5b;--paper:#f6f5f1;--white:#fff;--line:#d8d5cc;--muted:#5d676d;--shell:1180px;color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--white);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;text-rendering:optimizeLegibility}img{display:block;max-width:100%}a{color:inherit;text-underline-offset:3px}button,a{touch-action:manipulation}.skip-link{position:fixed;z-index:1000;top:8px;left:8px;transform:translateY(-150%);padding:10px 14px;background:var(--white);color:var(--navy);border:2px solid var(--navy)}.skip-link:focus{transform:none}.shell{width:min(calc(100% - 40px),var(--shell));margin-inline:auto}.site-header{position:sticky;z-index:100;top:0;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line)}.header-inner{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:28px}.brand{display:inline-flex;align-items:center;min-height:44px;color:var(--navy);font-family:Georgia,"Times New Roman",serif;font-size:1.35rem;font-weight:700;text-decoration:none}.brand span{color:var(--copper)}.site-nav{display:flex;align-items:center;gap:22px}.site-nav a{display:inline-flex;align-items:center;min-height:44px;font-size:.91rem;font-weight:700;text-decoration:none}.site-nav .nav-cta{padding:0 16px;color:var(--white);background:var(--navy);border-radius:6px}.breadcrumbs{padding-top:22px;color:var(--muted);font-size:.86rem}.breadcrumbs ol{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}.breadcrumbs li:not(:last-child)::after{content:"/";margin-left:8px;color:#8a9296}.catalog-hero{padding:64px 0 54px;background:var(--paper);border-bottom:1px solid var(--line)}.eyebrow{margin:0 0 10px;color:var(--copper);font-size:.78rem;font-weight:800;text-transform:uppercase}.catalog-hero h1,.model-heading h1{max-width:900px;margin:0;color:var(--navy);font-family:Georgia,"Times New Roman",serif;font-size:3.75rem;line-height:1.04;letter-spacing:0}.catalog-hero p{max-width:760px;margin:22px 0 0;color:var(--muted);font-size:1.12rem}.catalog-summary{display:flex;flex-wrap:wrap;gap:10px 28px;margin-top:28px;padding-top:22px;border-top:1px solid var(--line)}.catalog-summary strong{color:var(--navy)}.catalog-section{padding:58px 0 78px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:24px}.section-heading h2,.related h2,.feature-section h2,.project-band h2{margin:0;color:var(--navy);font-family:Georgia,"Times New Roman",serif;font-size:2.35rem;line-height:1.12;letter-spacing:0}.section-heading p{margin:0;color:var(--muted)}.model-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.model-card{overflow:hidden;background:var(--white);border:1px solid var(--line);border-radius:6px}.model-card>a:first-child{display:block;background:var(--paper)}.model-card img{width:100%;aspect-ratio:4/3;object-fit:cover}.model-card-body{padding:18px}.model-card-meta{margin:0;color:var(--copper);font-size:.76rem;font-weight:800;text-transform:uppercase}.model-card h2,.model-card h3{margin:5px 0 7px;color:var(--navy);font-family:Georgia,"Times New Roman",serif;font-size:1.65rem;letter-spacing:0}.model-card h2 a,.model-card h3 a{text-decoration:none}.model-card p{margin:0;color:var(--muted)}.model-card-specs{display:flex;flex-wrap:wrap;gap:7px 14px;margin-top:14px;padding-top:13px;border-top:1px solid var(--line);font-size:.84rem}.card-link{display:inline-flex;align-items:center;min-height:44px;margin-top:12px;color:var(--navy);font-weight:800}.model-heading{padding:44px 0 30px}.model-heading .lede{max-width:780px;margin:18px 0 0;color:var(--muted);font-size:1.1rem}.model-visual{width:min(100%,1440px);margin:0 auto;background:var(--paper)}.model-visual img{width:100%;max-height:680px;aspect-ratio:16/7;object-fit:cover}.model-details{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:56px;padding:56px 0 68px}.model-copy h2{margin:0 0 14px;color:var(--navy);font-family:Georgia,"Times New Roman",serif;font-size:2.35rem;letter-spacing:0}.model-copy p{max-width:740px;margin:0;color:var(--muted);font-size:1.04rem}.feature-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:26px 0 0;padding:0;list-style:none}.feature-list li{padding:13px 15px;border-left:4px solid var(--green);background:var(--paper);font-weight:700}.spec-panel{align-self:start;border-top:5px solid var(--copper);background:var(--navy);color:var(--white);padding:24px}.spec-panel h2{margin:0 0 18px;font-family:Georgia,"Times New Roman",serif;font-size:1.7rem;letter-spacing:0}.spec-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;background:rgba(255,255,255,.18)}.spec-list div{min-height:92px;padding:15px;background:var(--navy)}.spec-list dt{font-size:.75rem;color:#c9d6dc}.spec-list dd{margin:4px 0 0;font-family:Georgia,"Times New Roman",serif;font-size:1.35rem}.source-note{margin:18px 0 0;font-size:.78rem;color:#c9d6dc}.source-note a{min-height:44px;display:inline-flex;align-items:center}.feature-section{padding:54px 0;background:var(--paper);border-block:1px solid var(--line)}.related{padding:58px 0 70px}.related .model-grid{margin-top:22px}.project-band{padding:58px 0;background:var(--green);color:var(--white)}.project-band .shell{display:flex;align-items:center;justify-content:space-between;gap:36px}.project-band h2{color:var(--white)}.project-band p{max-width:680px;margin:10px 0 0;color:#e0ece8}.button-row{display:flex;flex-wrap:wrap;gap:10px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 18px;border:1px solid var(--white);border-radius:6px;font-weight:800;text-decoration:none;white-space:nowrap}.button-primary{background:var(--white);color:var(--green)}.button-secondary{color:var(--white)}.site-footer{padding:34px 0;background:var(--ink);color:#d9e0e3}.footer-inner{display:flex;justify-content:space-between;gap:28px}.footer-inner p{margin:0}.footer-inner a{display:inline-flex;align-items:center;min-height:44px}:focus-visible{outline:3px solid #e5a84b;outline-offset:3px}
.spec-list dd{font-size:1.25rem;overflow-wrap:anywhere}
@media(max-width:900px){.model-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.model-details{grid-template-columns:1fr;gap:34px}.spec-panel{width:100%}.project-band .shell{align-items:flex-start;flex-direction:column}.catalog-hero h1,.model-heading h1{font-size:3rem}}
@media(max-width:640px){.shell{width:min(calc(100% - 28px),var(--shell))}.header-inner{min-height:64px;align-items:flex-start;flex-direction:column;gap:0;padding:8px 0}.site-nav{width:100%;justify-content:space-between;gap:8px;overflow-x:auto}.site-nav a{font-size:.78rem}.site-nav .nav-cta{padding:0 10px}.catalog-hero{padding:44px 0}.catalog-hero h1,.model-heading h1{font-size:2.45rem}.catalog-hero p,.model-heading .lede{font-size:1rem}.catalog-section,.related{padding:42px 0 54px}.section-heading{align-items:flex-start;flex-direction:column;gap:8px}.section-heading h2,.related h2,.feature-section h2,.project-band h2,.model-copy h2{font-size:1.95rem}.model-grid{grid-template-columns:1fr}.model-visual img{aspect-ratio:4/3}.model-details{padding:40px 0 50px}.feature-list{grid-template-columns:1fr}.footer-inner{flex-direction:column;gap:8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

function sharedHeader(publicOrigin) {
  return `<a class="skip-link" href="#contenu">Aller au contenu</a>
  <header class="site-header"><div class="shell header-inner">
    <a class="brand" href="${escapeHtml(publicUrl(publicOrigin, '/'))}">Maisons S. <span>Turner</span></a>
    <nav class="site-nav" aria-label="Navigation principale">
      <a href="${escapeHtml(publicUrl(publicOrigin, '/modeles/'))}">Modèles</a>
      <a href="${escapeHtml(publicUrl(publicOrigin, '/#processus'))}">Démarche</a>
      <a class="nav-cta" href="${escapeHtml(publicUrl(publicOrigin, '/#contact'))}">Parler du projet</a>
    </nav>
  </div></header>`;
}

function sharedFooter(content, publicOrigin) {
  return `<footer class="site-footer"><div class="shell footer-inner"><p><strong>Maisons S. Turner</strong><br>${escapeHtml(content.company.address)}</p><p><a href="tel:+18193770570">${escapeHtml(content.company.phone)}</a><br><a href="mailto:${escapeHtml(content.company.email)}">${escapeHtml(content.company.email)}</a></p><p><a href="${escapeHtml(publicUrl(publicOrigin, '/'))}">Retour à l'accueil</a></p></div></footer>`;
}

function modelCard(model, publicOrigin, headingLevel = 2) {
  const path = publicUrl(publicOrigin, modelPath(model.id));
  const Heading = `h${headingLevel}`;
  return `<article class="model-card">
    <a href="${escapeHtml(path)}" aria-label="Voir le modèle ${escapeHtml(model.name)}"><img src="${escapeHtml(model.imageUrl)}" alt="Maison modèle ${escapeHtml(model.name)}" loading="lazy" decoding="async"></a>
    <div class="model-card-body">
      <p class="model-card-meta">${escapeHtml(model.type)} · ${escapeHtml(model.style)}</p>
      <${Heading}><a href="${escapeHtml(path)}">${escapeHtml(model.name)}</a></${Heading}>
      <p>${escapeHtml(model.description)}</p>
      <div class="model-card-specs"><span>${areaFormatter.format(model.area)} pi²</span><span>${plural(model.bedrooms, 'chambre')}</span><span>${plural(model.bathrooms, 'salle de bain')}</span></div>
      <a class="card-link" href="${escapeHtml(path)}">Voir la fiche</a>
    </div>
  </article>`;
}

export function modelPath(id) {
  return `/modeles/${encodeURIComponent(String(id))}/`;
}

export function renderCatalogPage({ content, publicOrigin, indexable = true }) {
  const canonical = publicUrl(publicOrigin, '/modeles/');
  const home = publicUrl(publicOrigin, '/');
  const title = 'Modèles de maisons usinées | Maisons S. Turner';
  const description = metadataDescription(`Explorez ${content.models.length} modèles de maisons et chalets usinés personnalisables: plain-pied, deux étages et chalets fabriqués au Québec.`);
  const breadcrumbs = [{ name: 'Accueil', url: home }, { name: 'Modèles', url: canonical }];
  const structuredData = [
    businessNode(content, publicOrigin),
    {
      '@type': 'CollectionPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      inLanguage: 'fr-CA',
      breadcrumb: { '@id': `${canonical}#breadcrumb` },
      mainEntity: { '@id': `${canonical}#models` },
    },
    breadcrumbNode(breadcrumbs, canonical),
    {
      '@type': 'ItemList',
      '@id': `${canonical}#models`,
      name: 'Catalogue des modèles Maisons S. Turner',
      numberOfItems: content.models.length,
      itemListElement: content.models.map((model, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: model.name,
        url: publicUrl(publicOrigin, modelPath(model.id)),
      })),
    },
  ];
  const typeCount = new Set(content.models.map(model => model.type)).size;
  const styleCount = new Set(content.models.flatMap(model => model.styles)).size;
  return `<!doctype html><html lang="fr-CA"><head>${pageHead({ title, description, canonical, image: content.models[0].imageUrl, structuredData, indexable })}<style>${pageCss}</style></head><body>
  ${sharedHeader(publicOrigin)}
  <main id="contenu">
    <div class="shell">${breadcrumbMarkup(breadcrumbs)}</div>
    <section class="catalog-hero"><div class="shell"><p class="eyebrow">Catalogue officiel</p><h1>Modèles de maisons usinées</h1><p>${escapeHtml(description)}</p><div class="catalog-summary"><span><strong>${content.models.length}</strong> modèles</span><span><strong>${typeCount}</strong> collections</span><span><strong>${styleCount}</strong> styles</span><span>Livraison annoncée partout au Québec</span></div></div></section>
    <section class="catalog-section"><div class="shell"><div class="section-heading"><h2>Choisir un plan de départ</h2><p>Les dimensions et options finales sont confirmées avec un conseiller.</p></div><div class="model-grid">${content.models.map(model => modelCard(model, publicOrigin)).join('')}</div></div></section>
    <section class="project-band"><div class="shell"><div><h2>Votre terrain. Vos besoins. Un plan adapté.</h2><p>Présentez votre projet à l'équipe Turner pour valider le modèle, les modifications possibles et la portée du mandat.</p></div><div class="button-row"><a class="button button-primary" href="${escapeHtml(publicUrl(publicOrigin, '/#contact'))}">Préparer une demande</a><a class="button button-secondary" href="tel:+18193770570">819 377-0570</a></div></div></section>
  </main>${sharedFooter(content, publicOrigin)}</body></html>`;
}

export function renderModelPage({ model, content, publicOrigin, indexable = true }) {
  const canonical = publicUrl(publicOrigin, modelPath(model.id));
  const home = publicUrl(publicOrigin, '/');
  const catalog = publicUrl(publicOrigin, '/modeles/');
  const detailedTitle = `Maison ${model.name} — ${model.bedrooms} ch., ${areaFormatter.format(model.area)} pi² | Maisons S. Turner`;
  const title = detailedTitle.length <= 65 ? detailedTitle : `Modèle ${model.name} | Maisons S. Turner`;
  const description = metadataDescription(`Découvrez ${model.name}, ${model.type.toLowerCase()} de style ${model.style.toLowerCase()} de ${areaFormatter.format(model.area)} pi² avec ${plural(model.bedrooms, 'chambre')} et ${plural(model.bathrooms, 'salle de bain')}${model.garage ? ', avec garage' : ''}.`);
  const breadcrumbs = [{ name: 'Accueil', url: home }, { name: 'Modèles', url: catalog }, { name: model.name, url: canonical }];
  const related = [
    ...content.models.filter(candidate => candidate.id !== model.id && candidate.type === model.type),
    ...content.models.filter(candidate => candidate.id !== model.id && candidate.type !== model.type),
  ].slice(0, 3);
  const structuredData = [
    businessNode(content, publicOrigin),
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      inLanguage: 'fr-CA',
      breadcrumb: { '@id': `${canonical}#breadcrumb` },
      mainEntity: { '@id': `${canonical}#model` },
      dateModified: model.sourceLastModified || content.verifiedAt,
    },
    breadcrumbNode(breadcrumbs, canonical),
    {
      '@type': 'Product',
      '@id': `${canonical}#model`,
      name: `Modèle de maison ${model.name}`,
      url: canonical,
      image: [model.imageUrl],
      description,
      category: `${model.type} · ${model.style}`,
      brand: { '@type': 'Brand', name: 'Maisons S. Turner' },
      manufacturer: { '@id': `${home}#business` },
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'Superficie', value: model.area, unitCode: 'FTK', unitText: 'pi²' },
        { '@type': 'PropertyValue', name: 'Chambres', value: model.bedrooms },
        { '@type': 'PropertyValue', name: 'Salles de bain', value: model.bathrooms },
        { '@type': 'PropertyValue', name: 'Étages', value: model.floors },
        { '@type': 'PropertyValue', name: 'Garage', value: model.garage ? 'Oui' : 'Non' },
      ],
    },
  ];
  const sourceDate = dateOnly(model.sourceLastModified);
  return `<!doctype html><html lang="fr-CA"><head>${pageHead({ title, description, canonical, image: model.imageUrl, type: 'product', structuredData, indexable })}<style>${pageCss}</style></head><body>
  ${sharedHeader(publicOrigin)}
  <main id="contenu">
    <div class="shell">${breadcrumbMarkup(breadcrumbs)}</div>
    <section class="shell model-heading"><p class="eyebrow">${escapeHtml(model.type)} · ${escapeHtml(model.style)}</p><h1>Modèle de maison ${escapeHtml(model.name)}</h1><p class="lede">${escapeHtml(description)}</p></section>
    <figure class="model-visual"><img src="${escapeHtml(model.imageUrl)}" alt="Maison modèle ${escapeHtml(model.name)}" fetchpriority="high" decoding="async"></figure>
    <section class="shell model-details" aria-labelledby="model-overview-title"><div class="model-copy"><h2 id="model-overview-title">Une base à personnaliser</h2><p>${escapeHtml(model.description)} Les adaptations possibles, les inclusions et les coûts sont établis selon le terrain et le devis.</p><ul class="feature-list">${model.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></div><aside class="spec-panel" aria-labelledby="spec-title"><h2 id="spec-title">Caractéristiques</h2><dl class="spec-list"><div><dt>Superficie</dt><dd>${areaFormatter.format(model.area)} pi²</dd></div><div><dt>Chambres</dt><dd>${model.bedrooms}</dd></div><div><dt>Salles de bain</dt><dd>${model.bathrooms}</dd></div><div><dt>Étages</dt><dd>${model.floors}</dd></div><div><dt>Garage</dt><dd>${model.garage ? 'Oui' : 'Non'}</dd></div><div><dt>Style</dt><dd>${escapeHtml(model.style)}</dd></div></dl><p class="source-note">Données de la fiche Turner${sourceDate ? `, mise à jour le ${escapeHtml(sourceDate)}` : ''}. <a href="${escapeHtml(model.sourceUrl)}" target="_blank" rel="noreferrer">Consulter la source officielle</a></p></aside></section>
    <section class="feature-section"><div class="shell"><h2>Ce modèle dans votre projet</h2><p>Le plan sert de point de départ. L'équipe Turner peut préciser les changements réalisables, les composantes du mandat et les étapes de fabrication.</p></div></section>
    <section class="related"><div class="shell"><h2>Autres modèles à explorer</h2><div class="model-grid">${related.map(candidate => modelCard(candidate, publicOrigin, 3)).join('')}</div></div></section>
    <section class="project-band"><div class="shell"><div><h2>Discuter du modèle ${escapeHtml(model.name)}</h2><p>Préparez une demande pour valider le plan, le terrain et les adaptations qui comptent pour votre projet.</p></div><div class="button-row"><a class="button button-primary" href="${escapeHtml(publicUrl(publicOrigin, `/#contact`))}">Préparer une demande</a><a class="button button-secondary" href="${escapeHtml(catalog)}">Tous les modèles</a></div></div></section>
  </main>${sharedFooter(content, publicOrigin)}</body></html>`;
}

export function buildSitemapXml({ content, publicOrigin }) {
  const entries = [
    { path: '/', lastmod: dateOnly(content.verifiedAt), changefreq: 'weekly', priority: '1.0' },
    { path: '/modeles/', lastmod: dateOnly(content.verifiedAt), changefreq: 'weekly', priority: '0.9' },
    ...content.models.map(model => ({ path: modelPath(model.id), lastmod: dateOnly(model.sourceLastModified) || dateOnly(content.verifiedAt), changefreq: 'monthly', priority: '0.8' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(entry => `  <url>\n    <loc>${escapeHtml(publicUrl(publicOrigin, entry.path))}</loc>\n    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
}
