// Merging sources, price drops, days listed, ranking, the call list and outcomes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isolate, obs } from "./helpers.mjs";

isolate();
const { config } = await import("../src/config.js");
const { applyObservations, daysListed } = await import("../src/listings.js");
const B = await import("../src/buyList.js");
const { localDay } = await import("../src/util.js");

const freshDb = () => ({ listings: {}, calls: [], scans: [], hiddenDealers: {}, marketcheckCalls: {} });
const DAY = 86400000;

test("merge: one record per VIN across sources; excluded sellers and far dealers dropped", () => {
  const db = freshDb();
  const t = applyObservations(db, [
    obs(0), obs(1), obs(2), obs(3),                          // obs(3) is at CarMax → excluded
    obs(0, { source: "dealer", url: "https://dealer.example/0", daysListed: null }), // same VIN, 2nd source
    obs(4, { dealer: { name: "Example Ford", zip: "39540" } }), // our own store → excluded
    obs(5, { distance: 160 }),                               // outside 100 mi
    obs(6, { isNew: true }),                                 // new car → ignored
  ], config);
  assert.equal(t.excluded, 3);
  assert.equal(Object.keys(db.listings).length, 3);
  const l = db.listings[obs(0).vin];
  assert.deepEqual(Object.keys(l.seen).sort(), ["cargurus", "dealer"]);
  assert.equal(l.urls.dealer, "https://dealer.example/0");
});

test("price drops are per source: a cut counts, two sites disagreeing doesn't", () => {
  const db = freshDb();
  applyObservations(db, [obs(0, { price: 20000 }), obs(0, { source: "dealer", price: 19800 })], config);
  assert.equal(db.listings[obs(0).vin].priceDrops, 0, "different sources, different prices ≠ a drop");
  const t = applyObservations(db, [obs(0, { price: 18500 })], config);
  const l = db.listings[obs(0).vin];
  assert.equal(t.dropCount, 1);
  assert.equal(l.priceDrops, 1);
  assert.equal(l.priceDropTotal, 1500);
  assert.equal(l.price, 18500);
  applyObservations(db, [obs(0, { price: 18450 })], config);
  assert.equal(l.priceDrops, 1, "under $100 isn't a drop");
});

test("a previous price on first sight counts as a drop that already happened", () => {
  const db = freshDb();
  applyObservations(db, [obs(1, { price: 20000, prevPrice: 22000 })], config);
  const l = db.listings[obs(1).vin];
  assert.equal(l.priceDrops, 1);
  assert.equal(l.priceDropTotal, 2000);
  assert.equal(l.firstPrice, 22000);
});

test("days listed = the longest of what sources said (aged forward) and our own tracking", () => {
  const now = Date.now();
  const l = { firstSeenAt: new Date(now - 10 * DAY).toISOString(), reported: { cargurus: { days: 100, at: new Date(now - 5 * DAY).toISOString() } } };
  assert.equal(daysListed(l, now), 105);
  const tracked = { firstSeenAt: new Date(now - 70 * DAY).toISOString(), reported: {} };
  assert.equal(daysListed(tracked, now), 70, "dealer-site cars age from the day we first saw them");
});

test("private sellers each get their own card", () => {
  const db = freshDb();
  applyObservations(db, [
    obs(0, { dealer: { name: "Private Seller", city: "Gulfport", zip: "39501" } }),
    obs(1, { dealer: { name: "Private Seller", city: "Biloxi", zip: "39530" } }),
  ], config);
  const keys = Object.values(db.listings).map((l) => l.dealerKey);
  assert.notEqual(keys[0], keys[1]);
});

