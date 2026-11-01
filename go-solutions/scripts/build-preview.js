// Builds preview/go-solutions-preview.html: the whole storefront in one file,
// running on sample data in the browser (no server, test payments only).
// Run: npm run build:preview
process.env.PAYMENT_SANDBOX = 'on';
const fs = require('fs');
const path = require('path');
const { site, products } = require('../src/config');
const catalog = require('../src/catalog');

const pub = p => path.join(__dirname, '..', 'public', p);
const css = fs.readFileSync(pub('styles.css'), 'utf8');
const js = fs.readFileSync(pub('app.js'), 'utf8');

const demo = {
  catalog: { site: catalog.publicSite(), products },
  bank: site.payments.bank
};
// Keep </script> sequences out of inline JSON.
const json = JSON.stringify(demo).replace(/</g, '\\u003c');

const html = `<title>Go Solutions Website</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..800&family=Public+Sans:wght@400;500;600;700&display=swap">
<style>
${css}
</style>
<div id="app"><p class="loading">Loading Go Solutions...</p></div>
<script>window.GS_DEMO = ${json};</script>
<script>
${js}
</script>
`;

const outDir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'go-solutions-preview.html'), html);
console.log('Wrote preview/go-solutions-preview.html (' + Math.round(html.length / 1024) + ' KB)');
