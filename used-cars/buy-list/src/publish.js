// What the web version publishes after each scan (see cloud/). The ranking runs in
// the browser, so this sends only the cars that can show up (aged and still for
// sale, plus anything the manager has called about) with just the fields the page
// uses. That keeps it small enough for Cloudflare's free tier.
import { daysListed, isActive } from "./age.js";
import { dealerRoster } from "./roster.js";

const KEEP = [
  "key", "vin", "year", "make", "model", "trim", "title", "color", "stock", "miles", "price", "firstPrice",
  "priceDrops", "priceDropTotal", "lastDropAt", "dealer", "dealerKey", "distance", "urls", "reported", "seen",
  "firstSeenAt", "lastSeenAt", "dealRating",
];
const SLACK_DAYS = 2; // publish cars just under the window too: days listed keeps counting between scans

export function buildPublished(db, cfg, dealers, calledKeys = new Set(), now = Date.now()) {
  const hidden = db.hiddenDealers || {};
  const aged = [];
  for (const l of Object.values(db.listings)) {
    const called = calledKeys.has(l.key);
    if (hidden[l.dealerKey] && !called) continue;
    const d = daysListed(l, now);
    const inWindow = isActive(l, now) && d >= cfg.minDaysListed - SLACK_DAYS && d <= cfg.maxDaysListed;
    if (!inWindow && !called) continue;
    aged.push(Object.fromEntries(KEEP.filter((k) => l[k] != null).map((k) => [k, l[k]])));
  }
  const month = new Date(now).toISOString().slice(0, 7);
  const status = {
    filters: {
      zip: cfg.zip, radiusMiles: cfg.radiusMiles, minDaysListed: cfg.minDaysListed, maxDaysListed: cfg.maxDaysListed,
      minPrice: cfg.minPrice, maxMiles: cfg.maxMiles, dailyListSize: cfg.dailyListSize, scanTime: cfg.scanTime,
    },
    sourcesEnabled: Object.fromEntries(Object.entries(cfg.sources).map(([k, v]) => [k, !!v.enabled])),
    lastScan: db.scans[0] || null,
    marketcheck: { used: db.marketcheckCalls?.[month] || 0, cap: cfg.sources.marketcheck.monthlyCallCap, hasKey: !!cfg.sources.marketcheck.apiKey },
    publishedAt: new Date(now).toISOString(),
  };
  return { status, aged, dealers: dealerRoster(db, cfg, dealers, now) };
}
