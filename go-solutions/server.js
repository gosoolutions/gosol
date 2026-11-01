require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./src/db');
const catalog = require('./src/catalog');
const orders = require('./src/orders');
const payments = require('./src/payments');
const notify = require('./src/notify');
const admin = require('./src/admin');
const { port, isProd, sandboxOn } = require('./src/config');

const app = express();
app.set('trust proxy', 1); // Render and most hosts sit behind a proxy
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));

const limit = (n, mins) => rateLimit({ windowMs: mins * 60 * 1000, limit: n, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many requests. Wait a few minutes and try again.' } });

// Payment routes first: webhooks need the raw body.
payments.mount(app);

app.use(express.json({ limit: '100kb' }));

/* ---------- Public API ---------- */
app.get('/api/catalog', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await catalog.publicCatalog());
});

app.get('/api/slots', limit(120, 5), async (req, res) => {
  const slots = await catalog.availableSlots(String(req.query.product || ''), String(req.query.date || ''));
  if (!slots) return res.status(404).json({ error: 'That product cannot be booked.' });
  res.set('Cache-Control', 'no-store').json({ slots });
});

app.post('/api/orders', limit(20, 15), async (req, res) => {
  const order = await orders.createOrder(req.body || {});
  let next;
  try {
    next = await payments.start(order);
  } catch (err) {
    await orders.markFailed(order.ref, 'We could not start the payment. Please try again.').catch(() => {});
    throw err;
  }
  res.status(201).json({ ref: order.ref, token: order.access_token, next });
});

app.get('/api/orders/:ref', limit(60, 15), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await orders.getForCustomer(req.params.ref, { token: req.query.t, email: req.query.email }));
});

app.post('/api/contact', limit(5, 15), async (req, res) => {
  const b = req.body || {};
  const m = {
    name: String(b.name || '').trim().slice(0, 120),
    email: String(b.email || '').trim().slice(0, 190),
    phone: String(b.phone || '').trim().slice(0, 40) || null,
    message: String(b.message || '').trim().slice(0, 4000)
  };
  if (!m.name || !m.message || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.email)) {
    return res.status(400).json({ error: 'Add your name, a valid email and a message.' });
  }
  await db.q('INSERT INTO messages (name, email, phone, message, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())', [m.name, m.email, m.phone, m.message]);
  notify.contact(m);
  res.status(201).json({ ok: true });
});

/* ---------- Admin ---------- */
app.use('/api/admin', admin.router);
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

/* ---------- Static site ---------- */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1h' : 0, index: 'index.html' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

/* ---------- Errors ---------- */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on our side. Please try again.' : err.message });
});

/* ---------- Start ---------- */
(async () => {
  await db.migrate();
  await catalog.seedStock();
  setInterval(() => orders.expireUnpaid().catch(e => console.error('Expiry job failed:', e.message)), 5 * 60 * 1000).unref();
  app.listen(port, () => {
    console.log(`Go Solutions site running on port ${port}`);
    if (sandboxOn) console.log('Payments are in TEST mode (sandbox page). Set PAYMENT_PROVIDER=hosted for real payments.');
  });
})().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
