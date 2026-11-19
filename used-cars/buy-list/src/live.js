// Search the U.S.: any used car in America, pulled from CarGurus at the moment the UCM
// searches and never stored (a few million cars can't be mirrored on free tools, and
// CarGurus' data isn't ours to copy wholesale). One CarGurus request per search or "show
// more". The same code builds the request on the PC (server.js) and in the Cloudflare
// worker, and turns the answer into cars on the PC or in the browser (web version).
// Requests go out plain: CarGurus refuses ones dressed up as a browser (HTTP 406).
// Pure module: no Node imports (it's bundled for the browser and the worker).
import { extractListings, parseJsonLoose } from "./extract.js";
import { CATALOG } from "./catalog.js";
import { STATES, ZIP3 } from "./usgeo.js";

export const CG = "https://www.cargurus.com";
export const PAGE = 48;          // cars per CarGurus request
const OFFSET_CAP = 10000;        // the feed returns nothing past this many results
const NATIONWIDE = 50000;        // CarGurus' "anywhere" distance

// Sorts the feed honors (checked live 2026-11-19; it ignores distance and year sorts).
export const LIVE_SORTS = {
  deals: { type: "DEAL_SCORE", dir: "ASC", label: "Best deals first" },
  price: { type: "PRICE", dir: "ASC", label: "Lowest price first" },
  priceHigh: { type: "PRICE", dir: "DESC", label: "Highest price first" },
  miles: { type: "MILEAGE", dir: "ASC", label: "Lowest miles first" },
  newest: { type: "AGE_IN_DAYS", dir: "ASC", label: "Newest listings first" },
  oldest: { type: "AGE_IN_DAYS", dir: "DESC", label: "Longest listed first" },
};

// One-tap regions for "In certain states": the Census divisions in plain words, plus home.
export const REGIONS = [
  { name: "Gulf Coast", states: ["TX", "LA", "MS", "AL", "FL"] },
  { name: "Southeast", states: ["FL", "GA", "SC", "NC", "VA", "WV", "MD", "DE", "DC"] },
  { name: "Mid-South", states: ["AL", "MS", "TN", "KY"] },
  { name: "South Central", states: ["TX", "OK", "AR", "LA"] },
  { name: "Northeast", states: ["NY", "NJ", "PA", "CT", "RI", "MA", "VT", "NH", "ME"] },
  { name: "Great Lakes", states: ["OH", "IN", "IL", "MI", "WI"] },
  { name: "Plains", states: ["MN", "IA", "MO", "KS", "NE", "SD", "ND"] },
  { name: "Mountain", states: ["MT", "ID", "WY", "CO", "UT", "NV", "AZ", "NM"] },
  { name: "West Coast", states: ["CA", "OR", "WA"] },
];

const MAKES = new Map(CATALOG.map((m) => [m.id, m]));

