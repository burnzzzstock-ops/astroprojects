// Merging what each source saw into one record per car (keyed by VIN), and the
// rules for "how long has it been listed". Pure functions over the db object.
import { norm, daysSince, dealerKeyOf, zipDistance } from "./util.js";

export const ACTIVE_DAYS = 3;   // still for sale if any source saw it this recently
const PRUNE_DAYS = 45;          // forget never-called cars nobody has seen in this long

export const listingKey = (o) =>
  o.vin || `${o.source}:${o.sourceId || `${norm(o.title)}|${o.price ?? ""}|${o.miles ?? ""}`}`;

/**
 * Days listed = the longest of: what each source reported (aged forward from the
 * day it said so) and how long this tool has been seeing the car itself.
 */
export function daysListed(l, now = Date.now()) {
  let best = daysSince(l.firstSeenAt, now) ?? 0;
  for (const r of Object.values(l.reported || {})) {
    if (r && r.days != null) best = Math.max(best, r.days + (daysSince(r.at, now) ?? 0));
  }
  return Math.round(best);
}

export function isActive(l, now = Date.now()) {
  return (daysSince(l.lastSeenAt, now) ?? Infinity) <= ACTIVE_DAYS;
}

/**
 * Apply one scan's observations to the db. Returns { kept, excluded, newCount, dropCount }.
 * Price drops are tracked PER SOURCE (a source vs. itself), so two sites showing
 * slightly different prices for the same car never look like a drop.
 */
export function applyObservations(db, observations, cfg, now = new Date()) {
  const at = now.toISOString();
  const frags = (cfg.excludeSellers || []).map(norm).filter(Boolean);
  const t = { kept: 0, excluded: 0, newCount: 0, dropCount: 0 };
  for (const o of observations) {
    if (o.isNew) continue;
    const dealerName = norm(o.dealer?.name);
    if (dealerName && frags.some((f) => dealerName.includes(f))) { t.excluded++; continue; }
    const key = listingKey(o);
    const existing = db.listings[key];
    const dealerKey = existing?.dealerKey || dealerKeyOf(o.dealer, key);
    if (db.hiddenDealers[dealerKey]) { t.excluded++; continue; }
    const distance = o.distance ?? zipDistance(cfg.zip, o.dealer?.zip);
    if (distance != null && distance > cfg.radiusMiles + 5) { t.excluded++; continue; }

    let l = existing;
    if (!l) {
      // A previous price above today's ask = the seller already cut it before we saw it.
      const pre = o.prevPrice && o.price && o.prevPrice >= o.price + 100 ? o.prevPrice - o.price : 0;
      l = db.listings[key] = {
        key, vin: o.vin, year: o.year, make: o.make, model: o.model, trim: o.trim, title: o.title,
        color: o.color, stock: o.stock, photo: o.photo, miles: o.miles,
        price: o.price, firstPrice: pre ? o.prevPrice : o.price,
        priceDrops: pre ? 1 : 0, priceDropTotal: pre, lastDropAt: null, srcPrice: {},
        dealer: { ...o.dealer }, dealerKey, distance,
        urls: {}, reported: {}, seen: {}, dealRating: o.dealRating || null,
        firstSeenAt: at, lastSeenAt: at,
        status: "new", nextCallDay: null, lastCallAt: null, lastOutcome: null,
        priceAtLastCall: null, offer: null, notes: null, boughtAt: null,
      };
      t.newCount++;
    } else {
      const prev = l.srcPrice?.[o.source];
      if (o.price && prev && o.price <= prev - 100) {
        l.priceDrops++;
        l.priceDropTotal += prev - o.price;
        l.lastDropAt = at;
        if (l.status === "working") l.nextCallDay = null; // a drop puts it back on today's list
        t.dropCount++;
      }
      for (const f of ["vin", "year", "make", "model", "trim", "title", "color", "stock", "photo", "miles"]) {
        if (o[f] != null) l[f] = o[f];
      }
      if (o.price) l.price = o.price;
      if (o.dealRating) l.dealRating = o.dealRating;
      if (distance != null) l.distance = distance;
      // Fill in any dealer details we didn't have; dealers.csv (source "dealer") wins outright.
      for (const [k, v] of Object.entries(o.dealer || {})) {
        if (v && (o.source === "dealer" || !l.dealer[k])) l.dealer[k] = v;
      }
    }
    if (o.price) l.srcPrice[o.source] = o.price;
    if (o.url) l.urls[o.source] = o.url;
    if (o.daysListed != null) l.reported[o.source] = { days: o.daysListed, at };
    l.seen[o.source] = at;
    l.lastSeenAt = at;
    t.kept++;
  }
  // Keep the file small: drop cars long gone that nobody ever called about.
  for (const [k, l] of Object.entries(db.listings)) {
    if (!l.lastCallAt && (daysSince(l.lastSeenAt, now.getTime()) ?? 0) > PRUNE_DAYS) delete db.listings[k];
  }
  return t;
}
