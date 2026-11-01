const db = require('./db');
const { site, products, sandboxOn } = require('./config');

const byId = new Map(products.map(p => [p.id, p]));

function getProduct(id) {
  const p = byId.get(id);
  return p && p.active !== false ? p : null;
}

function currencyInfo(code) {
  return site.currencies.find(c => c.code === code) || null;
}

function round(value, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// Prices in products.json are in the base currency (USD).
function convert(base, code) {
  const c = currencyInfo(code);
  return round(base * c.rate, c.decimals);
}

async function seedStock() {
  for (const p of products) {
    await db.q('INSERT IGNORE INTO stock (product_id, quantity, updated_at) VALUES (?, ?, UTC_TIMESTAMP())', [
      p.id,
      p.stock == null ? null : p.stock
    ]);
  }
}

async function stockMap() {
  const rows = await db.q('SELECT product_id, quantity FROM stock');
  return Object.fromEntries(rows.map(r => [r.product_id, r.quantity]));
}

function publicSite() {
  const methods = {};
  for (const [key, m] of Object.entries(site.payments.methods)) {
    if (!m.enabled) continue;
    const available = key === 'bank' || key === 'paypal'
      ? (key === 'bank' || !!process.env.PAYPAL_CLIENT_ID || sandboxOn)
      : (process.env.PAYMENT_PROVIDER === 'hosted' || sandboxOn);
    if (!available) continue;
    methods[key] = { label: m.label, note: m.note, currencies: m.currencies || null, maxBaseTotal: m.maxBaseTotal || null };
  }
  return {
    businessName: site.businessName,
    legalName: site.legalName,
    registrationNumber: site.registrationNumber,
    registeredIn: site.registeredIn,
    address: site.address,
    email: site.email,
    whatsapp: site.whatsapp,
    supportHours: site.supportHours,
    defaultCurrency: site.defaultCurrency,
    currencies: site.currencies,
    booking: site.booking,
    bankHoldDays: site.payments.methods.bank ? site.payments.methods.bank.holdDays : null,
    methods,
    testMode: sandboxOn && process.env.PAYMENT_PROVIDER !== 'hosted'
  };
}

async function publicCatalog() {
  const stock = await stockMap();
  return {
    site: publicSite(),
    products: products
      .filter(p => p.active !== false)
      .map(p => ({ ...p, stock: p.id in stock ? stock[p.id] : (p.stock == null ? null : p.stock) }))
  };
}

/* ---------- Booking slots ---------- */
function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function bookableDates() {
  const b = site.booking;
  const today = todayIn(b.timezone);
  const out = [];
  for (let i = b.leadDays; i <= b.horizonDays; i++) {
    const d = addDays(today, i);
    if (b.days.includes(new Date(d + 'T00:00:00Z').getUTCDay())) out.push(d);
  }
  return out;
}

async function availableSlots(productId, date) {
  const p = getProduct(productId);
  if (!p || p.type !== 'booking') return null;
  if (!bookableDates().includes(date)) return [];
  const rows = await db.q('SELECT slot_time FROM bookings WHERE product_id = ? AND slot_date = ?', [productId, date]);
  const taken = new Set(rows.map(r => r.slot_time));
  return site.booking.slots.map(time => ({ time, available: !taken.has(time) }));
}

module.exports = {
  getProduct, currencyInfo, convert, round, seedStock, stockMap,
  publicCatalog, publicSite, bookableDates, availableSlots
};
