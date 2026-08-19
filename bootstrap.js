const decoder = new TextDecoder();
async function ungzip(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!('DecompressionStream' in window)) throw new Error('Ce navigateur ne prend pas en charge DecompressionStream.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return decoder.decode(await new Response(stream).arrayBuffer());
}

try {
  const [html, css, js] = await Promise.all([
    ungzip('./payload/index.html.gz'),
    ungzip('./payload/styles.css.gz'),
    ungzip('./payload/app.js.gz'),
  ]);
  const hydrated = html
    .replace('</head>', `<style>${css}</style></head>`)
    .replace('</body>', `<script>${js.replaceAll('</script>', '<\\/script>')}</script></body>`);
  document.open();
  document.write(hydrated);
  document.close();
} catch (error) {
  document.body.innerHTML = `<main style="font:16px system-ui;padding:40px;max-width:760px;margin:auto"><h1>Impossible de charger l’application</h1><p>${String(error.message || error)}</p></main>`;
}
