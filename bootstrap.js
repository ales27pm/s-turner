const decoder = new TextDecoder();

async function ungzip(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!('DecompressionStream' in window)) throw new Error('Ce navigateur ne prend pas en charge DecompressionStream.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return decoder.decode(await new Response(stream).arrayBuffer());
}

function patchAppJs(js) {
  const guardedInit = "if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init, { once: true }); } else { init(); }";
  return js
    .replace("document.addEventListener('DOMContentLoaded', init);", guardedInit)
    .replace('document.addEventListener("DOMContentLoaded", init);', guardedInit)
    .replace(
      "syncFiltersFromForm();\n      $('.catalog-toolbar').scrollIntoView",
      "syncFiltersFromForm();\n      renderModels();\n      $('.catalog-toolbar').scrollIntoView"
    )
    .replace(
      "select.addEventListener('change', syncFiltersFromForm)",
      "select.addEventListener('change', () => { syncFiltersFromForm(); renderModels(); })"
    );
}

function patchHtml(html) {
  html = html.replace(/<script\s+src=["']\.\/app\.js["']\s+defer><\/script>/g, '');
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

function patchCss(css) {
  return `${css}\n\n/* Runtime UX fixes injected by bootstrap. */\n.compare-actions{display:flex;align-items:center;gap:8px}.compare-actions .button{min-height:42px;padding-inline:18px}.compare-mini-button,.compare-return{min-height:42px;padding:0 13px;color:var(--white);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:7px;cursor:pointer;font-size:.72rem;font-weight:800}.compare-mini-button:hover,.compare-return:hover{background:rgba(255,255,255,.14)}.compare-return{position:fixed;z-index:250;right:max(18px,calc((100vw - var(--shell))/2));bottom:18px;color:var(--white);background:var(--navy);box-shadow:var(--shadow-md)}.compare-return[hidden]{display:none}.collection-card::after{inset:0!important;background:linear-gradient(180deg,rgba(8,19,27,.02) 0%,rgba(8,19,27,.16) 48%,rgba(8,19,27,.84) 100%)!important}@media(max-width:980px){.compare-actions{grid-column:1/-1;justify-content:stretch}.compare-actions>*{flex:1}}@media(max-width:720px){.hero-copy.shell{min-height:455px!important;padding-top:44px!important;padding-bottom:72px!important}.hero-copy h1{font-size:clamp(2.8rem,13.2vw,4.45rem)!important}.hero-copy>p{font-size:.95rem!important}.hero-media{min-height:292px!important}.collection-card,.collection-card-tall{min-height:255px!important}.compare-return{right:10px;bottom:10px;left:10px;width:auto}}@media(max-width:440px){.hero-media{min-height:245px!important}}\n`;
}

function compareEnhancerScript() {
  return `(() => {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    function selectedCount() { return $$('.compare-chip').length || $$('[data-compare-id][aria-pressed="true"]').length; }
    function updateReturnLabel() {
      const show = $('#show-compare');
      if (show) show.textContent = 'Afficher comparaison' + (selectedCount() ? ' (' + selectedCount() + ')' : '');
    }
    document.addEventListener('click', (event) => {
      if (event.target.closest('#hide-compare')) {
        const tray = $('#compare-tray');
        const show = $('#show-compare');
        if (tray && show) { tray.hidden = true; updateReturnLabel(); show.hidden = false; }
      }
      if (event.target.closest('#show-compare')) {
        const tray = $('#compare-tray');
        const show = $('#show-compare');
        if (tray && show) { tray.hidden = false; show.hidden = true; }
      }
      if (event.target.closest('#clear-compare')) {
        const removeButtons = $$('[data-remove-compare]');
        if (removeButtons.length) removeButtons.forEach((button) => button.click());
        else $$('[data-compare-id][aria-pressed="true"]').forEach((button) => button.click());
        const tray = $('#compare-tray');
        const show = $('#show-compare');
        if (tray) tray.hidden = true;
        if (show) show.hidden = true;
      }
      queueMicrotask(updateReturnLabel);
    });
  })();`;
}

try {
  const [rawHtml, rawCss, rawJs] = await Promise.all([
    ungzip('./payload/index.html.gz'),
    ungzip('./payload/styles.css.gz'),
    ungzip('./payload/app.js.gz'),
  ]);
  const html = patchHtml(rawHtml);
  const css = patchCss(rawCss);
  const js = patchAppJs(rawJs);
  const hydrated = html
    .replace('</head>', `<style>${css}</style></head>`)
    .replace('</body>', `<script>${js.replaceAll('</script>', '<\\/script>')}</script><script>${compareEnhancerScript()}</script></body>`);
  document.open();
  document.write(hydrated);
  document.close();
} catch (error) {
  document.body.innerHTML = `<main style="font:16px system-ui;padding:40px;max-width:760px;margin:auto"><h1>Impossible de charger l’application</h1><p>${String(error.message || error)}</p></main>`;
}
