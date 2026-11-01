# Go Solutions website

Storefront, checkout, order tracking and admin dashboard for Go Solutions. Built by EAWEB.

- **Stack:** Node.js + Express, MySQL (Aiven works), plain HTML/CSS/JS front end. No build step.
- **Pages:** Home, Solutions, product pages, Cart, Checkout, Track order, About, Contact, Terms, Refunds, Privacy, Delivery.
- **Features:** cart and checkout, licences / subscriptions / fixed-price projects / bookable calls, stock tracking, booking slots with double-booking protection, 5 currencies, order tracking with timeline, admin dashboard, email + WhatsApp order alerts, WhatsApp chat button.
- **Payments:** card, Alipay and WeChat Pay through a hosted payment page provider, PayPal, and bank transfer. A built-in test payment page lets you run the whole flow before the merchant account is approved.

## Run it locally

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD
npm run dev               # http://localhost:3000   admin: http://localhost:3000/admin
```

Tables are created automatically on first start (`db/schema.sql`). Outside production, payments run in test mode: checkout sends you to a test page where you approve or decline. Nothing is charged.

## Deploy (Render + Aiven MySQL)

**Step-by-step guide with every click: [DEPLOY.md](DEPLOY.md).** Short version:

1. Create a free MySQL service on Aiven. Copy the service URI into `DATABASE_URL` and the CA certificate into `DB_CA_CERT`.
2. Push this folder to a GitHub repo and create a **Web Service** on Render from it (or use `render.yaml`).
   Build command `npm install`, start command `npm start`.
3. Add the environment variables from `.env.example` in Render. Set `BASE_URL` to the live address (e.g. `https://gosolutions.com`).
4. Point the domain at Render and turn on HTTPS.

Render's free tier sleeps when idle, so the first visit after a quiet spell is slow. Use a paid instance once real customers are buying.

## Before launch checklist

- [ ] **Products:** replace the sample catalogue in `config/products.json` with Go Solutions' real offerings and remove `"sample": true`. The yellow preview bar disappears when no product is marked sample and test mode is off.
- [ ] **Company details** in `config/site.json`: `legalName`, `registrationNumber`, `address`, `email`, `whatsapp`. Anything empty shows as a highlighted `[placeholder]` on the site.
- [ ] **Bank details** in `config/site.json` → `payments.bank`.
- [ ] **Exchange rates** in `config/site.json` → `currencies`. Prices are set in USD and converted at these rates. Update them regularly.
- [ ] **Brand colours:** the site is burgundy. To change it, edit the `--wine-*` values at the top of `public/styles.css`. See `docs/brand-guidelines.md`.
- [ ] **Policies:** the Terms, Refunds, Privacy and Delivery pages (`policy()` in `public/app.js`) are starting templates. Simon should check they match how he actually works, and a lawyer should review them.
- [ ] **Email alerts:** set `SMTP_*`, `MAIL_FROM` and `ADMIN_EMAIL`.
- [ ] **WhatsApp alerts:** set `WHATSAPP_ALERT_URL` (CallMeBot is the easiest for alerts to your own number).
- [ ] **Admin password:** long and random, in `ADMIN_PASSWORD`.
- [ ] **Real payments:** set `PAYMENT_PROVIDER=hosted` and fill in `src/payments/hosted-card.js` (see below). Make sure `PAYMENT_SANDBOX` is **not** `on`.

## Payments

| Method | How it works | What you need |
| --- | --- | --- |
| Card, Alipay, WeChat Pay | Customer pays on the provider's hosted page. The provider calls `/pay/hosted/callback`, which marks the order paid. | Merchant account in **Go Solutions' name**, API keys, webhook secret |
| PayPal | PayPal Checkout (Orders v2). Customer approves on PayPal, the site captures the payment on return. | PayPal Business account, REST app client ID + secret |
| Bank transfer | Order page shows bank details and the order reference. You mark it paid in the admin when the money lands. | Bank details in `site.json` |

**Plugging in the card provider.** Open `src/payments/hosted-card.js`. The flow is already wired; the `TODO` lines are the bits that differ per provider (endpoint, field names, signature header). Copy those from the provider's API docs. Card numbers never touch this server, which keeps PCI compliance light (usually SAQ A).

**2D vs 3D Secure** is a setting on the merchant account, handled by the provider. The site code is the same either way. Ask the provider to switch on CVV and address checks, per-transaction limits and chargeback alerts.

**Limits.** Card, Alipay, WeChat Pay and PayPal are capped at US$10,000 per order (`maxBaseTotal` in `site.json`). Bigger orders must use bank transfer. Change the caps to match what the provider approves.

**Unpaid orders.** Card and PayPal orders that aren't paid within 60 minutes are released (stock and call slots go back). Unpaid bank transfers are cancelled after 5 days. Both are set in `site.json`.

**Test mode.** `PAYMENT_SANDBOX=on` turns on the fake payment page, which lets *anyone* mark their own order as paid. Use it only for demos and testing, never with real customers.

## Admin

Go to `/admin` and log in with `ADMIN_PASSWORD`.

- **Orders:** filter, search, open an order, change its status, add a note (shown to the customer or internal), email the customer. "Mark bank transfer received" for bank orders.
- **Stock:** set how many licences or project slots are left. Empty means unlimited.
- **Messages:** everything sent through the Contact page.

Order statuses: Awaiting payment → Payment received → In progress → Completed. Also Cancelled and Payment failed (these put the stock and booking slot back).

## Preview build

`npm run build:preview` writes `preview/go-solutions-preview.html`: the full storefront in one file, running on sample data in the browser with test payments. Good for showing the client before the server is live.

## Files

```
server.js                 Express app and routes
config/site.json          Company details, currencies, booking hours, payment methods, bank details
config/products.json      Catalogue (prices in USD)
db/schema.sql             Tables (created automatically)
src/orders.js             Orders, stock, bookings, statuses, expiry
src/catalog.js            Products, currency conversion, booking slots
src/notify.js             Email + WhatsApp alerts
src/admin.js              Admin API and login
src/payments/             hosted-card.js (real provider), paypal.js, sandbox.js (test page)
public/                   index.html, app.js (storefront), admin.html, admin.js, styles.css
scripts/build-preview.js  One-file preview build
```
