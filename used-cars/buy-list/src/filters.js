// The used car manager's filters: dozens of categories, most of them pick-any-number.
// A filter is a plain object saved with the page's prefs, e.g.
//   { make: ["Ford", "Toyota"], body: ["Truck"], price: [10000, 30000], cpo: true, q: "lariat" }
// Within a category any pick matches (OR); across categories all must match (AND).
// Features are the exception: a car needs every feature picked.
// Values come from what each site sent (body style, drivetrain, …), bucketed here, with
// the title/trim as a fallback when a site doesn't say.
import { norm } from "./util.js";
import { queryMatches, resolveQuery } from "./search.js";

const asList = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);

function bodyFrom(s) {
  if (!s) return null;
  if (/minivan|mini-van/.test(s)) return "Minivan";
  if (/\bvan\b|cargo|transit|express \d|savana|promaster|sprinter/.test(s)) return "Van";
  if (/pickup|truck|crew ?cab|supercrew|supercab|regular cab|double cab|quad cab|extended cab|mega cab|king cab|access cab|chassis/.test(s)) return "Truck";
  if (/\bsuv\b|crossover|sport utility/.test(s)) return "SUV";
  if (/convertible|cabriolet|roadster|spyder|spider/.test(s)) return "Convertible";
  if (/coupe/.test(s)) return "Coupe";
  if (/hatch/.test(s)) return "Hatchback";
  if (/wagon/.test(s)) return "Wagon";
  if (/sedan/.test(s)) return "Sedan";
  return null;
}
const TRUCK_MODELS = /\b(f-?150|f-?250|f-?350|f-?450|super duty|silverado|sierra|ram (1500|2500|3500)|tacoma|tundra|colorado|canyon|ranger|frontier|titan|ridgeline|gladiator|maverick|santa cruz)\b/;
export function bodyOf(u) {
  const t = `${u.model || ""} ${u.trim || ""} ${u.title || ""}`.toLowerCase();
  return bodyFrom(String(u.body || "").toLowerCase()) || bodyFrom(t) || (TRUCK_MODELS.test(t) ? "Truck" : null);
}

function driveFrom(s) {
  if (/four[-_ ]?wheel|4wd|4x4/.test(s)) return "4WD";
  if (/all[-_ ]?wheel|awd|4matic|xdrive|quattro|4motion/.test(s)) return "AWD";
  if (/front[-_ ]?wheel|fwd/.test(s)) return "FWD";
  if (/rear[-_ ]?wheel|rwd|4x2|2wd/.test(s)) return "RWD / 2WD";
  return null;
}
export const driveOf = (u) => driveFrom(String(u.drive || "").toLowerCase()) || driveFrom(`${u.trim || ""} ${u.title || ""}`.toLowerCase());

function fuelFrom(s) {
  if (/plug-?in|phev/.test(s)) return "Plug-in hybrid";
  if (/hybrid/.test(s)) return "Hybrid";
  if (/electric|\bev\b/.test(s)) return "Electric";
  if (/diesel/.test(s)) return "Diesel";
  if (/flex|e85/.test(s)) return "Flex fuel";
  if (/gas|unleaded|petrol/.test(s)) return "Gas";
  return null;
}
export function fuelOf(u) {
  const t = `${u.trim || ""} ${u.title || ""}`.toLowerCase();
  return fuelFrom(String(u.fuel || "").toLowerCase()) || (/hybrid|diesel|plug-?in|phev|electric/.test(t) ? fuelFrom(t) : null);
}

export function transOf(u) {
  const s = `${u.trans || ""}`.toLowerCase();
  if (/manual|stick/.test(s)) return "Manual";
  if (/cvt|continuously|automatic|auto|dual[- ]clutch|dct/.test(s)) return "Automatic";
  return null;
}

export function engineOf(u) {
  const s = String(u.engine || "").toLowerCase();
  if (/electric/.test(s) || fuelOf(u) === "Electric") return "Electric";
  const m = s.match(/\b[vih]-?(\d{1,2})\b/) || s.match(/\b(\d{1,2})[- ]?cyl/);
  const n = m ? Number(m[1]) : 0;
  return n >= 3 && n <= 16 ? (n >= 10 ? "10+ cylinders" : `${n} cylinders`) : null;
}

