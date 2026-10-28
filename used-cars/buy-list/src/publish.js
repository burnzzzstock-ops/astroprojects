// What the web version publishes after each scan (see cloud/). The ranking runs in
// the browser, so this sends only the cars that can show up (aged and still for
// sale, plus anything the manager has called about) with just the fields the page
// uses. That keeps it small enough for Cloudflare's free tier.
import { daysListed, isActive } from "./age.js";
import { dealerRoster } from "./roster.js";
import { status as deskStatus } from "./buyList.js";
import { DETAIL_FIELDS } from "./listings.js";

const KEEP = [
  "key", "vin", "year", "make", "model", "trim", "title", "color", "stock", "miles", "price", "firstPrice",
  "priceDrops", "priceDropTotal", "lastDropAt", "dealer", "dealerKey", "distance", "urls", "reported", "seen",
  "firstSeenAt", "lastSeenAt", "dealRating", ...DETAIL_FIELDS,
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
  // Same as the PC page's status (each source's latest run), plus the settings the ranking needs.
  const s = deskStatus(db, cfg, now);
  const status = {
    filters: { ...s.filters, focusMakes: cfg.focusMakes, focusUnderMiles: cfg.focusUnderMiles, topListSize: cfg.topListSize },
    sourcesEnabled: s.sourcesEnabled,
    lastScan: s.lastScan,
    marketcheck: s.marketcheck,
    publishedAt: new Date(now).toISOString(),
  };
  return { status, aged, dealers: dealerRoster(db, cfg, dealers, now) };
}
