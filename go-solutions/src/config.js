const path = require('path');
const fs = require('fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', file), 'utf8'));
}

const site = readJson('site.json');
const products = readJson('products.json');

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
// BASE_URL is only needed for a custom domain. On Render, RENDER_EXTERNAL_URL is set automatically.
const baseUrl = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, '');

// The test payment page lets anyone approve their own order, so it is only on outside
// production, or when PAYMENT_SANDBOX=on is set on purpose for a demo.
const sandboxOn = process.env.PAYMENT_SANDBOX === 'on' || (!isProd && process.env.PAYMENT_SANDBOX !== 'off');

module.exports = { site, products, isProd, port, baseUrl, sandboxOn };