/** What the search screen needs: makes/models, states, regions, sorts. */
export function liveCatalog() {
  return {
    makes: CATALOG,
    states: Object.entries(STATES).map(([code, s]) => ({ code, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
    regions: REGIONS,
    sorts: Object.entries(LIVE_SORTS).map(([key, s]) => ({ key, label: s.label })),
  };
}

// A whole number from what the page sent ("$30,000" → 30000), in range, or null.
function whole(v, lo, hi) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(String(v).replace(/[^0-9.]/g, "")));
  return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : null;
}
const ordered = (a, b) => (a != null && b != null && a > b ? [b, a] : [a, b]);

/**
 * The search, with everything checked: make/model ids must be CarGurus' (from the
 * catalog, and the model must belong to the make), numbers in range, states real ones.
 * where: "us" (anywhere), "near" (zip + radius), "states" (the picked states).
 */
export function cleanLiveQuery(raw, { zip: storeZip = "39540" } = {}) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const make = MAKES.has(r.make) ? r.make : null;
  const model = make && MAKES.get(make).models.some((m) => m.id === r.model) ? r.model : null;
  const nextYear = new Date().getFullYear() + 1;
  const [yearMin, yearMax] = ordered(whole(r.yearMin, 1900, nextYear), whole(r.yearMax, 1900, nextYear));
  const [priceMin, priceMax] = ordered(whole(r.priceMin, 1, 1e7), whole(r.priceMax, 1, 1e7));
  const states = [...new Set((Array.isArray(r.states) ? r.states : []).map((s) => String(s).toUpperCase()).filter((s) => STATES[s]))];
  const where = r.where === "near" ? "near" : r.where === "states" && states.length ? "states" : "us";
  return {
    make, model, yearMin, yearMax, priceMin, priceMax,
    milesMax: whole(r.milesMax, 1, 1e6),
    where,
    zip: /^\d{5}$/.test(String(r.zip ?? "")) ? String(r.zip) : storeZip,
    radius: whole(r.radius, 5, 3000) ?? 200,
    states: where === "states" ? states : [],
    sort: LIVE_SORTS[r.sort] ? r.sort : "deals",
    page: Math.min(whole(r.page, 0, 1e6) ?? 0, Math.floor(OFFSET_CAP / PAGE) - 1),
  };
}
export function parseLiveQuery(s, opts) {
  try { return cleanLiveQuery(JSON.parse(String(s || "{}")), opts); } catch { return cleanLiveQuery({}, opts); }
}