const EXTERIOR = [
  ["Black", /black|ebony|onyx|obsidian|\bjet\b/], ["White", /white|pearl|ivory|alabaster|snow/],
  ["Silver", /silver|aluminum|platinum|ingot/],
  ["Gray", /gr[ae]y|graphite|charcoal|gunmetal|granite|magnetic|slate|carbon|steel|titanium|shadow/],
  ["Red", /red|maroon|burgundy|ruby|crimson|cherry|garnet/], ["Blue", /blue|navy|cobalt|sapphire|azure/],
  ["Green", /green|olive|emerald|jade/], ["Brown", /brown|bronze|copper|mocha|espresso|chestnut|cocoa/],
  ["Beige / tan", /beige|\btan\b|sand|champagne|khaki|cashmere|desert|almond|parchment/],
  ["Gold", /gold/], ["Orange", /orange/], ["Yellow", /yellow/], ["Purple", /purple|violet|plum/],
];
const INTERIOR = [
  ["Black", /black|ebony|\bjet\b|onyx/], ["Gray", /gr[ae]y|graphite|slate|\bash\b|steel|pewter|charcoal/],
  ["Brown", /brown|saddle|cocoa|mocha|chestnut|espresso|java|cognac|caramel|tobacco|kona/],
  ["Beige / tan", /tan\b|beige|camel|sand|parchment|almond|cashmere|stone|oyster|linen|dune|wheat|light/],
  ["Red", /red|maroon|burgundy|garnet|adrenaline/], ["White", /white|ivory|cream|pearl/], ["Blue", /blue|navy/],
];
const bucket = (list, s) => (s ? (list.find(([, re]) => re.test(String(s).toLowerCase())) || [null])[0] : null);
export const colorOf = (u) => bucket(EXTERIOR, u.colorGroup) || bucket(EXTERIOR, u.color);
export const intColorOf = (u) => bucket(INTERIOR, u.intColor);

const FEATURES = [
  ["Leather seats", /leather/], ["Sunroof / moonroof", /sunroof|moonroof|panoramic/], ["Navigation", /navigation|\bnav\b/],
  ["Third row", /third[- ]row|3rd[- ]row/], ["Backup camera", /back-?up camera|rear[- ]?view camera|rear camera/],
  ["Bluetooth", /bluetooth/], ["CarPlay / Android Auto", /carplay|android auto/], ["Heated seats", /heated (front )?seat/],
  ["Cooled seats", /ventilated|cooled seat/], ["Remote start", /remote (engine )?start/], ["Adaptive cruise", /adaptive cruise/],
  ["Blind spot monitor", /blind[- ]spot/], ["Tow package", /tow(ing)? (package|hitch)|trailer (hitch|tow)/],
  ["Premium sound", /premium (sound|audio)|bose|harman|jbl|bang|burmester|mark levinson/], ["Keyless entry", /keyless/],
  ["Lane keep assist", /lane (keep|departure|centering)/], ["Heated steering wheel", /heated steering/], ["Alloy wheels", /alloy/],
];
export function featuresOf(u) {
  const raw = asList(u.features).join(" | ").toLowerCase();
  return raw ? FEATURES.filter(([, re]) => re.test(raw)).map(([n]) => n) : [];
}

const RATING = { GREAT_PRICE: "Great price", GOOD_PRICE: "Good price", FAIR_PRICE: "Fair price", POOR_PRICE: "High price",
  HIGH_PRICE: "High price", OVERPRICED: "Overpriced", OUTLIER: "Outlier", NA: "No rating" };
const dealRatingOf = (u) => (u.dealRating ? RATING[String(u.dealRating).toUpperCase()] || String(u.dealRating) : null);
const SELLER = { franchise: "Franchise dealer", independent: "Independent lot", private: "Private seller" };
const sellerTypeOf = (u) => (String(u.dealerKey).startsWith("private:") ? SELLER.private : SELLER[u.dealer?.type] || null);
const SOURCE = { cargurus: "CarGurus", dealer: "Dealer website", marketcheck: "Marketcheck" };
const STATUS = { new: "Not called yet", working: "Called, follow up", negotiating: "Negotiating", bought: "Bought", passed: "Passed" };
const state = (u) => (u.dealer?.state ? String(u.dealer.state).toUpperCase() : null);

