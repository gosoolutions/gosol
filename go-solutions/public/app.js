/* Go Solutions storefront. Plain JS, no build step.
   Routes live in the URL hash (#shop, #p-<id>, #cart, #checkout, #order-<ref>-<token>, ...).
   When window.GS_DEMO is set (the preview build), everything runs in the browser with test data. */
(function () {
  "use strict";

  const DEMO = window.GS_DEMO || null;
  const root = document.getElementById("app");

  /* ================= Helpers ================= */
  function h(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v; // static SVG only
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
        else if (k === "value") n.value = v;
        else n.setAttribute(k, v === true ? "" : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, k) {
    if (k == null || k === false) return;
    if (Array.isArray(k)) { k.forEach(x => add(n, x)); return; }
    n.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  function frag() { const f = document.createDocumentFragment(); for (const a of arguments) add(f, a); return f; }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const ICONS = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/><circle cx="9.5" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5z"/></svg>'
  };
  function icon(name) {
    const svg = h("span", { html: ICONS[name] }).firstChild;
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }

  /* ================= Data ================= */
  let SITE = null, PRODUCTS = [], PMAP = {}, CUR = {};
  const S = { currency: "USD", cart: [] };
  const TYPE_LABEL = { licence: "Licence", subscription: "Subscription", service: "Project", booking: "Booking" };
  const STATUS = {
    awaiting_payment: "Awaiting payment", paid: "Payment received", in_progress: "In progress",
    completed: "Completed", cancelled: "Cancelled", payment_failed: "Payment failed"
  };
  const STATUS_PILL = { awaiting_payment: "pill-warn", paid: "pill-blue", in_progress: "pill-blue", completed: "pill-ok", cancelled: "pill-gray", payment_failed: "pill-bad" };

  /* ================= Money ================= */
  function curInfo(code) { return CUR[code] || CUR[SITE.defaultCurrency]; }
  function roundTo(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }
  function convert(base, code) { const c = curInfo(code); return roundTo(base * c.rate, c.decimals); }
  function money(amount, code) {
    const c = curInfo(code);
    const whole = Math.abs(amount - Math.round(amount)) < 1e-9;
    const d = whole ? 0 : c.decimals;
    const n = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(amount);
    return (/[A-Za-z]$/.test(c.symbol) ? c.symbol + " " : c.symbol) + n;
  }
  function maxFor(p) { return Math.max(0, Math.min(p.maxQty || 1, p.stock == null ? Infinity : p.stock)); }

  /* ================= Booking dates ================= */
  function todayIn(tz) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function addDays(ymd, n) { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function bookableDates() {
    const b = SITE.booking, t = todayIn(b.timezone), out = [];
    for (let i = b.leadDays; i <= b.horizonDays; i++) {
      const d = addDays(t, i);
      if (b.days.indexOf(new Date(d + "T00:00:00Z").getUTCDay()) !== -1) out.push(d);
    }
    return out;
  }
  function fmtDay(ymd) { return new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /* ================= API ================= */
  async function http(method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    } catch (e) {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }
  const API = DEMO ? demoApi() : {
    catalog: () => http("GET", "/api/catalog"),
    slots: (id, date) => http("GET", "/api/slots?product=" + encodeURIComponent(id) + "&date=" + date).then(d => d.slots),
    order: (ref, cred) => http("GET", "/api/orders/" + encodeURIComponent(ref) + "?" + (cred.token ? "t=" + encodeURIComponent(cred.token) : "email=" + encodeURIComponent(cred.email))),
    createOrder: body => http("POST", "/api/orders", body),
    contact: body => http("POST", "/api/contact", body)
  };

  // Preview build: same behaviour, stored in this browser only.
  function demoApi() {
    const KEY = "gs_demo_v1";
    const db = store.get(KEY, null) || { orders: {}, stock: {}, bookings: {} };
    const save = () => store.set(KEY, db);
    const stockOf = p => (p.id in db.stock ? db.stock[p.id] : p.stock);
    const rid = n => { const al = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < n; i++) s += al[Math.floor(Math.random() * al.length)]; return s; };
    function event(o, status, note) { o.status = status; o.statusLabel = STATUS[status]; o.events.push({ status, label: STATUS[status], note, at: new Date().toISOString() }); }
    function release(o) {
      o.items.forEach(i => {
        const p = PMAP[i.id];
        if (p && stockOf(p) != null) db.stock[p.id] = stockOf(p) + i.qty;
        if (i.date) delete db.bookings[i.id + "|" + i.date + "|" + i.time];
      });
    }
    function pub(o) {
      const out = Object.assign({}, o);
      delete out.email;
      out.bank = o.method === "bank" && o.status === "awaiting_payment" ? Object.assign({}, DEMO.bank, { reference: o.ref }) : null;
      out.bankHoldDays = SITE.bankHoldDays;
      return out;
    }
    return {
      async catalog() {
        await wait(60);
        const c = JSON.parse(JSON.stringify(DEMO.catalog));
        c.products.forEach(p => { if (p.id in db.stock) p.stock = db.stock[p.id]; });
        return c;
      },
      async slots(id, date) {
        await wait(150);
        return SITE.booking.slots.map(t => ({ time: t, available: !db.bookings[id + "|" + date + "|" + t] }));
      },
      async createOrder(b) {
        await wait(450);
        const cur = curInfo(b.currency);
        const lines = b.items.map(it => {
          const p = PMAP[it.id];
          if (!p) throw new Error("One of the items in your cart is no longer available. Remove it and try again.");
          const qty = p.type === "licence" ? it.qty : 1;
          const unit = convert(p.price, b.currency);
          return { p, qty, unit, total: roundTo(unit * qty, cur.decimals), date: it.date || null, time: it.time || null };
        });
        for (const l of lines) {
          const st = stockOf(l.p);
          if (st != null && st < l.qty) throw new Error(st === 0 ? l.p.name + " just sold out." : "Only " + st + " left of " + l.p.name + ".");
          if (l.date && db.bookings[l.p.id + "|" + l.date + "|" + l.time]) throw new Error("That call time was just booked by someone else. Pick another time.");
        }
        const ref = "GS" + rid(6), token = rid(24).toLowerCase();
        lines.forEach(l => {
          const st = stockOf(l.p);
          if (st != null) db.stock[l.p.id] = st - l.qty;
          if (l.date) db.bookings[l.p.id + "|" + l.date + "|" + l.time] = ref;
        });
        const o = {
          ref, token, status: "awaiting_payment", statusLabel: STATUS.awaiting_payment, method: b.method, currency: b.currency,
          total: roundTo(lines.reduce((s, l) => s + l.total, 0), cur.decimals), firstName: b.customer.name.split(" ")[0],
          email: b.customer.email.toLowerCase(), createdAt: new Date().toISOString(), paidAt: null, events: [],
          items: lines.map(l => ({ id: l.p.id, name: l.p.name, type: l.p.type, qty: l.qty, unit: l.unit, total: l.total, interval: l.p.interval || null, date: l.date, time: l.time }))
        };
        event(o, "awaiting_payment", "Order placed.");
        db.orders[ref] = o;
        save();
        return { ref, token, next: b.method === "bank" ? { type: "order" } : { type: "redirect", url: "#pay-" + ref + "-" + token } };
      },
      async order(ref, cred) {
        await wait(120);
        const o = db.orders[String(ref).toUpperCase()];
        const ok = o && (cred.token ? cred.token === o.token : String(cred.email || "").trim().toLowerCase() === o.email);
        if (!ok) throw new Error("We couldn't find that order. Check the order number and email.");
        return pub(o);
      },
      async pay(ref, token, approve) {
        await wait(500);
        const o = db.orders[ref];
        if (!o || o.token !== token || o.status !== "awaiting_payment") return;
        if (approve) { event(o, "paid", "Test payment approved. No money was charged."); o.paidAt = new Date().toISOString(); }
        else { event(o, "payment_failed", "The test payment was declined."); release(o); }
        save();
      },
      async contact() { await wait(350); return { ok: true }; }
    };
  }

  /* ================= Cart ================= */
  function saveCart() { store.set("gs_cart", S.cart); updateCartCount(); }
  function cartLines() {
    const c = curInfo(S.currency);
    return S.cart.filter(i => PMAP[i.id]).map(i => {
      const p = PMAP[i.id], unit = convert(p.price, S.currency);
      return { key: i.key, item: i, p, qty: i.qty, unit, total: roundTo(unit * i.qty, c.decimals) };
    });
  }
  function cartTotal(lines) { return roundTo(lines.reduce((s, l) => s + l.total, 0), curInfo(S.currency).decimals); }
  function cartBase(lines) { return lines.reduce((s, l) => s + l.p.price * l.qty, 0); }
  function addToCart(p, opts) {
    const key = p.id + (opts.date ? "|" + opts.date + "|" + opts.time : "");
    const found = S.cart.find(i => i.key === key);
    if (found) {
      if (p.type !== "licence") { toast("That's already in your cart.", "#cart", "View cart"); return; }
      found.qty = Math.min(found.qty + opts.qty, maxFor(p));
    } else {
      S.cart.push({ key, id: p.id, qty: opts.qty || 1, date: opts.date || null, time: opts.time || null });
    }
    saveCart();
    toast("Added " + p.name + " to your cart.", "#cart", "View cart");
  }
  function updateCartCount() {
    const n = S.cart.reduce((s, i) => s + (PMAP[i.id] ? i.qty : 0), 0);
    const el = document.getElementById("cart-count");
    if (el) { el.textContent = String(n); el.classList.toggle("has", n > 0); }
  }

  /* ================= Shared bits ================= */
  function ph(value, label) { return value ? value : h("span", { class: "ph", title: "Add this in config/site.json" }, "[" + label + "]"); }
  function waDigits() { return String(SITE.whatsapp || "").replace(/[^\d]/g, ""); }
  function waLink(text) { return "https://wa.me/" + waDigits() + "?text=" + encodeURIComponent(text); }
  function btn(href, label, kind, extra) { return h("a", { class: "btn btn-" + (kind || "primary") + (extra ? " " + extra : ""), href }, label); }
  function typeChip(p) { return h("span", { class: "chip-type" }, TYPE_LABEL[p.type] || p.type); }
  function stockBadge(p) {
    if (p.stock == null) return null;
    if (p.stock <= 0) return h("span", { class: "stock stock-out" }, "Sold out");
    if (p.stock <= 5) {
      const unit = p.stockUnit || "left";
      return h("span", { class: "stock stock-low" }, p.stock + " " + unit + (p.stock === 1 ? "" : "s") + " left");
    }
    return h("span", { class: "stock stock-ok" }, "Available");
  }
  function priceTag(p, cls) {
    return h("span", { class: "price" + (cls ? " " + cls : "") }, money(convert(p.price, S.currency), S.currency),
      p.interval ? h("small", null, " / " + p.interval) : p.unit ? h("small", null, " " + p.unit) : null);
  }
  function payNames() {
    const out = [], m = SITE.methods;
    if (m.card) out.push("Visa", "Mastercard");
    if (m.alipay) out.push("Alipay");
    if (m.wechat) out.push("WeChat Pay");
    if (m.paypal) out.push("PayPal");
    if (m.bank) out.push("Bank transfer");
    return out;
  }
  function payText() {
    const n = payNames().map(x => x === "Bank transfer" ? "bank transfer" : x);
    return n.length > 1 ? n.slice(0, -1).join(", ") + " or " + n[n.length - 1] : (n[0] || "");
  }
  function section(eyebrow, title, intro) {
    const body = Array.prototype.slice.call(arguments, 3);
    return h("section", { class: "section" }, h("div", { class: "wrap" },
      h("div", { class: "section-head" }, eyebrow ? h("p", { class: "eyebrow" }, eyebrow) : null, h("h2", null, title), intro ? h("p", { class: "lede" }, intro) : null),
      body));
  }
  function pageHead(title, intro, crumbs) {
    return h("div", { class: "wrap page-head" },
      crumbs ? h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, crumbs) : null,
      h("h1", { tabindex: "-1" }, title),
      intro ? h("p", { class: "lede" }, intro) : null);
  }
  let toastTimer = null;
  function toast(msg, href, linkText) {
    const t = document.getElementById("toast");
    t.textContent = "";
    t.append(h("span", null, msg));
    if (href) t.append(h("a", { href, onclick: () => t.classList.remove("show") }, linkText));
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }
  function setCurrency(code) {
    if (!CUR[code]) return;
    S.currency = code;
    store.set("gs_currency", code);
    render(false);
  }

  /* ================= Chrome ================= */
  const NAV = [["home", "Home"], ["shop", "Solutions"], ["about", "About"], ["contact", "Contact"], ["track", "Track order"]];
  function logo() {
    return h("a", { href: "#home", class: "logo", "aria-label": SITE.businessName + " home" },
      h("span", { class: "logo-mark", "aria-hidden": "true" }, "go"), h("span", { class: "logo-word" }, SITE.businessName));
  }
  function header() {
    const head = h("header", { class: "site-header" });
    const menuBtn = h("button", { class: "menu-btn", type: "button", "aria-expanded": "false", "aria-controls": "site-nav",
      onclick: () => { const open = head.classList.toggle("open"); menuBtn.setAttribute("aria-expanded", String(open)); } },
      icon("menu"), h("span", { class: "sr" }, "Menu"));
    const sel = h("select", { id: "currency", class: "cur-select", "aria-label": "Currency", onchange: e => setCurrency(e.target.value) },
      SITE.currencies.map(c => h("option", { value: c.code }, c.code)));
    sel.value = S.currency;
    head.append(h("div", { class: "wrap head-row" },
      logo(),
      h("nav", { class: "nav", id: "site-nav", "aria-label": "Main" }, NAV.map(n => h("a", { href: "#" + n[0], "data-r": n[0] }, n[1]))),
      h("div", { class: "head-tools" }, sel,
        h("a", { href: "#cart", class: "cart-btn", "aria-label": "Cart" }, icon("cart"), h("span", { class: "cart-label" }, "Cart"), h("span", { class: "cart-count", id: "cart-count" }, "0")),
        menuBtn)));
    return head;
  }
  function previewBar() {
    const msgs = [];
    if (PRODUCTS.some(p => p.sample)) msgs.push("Sample products and placeholder company details");
    if (SITE.testMode) msgs.push("Test payments only, nothing is charged");
    if (!msgs.length) return null;
    return h("div", { class: "preview-bar", role: "note" }, h("div", { class: "wrap" }, h("b", null, "Preview"), " · " + msgs.join(" · ")));
  }
  function footer() {
    const list = items => h("ul", null, items.map(i => h("li", null, h("a", { href: "#" + i[0] }, i[1]))));
    const year = new Date().getFullYear();
    return h("footer", { class: "site-footer" },
      h("div", { class: "wrap foot-grid" },
        h("div", { class: "foot-brand" }, logo(), h("p", null, "Business software, built and supported for clients worldwide."), h("p", null, "We accept " + payText() + ".")),
        h("div", null, h("h3", null, "Company"), list([["about", "About"], ["contact", "Contact"], ["track", "Track an order"]])),
        h("div", null, h("h3", null, "Solutions"), list(PRODUCTS.slice(0, 5).map(p => ["p-" + p.id, p.name]))),
        h("div", null, h("h3", null, "Policies"), list([["terms", "Terms of service"], ["refunds", "Refunds and cancellations"], ["privacy", "Privacy policy"], ["delivery", "Delivery policy"]]))),
      h("div", { class: "wrap foot-legal" },
        "© " + year + " ", ph(SITE.legalName, "Legal company name"),
        " · Registration no. ", ph(SITE.registrationNumber, "Registration number"),
        " · Registered in " + (SITE.registeredIn || "") + " · ", ph(SITE.address, "Registered address"),
        " · ", ph(SITE.email, "Business email")));
  }

  /* ================= Views ================= */
  const GROUPS = [
    ["licence", "Ready-made software", "Buy once, install this week."],
    ["subscription", "Subscriptions", "Hosted for you, billed monthly."],
    ["service", "Projects", "Fixed-price builds with a written scope."],
    ["booking", "Calls", "Talk it through before you commit."]
  ];

  function viewHome() {
    const booking = PRODUCTS.find(p => p.type === "booking");
    const groups = GROUPS.filter(g => g[0] !== "booking" && PRODUCTS.some(p => p.type === g[0]));
    return frag(
      h("section", { class: "hero" }, h("div", { class: "wrap hero-grid" },
        h("div", { class: "hero-copy" },
          h("p", { class: "eyebrow" }, "Software company · Registered in " + (SITE.registeredIn || "China") + " · Clients worldwide"),
          h("h1", { class: "display", tabindex: "-1" }, "Business software, priced up front."),
          h("p", { class: "lede" }, SITE.businessName + " builds, licenses and supports software for shops, service firms and growing companies. Pick from the rate card, pay online, and follow your order from payment to launch."),
          h("div", { class: "cta-row" }, btn("#shop", "See all solutions", "primary", "btn-lg"), booking ? btn("#p-" + booking.id, "Book a discovery call", "ghost", "btn-lg") : null),
          h("p", { class: "payline" }, "Pay by " + payText() + ".")),
        rateCard())),
      section(null, "What you can order", "Three ways to work with us. Prices show in " + S.currency + "; change the currency at the top.",
        h("div", { class: "groups", style: "--cols:" + groups.length }, groups.map(g => h("div", { class: "group" },
          h("h3", null, g[1]), h("p", null, g[2]),
          PRODUCTS.filter(p => p.type === g[0]).map(p => h("div", { class: "gitem" },
            h("a", { href: "#p-" + p.id }, p.name),
            h("p", null, p.tagline),
            h("div", { class: "meta-row" }, priceTag(p), stockBadge(p))))))),
        h("div", { class: "section-foot" }, btn("#shop", "Compare everything", "ghost"))),
      section(null, "From first call to launch", "How a project runs once you've paid.",
        h("ol", { class: "steps" }, [
          ["Discovery call", "We learn how your business runs and what's slowing it down."],
          ["Scope and payment", "You get a fixed price, a timeline and a written scope. Pay online or by bank transfer."],
          ["Build with weekly demos", "You see working software every week and tell us what to change."],
          ["Launch and support", "We go live, train your team and stay on for fixes and updates."]
        ].map(st => h("li", null, h("h3", null, st[0]), h("p", null, st[1]))))),
      section(null, "Before you order", null, faq()),
      booking ? h("section", { class: "cta-band" }, h("div", { class: "wrap" },
        h("div", null, h("h2", null, "Not sure what you need?"),
          h("p", null, "Book a " + (booking.durationMin || 60) + "-minute discovery call for " + money(convert(booking.price, S.currency), S.currency) + ". The fee comes off any project you order within 30 days.")),
        btn("#p-" + booking.id, "Book a call", "primary", "btn-lg"))) : null
    );
  }

  // The signature element: a published price list, built from the live catalogue.
  function rateCard() {
    const cardMax = SITE.methods.card && SITE.methods.card.maxBaseTotal;
    return h("aside", { class: "rate", "aria-label": "Rate card" },
      h("div", { class: "rate-head" }, h("h2", null, "Rate card"), h("span", null, "Fixed prices in " + S.currency)),
      GROUPS.filter(g => PRODUCTS.some(p => p.type === g[0])).map(g => h("div", { class: "rate-group" },
        h("h3", null, g[1]),
        PRODUCTS.filter(p => p.type === g[0]).map(p => h("a", { class: "rate-row", href: "#p-" + p.id },
          h("span", { class: "rate-name" }, p.name),
          h("span", { class: "rate-dots", "aria-hidden": "true" }),
          h("span", { class: "rate-price" }, money(convert(p.price, S.currency), S.currency), p.interval ? h("small", null, " /" + (p.interval === "month" ? "mo" : p.interval)) : null))))),
      h("p", { class: "rate-foot" }, cardMax ? "Orders over " + money(convert(cardMax, "USD"), "USD") + " are paid by bank transfer. Everything else can be paid online." : "Pay online or by bank transfer."));
  }

  function faq() {
    const methods = payNames().join(", ");
    const curList = SITE.currencies.map(c => c.code).join(", ");
    const cardMax = SITE.methods.card && SITE.methods.card.maxBaseTotal;
    const qa = [
      ["Which payment methods do you accept?", methods + ". Card, Alipay and WeChat Pay payments are made on our payment partner's secure page, so we never see your card number."],
      ["Which currencies can I pay in?", curList + ". Prices are set in US dollars and converted at our own rate. You pay exactly the amount shown at checkout."],
      ["How do I receive a licence?", "We email your licence key and setup guide within 24 hours of payment. You can follow your order on the Track order page."],
      ["Can I pay for a large project by bank transfer?", cardMax ? "Yes. Orders over " + money(convert(cardMax, "USD"), "USD") + " are paid by bank transfer, and you can choose it for any order. Work starts when the money arrives." : "Yes. Choose bank transfer at checkout. Work starts when the money arrives."],
      ["What if I need to cancel?", "Our Refunds and cancellations policy explains what you can cancel and when. Get in touch first and we'll sort it out with you."],
      ["Do you work with clients outside China?", "Yes. We work with clients worldwide, in English, over video calls and WhatsApp."]
    ];
    return h("div", { class: "faq" }, qa.map(x => h("details", null, h("summary", null, x[0]), h("p", null, x[1]))));
  }

  function viewShop() {
    const types = ["all"].concat(Object.keys(TYPE_LABEL).filter(t => PRODUCTS.some(p => p.type === t)));
    let filter = "all";
    const list = h("div", { class: "plist" });
    const bar = h("div", { class: "filters", role: "group", "aria-label": "Filter solutions" });
    function draw() {
      list.textContent = "";
      PRODUCTS.filter(p => filter === "all" || p.type === filter).forEach(p => list.append(
        h("article", { class: "prow" },
          h("div", { class: "prow-main" },
            h("div", { class: "prow-meta" }, typeChip(p), stockBadge(p)),
            h("h2", null, h("a", { href: "#p-" + p.id }, p.name)),
            h("p", { class: "muted" }, p.tagline)),
          h("div", { class: "prow-side" }, priceTag(p), h("span", { class: "help-line" }, p.type === "booking" ? (p.durationMin || 60) + "-minute call" : p.type === "subscription" ? "Billed monthly" : p.type === "service" ? "Fixed price" : "One-off payment")))));
      bar.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === filter)));
    }
    types.forEach(t => bar.append(h("button", { class: "filter", type: "button", "data-t": t, onclick: () => { filter = t; draw(); } },
      t === "all" ? "All" : TYPE_LABEL[t] + "s")));
    draw();
    return frag(pageHead("Solutions", "Everything you can order online. Prices show in " + S.currency + "."), h("div", { class: "wrap", style: "padding-bottom:72px" }, bar, list));
  }

  function viewProduct(id) {
    const p = PMAP[id];
    if (!p) return viewNotFound();
    const max = maxFor(p), soldOut = p.stock === 0;
    const pick = { qty: 1, date: null, time: null };
    const err = h("p", { class: "err", role: "alert" });

    let qtyBox = null;
    if (p.type === "licence" && max > 1) {
      const out = h("output", { "aria-live": "polite" }, "1");
      const minus = h("button", { type: "button", "aria-label": "Fewer", onclick: () => setQ(pick.qty - 1) }, "−");
      const plus = h("button", { type: "button", "aria-label": "More", onclick: () => setQ(pick.qty + 1) }, "+");
      function setQ(n) { pick.qty = Math.max(1, Math.min(max, n)); out.textContent = String(pick.qty); minus.disabled = pick.qty <= 1; plus.disabled = pick.qty >= max; }
      setQ(1);
      qtyBox = h("div", { style: "display:grid;gap:8px" }, h("span", { class: "field-label" }, "Quantity"), h("div", { class: "qty" }, minus, out, plus));
    }

    const addBtn = h("button", { class: "btn btn-primary btn-lg btn-block", type: "button", disabled: soldOut || null,
      onclick: () => {
        err.textContent = "";
        if (p.type === "booking" && (!pick.date || !pick.time)) { err.textContent = "Pick a date and a time first."; return; }
        addToCart(p, pick);
      } }, soldOut ? "Sold out" : p.type === "booking" ? "Add booking to cart" : "Add to cart");

    const cardMax = SITE.methods.card && SITE.methods.card.maxBaseTotal;
    const meta = [["Type", TYPE_LABEL[p.type]], ["Delivery", p.delivery]];
    if (p.type === "booking") meta.splice(1, 0, ["Length", (p.durationMin || 60) + " minutes, " + SITE.booking.timezoneLabel]);
    if (p.interval) meta.splice(1, 0, ["Billing", "Every " + p.interval + ". First " + p.interval + " charged at checkout."]);

    return frag(
      h("div", { class: "wrap page-head" }, h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "#home" }, "Home"), "/", h("a", { href: "#shop" }, "Solutions"), "/", h("span", null, p.name))),
      h("div", { class: "wrap pd" },
        h("div", { class: "pd-main" },
          h("div", { class: "prow-meta" }, typeChip(p), stockBadge(p)),
          h("h1", { tabindex: "-1" }, p.name),
          h("p", { class: "lede" }, p.tagline),
          h("p", { class: "pd-desc" }, p.description),
          h("h2", { class: "h-sm" }, "What's included"),
          h("ul", { class: "feature-list" }, (p.features || []).map(f => h("li", null, icon("check"), h("span", null, f)))),
          h("dl", { class: "spec" }, meta.map(m => h("div", null, h("dt", null, m[0]), h("dd", null, m[1]))))),
        h("aside", { class: "buybox", "aria-label": "Order" },
          h("div", null, priceTag(p), p.type === "service" ? h("p", { class: "help-line" }, "Fixed price, paid upfront") : null),
          p.type === "booking" ? bookingPicker(p, (d, t) => { pick.date = d; pick.time = t; err.textContent = ""; }) : null,
          qtyBox,
          addBtn, err,
          cardMax && p.price > cardMax ? h("p", { class: "note note-warn" }, "Orders over " + money(convert(cardMax, "USD"), "USD") + " are paid by bank transfer. We show our bank details after you order.") : null,
          h("div", { class: "secure" }, icon("lock"), "Secure checkout. Pay by " + payText() + "."),
          SITE.whatsapp ? h("p", { class: "help-line" }, "Questions first? ", h("a", { href: waLink("Hi " + SITE.businessName + ", I have a question about " + p.name), target: "_blank", rel: "noopener" }, "Message us on WhatsApp")) : null)));
  }

  function bookingPicker(p, onPick) {
    const dates = bookableDates().slice(0, 10);
    let sel = { date: null, time: null };
    const dateRow = h("div", { class: "chips", role: "group", "aria-label": "Choose a date" });
    const timeRow = h("div", { class: "chips", role: "group", "aria-label": "Choose a time" }, h("span", { class: "help-line" }, "Pick a date first."));
    dates.forEach(d => dateRow.append(h("button", { type: "button", class: "chip", "data-d": d, "aria-pressed": "false", onclick: () => pickDate(d) }, fmtDay(d))));
    async function pickDate(d) {
      sel = { date: d, time: null };
      onPick(d, null);
      dateRow.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.d === d)));
      timeRow.textContent = "";
      timeRow.append(h("span", { class: "help-line" }, "Loading times..."));
      try {
        const slots = await API.slots(p.id, d);
        if (sel.date !== d) return;
        timeRow.textContent = "";
        if (!slots.some(s => s.available)) timeRow.append(h("span", { class: "help-line" }, "That day is full. Try another date."));
        slots.forEach(s => timeRow.append(h("button", { type: "button", class: "chip", "data-t": s.time, "aria-pressed": "false", disabled: !s.available || null,
          "aria-label": s.time + (s.available ? "" : ", booked"), onclick: () => pickTime(s.time) }, s.time)));
      } catch (e) {
        timeRow.textContent = "";
        timeRow.append(h("span", { class: "err" }, e.message));
      }
    }
    function pickTime(t) {
      sel.time = t;
      onPick(sel.date, t);
      timeRow.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.t === t)));
    }
    return h("div", { class: "booking" },
      h("span", { class: "field-label" }, "Date"), dateRow,
      h("span", { class: "field-label" }, "Time (" + SITE.booking.timezoneLabel + ")"), timeRow);
  }

  function lineMeta(p, item) {
    const bits = [TYPE_LABEL[p.type]];
    if (item.date) bits.push(fmtDay(item.date) + " at " + item.time + " " + SITE.booking.timezoneLabel);
    if (p.interval) bits.push("Billed every " + p.interval);
    if (p.unit) bits.push(p.unit);
    return bits.join(" · ");
  }

  function viewCart() {
    const lines = cartLines();
    if (!lines.length) {
      return frag(pageHead("Your cart"), h("div", { class: "wrap", style: "padding-bottom:72px" },
        h("div", { class: "empty" }, h("h2", null, "Your cart is empty"), h("p", { class: "muted" }, "Pick a licence, a project or book a call."), btn("#shop", "Browse solutions"))));
    }
    const list = h("div", { class: "lines" }, lines.map(l => {
      const max = maxFor(l.p);
      const ctrls = h("div", { class: "line-ctrls" });
      if (l.p.type === "licence" && max > 1) {
        const out = h("output", null, String(l.qty));
        ctrls.append(h("div", { class: "qty" },
          h("button", { type: "button", "aria-label": "Fewer", disabled: l.qty <= 1 || null, onclick: () => { l.item.qty = Math.max(1, l.qty - 1); saveCart(); render(false); } }, "−"),
          out,
          h("button", { type: "button", "aria-label": "More", disabled: l.qty >= max || null, onclick: () => { l.item.qty = Math.min(max, l.qty + 1); saveCart(); render(false); } }, "+")));
      }
      ctrls.append(h("button", { type: "button", class: "btn btn-quiet btn-sm", onclick: () => { S.cart = S.cart.filter(i => i.key !== l.key); saveCart(); render(false); } }, "Remove"));
      return h("div", { class: "line" },
        h("div", { style: "display:grid;gap:4px;min-width:0" },
          h("span", { class: "line-name" }, h("a", { href: "#p-" + l.p.id }, l.p.name)),
          h("span", { class: "line-meta" }, lineMeta(l.p, l.item)),
          ctrls),
        h("div", { class: "line-side" }, h("span", { class: "price" }, money(l.total, S.currency)), l.qty > 1 ? h("span", { class: "help-line" }, l.qty + " × " + money(l.unit, S.currency)) : null));
    }));
    const total = cartTotal(lines);
    const hasSub = lines.some(l => l.p.type === "subscription");
    return frag(pageHead("Your cart"), h("div", { class: "wrap two-col" },
      list,
      h("aside", { class: "summary", "aria-label": "Summary" },
        h("h2", null, "Summary"),
        h("div", { class: "sum-row sum-total" }, h("span", null, "Total"), h("span", null, money(total, S.currency))),
        hasSub ? h("p", { class: "help-line" }, "Subscriptions: the first month is charged now, then monthly.") : null,
        h("p", { class: "help-line" }, "You pay in " + S.currency + ". Change the currency at the top of the page."),
        btn("#checkout", "Go to checkout", "primary", "btn-lg btn-block"),
        btn("#shop", "Keep browsing", "ghost", "btn-block"))));
  }

  function viewCheckout() {
    const lines = cartLines();
    if (!lines.length) { setTimeout(() => { location.hash = "cart"; }, 0); return h("div", { class: "loading" }, "Your cart is empty."); }
    const total = cartTotal(lines), base = cartBase(lines);
    const draft = store.get("gs_checkout", {});
    const fields = [
      ["name", "Full name", "text", "name", true], ["email", "Email", "email", "email", true],
      ["phone", "Phone or WhatsApp", "tel", "tel", true], ["company", "Company", "text", "organization", false],
      ["country", "Country", "text", "country-name", true], ["city", "City", "text", "address-level2", true],
      ["address", "Street address", "text", "street-address", true], ["postcode", "Postcode", "text", "postal-code", false]
    ];
    const inputs = {};
    function fld(f) {
      const id = "co_" + f[0];
      const input = h("input", { class: "input", id, name: f[0], type: f[2], autocomplete: f[3], required: f[4] || null, value: draft[f[0]] || "" });
      input.addEventListener("input", () => { draft[f[0]] = input.value; store.set("gs_checkout", draft); input.removeAttribute("aria-invalid"); });
      inputs[f[0]] = input;
      return h("div", { class: "fld" }, h("label", { for: id }, f[1], f[4] ? null : h("span", { class: "opt" }, " (optional)")), input);
    }
    const F = {}; fields.forEach(f => { F[f[0]] = fld(f); });

    // Payment methods
    let method = null;
    const mbox = h("div", { class: "methods", role: "radiogroup", "aria-label": "Payment method" });
    Object.keys(SITE.methods).forEach(key => {
      const m = SITE.methods[key];
      let why = null;
      if (m.currencies && m.currencies.indexOf(S.currency) === -1) why = "Available when paying in " + m.currencies.join(" or ") + ".";
      else if (m.maxBaseTotal && base > m.maxBaseTotal) why = "For orders up to " + money(convert(m.maxBaseTotal, S.currency), S.currency) + ".";
      if (!why && !method) method = key;
      const input = h("input", { type: "radio", name: "method", value: key, disabled: why ? true : null, checked: method === key || null, onchange: () => { method = key; submitLabel(); } });
      mbox.append(h("label", { class: "method" + (why ? " off" : "") }, input, h("b", null, m.label), h("span", null, why || m.note)));
    });

    const notes = h("textarea", { class: "input", id: "co_notes", rows: "3", placeholder: "Anything we should know before we start?" });
    const agree = h("input", { type: "checkbox", id: "co_agree" });
    const err = h("div", { class: "note note-bad", role: "alert", hidden: true });
    const submit = h("button", { class: "btn btn-primary btn-lg btn-block", type: "submit" });
    function submitLabel() { submit.textContent = method === "bank" ? "Place order" : "Continue to payment · " + money(total, S.currency); submit.disabled = !method; }
    submitLabel();

    const form = h("form", { class: "form", novalidate: true, onsubmit: onSubmit },
      h("fieldset", null, h("legend", null, "Your details"), h("div", { class: "row2" }, F.name, F.email), h("div", { class: "row2" }, F.phone, F.company)),
      h("fieldset", null, h("legend", null, "Billing address"), h("div", { class: "row2" }, F.country, F.city), h("div", { class: "row2" }, F.address, F.postcode)),
      h("fieldset", null, h("legend", null, "Payment"), mbox, SITE.testMode ? h("p", { class: "note note-warn" }, "Test mode: you'll see a test payment page and nothing is charged.") : null),
      h("div", { class: "fld" }, h("label", { for: "co_notes" }, "Order notes ", h("span", { class: "opt" }, "(optional)")), notes),
      h("label", { class: "check", for: "co_agree" }, agree, h("span", null, "I agree to the ", h("a", { href: "#terms" }, "Terms of service"), " and the ", h("a", { href: "#refunds" }, "Refunds policy"), ".")),
      err, submit);

    async function onSubmit(e) {
      e.preventDefault();
      err.hidden = true;
      const missing = [];
      fields.forEach(f => {
        const v = inputs[f[0]].value.trim();
        const bad = (f[4] && !v) || (f[0] === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v));
        inputs[f[0]].setAttribute("aria-invalid", bad ? "true" : "false");
        if (bad) missing.push(f[1]);
      });
      let msg = null;
      if (missing.length) msg = "Please check: " + missing.join(", ") + ".";
      else if (!method) msg = "Choose a payment method.";
      else if (!agree.checked) msg = "Please accept the Terms and the Refunds policy.";
      if (msg) { err.textContent = msg; err.hidden = false; const first = form.querySelector('[aria-invalid="true"]'); (first || err).focus && (first || err).focus(); return; }

      submit.disabled = true; submit.textContent = "Placing your order...";
      const customer = {}; fields.forEach(f => { customer[f[0]] = inputs[f[0]].value.trim(); });
      try {
        const res = await API.createOrder({
          currency: S.currency, method, agree: true, notes: notes.value.trim(), customer,
          items: lines.map(l => ({ id: l.p.id, qty: l.qty, date: l.item.date, time: l.item.time }))
        });
        S.cart = []; saveCart();
        if (res.next && res.next.type === "redirect") {
          if (res.next.url.charAt(0) === "#") location.hash = res.next.url.slice(1);
          else location.assign(res.next.url);
        } else {
          location.hash = "order-" + res.ref + "-" + res.token;
        }
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false; err.setAttribute("tabindex", "-1"); err.focus();
        submitLabel();
      }
    }

    return frag(pageHead("Checkout", null, [h("a", { href: "#cart" }, "Cart"), "/", h("span", null, "Checkout")]),
      h("div", { class: "wrap two-col" }, form,
        h("aside", { class: "summary", "aria-label": "Order summary" },
          h("h2", null, "Order summary"),
          lines.map(l => h("div", { class: "sum-item" }, h("span", null, (l.qty > 1 ? l.qty + " × " : "") + l.p.name), h("span", { class: "mono" }, money(l.total, S.currency)), h("small", null, lineMeta(l.p, l.item)))),
          h("div", { class: "sum-row sum-total" }, h("span", null, "Total"), h("span", null, money(total, S.currency))),
          h("div", { class: "secure" }, icon("lock"), "Card details are entered on our payment partner's page, never on this site."))));
  }

  function viewPay(ref, token) {
    // Preview build only: stands in for the payment provider's page.
    const box = h("div", { class: "wrap" }, h("div", { class: "loading" }, "Loading payment..."));
    API.order(ref, { token }).then(o => {
      box.textContent = "";
      const approve = h("button", { class: "btn btn-primary btn-lg btn-block", type: "button", onclick: () => go(true) }, "Approve test payment");
      const decline = h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: () => go(false) }, "Decline");
      async function go(ok) { approve.disabled = decline.disabled = true; await API.pay(ref, token, ok); location.hash = "order-" + ref + "-" + token; }
      box.append(h("div", { class: "paybox" },
        h("span", { class: "pill pill-warn", style: "justify-self:start" }, "Test payment page"),
        h("h1", { tabindex: "-1", style: "font-size:22px" }, SITE.businessName),
        h("div", { class: "amt" }, money(o.total, o.currency)),
        h("dl", { class: "kv" }, h("dt", null, "Order"), h("dd", { class: "mono" }, o.ref), h("dt", null, "Method"), h("dd", null, (SITE.methods[o.method] || {}).label || o.method)),
        h("p", { class: "muted" }, "On the live site this is your payment provider's secure page. Here nothing is charged."),
        approve, decline));
    }).catch(e => { box.textContent = ""; box.append(h("div", { class: "loading" }, e.message)); });
    return box;
  }

  function viewOrder(ref, token) {
    const box = h("div", null, h("div", { class: "loading" }, "Loading your order..."));
    API.order(ref, { token }).then(o => { box.textContent = ""; box.append(orderPage(o)); focusMain(); })
      .catch(e => { box.textContent = ""; box.append(pageHead("Order not found", e.message), h("div", { class: "wrap", style: "padding-bottom:72px" }, btn("#track", "Track an order", "ghost"))); });
    return box;
  }

  function orderPage(o) {
    const isBank = o.method === "bank";
    const msgs = {
      awaiting_payment: isBank
        ? "Thanks" + (o.firstName ? ", " + o.firstName : "") + ". Your order is reserved. Please pay by bank transfer using the details below."
        : "We're waiting for the payment provider to confirm your payment. This usually takes a few seconds.",
      paid: "Thanks" + (o.firstName ? ", " + o.firstName : "") + "! Payment received. We'll email you the next steps within 1 business day.",
      in_progress: "We're working on your order. We'll keep you posted by email.",
      completed: "Your order is complete. Thanks for working with us.",
      cancelled: "This order was cancelled. If that's a surprise, get in touch.",
      payment_failed: "The payment didn't go through, so the order was released. You can place it again any time."
    };
    const bank = o.bank;
    const rows = bank ? [
      ["Bank", bank.bankName, "Bank name"], ["Account name", bank.accountName, "Account name"],
      ["Account number / IBAN", bank.accountNumber, "Account number"], ["SWIFT / BIC", bank.swift, "SWIFT code"],
      ["Bank address", bank.bankAddress, "Bank address"], ["Amount", money(o.total, o.currency)], ["Payment reference", o.ref]
    ] : [];
    const refresh = o.status === "awaiting_payment" && !isBank
      ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => render(false) }, "Refresh status") : null;

    return frag(
      h("div", { class: "wrap page-head" },
        h("p", { class: "eyebrow" }, "Order " + o.ref),
        h("h1", { tabindex: "-1" }, STATUS[o.status] || o.statusLabel),
        h("div", { class: "prow-meta" }, h("span", { class: "pill " + (STATUS_PILL[o.status] || "pill-gray") }, STATUS[o.status]), h("span", { class: "help-line" }, "Placed " + fmtDateTime(o.createdAt)))),
      h("div", { class: "wrap order-grid" },
        h("div", { style: "display:grid;gap:18px;min-width:0" },
          h("div", { class: "panel" }, h("p", { class: "status-msg" }, msgs[o.status] || ""), refresh),
          bank ? h("div", { class: "panel" },
            h("h2", null, "Bank transfer details"),
            h("dl", { class: "bank" }, rows.map(r => h("div", null, h("dt", null, r[0]), h("dd", null, r.length > 2 ? ph(r[1], r[2]) : r[1])))),
            h("p", { class: "help-line" }, (bank.currencyNote ? bank.currencyNote + " " : "") + "Use the payment reference so we can match your transfer." + (o.bankHoldDays ? " We hold your order for " + o.bankHoldDays + " days." : ""))) : null,
          h("div", { class: "panel" }, h("h2", null, "Timeline"),
            h("ol", { class: "timeline" }, o.events.slice().reverse().map(e => h("li", null, h("b", null, e.label), h("time", { datetime: e.at }, fmtDateTime(e.at)), e.note ? h("p", null, e.note) : null))))),
        h("aside", { class: "summary", "aria-label": "Order summary" },
          h("h2", null, "Order summary"),
          o.items.map(i => h("div", { class: "sum-item" },
            h("span", null, (i.qty > 1 ? i.qty + " × " : "") + i.name), h("span", { class: "mono" }, money(i.total, o.currency)),
            h("small", null, [TYPE_LABEL[i.type], i.date ? fmtDay(i.date) + " at " + i.time + " " + SITE.booking.timezoneLabel : null, i.interval ? "every " + i.interval : null].filter(Boolean).join(" · ")))),
          h("div", { class: "sum-row sum-total" }, h("span", null, "Total"), h("span", null, money(o.total, o.currency))),
          h("div", { class: "sum-row" }, h("span", { class: "muted" }, "Payment"), h("span", null, (SITE.methods[o.method] || {}).label || o.method)),
          h("p", { class: "help-line" }, "Save this page's link to check your order later, or use Track order with your email."),
          SITE.whatsapp ? btn(waLink("Hi " + SITE.businessName + ", about my order " + o.ref), "Message us about this order", "ghost", "btn-block") : null)));
  }

  function viewTrack() {
    const ref = h("input", { class: "input", id: "tr_ref", autocomplete: "off", placeholder: "e.g. GS7K2M9Q", style: "text-transform:uppercase" });
    const email = h("input", { class: "input", id: "tr_email", type: "email", autocomplete: "email" });
    const err = h("p", { class: "err", role: "alert" });
    const go = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Find my order");
    const form = h("form", { class: "form", novalidate: true, style: "max-width:520px;padding-bottom:72px", onsubmit: async e => {
      e.preventDefault(); err.textContent = "";
      const r = ref.value.trim().toUpperCase(), m = email.value.trim();
      if (!r || !m) { err.textContent = "Add your order number and the email you used."; return; }
      go.disabled = true; go.textContent = "Looking...";
      try { const o = await API.order(r, { email: m }); location.hash = "order-" + o.ref + "-" + o.token; }
      catch (ex) { err.textContent = ex.message; go.disabled = false; go.textContent = "Find my order"; }
    } },
      h("div", { class: "fld" }, h("label", { for: "tr_ref" }, "Order number"), ref),
      h("div", { class: "fld" }, h("label", { for: "tr_email" }, "Email used for the order"), email),
      err, h("div", null, go));
    return frag(pageHead("Track your order", "Your order number is in your confirmation email. It starts with GS."), h("div", { class: "wrap" }, form));
  }

  function viewAbout() {
    return frag(
      pageHead("About " + SITE.businessName, SITE.businessName + " is a software company registered in " + (SITE.registeredIn || "China") + ". We build, license and support software for businesses of every size, from a single shop to companies with many branches."),
      h("div", { class: "wrap" },
        h("div", { class: "trio" },
          h("div", null, h("span", { class: "chip-type", style: "justify-self:start" }, "Licences"), h("h3", null, "Ready-made software"), h("p", null, "Tools you can buy today and start using this week, with setup guides and updates included.")),
          h("div", null, h("span", { class: "chip-type", style: "justify-self:start" }, "Projects"), h("h3", null, "Custom builds"), h("p", null, "Websites, web apps and integrations built around how your team works, at a fixed price.")),
          h("div", null, h("span", { class: "chip-type", style: "justify-self:start" }, "Support"), h("h3", null, "Hosting and care"), h("p", null, "We keep your software online, updated and backed up after launch."))),
        h("div", { class: "prose", style: "padding-top:40px" },
          h("h2", null, "How we work"),
          h("ul", null,
            h("li", null, "We work with clients worldwide, in English, over video calls, email and WhatsApp."),
            h("li", null, "Every project has a written scope and a fixed price before you pay."),
            h("li", null, "You see progress every week, not just at the end."),
            h("li", null, "We stay on after launch for fixes, updates and hosting.")),
          h("h2", null, "Company details"),
          h("dl", { class: "spec" }, [
            ["Legal name", ph(SITE.legalName, "Legal company name")], ["Registration no.", ph(SITE.registrationNumber, "Registration number")],
            ["Registered in", SITE.registeredIn], ["Address", ph(SITE.address, "Registered address")],
            ["Email", ph(SITE.email, "Business email")], ["Hours", SITE.supportHours]
          ].map(r => h("div", null, h("dt", null, r[0]), h("dd", null, r[1])))),
          h("div", { class: "cta-row" }, btn("#shop", "Browse solutions"), btn("#contact", "Contact us", "ghost")))));
  }

  function viewContact() {
    const f = {};
    const mk = (k, label, type, opt) => {
      f[k] = type === "textarea" ? h("textarea", { class: "input", id: "ct_" + k, rows: "6" }) : h("input", { class: "input", id: "ct_" + k, type, autocomplete: k === "phone" ? "tel" : k });
      return h("div", { class: "fld" }, h("label", { for: "ct_" + k }, label, opt ? h("span", { class: "opt" }, " (optional)") : null), f[k]);
    };
    const status = h("div", { role: "status" });
    const send = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Send message");
    const form = h("form", { class: "form", novalidate: true, onsubmit: async e => {
      e.preventDefault(); status.textContent = "";
      const body = { name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), message: f.message.value.trim() };
      if (!body.name || !body.message || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) {
        status.append(h("p", { class: "note note-bad" }, "Add your name, a valid email and a message.")); return;
      }
      send.disabled = true; send.textContent = "Sending...";
      try {
        await API.contact(body);
        form.reset();
        status.append(h("p", { class: "note note-ok" }, "Thanks, we've got your message. We reply within 1 business day."));
      } catch (ex) { status.append(h("p", { class: "note note-bad" }, ex.message)); }
      send.disabled = false; send.textContent = "Send message";
    } }, h("div", { class: "row2" }, mk("name", "Name", "text"), mk("email", "Email", "email")), mk("phone", "Phone or WhatsApp", "tel", true), mk("message", "How can we help?", "textarea"), status, h("div", null, send));
    const wa = SITE.whatsapp;
    return frag(pageHead("Contact us", "Questions about a product, a project or an order? We reply within 1 business day."),
      h("div", { class: "wrap contact-grid" },
        h("div", { class: "ways" },
          wa ? h("div", { class: "way" }, h("b", null, "WhatsApp"), h("a", { href: waLink("Hi " + SITE.businessName + "!"), target: "_blank", rel: "noopener" }, wa)) : null,
          h("div", { class: "way" }, h("b", null, "Email"), SITE.email ? h("span", { class: "mono" }, SITE.email) : ph("", "Business email")),
          h("div", { class: "way" }, h("b", null, "Hours"), h("span", null, SITE.supportHours)),
          h("div", { class: "way" }, h("b", null, "Address"), ph(SITE.address, "Registered address"))),
        form));
  }

  function policy(kind) {
    const N = SITE.businessName;
    const L = () => ph(SITE.legalName, "Legal company name");
    const email = () => ph(SITE.email, "Business email");
    const P = {
      terms: ["Terms of service", [
        ["Who we are", [N + " (", L(), ", registration no. ", ph(SITE.registrationNumber, "Registration number"), ") is registered in " + SITE.registeredIn + ". These terms apply to everything you order on this website."]],
        ["Orders", ["When you place an order you agree to pay the total shown at checkout. We confirm every order by email. We may refuse or cancel an order if a product is unavailable, the price was shown in error, or we can't verify the payment. If we cancel, you get a full refund."]],
        ["Prices and currencies", ["Prices are set in US dollars and converted to other currencies at our own rate. You pay exactly the amount and currency shown at checkout. Your bank may add its own fees."]],
        ["Payment", ["Card, Alipay and WeChat Pay payments are processed by our payment partner on their secure page. PayPal payments are processed by PayPal. Bank transfers must arrive within the time shown on your order page or the order is cancelled."]],
        ["Licences", ["Software licences are for use by the business named on the order. You may not resell, share or copy the software beyond the number of licences you bought."]],
        ["Projects", ["Each project follows the scope we agree in writing. Changes to the scope may change the price and timeline, and we agree those changes with you before doing the work."]],
        ["Subscriptions", ["Subscriptions renew every billing period until you cancel. Cancel with 30 days' notice by email."]],
        ["Liability", ["We provide our software and services with reasonable care and skill. Our total liability for any order is limited to the amount you paid for that order."]],
        ["Disputes", ["Please contact us first at ", email(), " so we can fix the problem. These terms are governed by the laws of " + SITE.registeredIn + "."]]
      ]],
      refunds: ["Refunds and cancellations", [
        ["Licences", ["You can ask for a full refund within 14 days of purchase if the licence key has not been activated."]],
        ["Subscriptions", ["Cancel any time with 30 days' notice. We don't refund part-used billing periods."]],
        ["Projects", ["You can cancel before work starts for a full refund. After work starts, we refund the share of the project not yet delivered, minus work already done."]],
        ["Discovery calls", ["Cancel or reschedule at least 24 hours before the call for a full refund. Missed calls are not refunded."]],
        ["How refunds are paid", ["Refunds go back to the original payment method within 10 business days of approval. Bank transfer refunds go to the account that paid."]],
        ["Questions about a charge", ["Please contact us at ", email(), " before disputing a charge with your bank. We usually resolve problems within 2 business days."]]
      ]],
      privacy: ["Privacy policy", [
        ["What we collect", ["Your name, email, phone number, company, billing address and order details. If you contact us, we keep your message."]],
        ["Why", ["To process and deliver your order, contact you about it, prevent fraud and meet our legal and tax obligations."]],
        ["Payment details", ["We never see or store your full card number. Card, Alipay, WeChat Pay and PayPal payments are handled by those providers on their own secure pages."]],
        ["Who we share it with", ["Only our payment providers, email and hosting providers, and authorities when the law requires it. We never sell your data."]],
        ["How long we keep it", ["Order records are kept for as long as tax law requires. You can ask us to delete anything else."]],
        ["Your rights", ["You can ask to see, correct or delete your data by emailing ", email(), "."]],
        ["Cookies", ["This site stores your cart and currency choice in your browser. We don't use advertising cookies."]]
      ]],
      delivery: ["Delivery policy", [
        ["Digital delivery only", [N + " sells software, services and bookings. Nothing is shipped physically."]],
        ["Licences", ["Licence keys and setup guides are emailed within 24 hours of payment."]],
        ["Subscriptions", ["Accounts are set up within 1 to 2 business days of payment. Login details are sent by email."]],
        ["Projects", ["We contact you within the time shown on the product page to schedule the kick-off. Delivery dates are set in your written project scope."]],
        ["Discovery calls", ["You receive a calendar invite and call link by email right after payment."]],
        ["Didn't receive something?", ["Check your spam folder, then contact us at ", email(), " with your order number."]]
      ]]
    }[kind];
    return frag(pageHead(P[0]), h("div", { class: "wrap" }, h("div", { class: "prose" },
      h("p", { class: "updated" }, "Last updated " + new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })),
      P[1].map(s => frag(h("h2", null, s[0]), h("p", null, s[1]))))));
  }

  function viewNotFound() {
    return frag(pageHead("Page not found", "That page doesn't exist or has moved."), h("div", { class: "wrap", style: "padding-bottom:72px" }, btn("#home", "Go to the home page")));
  }

  /* ================= Router ================= */
  const TITLES = { home: null, shop: "Solutions", cart: "Cart", checkout: "Checkout", track: "Track order", about: "About", contact: "Contact", terms: "Terms of service", refunds: "Refunds and cancellations", privacy: "Privacy policy", delivery: "Delivery policy" };
  let lastRoute = null;

  function parse() {
    const r = decodeURIComponent(location.hash.replace(/^#/, "")) || "home";
    let m;
    if ((m = r.match(/^p-(.+)$/))) return { name: "product", id: m[1], key: r };
    if ((m = r.match(/^order-([A-Za-z0-9]+)-([A-Za-z0-9]+)$/))) return { name: "order", ref: m[1], token: m[2], key: r };
    if ((m = r.match(/^pay-([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)) && DEMO) return { name: "pay", ref: m[1], token: m[2], key: r };
    return { name: r, key: r };
  }

  function view(rt) {
    switch (rt.name) {
      case "home": return viewHome();
      case "shop": return viewShop();
      case "product": return viewProduct(rt.id);
      case "cart": return viewCart();
      case "checkout": return viewCheckout();
      case "order": return viewOrder(rt.ref, rt.token);
      case "pay": return viewPay(rt.ref, rt.token);
      case "track": return viewTrack();
      case "about": return viewAbout();
      case "contact": return viewContact();
      case "terms": case "refunds": case "privacy": case "delivery": return policy(rt.name);
      default: return viewNotFound();
    }
  }

  function focusMain() {
    const t = document.querySelector("main h1");
    if (t) t.focus({ preventScroll: true });
  }

  function render(navigated) {
    const rt = parse();
    const main = document.getElementById("main");
    main.textContent = "";
    main.append(view(rt));
    const p = rt.name === "product" ? PMAP[rt.id] : null;
    const t = p ? p.name : TITLES[rt.name] || (rt.name === "order" ? "Your order" : null);
    document.title = (t ? t + " | " : "") + SITE.businessName;
    document.querySelectorAll(".nav a").forEach(a => {
      const on = a.dataset.r === rt.name || (a.dataset.r === "shop" && rt.name === "product");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const head = document.querySelector(".site-header");
    if (head) { head.classList.remove("open"); const mb = head.querySelector(".menu-btn"); if (mb) mb.setAttribute("aria-expanded", "false"); }
    const sel = document.getElementById("currency");
    if (sel) sel.value = S.currency;
    updateCartCount();
    if (navigated && rt.key !== lastRoute) { window.scrollTo(0, 0); focusMain(); }
    lastRoute = rt.key;
  }

  /* ================= Boot ================= */
  async function boot() {
    let data;
    try { data = await API.catalog(); }
    catch (e) {
      root.textContent = "";
      root.append(h("div", { class: "wrap loading" }, "We couldn't load the shop. ", h("a", { href: location.href, onclick: () => location.reload() }, "Try again")));
      return;
    }
    SITE = data.site;
    PRODUCTS = data.products;
    PMAP = {}; PRODUCTS.forEach(p => { PMAP[p.id] = p; });
    CUR = {}; SITE.currencies.forEach(c => { CUR[c.code] = c; });
    const saved = store.get("gs_currency", null);
    S.currency = CUR[saved] ? saved : SITE.defaultCurrency;
    S.cart = (store.get("gs_cart", []) || []).filter(i => i && PMAP[i.id]);

    root.textContent = "";
    root.append(
      h("a", { class: "sr", href: "#home", onclick: e => { e.preventDefault(); focusMain(); } }, "Skip to content"),
      previewBar(), header(),
      h("main", { id: "main", tabindex: "-1" }),
      footer(),
      SITE.whatsapp ? h("a", { class: "wa-btn", href: waLink("Hi " + SITE.businessName + ", I have a question."), target: "_blank", rel: "noopener", "aria-label": "Chat with us on WhatsApp" }, icon("chat"), h("span", null, "WhatsApp us")) : null,
      h("div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" }));
    window.addEventListener("hashchange", () => render(true));
    render(false);
  }

  boot();
})();
