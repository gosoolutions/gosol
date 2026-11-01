const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;

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
  if (process.env.DB_CA_CERT) {
    // Aiven gives you a CA certificate. Paste it into DB_CA_CERT (\n line breaks are fine).
    opts.ssl = { ca: process.env.DB_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true };
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
  for (const s of statements) await q(s);
}

// MySQL DATETIME strings are stored in UTC. Turn them into ISO strings for the browser.
function iso(v) {
  if (!v) return null;
  return String(v).replace(' ', 'T') + 'Z';
}

module.exports = { q, tx, migrate, iso, getPool };