const R = 3958.8;
const rad = (d) => (d * Math.PI) / 180;
function milesBetween(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const zipPoint = (zip) => { const z = ZIP3[String(zip ?? "").slice(0, 3)]; return z ? { lat: z[0], lon: z[1] } : null; };

/** Rough driving miles between two ZIPs: straight line between their 3-digit areas × 1.2. */
export function roadMiles(zipA, zipB) {
  const a = zipPoint(zipA), b = zipPoint(zipB);
  return a && b ? Math.round(milesBetween(a, b) * 1.2) : null;
}

/**
 * Rough open-carrier shipping, not a quote: nothing under 75 miles (drive it back), else
 * $150 + $1.10/mile for the first 300, $0.75 up to 1,000, $0.50 past that, to the nearest $25.
 */
export function shippingEstimate(road) {
  if (road == null) return null;
  if (road < 75) return 0;
  const cost = 150 + 1.1 * Math.min(road, 300) + 0.75 * Math.max(0, Math.min(road, 1000) - 300) + 0.5 * Math.max(0, road - 1000);
  return Math.round(cost / 25) * 25;
}

/**
 * Where to search. Anywhere = CarGurus' nationwide distance. A ZIP + radius as given.
 * States = one circle from the picked state nearest their middle, wide enough to reach
 * every picked state's far edge (cars outside the states are dropped after), or
 * nationwide when they're too spread out for one circle.
 */
export function liveArea(q) {
  if (q.where === "near") return { zip: q.zip, distance: q.radius, keep: null };
  if (q.where !== "states" || !q.states.length) return { zip: q.zip, distance: NATIONWIDE, keep: null };
  const keep = new Set(q.states);
  const picked = q.states.map((c) => STATES[c]);
  const mid = { lat: picked.reduce((s, p) => s + p.lat, 0) / picked.length, lon: picked.reduce((s, p) => s + p.lon, 0) / picked.length };
  const center = picked.reduce((best, p) => (milesBetween(p, mid) < milesBetween(best, mid) ? p : best));
  const distance = Math.ceil(Math.max(...picked.map((p) => milesBetween(center, p) + p.radius)) / 10) * 10;
  return distance > 1500 ? { zip: q.zip, distance: NATIONWIDE, keep } : { zip: center.zip, distance, keep };
}

/** The CarGurus request for one page of a search. */
export function liveSearchUrl(q, base = CG) {
  const area = liveArea(q), s = LIVE_SORTS[q.sort] || LIVE_SORTS.deals;
  const p = new URLSearchParams({
    zip: area.zip, distance: String(area.distance), inventorySearchWidgetType: "AUTO",
    sortType: s.type, sortDir: s.dir, offset: String(q.page * PAGE), maxResults: String(PAGE), filtersModified: "true",
  });
  if (q.model || q.make) p.set("entitySelectingHelper.selectedEntity", q.model || q.make);
  for (const [k, param] of [["yearMin", "startYear"], ["yearMax", "endYear"], ["priceMin", "minPrice"], ["priceMax", "maxPrice"], ["milesMax", "maxMileage"]]) {
    if (q[k] != null) p.set(param, String(q[k]));
  }
  return `${base}/Cars/searchResults.action?${p}`;
}

/**
 * CarGurus' answer → the cars to show: used only, inside the picked states, each with
 * rough road miles from the store, a shipping estimate, the delivered price and how
 * that compares to CarGurus' market value.
 */
export function liveResults(text, q, { storeZip = "39540", base = CG } = {}) {
  const raw = parseJsonLoose(text);
  if (!Array.isArray(raw)) throw new Error("CarGurus sent back something other than a list of cars. Try again in a minute.");
  const keep = liveArea(q).keep;
  const rows = [];
  for (const l of extractListings(raw)) {
    if (l.isNew) continue;
    const d = l.dealer || {};
    const state = String(d.state || "").toUpperCase();
    if (keep && !keep.has(state)) continue;
    const road = roadMiles(d.zip, storeZip);
    const shipping = shippingEstimate(road);
    const delivered = l.price && shipping != null ? l.price + shipping : null;
    rows.push({
      key: l.vin || `cargurus:${l.sourceId}`, vin: l.vin, stock: l.stock, year: l.year, make: l.make, model: l.model,
      trim: l.trim, title: l.title, price: l.price, miles: l.miles, days: l.daysListed, dealRating: l.dealRating,
      marketValue: l.marketValue, body: l.body, drive: l.drive, fuel: l.fuel, cpo: l.cpo, color: l.color, photo: l.photo,
      url: l.sourceId ? `${base}/details/${encodeURIComponent(l.sourceId)}` : null,
      dealer: { name: d.name || null, phone: d.phone || null, city: d.city || null, state: state || null, zip: d.zip || null, type: d.type || null },
      roadMiles: road, shipping, delivered, vsMarket: delivered && l.marketValue ? delivered - l.marketValue : null,
    });
  }
  // CarGurus' own order is loose (it sorts by price with fees), so each page is put in the
  // chosen order; "best deals" keeps CarGurus' ranking.
  const by = PAGE_ORDER[q.sort];
  if (by) rows.sort(by);
  return { rows, page: q.page, got: raw.length, more: raw.length >= PAGE - 8 && (q.page + 1) * PAGE < OFFSET_CAP };
}
const last = (v, dir) => (v == null ? (dir > 0 ? Infinity : -Infinity) : v);
const PAGE_ORDER = {
  price: (a, b) => last(a.price, 1) - last(b.price, 1),
  priceHigh: (a, b) => last(b.price, -1) - last(a.price, -1),
  miles: (a, b) => last(a.miles, 1) - last(b.miles, 1),
  newest: (a, b) => last(a.days, 1) - last(b.days, 1),
  oldest: (a, b) => last(b.days, -1) - last(a.days, -1),
};

/** One page of a search, end to end (the PC server; the worker only forwards the request). */
export async function runLiveSearch(q, { fetchImpl = fetch, storeZip, base = CG } = {}) {
  let r;
  try {
    r = await fetchImpl(liveSearchUrl(q, base)); // plain: no browser headers
  } catch {
    throw new Error("CarGurus couldn't be reached. Check the internet connection and try again.");
  }
  if (!r.ok) throw new Error(`CarGurus didn't answer the search (HTTP ${r.status}). Try again in a minute.`);
  return liveResults(await r.text(), q, { storeZip, base });
}
