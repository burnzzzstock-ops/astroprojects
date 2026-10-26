// The UCM's filters: buckets, matching (any-of within a category, all categories),
// counts under the other filters, and the call list following a filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isolate, obs } from "./helpers.mjs";

isolate();
const { config } = await import("../src/config.js");
const F = await import("../src/filters.js");
const { applyObservations } = await import("../src/listings.js");
const B = await import("../src/buyList.js");

const freshDb = () => ({ listings: {}, calls: [], scans: [], hiddenDealers: {}, marketcheckCalls: {} });
const lot = (name, state = "MS", city = "Gulfport") => ({ name, phone: "(228) 555-0101", city, state, zip: "39501" });

test("buckets: body, drivetrain, fuel, engine, colors, features, from the site's words or the title", () => {
  assert.equal(F.bodyOf({ body: "Pickup Truck" }), "Truck");
  assert.equal(F.bodyOf({ body: "SUV / Crossover" }), "SUV");
  assert.equal(F.bodyOf({ body: null, model: "F-150", title: "2019 Ford F-150 XLT" }), "Truck", "known truck model");
  assert.equal(F.bodyOf({ body: "Minivan" }), "Minivan");
  assert.equal(F.driveOf({ drive: "Four-Wheel Drive" }), "4WD");
  assert.equal(F.driveOf({ drive: null, trim: "SEL AWD" }), "AWD");
  assert.equal(F.driveOf({ drive: "https://schema.org/FrontWheelDriveConfiguration" }), "FWD");
  assert.equal(F.fuelOf({ fuel: "Flex Fuel Vehicle" }), "Flex fuel");
  assert.equal(F.fuelOf({ fuel: null, title: "2020 Ford F-250 Lariat Diesel" }), "Diesel");
  assert.equal(F.fuelOf({ fuel: null, title: "2020 Ford Escape SE" }), null, "a plain title says nothing about fuel");
  assert.equal(F.engineOf({ engine: "400 hp 3.5L V6" }), "6 cylinders");
  assert.equal(F.engineOf({ engine: "2.5L H-4 direct injection" }), "4 cylinders");
  assert.equal(F.transOf({ trans: "Continuously Variable Transmission" }), "Automatic");
  assert.equal(F.colorOf({ colorGroup: "WHITE", color: "Star White Metallic Tri-Coat" }), "White");
  assert.equal(F.colorOf({ color: "Agate Black Metallic" }), "Black");
  assert.equal(F.intColorOf({ intColor: "Black (Medium Earth Gray)" }), "Black");
  assert.deepEqual(F.featuresOf({ features: ["Leather Seats", "Sunroof/Moonroof", "Apple CarPlay", "Bluetooth®"] }),
    ["Leather seats", "Sunroof / moonroof", "Bluetooth", "CarPlay / Android Auto"]);
});

test("cleanFilter keeps known categories with sane values only", () => {
  assert.deepEqual(F.cleanFilter({ make: ["Ford", "", "Ford", "Toyota"], nope: ["x"], price: ["10000", ""], cpo: "true", hasPrice: false, q: "  lariat " }),
    { make: ["Ford", "Toyota"], price: [10000, null], cpo: true, q: "lariat" });
  assert.deepEqual(F.parseFilter("not json"), {});
  assert.deepEqual(F.cleanFilter({ miles: ["", null] }), {}, "an empty range is no filter");
});

test("matching: any pick within a category, every category, features need all, ranges, flags", () => {
  const u = { make: "FORD", model: "F-150", body: "Pickup Truck", price: 32000, miles: 58000, days: 120, distance: 12,
    cpo: false, features: ["Leather Seats", "Bluetooth"], dealer: { name: "Example Motors", state: "MS", city: "Gulfport" }, seen: { cargurus: "x" } };
  assert.ok(F.matches(u, { make: ["Toyota", "Ford"] }), "case doesn't matter; any of the picks");
  assert.ok(!F.matches(u, { make: ["Ford"], body: ["SUV"] }), "every category must match");
  assert.ok(F.matches(u, { make: ["Ford"], body: ["Truck", "SUV"], price: [30000, 35000], miles: [null, 80000] }));
  assert.ok(!F.matches(u, { price: [null, 30000] }));
  assert.ok(F.matches(u, { features: ["Leather seats", "Bluetooth"] }));
  assert.ok(!F.matches(u, { features: ["Leather seats", "Navigation"] }), "features: has all picked");
  assert.ok(!F.matches(u, { cpo: true }));
  assert.ok(!F.matches({ ...u, price: null }, { price: [10000, null] }), "no price can't be inside a price range");
  assert.ok(F.matches(u, { source: ["CarGurus"], state: ["ms"], q: "f-150 example" }));
});

test("counts: each category counted under the other filters; picked options stay listed", () => {
  const units = [
    { make: "Ford", body: "Pickup Truck", price: 30000 }, { make: "Ford", body: "SUV / Crossover", price: 25000 },
    { make: "Toyota", body: "Pickup Truck", price: 35000 }, { make: "Honda", body: "Sedan", price: 18000 },
  ];
  const r = F.facetCounts(units, { make: ["Ford"], body: ["Truck"] });
  assert.equal(r.total, 1, "only the Ford truck matches both");
  assert.deepEqual(r.facets.make.opts, [{ v: "Ford", n: 1 }, { v: "Toyota", n: 1 }], "makes among trucks");
  assert.deepEqual(r.facets.body.opts, [{ v: "SUV", n: 1 }, { v: "Truck", n: 1 }], "body styles among Fords");
  assert.deepEqual([r.facets.price.min, r.facets.price.max], [30000, 30000]);
  const none = F.facetCounts(units, { make: ["Kia"] });
  assert.equal(none.total, 0);
  assert.ok(none.facets.make.opts.some((o) => o.v === "Kia" && o.n === 0), "a pick with no cars still shows (so it can be unpicked)");
});

test("the call list and Top 10 follow the filter; no filter = everything aged in the store's order", () => {
  const db = freshDb();
  applyObservations(db, [
    obs(0, { dealer: lot("Example Motors"), make: "Ford", model: "F-150", body: "Pickup Truck", miles: 50000, daysListed: 120, distance: 5, price: 30000 }),
    obs(1, { dealer: lot("Sample Auto Sales", "AL", "Mobile"), make: "Toyota", model: "Tacoma", body: "Pickup Truck", miles: 40000, daysListed: 200, distance: 60, price: 28000 }),
    obs(2, { dealer: lot("Demo Chevrolet", "LA", "Slidell"), make: "Chevrolet", model: "Malibu", body: "Sedan", miles: 30000, daysListed: 90, distance: 150, price: 16000 }),
  ], { ...config, radiusMiles: 200 });
  const cfg = { ...config, radiusMiles: 200, focusMakes: ["Ford"], focusUnderMiles: 80000 };
  assert.deepEqual(B.buildCallList(db, cfg).top.map((u) => u.model), ["F-150", "Tacoma", "Malibu"], "everything within 200 mi, Ford first");
  assert.deepEqual(B.buildCallList(db, cfg, Date.now(), { body: ["Truck"], state: ["AL", "LA"] }).top.map((u) => u.model), ["Tacoma"]);
  const s = B.filterSummary(db, cfg, { body: ["Truck"] });
  assert.equal(s.total, 2);
  assert.equal(s.pool, 3);
  assert.ok(s.defs.length >= 24, `dozens of categories (${s.defs.length})`);
  assert.equal(B.browseListings(db, cfg, { filter: { distance: [100, null] } }).rows[0].model, "Malibu");
});
