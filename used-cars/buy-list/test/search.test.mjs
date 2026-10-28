// Forgiving search: a misspelled word falls back to the closest words on the list, so a
// typo never hides a car; exact words, numbers and VINs still match only as typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isolate, obs } from "./helpers.mjs";

isolate();
const { config } = await import("../src/config.js");
const { applyObservations } = await import("../src/listings.js");
const B = await import("../src/buyList.js");
const S = await import("../src/search.js");

// One plain lot, so the dealer's name never matches a search by itself.
const dealer = { name: "Example Motors", phone: "(228) 555-0101", city: "Gulfport", state: "MS", zip: "39501", type: null };
const lot = () => {
  const db = { listings: {}, calls: [], scans: [], hiddenDealers: {}, marketcheckCalls: {} };
  applyObservations(db, [
    ["Toyota", "Tacoma", "TRD Off-Road"], ["Chevrolet", "Silverado 1500", "LT"], ["Ford", "F-150", "Lariat"],
    ["Toyota", "Camry", "SE"], ["Chevrolet", "Camaro", "1LT"], ["Jeep", "Grand Cherokee", "Limited"],
  ].map(([make, model, trim], i) => obs(i, { make, model, trim, dealer })), config);
  return db;
};
const models = (r) => r.rows.map((u) => u.model).sort();
const search = (db, q, extra = {}) => B.browseListings(db, config, { q, ...extra });

test("typos count like a person would: one per wrong, missing, extra or swapped letter", () => {
  assert.equal(S.typos("tacomaa", "tacoma"), 1);
  assert.equal(S.typos("silvarado", "silverado"), 1);
  assert.equal(S.typos("tocama", "tacoma"), 2);
  assert.equal(S.typos("camyr", "camry"), 1, "two letters swapped = one typo");
  assert.equal(S.typos("wrangler", "tacoma", 2), 3, "past the limit it stops counting");
});

test("a misspelled model still finds the car, and says what it searched instead", () => {
  const db = lot();
  for (const [typed, want] of [["tacomaa", "Tacoma"], ["silvarado", "Silverado"], ["chrokee", "Cherokee"], ["lariet", "Lariat"], ["silvr", "Silverado"]]) {
    const r = search(db, typed);
    assert.equal(r.total, 1, typed);
    assert.deepEqual(r.fixes, [{ from: typed, to: [want] }], typed);
  }
  const r = search(db, "toyta tacoma");
  assert.deepEqual(models(r), ["Tacoma"], "one bad word in a longer search is fixed, the good one still narrows it");
  assert.deepEqual(r.fixes, [{ from: "toyta", to: ["Toyota"] }]);
});

test("nicknames and the ways people write F-150 all match", () => {
  const db = lot();
  assert.deepEqual(models(search(db, "chevy")), ["Camaro", "Silverado 1500"]);
  assert.deepEqual(search(db, "chevy").fixes, [{ from: "chevy", to: ["Chevrolet"] }]);
  for (const typed of ["f150", "F-150", "f 150", "F150 lariat"]) assert.deepEqual(models(search(db, typed)), ["F-150"], typed);
  assert.deepEqual(search(db, "f150").fixes, [], "not a typo: no note");
  assert.deepEqual(models(search(db, `${obs(2).year} f 150`)), ["F-150"], "a year in front doesn't get in the way");
  assert.deepEqual(models(search(db, "camry se")), ["Camry"], "a short trim at the end stays its own word");
});

test("exact words don't pull in look-alikes; numbers and nonsense aren't guessed at", () => {
  const db = lot();
  assert.deepEqual(models(search(db, "camry")), ["Camry"], "a real Camry never adds the Camaro");
  assert.deepEqual(search(db, "camry").fixes, []);
  assert.deepEqual(models(search(db, "camro")).length, 2, "but a word that's neither shows both");
  const year = obs(0).year;
  assert.equal(search(db, String(year + 30)).total, 0, "a year that isn't there matches nothing, no guessing");
  const r = search(db, "zzqxv");
  assert.equal(r.total, 0);
  assert.deepEqual(r.fixes, [{ from: "zzqxv", to: [] }], "nothing close: the page says check the spelling");
  assert.equal(search(db, obs(2).vin.slice(-6)).total, 1, "part of a VIN still finds it");
});

test("the filter's search box is forgiving too: today's list, the counts and Search all cars agree", () => {
  const db = lot();
  const f = { q: "tacomaa" };
  const all = B.browseListings(db, config, { filter: f });
  assert.deepEqual(models(all), ["Tacoma"]);
  assert.deepEqual(all.fixes, [], "the filter's swap is reported once, by the filter summary");
  const sum = B.filterSummary(db, config, f);
  assert.equal(sum.total, 1);
  assert.deepEqual(sum.fixes, [{ from: "tacomaa", to: ["Tacoma"] }]);
  const today = B.buildCallList(db, { ...config, dailyListSize: 50 }, Date.now(), f);
  assert.deepEqual(today.dealers.flatMap((d) => d.units.map((u) => u.model)), ["Tacoma"]);
});
