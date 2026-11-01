const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

let pool = null;

// Rebuilds a PEM certificate even if the line breaks were lost when it was pasted
// (turned into spaces, written as \n, wrapped in quotes...).
function normalisePem(text) {
  const s = String(text).replace(/\\n/g, '\n').replace(/\\r/g, '');
  const re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    const body = m[1].replace(/[^A-Za-z0-9+/=]/g, '');
    if (body) out.push('-----BEGIN CERTIFICATE-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n');
  }
  return out;
}

// Where the database CA certificate can come from, in order:
// DB_CA_FILE (a path), a Render Secret File named ca.pem, or the DB_CA_CERT variable.
function loadCa() {
  let text = null, from = null;
  if (process.env.DB_CA_FILE) { text = fs.readFileSync(process.env.DB_CA_FILE, 'utf8'); from = 'DB_CA_FILE'; }
  else if (fs.existsSync('/etc/secrets/ca.pem')) { text = fs.readFileSync('/etc/secrets/ca.pem', 'utf8'); from = 'secret file ca.pem'; }
  else if (process.env.DB_CA_CERT) { text = process.env.DB_CA_CERT; from = 'DB_CA_CERT'; }
  if (!text) return null;
  const pems = normalisePem(text);
  if (!pems.length) {
    throw new Error(`${from} doesn't contain a certificate. Copy the CA certificate from Aiven again, including the -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- lines.`);
  }
  const subjects = pems.map(p => {
    try { return new crypto.X509Certificate(p).subject.replace(/\n/g, ', '); }
    catch { throw new Error(`${from} has a damaged certificate. Copy the CA certificate from Aiven again.`); }
  });
  return { ca: pems.join(''), from, subjects };
}

function getPool() {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set. Add it to your .env file.');
  // Aiven's Service URI ends in ?ssl-mode=REQUIRED. mysql2 doesn't use that option; TLS is set below.
  const url = new URL(raw);
  url.searchParams.delete('ssl-mode');
  url.searchParams.delete('sslmode');
  const uri = url.toString();
  const opts = {
    uri,
    connectionLimit: 8,
    dateStrings: true,
    decimalNumbers: true,
    timezone: 'Z'
  };
  const ca = loadCa();
  if (ca) {
    // Aiven signs its databases with its own CA, so we trust exactly that certificate.
    opts.ssl = { ca: ca.ca, rejectUnauthorized: true };
    console.log(`Database TLS: checking the server against the CA from ${ca.from} (${ca.subjects.join(' | ')})`);
  } else if (process.env.DB_SSL === 'true') {
    // TiDB Cloud and most hosted MySQL: TLS with a public certificate, no CA file needed.
    opts.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  }
  pool = mysql.createPool(opts);
  return pool;
}

async function q(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function tx(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const run = async (sql, params = []) => (await conn.query(sql, params))[0];
    const result = await fn(run);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
  try {
    for (const s of statements) await q(s);
  } catch (err) {
    if (err.code && /certificate|SSL|TLS/i.test(err.message)) {
      err.message += '. The database certificate check failed: make sure DB_CA_CERT holds the CA certificate from Aiven (or add it as a Secret File named ca.pem).';
    } else if (/insecure transport|secure_transport/i.test(err.message)) {
      err.message += '. The database requires an encrypted connection: set DB_CA_CERT to the CA certificate from Aiven.';
    }
    throw err;
  }
}

// MySQL DATETIME strings are stored in UTC. Turn them into ISO strings for the browser.
function iso(v) {
  if (!v) return null;
  return String(v).replace(' ', 'T') + 'Z';
}

module.exports = { q, tx, migrate, iso, getPool };
