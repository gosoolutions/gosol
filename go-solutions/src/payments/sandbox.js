// TEST ONLY. A fake hosted payment page so the whole checkout can be tried
// before the real payment provider is approved. Approve or decline, nothing is charged.
// It is switched off in production unless PAYMENT_SANDBOX=on.
const crypto = require('crypto');
const express = require('express');
const orders = require('../orders');
const { site } = require('../config');

const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sign = ref => crypto.createHmac('sha256', secret).update('sandbox:' + ref).digest('hex').slice(0, 32);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { card: 'Card', alipay: 'Alipay', wechat: 'WeChat Pay', paypal: 'PayPal' };

async function start(order) {
  return { type: 'redirect', url: `/pay/sandbox?ref=${order.ref}&sig=${sign(order.ref)}` };
}

function page(o, sig) {
  const c = site.currencies.find(x => x.code === o.currency);
  const amount = (/[A-Za-z]$/.test(c.symbol) ? c.symbol + ' ' : c.symbol) +
    Number(o.total).toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test payment</title><style>
:root{--bg:#EEF1F6;--card:#fff;--ink:#101828;--muted:#5B6478;--line:#D9DEE8;--ok:#12805C;--bad:#C0362C;--warn:#8A5300;--warn-soft:#FFF1DC}
@media (prefers-color-scheme:dark){:root{--bg:#0B1020;--card:#141B31;--ink:#E8ECF8;--muted:#9AA6C6;--line:#26304F;--ok:#4CC99A;--bad:#F2857B;--warn:#F2B25C;--warn-soft:#2C2110;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;display:grid;gap:18px}
.tag{justify-self:start;font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;background:var(--warn-soft);color:var(--warn);padding:6px 9px;border-radius:6px}
h1{margin:0;font-size:22px}p{margin:0;color:var(--muted)}dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px}dt{color:var(--muted)}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.amt{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}form{display:grid;gap:10px}
button{font:600 16px/1 system-ui,sans-serif;padding:14px;border-radius:10px;border:0;cursor:pointer}
.ok{background:var(--ok);color:#fff}.bad{background:transparent;color:var(--bad);border:1px solid var(--line)}
</style></head><body><main class="card">
<span class="tag">Test payment page</span>
<h1>${esc(site.businessName)}</h1>
<div class="amt">${esc(amount)}</div>
<dl><dt>Order</dt><dd>${esc(o.ref)}</dd><dt>Method</dt><dd>${esc(LABEL[o.payment_method] || o.payment_method)}</dd></dl>
<p>This page stands in for the real payment provider while the merchant account is being set up. No money moves.</p>
<form method="post" action="/pay/sandbox/complete">
<input type="hidden" name="ref" value="${esc(o.ref)}"><input type="hidden" name="sig" value="${esc(sig)}">
<button class="ok" name="outcome" value="approve">Approve test payment</button>
<button class="bad" name="outcome" value="decline">Decline</button>
</form></main></body></html>`;
}

function mount(app) {
  app.get('/pay/sandbox', async (req, res) => {
    const ref = String(req.query.ref || ''), sig = String(req.query.sig || '');
    if (sig !== sign(ref)) return res.status(400).send('Invalid payment link.');
    const o = await orders.loadByRef(ref);
    if (!o) return res.status(404).send('Order not found.');
    if (o.status !== 'awaiting_payment') return res.redirect(303, `/#order-${o.ref}-${o.access_token}`);
    res.set('Cache-Control', 'no-store').type('html').send(page(o, sig));
  });

  app.post('/pay/sandbox/complete', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const ref = String(req.body.ref || ''), sig = String(req.body.sig || '');
    if (sig !== sign(ref)) return res.status(400).send('Invalid payment link.');
    if (req.body.outcome === 'approve') {
      await orders.markPaid(ref, { provider: 'sandbox', paymentRef: 'TEST-' + crypto.randomBytes(5).toString('hex').toUpperCase(), note: 'Test payment approved. No money was charged.' });
    } else {
      await orders.markFailed(ref, 'The test payment was declined.');
    }
    const o = await orders.loadByRef(ref);
    res.redirect(303, `/#order-${o.ref}-${o.access_token}`);
  });
}

module.exports = { start, mount };
