// Web version glue. The page (public/index.html, shared with the local app) talks
// to /api/status, /api/today, /api/listings, /api/filters and so on. Online, the
// server only hands over the raw data (GET /api/data + /api/aged); this answers
// those page calls in the browser with the same ranking and filter code
// (BuyLogic), and sends call outcomes, hidden dealers and the filter/saved
// searches to the server, mirroring what it saved.
(() => {
  const L = window.BuyLogic;
  const realFetch = window.fetch.bind(window);
  const RELOAD_MS = 10 * 60e3;
  let D = null; // { db, cfg, roster, prefs, at }

  const reply = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const COLUMNS = {
    status: "status", next_call_day: "nextCallDay", last_call_at: "lastCallAt", last_outcome: "lastOutcome",
    price_at_last_call: "priceAtLastCall", offer: "offer", notes: "notes", bought_at: "boughtAt",
  };
  function applyState(l, row) {
    for (const [col, field] of Object.entries(COLUMNS)) l[field] = row[col] ?? null;
    l.status ||= "new";
  }

  async function load(headers) {
    const [r, a] = await Promise.all([realFetch("/api/data", { headers }), realFetch("/api/aged", { headers })]);
    if (!r.ok) return r; // 401 → the page asks for the PIN and tries again
    if (!a.ok) return a;
    const [data, aged] = await Promise.all([r.json(), a.json()]);
    const listings = {};
    for (const l of aged) {
      l.status = "new";
      listings[l.key] = l;
    }
    for (const row of data.desk.states) if (listings[row.key]) applyState(listings[row.key], row);
    const st = data.status || {};
    const on = st.sourcesEnabled || {};
    const cfg = {
      ...(st.filters || { minDaysListed: 60, maxDaysListed: 365, minPrice: 0, maxMiles: 1e9, dailyListSize: 25, radiusMiles: 100 }),
      sources: {
        cargurus: { enabled: !!on.cargurus },
        dealerSites: { enabled: !!on.dealerSites },
        marketcheck: { enabled: !!on.marketcheck, monthlyCallCap: st.marketcheck?.cap ?? 0, apiKey: st.marketcheck?.hasKey ? "set" : "" },
      },
    };
    const month = new Date().toISOString().slice(0, 7);
    const db = {
      listings,
      calls: data.desk.calls,
      scans: st.lastScan ? [st.lastScan] : [],
      hiddenDealers: Object.fromEntries(data.desk.hidden.map((h) => [h.dealer_key, h.name])),
      marketcheckCalls: { [month]: st.marketcheck?.used ?? 0 },
    };
    D = { db, cfg, roster: data.dealers, prefs: data.desk.prefs || { active: {}, saved: [] }, at: Date.now() };
    return null;
  }

  const labels = () => Object.fromEntries(Object.entries(L.OUTCOMES).map(([k, o]) => [k, o.label]));

  window.fetch = async (url, opts = {}) => {
    if (typeof url !== "string" || !url.startsWith("/api/")) return realFetch(url, opts);
    const u = new URL(url, location.href);
    const p = u.pathname;
    const method = (opts.method || "GET").toUpperCase();
    const headers = { "content-type": "application/json", ...(opts.headers || {}) };

    if (method === "GET") {
      if (!D || (p === "/api/status" && Date.now() - D.at > RELOAD_MS)) {
        const failed = await load(headers);
        if (failed) return failed;
      }
      if (p === "/api/status") return reply({ ...L.status(D.db, D.cfg), running: false, outcomes: labels() });
      const filter = L.parseFilter(u.searchParams.get("f"));
      if (p === "/api/today") return reply(L.buildCallList(D.db, D.cfg, Date.now(), filter));
      if (p === "/api/listings") {
        return reply(L.browseListings(D.db, D.cfg, { q: u.searchParams.get("q") || "", sort: u.searchParams.get("sort") || "score", limit: 150, filter }));
      }
      if (p === "/api/filters") return reply(L.filterSummary(D.db, D.cfg, filter));
      if (p === "/api/prefs") return reply(D.prefs);
      if (p === "/api/dealers") return reply(D.roster);
      if (p === "/api/hidden") return reply(Object.entries(D.db.hiddenDealers).map(([dealerKey, name]) => ({ dealerKey, name })));
      return reply({ error: "not found" }, 404);
    }

    if (p === "/api/outcome") {
      const body = JSON.parse(opts.body || "{}");
      body.prices = Object.fromEntries((body.keys || []).map((k) => [k, D?.db.listings[k]?.price ?? null]));
      const r = await realFetch("/api/outcome", { method: "POST", headers, body: JSON.stringify(body) });
      if (r.ok && D) {
        const saved = await r.clone().json();
        for (const row of saved.states) if (D.db.listings[row.key]) applyState(D.db.listings[row.key], row);
        D.db.calls.push(...saved.calls);
      }
      return r;
    }
    if (p === "/api/prefs") {
      const r = await realFetch(p, { method: "PUT", headers, body: opts.body });
      if (r.ok && D) D.prefs = await r.clone().json();
      return r;
    }
    if (p === "/api/hide" || p === "/api/unhide") {
      const r = await realFetch(p, { method: "POST", headers, body: opts.body });
      if (r.ok && D) {
        const body = JSON.parse(opts.body || "{}");
        if (p === "/api/hide") D.db.hiddenDealers[body.dealerKey] = body.name || body.dealerKey;
        else delete D.db.hiddenDealers[body.dealerKey];
      }
      return r;
    }
    return realFetch(url, { ...opts, headers });
  };

  window.BUYLIST_CLOUD = {
    downloadCsv(filter = {}) {
      if (!D) return;
      const csv = "﻿" + L.callListCsv(L.buildCallList(D.db, D.cfg, Date.now(), filter));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `buy-list-${new Date().toLocaleDateString("en-CA")}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };
})();