/** Every category, in the order the panel shows them. kind: multi | all (features) | range | flag. */
export const FACETS = [
  { key: "make", group: "The car", label: "Make", kind: "multi", get: (u) => u.make || null },
  { key: "model", group: "The car", label: "Model", kind: "multi", get: (u) => (u.make && u.model ? `${u.make} ${u.model}` : null) },
  { key: "year", group: "The car", label: "Year", kind: "range", get: (u) => u.year ?? null },
  { key: "body", group: "The car", label: "Body style", kind: "multi", get: bodyOf },
  { key: "drive", group: "The car", label: "Drivetrain", kind: "multi", get: driveOf },
  { key: "fuel", group: "The car", label: "Fuel", kind: "multi", get: fuelOf },
  { key: "engine", group: "The car", label: "Engine", kind: "multi", get: engineOf },
  { key: "trans", group: "The car", label: "Transmission", kind: "multi", get: transOf },
  { key: "color", group: "The car", label: "Exterior color", kind: "multi", get: colorOf },
  { key: "intColor", group: "The car", label: "Interior color", kind: "multi", get: intColorOf },
  { key: "features", group: "The car", label: "Features (has all picked)", kind: "all", get: featuresOf },
  { key: "cpo", group: "The car", label: "Certified pre-owned only", kind: "flag", get: (u) => !!u.cpo },
  { key: "price", group: "The deal", label: "Price ($)", kind: "range", get: (u) => u.price ?? null },
  { key: "miles", group: "The deal", label: "Miles", kind: "range", get: (u) => u.miles ?? null },
  { key: "days", group: "The deal", label: "Days listed", kind: "range", get: (u) => u.days ?? null },
  { key: "vsMarket", group: "The deal", label: "Price vs. CarGurus market value ($)", kind: "range",
    get: (u) => (u.price && u.marketValue ? u.price - u.marketValue : null) },
  { key: "dealRating", group: "The deal", label: "CarGurus rating", kind: "multi", get: dealRatingOf },
  { key: "dropped", group: "The deal", label: "Price has dropped", kind: "flag", get: (u) => u.priceDrops > 0 },
  { key: "hasPrice", group: "The deal", label: "Has a posted price", kind: "flag", get: (u) => !!u.price },
  { key: "distance", group: "Where & who", label: "Distance (mi)", kind: "range", get: (u) => (u.distance != null ? Math.round(u.distance) : null) },
  { key: "state", group: "Where & who", label: "State", kind: "multi", get: state },
  { key: "city", group: "Where & who", label: "City", kind: "multi", get: (u) => (u.dealer?.city ? `${u.dealer.city}${state(u) ? ", " + state(u) : ""}` : null) },
  { key: "dealer", group: "Where & who", label: "Dealer", kind: "multi", get: (u) => u.dealer?.name || null },
  { key: "sellerType", group: "Where & who", label: "Seller type", kind: "multi", get: sellerTypeOf },
  { key: "source", group: "Where & who", label: "Found on", kind: "multi", get: (u) => Object.keys(u.seen || {}).map((k) => SOURCE[k] || k) },
  { key: "hasPhone", group: "Where & who", label: "Has a phone number", kind: "flag", get: (u) => !!u.dealer?.phone },
  { key: "status", group: "Our calls", label: "Call status", kind: "multi", get: (u) => STATUS[u.status] || null },
  { key: "neverCalled", group: "Our calls", label: "Never called", kind: "flag", get: (u) => !u.lastCallAt },
];
const BY_KEY = Object.fromEntries(FACETS.map((d) => [d.key, d]));

/** Keep only known categories with sane values (it comes from the page). */
export function cleanFilter(raw) {
  const f = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return f;
  for (const [k, v] of Object.entries(raw)) {
    if (k === "q") { const s = String(v ?? "").trim().slice(0, 100); if (s) f.q = s; continue; }
    const d = BY_KEY[k];
    if (!d) continue;
    if (d.kind === "multi" || d.kind === "all") {
      const vals = [...new Set(asList(v).map((x) => String(x).trim().slice(0, 120)).filter(Boolean))].slice(0, 200);
      if (vals.length) f[k] = vals;
    } else if (d.kind === "range") {
      const num = (x) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
      const [lo, hi] = Array.isArray(v) ? v.map(num) : [null, null];
      if (lo != null || hi != null) f[k] = [lo ?? null, hi ?? null];
    } else if (v === true || v === "true") f[k] = true; // flag
  }
  return f;
}
export function parseFilter(s) {
  try { return cleanFilter(JSON.parse(String(s || "{}"))); } catch { return {}; }
}

