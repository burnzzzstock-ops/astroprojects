// The Dealers tab: every dealers.csv row with how it did on the last scan.
// Runs where the scan runs (needs the ZIP table for distances).
import { daysSince, dealerKeyOf } from "./util.js";
import { zipDistance, zipForCity } from "./geo.js";
import { eligible } from "./buyList.js";

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
