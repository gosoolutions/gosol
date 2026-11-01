const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const orders = require('./orders');
const catalog = require('./catalog');
const { products, isProd } = require('./config');

const COOKIE = 'gs_admin';
const HOURS = 12;
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const sign = v => crypto.createHmac('sha256', secret).update(v).digest('base64url');
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function readCookie(req) {
  const part = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  return part ? decodeURIComponent(part.slice(COOKIE.length + 1)) : null;
}
function isAuthed(req) {
  const v = readCookie(req);
  if (!v) return false;
  const [exp, sig] = v.split('.');
  return !!exp && !!sig && same(sig, sign(exp)) && Number(exp) > Date.now();
}
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: isProd, path: '/' };

const router = express.Router();

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), (req, res) => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || pw.length < 10) return res.status(503).json({ error: 'Set ADMIN_PASSWORD (10+ characters) in the environment first.' });
  if (!same(String((req.body || {}).password || ''), pw)) return res.status(401).json({ error: 'Wrong password.' });
  const exp = String(Date.now() + HOURS * 3600 * 1000);
  res.cookie(COOKIE, `${exp}.${sign(exp)}`, { ...cookieOpts, maxAge: HOURS * 3600 * 1000 });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, cookieOpts);
  res.json({ ok: true });
});

// Everything below needs a valid session. Writes must be JSON, which blocks cross-site form posts.
router.use((req, res, next) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Please log in.' });
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/me', (req, res) => res.json({ ok: true }));
router.get('/summary', async (req, res) => res.json(await orders.adminSummary()));
router.get('/orders', async (req, res) => res.json(await orders.adminList({ status: req.query.status, q: req.query.q })));
router.get('/orders/:ref', async (req, res) => res.json(await orders.adminDetail(req.params.ref)));

router.post('/orders/:ref/status', async (req, res) => {
  const b = req.body || {};
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) || null : null;
  await orders.setStatus(req.params.ref, String(b.status || ''), {
    note,
    isPublic: b.isPublic !== false,
    notifyCustomer: b.notifyCustomer !== false,
    provider: b.status === 'paid' ? 'manual' : null
  });
  res.json(await orders.adminDetail(req.params.ref));
});

router.get('/stock', async (req, res) => {
  const stock = await catalog.stockMap();
  res.json(products.map(p => ({ id: p.id, name: p.name, type: p.type, price: p.price, stock: p.id in stock ? stock[p.id] : null, stockUnit: p.stockUnit || null })));
});

router.put('/stock/:id', async (req, res) => {
  const p = catalog.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const raw = (req.body || {}).stock;
  const qty = raw === null || raw === '' ? null : Number.parseInt(raw, 10);
  if (qty !== null && (!Number.isFinite(qty) || qty < 0 || qty > 1000000)) return res.status(400).json({ error: 'Stock must be a whole number, or empty for unlimited.' });
  await db.q('INSERT INTO stock (product_id, quantity, updated_at) VALUES (?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = UTC_TIMESTAMP()', [p.id, qty]);
  res.json({ id: p.id, stock: qty });
});

router.get('/messages', async (req, res) => {
  const rows = await db.q('SELECT id, name, email, phone, message, created_at FROM messages ORDER BY id DESC LIMIT 100');
  res.json(rows.map(r => ({ ...r, created_at: db.iso(r.created_at) })));
});

module.exports = { router };
