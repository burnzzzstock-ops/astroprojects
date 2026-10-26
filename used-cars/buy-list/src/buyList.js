// Ranking the aged cars into today's call list, and recording call outcomes.
// Pure functions over the db object (the server wraps them with readDb/withDb).
import { clamp01, money, localDay, csvCell, dealerKeyOf, zipDistance, zipForCity, daysSince, norm } from "./util.js";
import { daysListed, isActive } from "./listings.js";

// Call outcome → the car's status and how many days until it's due again.
export const OUTCOMES = {
  no_answer:    { label: "No answer",    status: "working",     days: 1 },
  left_message: { label: "Left message", status: "working",     days: 2 },
  too_high:     { label: "Too high",     status: "working",     days: 10 },
  not_selling:  { label: "Won't sell",   status: "working",     days: 21 },
  negotiating:  { label: "Negotiating",  status: "negotiating", days: 1 },
  bought:       { label: "Bought it",    status: "bought",      days: null },
  pass:         { label: "Pass",         status: "passed",      days: null },
  reopen:       { label: "Reopened",     status: null,          days: 0 }, // not a call: back on the list
};

const SOURCE_LABEL = { cargurus: "CarGurus", dealer: "Dealer site", marketcheck: "Marketcheck" };
const RATING = (r) => String(r || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/**
 * scoreListing(listing, { days, radius }) → { score, why[] }. Every point has a reason:
 *   days listed (0-40) · price drops (0-20) · dropped since your last call (+10)
 *   · closeness (0-15) · no posted price (−10) · 150k+ miles (−5)
 */
export function scoreListing(l, { days, radius = 100 }) {
  const why = [];
  let s = 40 * clamp01((days - 30) / 150);
  why.push(`${days} days listed`);
  if (l.priceDrops > 0) {
    s += Math.min(20, 7 * l.priceDrops);
    why.push(`${l.priceDrops} price drop${l.priceDrops > 1 ? "s" : ""}${l.priceDropTotal ? ` (−${money(l.priceDropTotal)})` : ""}`);
  }
  if (l.priceAtLastCall && l.price && l.price < l.priceAtLastCall) {
    s += 10;
    why.push(`📉 −${money(l.priceAtLastCall - l.price)} since your last call`);
  }
  if (l.distance != null) {
    s += 15 * (1 - clamp01(l.distance / radius));
    why.push(`${Math.round(l.distance)} mi away`);
  }
  if (!l.price) { s -= 10; why.push("no price posted"); }
  if (l.miles && l.miles > 150000) s -= 5;
  if (l.dealer?.type === "private" || String(l.dealerKey).startsWith("private:")) why.push("private seller");
  if (l.dealRating && !/^(na|n\/a|none|unknown)$/i.test(l.dealRating)) why.push(`CarGurus: ${RATING(l.dealRating)}`); // "NA" = no rating
  return { score: Math.max(0, Math.round(s)), why };
}

/**
 * The store's priorities rank ahead of the score: `focusMakes` first (Ford), then cars
 * under `focusUnderMiles`. tier 0-3, higher first; each shows as a chip.
 */
export function priorityOf(l, cfg) {
  const make = (cfg.focusMakes || []).find((m) => norm(m) && norm(m) === norm(l.make));
  const low = cfg.focusUnderMiles > 0 && l.miles != null && l.miles < cfg.focusUnderMiles;
  const why = [];
  if (make) why.push(`★ ${make}`);
  if (low) why.push(`under ${Math.round(cfg.focusUnderMiles / 1000)}k mi`);
  return { tier: (make ? 2 : 0) + (low ? 1 : 0), why };
}

function view(l, cfg, now) {
  const days = daysListed(l, now);
  const s = scoreListing(l, { days, radius: cfg.radiusMiles });
  const p = priorityOf(l, cfg);
  return {
    ...l, days,
    sources: Object.keys(l.seen || {}).map((k) => ({ key: k, label: SOURCE_LABEL[k] || k, url: l.urls?.[k] || null })),
    stale: !isActive(l, now),
    score: s.score, tier: p.tier, why: [...p.why, ...s.why],
  };
}

// Aged, still for sale, inside the filters, dealer not hidden.
function eligible(l, cfg, now) {
  if (!isActive(l, now)) return false;
  const d = daysListed(l, now);
  if (d < cfg.minDaysListed || d > cfg.maxDaysListed) return false;
  if (l.price && l.price < cfg.minPrice) return false;
  if (l.miles && l.miles > cfg.maxMiles) return false;
  return true;
}

function dealerCard(u) {
  const d = u.dealer || {};
  return {
    dealerKey: u.dealerKey, name: d.name || (String(u.dealerKey).startsWith("private:") ? "Private seller" : "Unknown dealer"),
    phone: d.phone || null, street: d.street || null, city: d.city || null, state: d.state || null,
    zip: d.zip || null, website: d.website || null, type: d.type || null, distance: u.distance, units: [],
  };
}

const RIDE_ALONG_MAX = 6;

// Best first: the store's priority tier (Ford, then low miles), then score, then listed
// longest, then closest (plenty of cars tie at the top score).
const byBest = (a, b) => b.tier - a.tier || b.score - a.score || b.days - a.days || (a.distance ?? Infinity) - (b.distance ?? Infinity);

/**
 * Today's list: the top-N due cars by score, grouped by dealer (best first) so one
 * call covers every aged car on that lot; that dealer's other due cars ride along.
 * `top` is the best `topListSize` (10) of those as a plain ranked list.
 * Cars being negotiated are pinned separately.
 */
export function buildCallList(db, cfg, now = Date.now()) {
  const today = localDay(0, new Date(now));
  const hidden = db.hiddenDealers || {};
  const due = Object.values(db.listings)
    .filter((l) => !hidden[l.dealerKey] && ["new", "working"].includes(l.status) && (!l.nextCallDay || l.nextCallDay <= today))
    .filter((l) => eligible(l, cfg, now))
    .map((l) => view(l, cfg, now))
    .sort(byBest);

  const picked = due.slice(0, cfg.dailyListSize);
  const byDealer = new Map();
  for (const u of picked) {
    if (!byDealer.has(u.dealerKey)) byDealer.set(u.dealerKey, dealerCard(u));
    byDealer.get(u.dealerKey).units.push(u);
  }
  for (const u of due.slice(cfg.dailyListSize)) {
    const d = byDealer.get(u.dealerKey);
    if (d && d.units.length < RIDE_ALONG_MAX) d.units.push({ ...u, rideAlong: true });
  }
  const negotiating = Object.values(db.listings)
    .filter((l) => l.status === "negotiating" && !hidden[l.dealerKey])
    .map((l) => view(l, cfg, now));
  const later = Object.values(db.listings)
    .filter((l) => !hidden[l.dealerKey] && ["new", "working"].includes(l.status) && l.nextCallDay > today && eligible(l, cfg, now)).length;
  return { today, top: due.slice(0, cfg.topListSize ?? 10), dealers: [...byDealer.values()], negotiating, dueTotal: due.length, laterCount: later };
}

/** Every aged car still for sale (any status), for "find me a Tacoma". */
export function browseListings(db, cfg, { q = "", sort = "score", limit = 150 } = {}, now = Date.now()) {
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  let rows = Object.values(db.listings)
    .filter((l) => !db.hiddenDealers[l.dealerKey] && eligible(l, cfg, now));
  if (terms.length) {
    rows = rows.filter((l) => {
      const hay = `${l.year} ${l.make} ${l.model} ${l.trim} ${l.title} ${l.dealer?.name} ${l.dealer?.city} ${l.vin}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  const by = {
    score: byBest,
    days: (a, b) => b.days - a.days,
    drops: (a, b) => b.priceDrops - a.priceDrops || b.priceDropTotal - a.priceDropTotal,
    price: (a, b) => (a.price || Infinity) - (b.price || Infinity),
    distance: (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
  }[sort] || byBest;
  const scored = rows.map((l) => view(l, cfg, now)).sort(by);
  return { total: scored.length, rows: scored.slice(0, limit) };
}

export function recordOutcome(db, keys, outcome, { notes = null, offer = null } = {}, now = new Date()) {
  const o = OUTCOMES[outcome];
  if (!o) throw new Error(`unknown outcome: ${outcome}`);
  const note = notes && String(notes).trim() ? String(notes).trim().slice(0, 1000) : null;
  const amt = Number(offer) > 0 ? Math.round(Number(offer)) : null;
  const at = now.toISOString();
  let updated = 0;
  for (const key of keys) {
    const l = db.listings[key];
    if (!l) continue;
    db.calls.push({ key, outcome, notes: note, offer: amt, price: l.price ?? null, at });
    if (outcome === "reopen") {
      l.status = l.lastCallAt ? "working" : "new";
      l.nextCallDay = null;
      l.boughtAt = null;
    } else {
      l.status = o.status;
      l.lastOutcome = outcome;
      l.lastCallAt = at;
      l.priceAtLastCall = l.price ?? null;
      l.nextCallDay = o.days ? localDay(o.days, now) : null;
      if (outcome === "bought") l.boughtAt = at;
    }
    if (note) l.notes = note;
    if (amt) l.offer = amt;
    updated++;
  }
  return { updated };
}

export function status(db, cfg, now = Date.now()) {
  const aged = Object.values(db.listings).filter((l) => !db.hiddenDealers[l.dealerKey] && eligible(l, cfg, now));
  const open = aged.filter((l) => !["bought", "passed"].includes(l.status));
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 86400000;
  const month = new Date(now).toISOString().slice(0, 7);
  return {
    filters: {
      zip: cfg.zip, radiusMiles: cfg.radiusMiles, minDaysListed: cfg.minDaysListed, maxDaysListed: cfg.maxDaysListed,
      minPrice: cfg.minPrice, maxMiles: cfg.maxMiles, dailyListSize: cfg.dailyListSize, scanTime: cfg.scanTime,
    },
    sourcesEnabled: Object.fromEntries(Object.entries(cfg.sources).map(([k, v]) => [k, !!v.enabled])),
    lastScan: db.scans[0] || null,
    marketcheck: { used: db.marketcheckCalls[month] || 0, cap: cfg.sources.marketcheck.monthlyCallCap, hasKey: !!cfg.sources.marketcheck.apiKey },
    stats: {
      tracked: open.length,
      dealers: new Set(open.map((l) => l.dealerKey)).size,
      negotiating: Object.values(db.listings).filter((l) => l.status === "negotiating").length,
      callsWeek: db.calls.filter((c) => c.outcome !== "reopen" && new Date(c.at).getTime() >= weekAgo).length,
      boughtMonth: Object.values(db.listings).filter((l) => l.boughtAt && new Date(l.boughtAt) >= monthStart).length,
      allSeen: Object.keys(db.listings).length,
    },
  };
}

/**
 * The dealers.csv roster with how each did: aged cars on the list, cars seen on
 * the site in the last few days, and the error if the last scan couldn't read it.
 */
export function dealerRoster(db, cfg, dealers, now = Date.now()) {
  const failed = new Map((db.scans[0]?.sources?.dealerSites?.failed || []).map((f) => [f.name, f.error]));
  const byKey = new Map();
  for (const l of Object.values(db.listings)) {
    const r = byKey.get(l.dealerKey) || { aged: 0, seen: 0 };
    if (eligible(l, cfg, now) && !["bought", "passed"].includes(l.status)) r.aged++;
    if (l.seen?.dealer && (daysSince(l.seen.dealer, now) ?? Infinity) <= 3) r.seen++;
    byKey.set(l.dealerKey, r);
  }
  const scanned = !!db.scans[0]?.sources?.dealerSites && !db.scans[0].sources.dealerSites.skipped;
  return dealers.map((d) => {
    const r = byKey.get(dealerKeyOf({ name: d.name }, "")) || { aged: 0, seen: 0 };
    return {
      name: d.name, phone: d.phone || null, city: d.city || null, state: d.state || null, url: d.url, type: d.type,
      distance: zipDistance(cfg.zip, d.zip || zipForCity(d.city, d.state)),
      aged: r.aged, seen: r.seen, scanned, error: failed.get(d.name) || null,
    };
  }).sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
}

export function callListCsv(list) {
  const head = ["Dealer", "Phone", "City", "State", "Miles away", "Year", "Make", "Model", "Trim", "Asking",
    "Mileage", "Days listed", "Price drops", "Score", "Why", "Listing", "VIN"];
  const lines = [head.join(",")];
  for (const d of list.dealers) {
    for (const u of d.units) {
      lines.push([
        d.name, d.phone, d.city, d.state, d.distance != null ? Math.round(d.distance) : "",
        u.year, u.make, u.model, u.trim, u.price, u.miles, u.days, u.priceDrops, u.score,
        u.why.join("; "), u.sources.find((s) => s.url)?.url || "", u.vin,
      ].map(csvCell).join(","));
    }
  }
  return lines.join("\n") + "\n";
}