test("ranking: older, closer, price-dropped cars score higher; reasons explain it", () => {
  const base = { distance: 50, price: 20000, priceDrops: 0, priceDropTotal: 0 };
  const s = (o, days = 90) => B.scoreListing({ ...base, ...o }, { days, radius: 100 }).score;
  assert.ok(s({}, 200) > s({}, 70));
  assert.ok(s({ distance: 5 }) > s({ distance: 95 }));
  assert.ok(s({ priceDrops: 2, priceDropTotal: 2000 }) > s({}));
  assert.ok(s({ price: null }) < s({}));
  assert.ok(s({ priceAtLastCall: 21500 }) > s({}), "dropped since your last call");
  const why = B.scoreListing({ ...base, priceDrops: 1, priceDropTotal: 1500, dealRating: "GREAT_PRICE" }, { days: 90 }).why;
  assert.ok(why.includes("90 days listed"));
  assert.ok(why.some((w) => w.includes("−$1,500")));
  assert.ok(why.includes("CarGurus: Great price"));
});

function marketDb(n = 30) {
  const db = freshDb();
  applyObservations(db, Array.from({ length: n }, (_, i) => obs(i)).filter((o) => !/carmax/i.test(o.dealer.name)), config);
  return db;
}

test("call list: top N, grouped by dealer, other due cars at that lot ride along", () => {
  const db = marketDb();
  const list = B.buildCallList(db, config);
  const primaries = list.dealers.flatMap((d) => d.units.filter((u) => !u.rideAlong));
  assert.equal(primaries.length, config.dailyListSize);
  assert.equal(new Set(list.dealers.map((d) => d.dealerKey)).size, list.dealers.length);
  assert.ok(list.dealers.every((d) => d.units.every((u) => u.dealerKey === d.dealerKey)));
  assert.ok(list.dealers.some((d) => d.units.some((u) => u.rideAlong)));
  assert.ok(primaries[0].score >= primaries.at(-1).score);
});

test("call list: only aged cars (min/max days, price, miles filters)", () => {
  const db = freshDb();
  applyObservations(db, [obs(0, { daysListed: 20 }), obs(1, { daysListed: 500 }), obs(2, { price: 2500 }), obs(4, { miles: 210000 }), obs(5)], config);
  const keys = B.buildCallList(db, config).dealers.flatMap((d) => d.units.map((u) => u.key));
  assert.deepEqual(keys, [obs(5).vin]);
});

test("outcomes: due days, too-high resurfaces on a drop, pass/reopen, negotiating, bought", () => {
  const db = marketDb();
  const k0 = obs(0).vin;
  B.recordOutcome(db, [k0], "no_answer");
  assert.equal(db.listings[k0].nextCallDay, localDay(1));
  assert.ok(!B.buildCallList(db, config).dealers.some((d) => d.units.some((u) => u.key === k0)));

  B.recordOutcome(db, [k0], "too_high", { notes: "wants 20 back", offer: 13500 });
  const l = db.listings[k0];
  assert.equal(l.nextCallDay, localDay(10));
  assert.equal(l.offer, 13500);
  assert.equal(l.notes, "wants 20 back");
  applyObservations(db, [obs(0, { price: l.price - 1000 })], config);
  assert.equal(l.nextCallDay, null, "a price drop puts it back on today's list");
  const back = B.buildCallList(db, { ...config, dailyListSize: 100 }).dealers.flatMap((d) => d.units).find((u) => u.key === k0);
  assert.ok(back.why.some((w) => w.includes("since your last call")));

  const k1 = obs(1).vin;
  B.recordOutcome(db, [k1], "pass");
  assert.ok(!B.buildCallList(db, { ...config, dailyListSize: 100 }).dealers.some((d) => d.units.some((u) => u.key === k1)));
  B.recordOutcome(db, [k1], "reopen");
  assert.ok(B.buildCallList(db, { ...config, dailyListSize: 100 }).dealers.some((d) => d.units.some((u) => u.key === k1)));

  const k2 = obs(2).vin;
  B.recordOutcome(db, [k2], "negotiating");
  const list = B.buildCallList(db, { ...config, dailyListSize: 100 });
  assert.ok(list.negotiating.some((u) => u.key === k2));
  assert.ok(!list.dealers.some((d) => d.units.some((u) => u.key === k2)));
  B.recordOutcome(db, [k2], "bought");
  assert.equal(B.status(db, config).stats.boughtMonth, 1);
  assert.throws(() => B.recordOutcome(db, [k2], "maybe"));
});

