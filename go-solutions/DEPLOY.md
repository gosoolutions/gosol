# Deploy Go Solutions: GitHub → Aiven → Render

About 20 minutes. $0 on the free plans. Do it on a laptop, signed in to the Go Solutions accounts.

## 1. Put the code on GitHub

The code is already committed, so you only need to push it.

**Option A: GitHub Desktop (easiest)**
1. Unzip `go-solutions-site.zip`.
2. GitHub Desktop → File → Add local repository → choose the `go-solutions` folder.
3. Click **Publish repository**. Keep **Private** ticked. Done.

**Option B: Terminal**
1. On github.com: New repository → name `go-solutions` → **Private** → don't add a README or .gitignore → Create.
2. In a terminal, inside the `go-solutions` folder:
   ```bash
   git remote add origin https://github.com/YOUR-GITHUB-USERNAME/go-solutions.git
   git push -u origin main
   ```
   GitHub asks you to sign in. Use the Go Solutions account.

Keep the repo private. Never commit a `.env` file (it's already in `.gitignore`).

## 2. Create the database on Aiven

1. Aiven console → **Create service** → **MySQL** → **Free** plan. Pick the region closest to Singapore if you get a choice. Name it `gosolutions-db`.
2. Wait until it says **Running** (a few minutes).
3. On the service's **Overview** page, under connection information, copy two things and keep them private:
   - **Service URI** (starts with `mysql://avnadmin:...`)
   - **CA certificate** (click to show or download it, then copy all of it, including the `BEGIN` and `END` lines)

You don't need to create any tables. The site creates them the first time it starts.

## 3. Deploy on Render

1. Render dashboard → **New** → **Blueprint** → connect the Go Solutions GitHub account → pick the `go-solutions` repo. Render reads `render.yaml` from the repo.
2. Render asks for these values:

   | Setting | What to paste |
   | --- | --- |
   | `DATABASE_URL` | Aiven Service URI |
   | `DB_CA_CERT` | Aiven CA certificate, all of it |
   | `ADMIN_PASSWORD` | A long password you make up (10+ characters). Save it somewhere safe |
   | `PAYMENT_SANDBOX` | `on` (turns on the test payment page for the demo) |

   `SESSION_SECRET` is generated for you. `NODE_ENV` is already set.
3. Click **Apply** / **Deploy** and wait for **Live**. Your address looks like `https://go-solutions.onrender.com` (Render may add letters if the name is taken).

## 4. Check it works (5 minutes)

- Open the address. The shop loads with a yellow **Preview** bar at the top.
- Book a Discovery Call → checkout → test payment page → **Approve**. The order page should say **Payment received**.
- Open `/admin` on the same address and log in with your `ADMIN_PASSWORD`. The order is there.
- Go to **Track order** and look the order up with its number and email.

## Before real customers

- [ ] Render → the service → **Settings** → change the instance type to **Starter** ($7/month). Free instances sleep after 15 minutes, and a sleeping site can miss payment confirmations.
- [ ] Delete `PAYMENT_SANDBOX` in Render → **Environment**. Leaving it on lets anyone mark their own order as paid.
- [ ] Real products, company details, bank details and exchange rates in `config/`. Push to GitHub and Render redeploys by itself.
- [ ] Payment provider: `PAYMENT_PROVIDER=hosted` plus its keys, after filling in `src/payments/hosted-card.js` (see README). PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE=live`.
- [ ] Order emails through the Go Solutions Gmail: turn on 2-Step Verification in the Google account, create an **App password**, then set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=` the Gmail address, `SMTP_PASS=` the app password, `ADMIN_EMAIL=` where Simon wants alerts.
- [ ] Custom domain: Render → **Settings** → **Custom Domains**, then set `BASE_URL=https://yourdomain.com`.

## If something goes wrong

| What you see | Fix |
| --- | --- |
| Deploy fails, logs say `Startup failed: connect ...` | `DATABASE_URL` is wrong, or Aiven switched the free database off for being idle. Power it back on in the Aiven console, then redeploy. |
| Logs mention a certificate or SSL error | `DB_CA_CERT` is missing or cut off. Paste the whole certificate again. |
| First visit takes about a minute | Normal on the free plan: the site was asleep. |
| `/admin` says to set `ADMIN_PASSWORD` | The password is missing or shorter than 10 characters. |
| Card checkout only shows bank transfer | `PAYMENT_SANDBOX` isn't `on` and no real provider is set up yet. |
