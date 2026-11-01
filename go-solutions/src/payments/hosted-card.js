// Real card / Alipay / WeChat Pay provider (hosted payment page).
//
// Fill this in from your provider's API docs once Go Solutions' merchant account is approved.
// Almost every hosted payment page works the same way:
//   1. This server creates a payment session (amount, currency, order ref, return URL, callback URL).
//   2. The customer is sent to the provider's page and pays there. Card numbers never touch this server,
//      which keeps PCI compliance simple.
//   3. The provider calls /pay/hosted/callback with the result. We check the signature, then mark the order paid.
// Whether the account runs 2D or 3D Secure is set on the provider's side. Nothing in this file changes for it.
//
// Env vars: PAYMENT_PROVIDER=hosted, HOSTED_API_URL, HOSTED_MERCHANT_ID, HOSTED_API_KEY, HOSTED_WEBHOOK_SECRET
const crypto = require('crypto');
const express = require('express');
const orders = require('../orders');
const { site, baseUrl } = require('../config');

async function start(order) {
  const decimals = (site.currencies.find(c => c.code === order.currency) || { decimals: 2 }).decimals;

  // TODO: match the endpoint, field names and auth to your provider's docs.
  const res = await fetch(`${process.env.HOSTED_API_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.HOSTED_API_KEY}`
    },
    body: JSON.stringify({
      merchant_id: process.env.HOSTED_MERCHANT_ID,
      reference: order.ref,
      amount: Number(order.total).toFixed(decimals),
      currency: order.currency,
      payment_method: order.payment_method, // card | alipay | wechat
      description: `${site.businessName} order ${order.ref}`,
      customer: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
        address: order.address_line,
        city: order.city,
        postcode: order.postcode,
        country: order.country
      },
      return_url: `${baseUrl}/pay/hosted/return?ref=${order.ref}&t=${order.access_token}`,
      callback_url: `${baseUrl}/pay/hosted/callback`
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));

  // TODO: use the field your provider returns for the payment page URL and its own payment id.
  const url = data.redirect_url || data.payment_url;
  if (!res.ok || !url) {
    console.error('Hosted payment session failed:', res.status, JSON.stringify(data).slice(0, 500));
    const e = new Error("We couldn't start the payment. Please try again or choose bank transfer.");
    e.status = 502;
    throw e;
  }
  if (data.id) await orders.setPaymentRef(order.ref, 'hosted', String(data.id));
  return { type: 'redirect', url };
}

function validSignature(raw, header) {
  const secret = process.env.HOSTED_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  // TODO: most providers sign the raw body with HMAC-SHA256. Check yours (some use SHA512 or a different header).
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(header).trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function mount(app) {
  // The provider calls this in the background when a payment succeeds or fails.
  app.post('/pay/hosted/callback', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
    // TODO: header name from your provider's docs.
    if (!validSignature(req.body, req.get('x-signature'))) return res.status(401).json({ error: 'bad signature' });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'bad body' }); }

    // TODO: map your provider's field names and status values.
    const ref = String(event.reference || '');
    const status = String(event.status || '').toLowerCase();
    if (['paid', 'success', 'succeeded', 'captured', 'approved'].includes(status)) {
      await orders.markPaid(ref, { provider: 'hosted', paymentRef: String(event.id || event.transaction_id || '') });
    } else if (['failed', 'declined', 'cancelled', 'canceled', 'expired'].includes(status)) {
      await orders.markFailed(ref);
    }
    res.json({ ok: true });
  });

  // Where the customer lands after the payment page. The callback above is what actually marks it paid.
  app.get('/pay/hosted/return', async (req, res) => {
    const o = await orders.loadByRef(String(req.query.ref || ''));
    if (!o || o.access_token !== String(req.query.t || '')) return res.redirect(303, '/#track');
    res.redirect(303, `/#order-${o.ref}-${o.access_token}`);
  });
}

module.exports = { start, mount };
