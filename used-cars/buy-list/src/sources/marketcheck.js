// Marketcheck listings API, FREE tier only: no credit card on file, so it can't
// bill. The free tier allows ~500 calls/month and a 100-mile radius; each call
// returns up to 50 aged used listings, nearest first. The monthly cap below stops
// before the quota so it never errors out mid-month. Skipped if no apiKey is set.
// Sign up (free): https://www.marketcheck.com/apis

export const SEARCH_URL = "https://api.marketcheck.com/v2/search/car/active";
export const PAGE_ROWS = 50;

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const str = (v) => (v == null || v === "" ? null : String(v).trim() || null);

export function buildSearchParams(f, start = 0) {
  return new URLSearchParams({
    api_key: f.apiKey,
    car_type: "used",
    zip: String(f.zip),
    radius: String(f.radius),
    dom_range: `${f.minDays}-${f.maxDays}`,
    price_range: `${f.minPrice || 0}-1000000`,
    miles_range: `0-${f.maxMiles || 1000000}`,
    rows: String(PAGE_ROWS),
    start: String(start),
  });
}

export function normalizeMarketcheck(raw) {
  const b = raw.build || {};
  const d = raw.dealer || {};
  const sellerType = String(raw.seller_type || "").toLowerCase();
  return {
    source: "marketcheck",
    sourceId: str(raw.id),
    vin: str(raw.vin)?.toUpperCase() || null,
    year: int(b.year),
    make: str(b.make),
    model: str(b.model),
    trim: str(b.trim),
    title: str(raw.heading),
    price: int(raw.price),
    prevPrice: int(raw.ref_price),
    miles: int(raw.miles),
    daysListed: int(raw.dom),
    url: str(raw.vdp_url),
    photo: str(raw.media?.photo_links?.[0]),
    color: str(raw.exterior_color),
    stock: str(raw.stock_no),
    isNew: false,
    distance: Number.isFinite(Number(raw.dist)) ? Number(raw.dist) : null,
    dealRating: null,
    dealer: {
      name: str(d.name || d.seller_name),
      phone: str(d.phone || d.seller_phone),
      street: str(d.street),
      city: str(d.city),
      state: str(d.state),
      zip: str(d.zip),
      website: str(d.website),
      type: /fsbo|private/.test(sellerType) ? "private" : str(d.dealer_type)?.toLowerCase() || null,
    },
  };
}

/**
 * fetchMarketcheck(cfg, { callsUsedThisMonth, fetchImpl, log })
 *   → { listings, apiCalls, pages, truncated, numFound }
 */
export async function fetchMarketcheck(cfg, { callsUsedThisMonth = 0, fetchImpl = fetch, log = () => {} } = {}) {
  const s = cfg.sources.marketcheck;
  const budget = Math.min(s.maxPages, s.monthlyCallCap - callsUsedThisMonth);
  if (budget <= 0) throw new Error(`free-tier monthly cap reached (${s.monthlyCallCap} calls); resets on the 1st`);
  const f = {
    apiKey: s.apiKey, zip: cfg.zip, radius: Math.min(cfg.radiusMiles, 100), minDays: cfg.minDaysListed,
    maxDays: cfg.maxDaysListed, minPrice: cfg.minPrice, maxMiles: cfg.maxMiles,
  };
  const listings = [];
  let apiCalls = 0, numFound = 0, truncated = true;
  for (let page = 0; page < budget; page++) {
    const start = page * PAGE_ROWS;
    apiCalls++;
    let resp;
    try {
      resp = await fetchImpl(`${SEARCH_URL}?${buildSearchParams(f, start)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw Object.assign(new Error(`Marketcheck unreachable: ${e.message}`), { partial: { listings, apiCalls, numFound } });
    }
    if (resp.status === 401 || resp.status === 403) throw Object.assign(new Error("Marketcheck rejected the API key (check sources.marketcheck.apiKey in config.json)"), { partial: { listings, apiCalls, numFound } });
    if (resp.status === 429) throw Object.assign(new Error("Marketcheck free-tier limit hit (429)"), { partial: { listings, apiCalls, numFound } });
    if (!resp.ok) throw Object.assign(new Error(`Marketcheck error ${resp.status}`), { partial: { listings, apiCalls, numFound } });
    const body = await resp.json();
    numFound = Number(body.num_found) || 0;
    const rows = (body.listings || []).map(normalizeMarketcheck);
    listings.push(...rows);
    log(`marketcheck page ${page + 1}: ${rows.length} listings (${numFound} in market)`);
    if (rows.length < PAGE_ROWS || start + PAGE_ROWS >= numFound) { truncated = false; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { listings, apiCalls, pages: apiCalls, truncated, numFound };
}
