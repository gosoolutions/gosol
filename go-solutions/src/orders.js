const crypto = require('crypto');
const db = require('./db');
const catalog = require('./catalog');
const notify = require('./notify');
const { site } = require('./config');

const STATUS = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Payment received',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  payment_failed: 'Payment failed'
};
const RELEASED = new Set(['cancelled', 'payment_failed']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function clean(v, max) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
function makeRef() {
  const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'GS';
  for (const b of crypto.randomBytes(6)) s += al[b % al.length];
  return s;
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ---------- Create ---------- */
async function createOrder(body) {
  const currency = String(body.currency || '').toUpperCase();
  const cur = catalog.currencyInfo(currency);
  if (!cur) throw httpError(400, 'Choose a currency we support.');

  const method = String(body.method || '');
  const methods = catalog.publicSite().methods;
  const m = methods[method];
  if (!m) throw httpError(400, 'That payment method is not available right now.');
  if (m.currencies && !m.currencies.includes(currency)) {
    throw httpError(400, `${m.label} is only available in ${m.currencies.join(' or ')}. Change the currency or pick another method.`);
  }
  if (body.agree !== true) throw httpError(400, 'Please accept the Terms and the Refund policy to continue.');

  const c = body.customer || {};
  const customer = {
    name: clean(c.name, 120),
    email: clean(c.email, 190).toLowerCase(),
    phone: clean(c.phone, 40),
    company: clean(c.company, 160) || null,
    country: clean(c.country, 80),
    address: clean(c.address, 200),
    city: clean(c.city, 100),
    postcode: clean(c.postcode, 20) || null
  };
  const missing = [['name', 'your name'], ['email', 'your email'], ['phone', 'a phone or WhatsApp number'],
    ['country', 'your country'], ['address', 'your address'], ['city', 'your city']]
    .filter(([k]) => !customer[k]).map(([, label]) => label);
  if (missing.length) throw httpError(400, 'Please add ' + missing.join(', ') + '.');
  if (!EMAIL.test(customer.email)) throw httpError(400, 'That email address does not look right.');
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null;

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw httpError(400, 'Your cart is empty.');
  if (items.length > 20) throw httpError(400, 'Too many items in one order.');

  const lines = [];
  for (const it of items) {
    const p = catalog.getProduct(String(it.id || ''));
    if (!p) throw httpError(400, 'One of the items in your cart is no longer available. Remove it and try again.');
    let qty = Number.parseInt(it.qty, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > (p.maxQty || 1)) throw httpError(400, `You can order up to ${p.maxQty || 1} of ${p.name} at a time.`);
    const line = {
      product: p, qty,
      unit: catalog.convert(p.price, currency),
      baseUnit: p.price,
      interval: p.type === 'subscription' ? (p.interval || 'month') : null,
      date: null, time: null
    };
    if (p.type === 'booking') {
      const date = String(it.date || ''), time = String(it.time || '');
      if (!DATE.test(date) || !catalog.bookableDates().includes(date)) throw httpError(400, `Pick a valid date for ${p.name}.`);
      if (!site.booking.slots.includes(time)) throw httpError(400, `Pick a valid time for ${p.name}.`);
      line.date = date; line.time = time; line.qty = 1;
    }
    line.total = catalog.round(line.unit * line.qty, cur.decimals);
    lines.push(line);
  }
  const total = catalog.round(lines.reduce((s, l) => s + l.total, 0), cur.decimals);
  const baseTotal = catalog.round(lines.reduce((s, l) => s + l.baseUnit * l.qty, 0), 2);
  if (m.maxBaseTotal && baseTotal > m.maxBaseTotal) {
    throw httpError(400, `${m.label} is limited to orders under US$${m.maxBaseTotal.toLocaleString('en-US')}. Please choose bank transfer for this order.`);
  }

  const ref = makeRef();
  const token = crypto.randomBytes(16).toString('hex');

  try {
    await db.tx(async run => {
      for (const l of lines) {
        const [row] = await run('SELECT quantity FROM stock WHERE product_id = ? FOR UPDATE', [l.product.id]);
        if (row && row.quantity != null) {
          if (row.quantity < l.qty) {
            throw httpError(409, row.quantity === 0
              ? `${l.product.name} just sold out. Remove it from your cart to continue.`
              : `Only ${row.quantity} left of ${l.product.name}. Lower the quantity and try again.`);
          }
          await run('UPDATE stock SET quantity = quantity - ?, updated_at = UTC_TIMESTAMP() WHERE product_id = ?', [l.qty, l.product.id]);
        }
      }
      const res = await run(
        `INSERT INTO orders (ref, access_token, status, payment_method, currency, total, base_total,
          customer_name, customer_email, customer_phone, company, country, address_line, city, postcode, notes,
          created_at, updated_at)
         VALUES (?, ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [ref, token, method, currency, total, baseTotal, customer.name, customer.email, customer.phone, customer.company,
          customer.country, customer.address, customer.city, customer.postcode, notes]
      );
      const orderId = res.insertId;
      for (const l of lines) {
        await run(
          `INSERT INTO order_items (order_id, product_id, name, type, unit_price, qty, line_total, billing_interval, booking_date, booking_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, l.product.id, l.product.name, l.product.type, l.unit, l.qty, l.total, l.interval, l.date, l.time]
        );
        if (l.date) {
          await run('INSERT INTO bookings (product_id, slot_date, slot_time, order_id) VALUES (?, ?, ?, ?)',
            [l.product.id, l.date, l.time, orderId]);
        }
      }
      await run('INSERT INTO order_events (order_id, status, note, is_public, created_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP())',
        [orderId, 'awaiting_payment', 'Order placed.']);
    });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') throw httpError(409, 'That call time was just booked by someone else. Pick another time.');
    throw err;
  }

  const order = await loadByRef(ref);
  notify.orderPlaced(order);
  return order;
}

/* ---------- Read ---------- */
async function loadByRef(ref) {
  const [o] = await db.q('SELECT * FROM orders WHERE ref = ?', [ref]);
  if (!o) return null;
  o.items = await db.q('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [o.id]);
  o.events = await db.q('SELECT * FROM order_events WHERE order_id = ? ORDER BY id', [o.id]);
  return o;
}

function bankDetails(o) {
  if (o.payment_method !== 'bank' || o.status !== 'awaiting_payment') return null;
  return { ...site.payments.bank, reference: o.ref };
}

function toPublic(o) {
  return {
    ref: o.ref,
    token: o.access_token,
    status: o.status,
    statusLabel: STATUS[o.status] || o.status,
    method: o.payment_method,
    currency: o.currency,
    total: Number(o.total),
    firstName: (o.customer_name || '').split(' ')[0],
    createdAt: db.iso(o.created_at),
    paidAt: db.iso(o.paid_at),
    items: o.items.map(i => ({
      id: i.product_id, name: i.name, type: i.type, qty: i.qty,
      unit: Number(i.unit_price), total: Number(i.line_total),
      interval: i.billing_interval, date: i.booking_date, time: i.booking_time
    })),
    events: o.events.filter(e => e.is_public).map(e => ({
      status: e.status, label: STATUS[e.status] || e.status, note: e.note, at: db.iso(e.created_at)
    })),
    bank: bankDetails(o),
    bankHoldDays: site.payments.methods.bank ? site.payments.methods.bank.holdDays : null
  };
}

async function getForCustomer(ref, { token, email }) {
  const o = await loadByRef(String(ref || '').toUpperCase());
  const ok = o && ((token && safeEqual(token, o.access_token)) ||
    (email && safeEqual(String(email).trim().toLowerCase(), o.customer_email)));
  if (!ok) throw httpError(404, "We couldn't find that order. Check the order number and email.");
  return toPublic(o);
}

/* ---------- Status changes ---------- */
async function setStatus(ref, status, { note = null, isPublic = true, provider = null, paymentRef = null, notifyCustomer = true, allowReopen = false } = {}) {
  if (!STATUS[status]) throw httpError(400, 'Unknown status.');
  let changed = false;
  await db.tx(async run => {
    const [o] = await run('SELECT * FROM orders WHERE ref = ? FOR UPDATE', [ref]);
    if (!o) throw httpError(404, 'Order not found.');
    if (o.status === status && !note) return;
    const items = await run('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
    const wasReleased = RELEASED.has(o.status), nowReleased = RELEASED.has(status);

    if (!wasReleased && nowReleased) {
      for (const i of items) {
        await run('UPDATE stock SET quantity = quantity + ?, updated_at = UTC_TIMESTAMP() WHERE product_id = ? AND quantity IS NOT NULL', [i.qty, i.product_id]);
      }
      await run('DELETE FROM bookings WHERE order_id = ?', [o.id]);
    } else if (wasReleased && !nowReleased) {
      if (!allowReopen) throw httpError(400, 'This order was cancelled. Ask the customer to place a new order.');
      // A late payment came in after the order expired: take the stock and slots back.
      for (const i of items) {
        await run('UPDATE stock SET quantity = GREATEST(quantity - ?, 0), updated_at = UTC_TIMESTAMP() WHERE product_id = ? AND quantity IS NOT NULL', [i.qty, i.product_id]);
        if (i.booking_date) {
          await run('INSERT IGNORE INTO bookings (product_id, slot_date, slot_time, order_id) VALUES (?, ?, ?, ?)', [i.product_id, i.booking_date, i.booking_time, o.id]);
        }
      }
    }

    await run(
      `UPDATE orders SET status = ?, updated_at = UTC_TIMESTAMP(),
         paid_at = IF(? = 'paid' AND paid_at IS NULL, UTC_TIMESTAMP(), paid_at),
         payment_provider = COALESCE(?, payment_provider), payment_ref = COALESCE(?, payment_ref)
       WHERE id = ?`,
      [status, status, provider, paymentRef, o.id]
    );
    await run('INSERT INTO order_events (order_id, status, note, is_public, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
      [o.id, status, note, isPublic ? 1 : 0]);
    changed = o.status !== status || !!note;
  });
  const order = await loadByRef(ref);
  if (changed) {
    if (status === 'paid') notify.orderPaid(order);
    else if (notifyCustomer) notify.statusChanged(order, STATUS[status], isPublic ? note : null);
  }
  return order;
}

async function markPaid(ref, { provider, paymentRef, note }) {
  const [o] = await db.q('SELECT status FROM orders WHERE ref = ?', [ref]);
  if (!o) return null;
  if (!['awaiting_payment', 'payment_failed', 'cancelled'].includes(o.status)) return loadByRef(ref); // already paid
  return setStatus(ref, 'paid', { note: note || 'Payment received. Thank you!', provider, paymentRef, allowReopen: true });
}

async function markFailed(ref, note) {
  const [o] = await db.q('SELECT status FROM orders WHERE ref = ?', [ref]);
  if (!o || o.status !== 'awaiting_payment') return null;
  return setStatus(ref, 'payment_failed', { note: note || 'The payment did not go through. You can place the order again.' });
}

async function setPaymentRef(ref, provider, paymentRef) {
  await db.q('UPDATE orders SET payment_provider = ?, payment_ref = ?, updated_at = UTC_TIMESTAMP() WHERE ref = ?', [provider, paymentRef, ref]);
}

// Unpaid card, wallet and PayPal orders release their stock and call slots after a while.
// Unpaid bank transfers are cancelled after holdDays.
async function expireUnpaid() {
  const mins = Number(site.unpaidExpiryMinutes || 60);
  const days = Number((site.payments.methods.bank || {}).holdDays || 5);
  const stale = await db.q(
    `SELECT ref, payment_method FROM orders WHERE status = 'awaiting_payment' AND (
       (payment_method <> 'bank' AND created_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE) OR
       (payment_method = 'bank' AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY))`,
    [mins, days]
  );
  for (const s of stale) {
    try {
      if (s.payment_method === 'bank') await setStatus(s.ref, 'cancelled', { note: `No transfer arrived within ${days} days, so the order was cancelled.` });
      else await setStatus(s.ref, 'payment_failed', { note: 'Payment was not completed in time, so the order was released.' });
    } catch (e) { console.error('Expire failed for', s.ref, e.message); }
  }
}

/* ---------- Admin queries ---------- */
async function adminList({ status, q }) {
  const where = [], params = [];
  if (status && STATUS[status]) { where.push('o.status = ?'); params.push(status); }
  if (q) {
    where.push('(o.ref LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.company LIKE ?)');
    const like = '%' + String(q).slice(0, 80) + '%';
    params.push(like, like, like, like);
  }
  const rows = await db.q(
    `SELECT o.ref, o.status, o.payment_method, o.currency, o.total, o.customer_name, o.customer_email, o.company,
            o.created_at, o.paid_at,
            (SELECT GROUP_CONCAT(CONCAT(i.qty, ' x ', i.name) SEPARATOR ', ') FROM order_items i WHERE i.order_id = o.id) AS summary
     FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY o.id DESC LIMIT 200`, params);
  return rows.map(r => ({ ...r, total: Number(r.total), created_at: db.iso(r.created_at), paid_at: db.iso(r.paid_at), statusLabel: STATUS[r.status] }));
}

async function adminDetail(ref) {
  const o = await loadByRef(ref);
  if (!o) throw httpError(404, 'Order not found.');
  return {
    ...toPublic(o),
    events: o.events.map(e => ({ status: e.status, label: STATUS[e.status], note: e.note, isPublic: !!e.is_public, at: db.iso(e.created_at) })),
    customer: {
      name: o.customer_name, email: o.customer_email, phone: o.customer_phone, company: o.company,
      country: o.country, address: o.address_line, city: o.city, postcode: o.postcode
    },
    notes: o.notes,
    provider: o.payment_provider,
    paymentRef: o.payment_ref,
    baseTotal: Number(o.base_total),
    updatedAt: db.iso(o.updated_at)
  };
}

async function adminSummary() {
  const counts = await db.q('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const revenue = await db.q(
    `SELECT currency, SUM(total) AS total, COUNT(*) AS n FROM orders
     WHERE status IN ('paid','in_progress','completed') AND paid_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')
     GROUP BY currency ORDER BY total DESC`);
  const [base] = await db.q(
    `SELECT COALESCE(SUM(base_total), 0) AS total FROM orders
     WHERE status IN ('paid','in_progress','completed') AND paid_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`);
  const [msgs] = await db.q('SELECT COUNT(*) AS n FROM messages WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY');
  return {
    counts: Object.fromEntries(counts.map(r => [r.status, r.n])),
    revenue: revenue.map(r => ({ currency: r.currency, total: Number(r.total), orders: r.n })),
    baseRevenue: Number(base.total),
    messages7d: msgs.n,
    statuses: STATUS
  };
}

module.exports = {
  STATUS, httpError, createOrder, loadByRef, getForCustomer, setStatus, markPaid, markFailed,
  setPaymentRef, expireUnpaid, adminList, adminDetail, adminSummary, toPublic
};