// Each car's value(s) per category, worked out once (kept off the JSON sent to the page).
function valuesOf(u) {
  if (!u._fv) Object.defineProperty(u, "_fv", { value: Object.fromEntries(FACETS.map((d) => [d.key, d.get(u)])) });
  return u._fv;
}
function passes(d, have, want) {
  if (d.kind === "multi") { const h = asList(have).map(norm); return want.some((w) => h.includes(norm(w))); }
  if (d.kind === "all") { const h = asList(have).map(norm); return want.every((w) => h.includes(norm(w))); }
  if (d.kind === "range") return have != null && (want[0] == null || have >= want[0]) && (want[1] == null || have <= want[1]);
  return !!have; // flag
}

// The categories a car fails, stopping at two (all the counts need to know).
function failing(u, f) {
  const out = [];
  if (f.q && !queryMatches(u, f.q)) out.push("q");
  for (const [k, want] of Object.entries(f)) {
    if (out.length > 1) break;
    const d = BY_KEY[k];
    if (d && !passes(d, valuesOf(u)[k], want)) out.push(k);
  }
  return out;
}
export const matches = (u, f) => !f || failing(u, f).length === 0;

/**
 * The filter with its search words worked out against these cars (a misspelled word
 * falls back to the closest words on the list), plus what was swapped (`fixes`).
 */
export function withSearch(f, pool) {
  if (!f?.q) return { filter: f || {}, fixes: [] };
  const rq = resolveQuery(f.q, pool);
  return { filter: { ...f, q: rq }, fixes: rq?.fixes || [] };
}

/**
 * For the panel: each category's options with how many cars have them, counted under all
 * the OTHER filters (picking Ford still shows how many trucks there'd be), each range's
 * low/high, each yes/no's count, and how many cars match everything.
 */
export function facetCounts(units, f) {
  const acc = Object.fromEntries(FACETS.map((d) => [d.key, d.kind === "range" ? { min: null, max: null } : d.kind === "flag" ? { n: 0 } : { opts: new Map() }]));
  let total = 0;
  for (const u of units) {
    const fails = failing(u, f);
    if (fails.length > 1) continue;
    if (!fails.length) total++;
    const fv = valuesOf(u);
    for (const d of FACETS) {
      if (fails.length && fails[0] !== d.key) continue;
      const a = acc[d.key], v = fv[d.key];
      if (d.kind === "range") {
        if (v != null) { a.min = a.min == null ? v : Math.min(a.min, v); a.max = a.max == null ? v : Math.max(a.max, v); }
      } else if (d.kind === "flag") {
        if (v) a.n++;
      } else {
        for (const x of asList(v)) {
          const e = a.opts.get(norm(x)) || { spell: new Map(), n: 0 };
          e.n++;
          e.spell.set(x, (e.spell.get(x) || 0) + 1);
          a.opts.set(norm(x), e);
        }
      }
    }
  }
  const facets = {};
  for (const d of FACETS) {
    const a = acc[d.key];
    if (!a.opts) { facets[d.key] = a; continue; }
    // the most common spelling ("Ford", not "FORD"); picked options stay listed even at 0
    const opts = [...a.opts.entries()].map(([k, e]) => ({ k, v: [...e.spell.entries()].sort((x, y) => y[1] - x[1])[0][0], n: e.n }));
    for (const w of asList(f[d.key])) if (!a.opts.has(norm(w))) opts.push({ k: norm(w), v: w, n: 0 });
    facets[d.key] = { opts: opts.sort((x, y) => y.n - x.n || String(x.v).localeCompare(String(y.v))).map(({ v, n }) => ({ v, n })) };
  }
  return { total, facets };
}

/** The category list for the page (no functions). */
export const FACET_DEFS = FACETS.map(({ key, group, label, kind }) => ({ key, group, label, kind }));
