// PayPal Checkout (Orders v2 API). Needs a PayPal Business account in Go Solutions' name.
// Env vars: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE=sandbox|live
const orders = require('../orders');
const { site, baseUrl } = require('../config');

const api = () => (process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

async function accessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const res = await fetch(`${api()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json();
  if (!res.ok) throw new Error('PayPal auth failed: ' + (data.error_description || res.status));
  return data.access_token;
}

async function start(order) {
  const token = await accessToken();
  const back = `ref=${order.ref}&t=${order.access_token}`;
  const res = await fetch(`${api()}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': order.ref },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.ref,
        custom_id: order.ref,
        description: `${site.businessName} order ${order.ref}`,
        amount: { currency_code: order.currency, value: Number(order.total).toFixed(2) }
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: site.businessName,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: `${baseUrl}/pay/paypal/return?${back}`,
            cancel_url: `${baseUrl}/pay/paypal/cancel?${back}`
          }
        }
      }
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json();
  const link = (data.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
  if (!res.ok || !link) {
    console.error('PayPal create order failed:', res.status, JSON.stringify(data).slice(0, 500));
    const e = new Error("We couldn't start PayPal. Please try again or choose another method.");
    e.status = 502;
    throw e;
  }
  await orders.setPaymentRef(order.ref, 'paypal', data.id);
  return { type: 'redirect', url: link.href };
}

async function load(req) {
  const o = await orders.loadByRef(String(req.query.ref || ''));
  return o && o.access_token === String(req.query.t || '') ? o : null;
}

function mount(app) {
  app.get('/pay/paypal/return', async (req, res) => {
    const o = await load(req);
    if (!o) return res.redirect(303, '/#track');
    if (o.status === 'awaiting_payment' && o.payment_ref) {
      try {
        const token = await accessToken();
        const r = await fetch(`${api()}/v2/checkout/orders/${encodeURIComponent(o.payment_ref)}/capture`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': o.ref + '-capture' },
          signal: AbortSignal.timeout(20000)
        });
        const data = await r.json();
        const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
        if (data.status === 'COMPLETED' && capture?.status === 'COMPLETED') {
          await orders.markPaid(o.ref, { provider: 'paypal', paymentRef: capture.id });
        } else {
          console.error('PayPal capture not completed:', JSON.stringify(data).slice(0, 500));
        }
      } catch (e) {
        console.error('PayPal capture failed:', e.message);
      }
    }
    res.redirect(303, `/#order-${o.ref}-${o.access_token}`);
  });

  app.get('/pay/paypal/cancel', async (req, res) => {
    const o = await load(req);
    if (!o) return res.redirect(303, '/#track');
    await orders.markFailed(o.ref, 'PayPal payment was cancelled.');
    res.redirect(303, `/#order-${o.ref}-${o.access_token}`);
  });
}

module.exports = { start, mount };
