/* Go Solutions admin: orders, stock and messages. Talks to /api/admin (cookie session). */
(function () {
  "use strict";
  const root = document.getElementById("adm");
  const STATUS_PILL = { awaiting_payment: "pill-warn", paid: "pill-blue", in_progress: "pill-blue", completed: "pill-ok", cancelled: "pill-gray", payment_failed: "pill-bad" };
  const METHOD = { card: "Card", alipay: "Alipay", wechat: "WeChat Pay", paypal: "PayPal", bank: "Bank transfer" };
  let CUR = {}, STATUSES = {}, tab = "orders";
  const F = { status: "", q: "" };

  function h(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else if (k === "value") n.value = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (let i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, k) { if (k == null || k === false) return; if (Array.isArray(k)) return k.forEach(x => add(n, x)); n.append(k.nodeType ? k : document.createTextNode(String(k))); }

  async function api(method, url, body) {
    const res = await fetch("/api/admin" + url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== "/login") { login(); throw new Error("Please log in."); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  function money(v, code) {
    const c = CUR[code] || { symbol: code + " ", decimals: 2 };
    const n = Number(v).toLocaleString("en-US", { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
    return (/[A-Za-z]$/.test(c.symbol) ? c.symbol + " " : c.symbol) + n;
  }
  const when = iso => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const pill = (s, label) => h("span", { class: "pill " + (STATUS_PILL[s] || "pill-gray") }, label || STATUSES[s] || s);

  /* ---------- Login ---------- */
  function login() {
    const pw = h("input", { class: "input", id: "pw", type: "password", autocomplete: "current-password" });
    const err = h("p", { class: "err", role: "alert" });
    const go = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Log in");
    root.textContent = "";
    root.append(h("div", { class: "wrap adm-login" }, h("form", { onsubmit: async e => {
      e.preventDefault(); err.textContent = ""; go.disabled = true;
      try { await api("POST", "/login", { password: pw.value }); start(); }
      catch (ex) { err.textContent = ex.message; go.disabled = false; }
    } },
      h("a", { class: "logo", href: "/" }, h("span", { class: "logo-mark", "aria-hidden": "true" }, "go"), h("span", { class: "logo-word" }, "Go Solutions")),
      h("h1", { style: "font-size:22px" }, "Admin"),
      h("div", { class: "fld" }, h("label", { for: "pw" }, "Password"), pw), err, go)));
    pw.focus();
  }

  /* ---------- Shell ---------- */
  async function start() {
    try {
      await api("GET", "/me");
      const cat = await fetch("/api/catalog").then(r => r.json());
      cat.site.currencies.forEach(c => { CUR[c.code] = c; });
    } catch (e) { return; }
    shell();
  }

  function shell() {
    const tabs = [["orders", "Orders"], ["stock", "Stock"], ["messages", "Messages"]];
    const body = h("main", { class: "wrap adm-body", id: "body" });
    root.textContent = "";
    root.append(
      h("header", { class: "adm-head" }, h("div", { class: "wrap" },
        h("a", { class: "logo", href: "/" }, h("span", { class: "logo-mark", "aria-hidden": "true" }, "go"), h("span", { class: "logo-word" }, "Admin")),
        h("nav", { class: "adm-tabs" }, tabs.map(t => h("button", { type: "button", "aria-pressed": String(tab === t[0]), onclick: () => { tab = t[0]; shell(); } }, t[1]))),
        h("button", { class: "btn btn-quiet", type: "button", onclick: async () => { await api("POST", "/logout", {}); login(); } }, "Log out"))),
      body);
    ({ orders: ordersTab, stock: stockTab, messages: messagesTab })[tab](body);
  }

  /* ---------- Orders ---------- */
  async function ordersTab(body) {
    body.append(h("p", { class: "loading" }, "Loading orders..."));
    let sum, list;
    try { [sum, list] = await Promise.all([api("GET", "/summary"), api("GET", "/orders?status=" + F.status + "&q=" + encodeURIComponent(F.q))]); }
    catch (e) { body.textContent = ""; body.append(h("p", { class: "err" }, e.message)); return; }
    STATUSES = sum.statuses;
    body.textContent = "";
    const c = sum.counts;
    body.append(h("div", { class: "kpis" },
      kpi(c.awaiting_payment || 0, "Awaiting payment"),
      kpi((c.paid || 0) + (c.in_progress || 0), "To deliver (paid or in progress)"),
      kpi(money(sum.baseRevenue, "USD"), "Paid this month (USD value)"),
      kpi(sum.messages7d, "Messages, last 7 days")));
    if (sum.revenue.length) body.append(h("p", { class: "help-line" }, "This month by currency: " + sum.revenue.map(r => money(r.total, r.currency) + " (" + r.orders + ")").join(" · ")));

    const sel = h("select", { class: "input", style: "max-width:220px", "aria-label": "Filter by status", onchange: e => { F.status = e.target.value; shell(); } },
      h("option", { value: "" }, "All statuses"), Object.keys(STATUSES).map(s => h("option", { value: s }, STATUSES[s])));
    sel.value = F.status;
    const q = h("input", { class: "input", type: "search", placeholder: "Search ref, name, email", value: F.q, "aria-label": "Search orders" });
    q.addEventListener("keydown", e => { if (e.key === "Enter") { F.q = q.value.trim(); shell(); } });
    body.append(h("div", { class: "toolbar" }, sel, q, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { F.q = q.value.trim(); shell(); } }, "Search")));

    if (!list.length) { body.append(h("div", { class: "empty" }, h("h2", null, "No orders yet"), h("p", { class: "muted" }, "New orders show up here as soon as they're placed."))); return; }
    body.append(h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, ["Order", "Placed", "Customer", "Items", "Method", "Status"].map(t => h("th", null, t)), h("th", { class: "num" }, "Total"))),
      h("tbody", null, list.map(o => h("tr", { class: "click", tabindex: "0", onclick: () => openOrder(o.ref), onkeydown: e => { if (e.key === "Enter") openOrder(o.ref); } },
        h("td", { class: "mono" }, o.ref), h("td", null, when(o.created_at)),
        h("td", null, o.customer_name, h("br"), h("span", { class: "help-line" }, o.company || o.customer_email)),
        h("td", null, o.summary), h("td", null, METHOD[o.payment_method] || o.payment_method), h("td", null, pill(o.status, o.statusLabel)),
        h("td", { class: "num" }, money(o.total, o.currency))))))));
  }
  function kpi(v, label) { return h("div", { class: "kpi" }, h("b", null, v), h("span", null, label)); }

  async function openOrder(ref) {
    const bg = h("div", { class: "drawer-bg", onclick: close });
    const d = h("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Order " + ref }, h("p", { class: "loading" }, "Loading..."));
    function close() { bg.remove(); d.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", esc);
    document.body.append(bg, d);
    let o;
    try { o = await api("GET", "/orders/" + ref); } catch (e) { d.textContent = ""; d.append(h("p", { class: "err" }, e.message)); return; }
    draw();

    function draw() {
      d.textContent = "";
      const c = o.customer;
      const status = h("select", { class: "input", id: "st" }, Object.keys(STATUSES).map(s => h("option", { value: s }, STATUSES[s])));
      status.value = o.status;
      const note = h("textarea", { class: "input", id: "nt", rows: "3", placeholder: "e.g. Licence key sent to your email" });
      const pub = h("input", { type: "checkbox", id: "pb", checked: true });
      const mail = h("input", { type: "checkbox", id: "ml", checked: true });
      const msg = h("p", { role: "status" });
      const save = h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
        save.disabled = true; msg.textContent = "";
        try {
          o = await api("POST", "/orders/" + ref + "/status", { status: status.value, note: note.value, isPublic: pub.checked, notifyCustomer: mail.checked });
          draw(); shell();
        } catch (e) { msg.className = "err"; msg.textContent = e.message; save.disabled = false; }
      } }, "Save update");
      const markPaid = o.status === "awaiting_payment" && o.method === "bank"
        ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => { status.value = "paid"; note.value = "Bank transfer received. Thank you!"; save.click(); } }, "Mark bank transfer received") : null;

      d.append(
        h("div", { class: "drawer-head" }, h("h2", { class: "mono" }, o.ref), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: close }, "Close")),
        h("div", { class: "prow-meta" }, pill(o.status, o.statusLabel), h("span", { class: "help-line" }, money(o.total, o.currency) + " · " + (METHOD[o.method] || o.method) + (o.paymentRef ? " · " + o.paymentRef : ""))),
        h("div", { class: "panel" }, h("h2", null, "Customer"), h("dl", { class: "kv" },
          [["Name", c.name], ["Email", c.email], ["Phone", c.phone], ["Company", c.company || "-"], ["Address", [c.address, c.city, c.postcode, c.country].filter(Boolean).join(", ")]]
            .map(r => [h("dt", null, r[0]), h("dd", null, r[1])])),
          o.notes ? h("p", { class: "note" }, o.notes) : null),
        h("div", { class: "panel" }, h("h2", null, "Items"), o.items.map(i => h("div", { class: "sum-item" },
          h("span", null, i.qty + " × " + i.name), h("span", { class: "mono" }, money(i.total, o.currency)),
          h("small", null, [i.date ? i.date + " " + i.time : null, i.interval ? "every " + i.interval : null].filter(Boolean).join(" · "))))),
        h("div", { class: "panel" }, h("h2", null, "Update order"), markPaid,
          h("div", { class: "fld" }, h("label", { for: "st" }, "Status"), status),
          h("div", { class: "fld" }, h("label", { for: "nt" }, "Note ", h("span", { class: "opt" }, "(optional)")), note),
          h("label", { class: "check", for: "pb" }, pub, h("span", null, "Show this note to the customer")),
          h("label", { class: "check", for: "ml" }, mail, h("span", null, "Email the customer about this update")),
          msg, save),
        h("div", { class: "panel" }, h("h2", null, "History"), h("ol", { class: "timeline" }, o.events.slice().reverse().map(e => h("li", null,
          h("b", null, e.label + (e.isPublic ? "" : " (internal)")), h("time", null, when(e.at)), e.note ? h("p", null, e.note) : null)))));
    }
  }

  /* ---------- Stock ---------- */
  async function stockTab(body) {
    let rows;
    try { rows = await api("GET", "/stock"); } catch (e) { body.append(h("p", { class: "err" }, e.message)); return; }
    body.append(h("p", { class: "help-line" }, "Leave stock empty for unlimited. Stock drops when an order is placed and comes back if it's cancelled or the payment fails."),
      h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", null, "Product"), h("th", null, "Type"), h("th", { class: "num" }, "Price (USD)"), h("th", null, "Stock"), h("th", null, ""))),
        h("tbody", null, rows.map(r => {
          const inp = h("input", { class: "input stock-in", type: "number", min: "0", step: "1", value: r.stock == null ? "" : String(r.stock), "aria-label": "Stock for " + r.name, placeholder: "Unlimited" });
          const ok = h("span", { class: "help-line", role: "status" });
          const save = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => {
            ok.textContent = ""; save.disabled = true;
            try { const res = await api("PUT", "/stock/" + r.id, { stock: inp.value === "" ? null : inp.value }); ok.textContent = res.stock == null ? "Saved: unlimited" : "Saved"; }
            catch (e) { ok.textContent = e.message; }
            save.disabled = false;
          } }, "Save");
          return h("tr", null, h("td", null, r.name), h("td", null, r.type), h("td", { class: "num" }, money(r.price, "USD")), h("td", null, inp), h("td", null, save, " ", ok));
        })))));
  }

  /* ---------- Messages ---------- */
  async function messagesTab(body) {
    let rows;
    try { rows = await api("GET", "/messages"); } catch (e) { body.append(h("p", { class: "err" }, e.message)); return; }
    if (!rows.length) { body.append(h("div", { class: "empty" }, h("h2", null, "No messages yet"), h("p", { class: "muted" }, "Messages from the Contact page show up here."))); return; }
    body.append(h("div", { style: "display:grid;gap:12px" }, rows.map(m => h("div", { class: "panel" },
      h("div", { class: "prow-meta" }, h("b", null, m.name), h("a", { href: "mailto:" + m.email }, m.email), m.phone ? h("span", { class: "help-line" }, m.phone) : null, h("span", { class: "help-line", style: "margin-left:auto" }, when(m.created_at))),
      h("p", { style: "white-space:pre-wrap" }, m.message)))));
  }

  start().catch(() => {});
})();