test("whole-lot outcome logs every car at that dealer; hidden dealers drop off", () => {
  const db = marketDb();
  const d = B.buildCallList(db, config).dealers[0];
  B.recordOutcome(db, d.units.map((u) => u.key), "left_message");
  assert.ok(d.units.every((u) => db.listings[u.key].lastOutcome === "left_message"));
  const d2 = B.buildCallList(db, config).dealers[0];
  db.hiddenDealers[d2.dealerKey] = d2.name;
  assert.ok(!B.buildCallList(db, { ...config, dailyListSize: 100 }).dealers.some((x) => x.dealerKey === d2.dealerKey));
  applyObservations(db, [obs(0, { dealer: d2.units[0].dealer, vin: "1FTEX1EP5JF999999" })], config);
  assert.ok(!db.listings["1FTEX1EP5JF999999"], "a hidden dealer's new cars aren't added");
});

test("CSV: one row per car, cells with commas/quotes escaped", () => {
  const db = marketDb();
  const list = B.buildCallList(db, config);
  const lines = B.callListCsv(list).trim().split("\n");
  assert.ok(lines[0].startsWith("Dealer,Phone,City"));
  assert.equal(lines.length, 1 + list.dealers.reduce((n, d) => n + d.units.length, 0));
  const odd = B.callListCsv({ dealers: [{ name: 'Smith, Jones & "Sons"', units: [{ why: ["a"], sources: [] }] }] });
  assert.ok(odd.split("\n")[1].startsWith('"Smith, Jones & ""Sons"""'));
});

test("long-gone cars nobody called are pruned; called ones are kept", () => {
  const db = marketDb(6);
  const [a, b] = Object.values(db.listings);
  a.lastSeenAt = b.lastSeenAt = new Date(Date.now() - 60 * DAY).toISOString();
  b.lastCallAt = new Date().toISOString();
  applyObservations(db, [], config);
  assert.ok(!db.listings[a.key]);
  assert.ok(db.listings[b.key]);
});

test("other sources' dealer names land on the dealers.csv dealer's card", () => {
  const db = freshDb();
  const csv = (i, name, city, state) => obs(i, { source: "dealer", dealer: { name, city, state, zip: null } });
  applyObservations(db, [
    obs(10, { dealer: { name: "Matt Bowers Nissan", city: "D'Iberville", state: "MS" } }), // CarGurus, same scan
    csv(11, "Matt Bowers Nissan of South Mississippi", "D'Iberville", "MS"),
    csv(12, "Matt Bowers Hyundai Gulfport", "Gulfport", "MS"),
    csv(13, "Matt Bowers Hyundai Slidell", "Slidell", "LA"),
    obs(14, { dealer: { name: "Matt Bowers Hyundai", city: "Gulfport", state: "MS" } }),
    obs(15, { dealer: { name: "Matt Bowers Hyundai", city: "Slidell", state: null } }),
    obs(16, { dealer: { name: "Matt Bowers Hyundai", city: null, state: null } }),
    obs(17, { dealer: { name: "Toyota", city: null, state: "MS" } }),
  ], config);
  const key = (i) => db.listings[obs(i).vin].dealerKey;
  assert.equal(key(10), key(11), "short CarGurus name maps onto the dealers.csv name");
  assert.equal(key(14), key(12), "state picks the Mississippi store");
  assert.equal(key(15), key(13), "city breaks the tie");
  assert.notEqual(key(16), key(12), "ambiguous: no merge");
  assert.notEqual(key(16), key(13));
  assert.equal(key(17), "toyota", "one-word names never merge");
});
