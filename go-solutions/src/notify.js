const nodemailer = require('nodemailer');
const { site, baseUrl } = require('./config');

let transport;
function mailer() {
  if (transport !== undefined) return transport;
  if (!process.env.SMTP_HOST) { transport = null; return null; }
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transport;
}

async function sendMail(to, subject, text) {
  if (!to) return;
  const t = mailer();
  if (!t) { console.log(`[email not sent: SMTP not set] to=${to} | ${subject}`); return; }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  } catch (e) {
    console.error('Email failed:', e.message);
  }
}

// WHATSAPP_ALERT_URL is any URL with {text} in it, e.g. CallMeBot:
// https://api.callmebot.com/whatsapp.php?phone=264XXXXXXX&apikey=XXXX&text={text}
async function whatsapp(text) {
  const url = process.env.WHATSAPP_ALERT_URL;
  if (!url) return;
  try {
    await fetch(url.replace('{text}', encodeURIComponent(text)), { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    console.error('WhatsApp alert failed:', e.message);
  }
}

function fmt(amount, code) {
  const c = site.currencies.find(x => x.code === code) || { symbol: code + ' ', decimals: 2 };
  const n = Number(amount).toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
  return (/[A-Za-z]$/.test(c.symbol) ? c.symbol + ' ' : c.symbol) + n;
}
function link(o) { return `${baseUrl}/#order-${o.ref}-${o.access_token}`; }
function lines(o) {
  return o.items.map(i => {
    let s = `- ${i.qty} x ${i.name}: ${fmt(i.line_total, o.currency)}`;
    if (i.billing_interval) s += ` per ${i.billing_interval}`;
    if (i.booking_date) s += ` (${i.booking_date} at ${i.booking_time}, ${site.booking.timezoneLabel})`;
    return s;
  }).join('\n');
}
const ADMIN = () => process.env.ADMIN_EMAIL;
const run = p => { p.catch(e => console.error('Notify failed:', e.message)); };

function orderPlaced(o) {
  run((async () => {
    const bank = o.payment_method === 'bank' ? site.payments.bank : null;
    let text = `Hi ${o.customer_name.split(' ')[0]},\n\nThanks for your order with ${site.businessName}.\n\nOrder: ${o.ref}\nTotal: ${fmt(o.total, o.currency)}\n\n${lines(o)}\n\n`;
    if (bank) {
      text += `Please pay by bank transfer:\nBank: ${bank.bankName || '-'}\nAccount name: ${bank.accountName || '-'}\nAccount number / IBAN: ${bank.accountNumber || '-'}\nSWIFT: ${bank.swift || '-'}\nReference: ${o.ref}\n\nWe start as soon as the money arrives.\n\n`;
    }
    text += `Track your order: ${link(o)}\n\n${site.businessName}`;
    await sendMail(o.customer_email, `Order ${o.ref} received`, text);
    await sendMail(ADMIN(), `New order ${o.ref}: ${fmt(o.total, o.currency)} (${o.payment_method}, awaiting payment)`,
      `${o.customer_name} <${o.customer_email}> ${o.customer_phone}\n${o.company || ''}\n\n${lines(o)}\n\nAdmin: ${baseUrl}/admin`);
  })());
}

function orderPaid(o) {
  run((async () => {
    await sendMail(o.customer_email, `Payment received for order ${o.ref}`,
      `Hi ${o.customer_name.split(' ')[0]},\n\nWe've received your payment of ${fmt(o.total, o.currency)}. Thank you!\n\n${lines(o)}\n\nWe'll be in touch with the next steps. Track your order: ${link(o)}\n\n${site.businessName}`);
    await sendMail(ADMIN(), `PAID ${o.ref}: ${fmt(o.total, o.currency)}`,
      `${o.customer_name} <${o.customer_email}> ${o.customer_phone}\n\n${lines(o)}\n\nAdmin: ${baseUrl}/admin`);
    await whatsapp(`Paid order ${o.ref}: ${fmt(o.total, o.currency)} from ${o.customer_name}. ${o.items.map(i => i.qty + 'x ' + i.name).join(', ')}`);
  })());
}

function statusChanged(o, label, note) {
  run(sendMail(o.customer_email, `Order ${o.ref}: ${label}`,
    `Hi ${o.customer_name.split(' ')[0]},\n\nYour order ${o.ref} is now: ${label}.${note ? '\n\n' + note : ''}\n\nTrack your order: ${link(o)}\n\n${site.businessName}`));
}

function contact(m) {
  run((async () => {
    await sendMail(ADMIN(), `Website message from ${m.name}`, `${m.name} <${m.email}> ${m.phone || ''}\n\n${m.message}`);
    await whatsapp(`New website message from ${m.name} (${m.email}): ${m.message.slice(0, 300)}`);
  })());
}

module.exports = { orderPlaced, orderPaid, statusChanged, contact };
