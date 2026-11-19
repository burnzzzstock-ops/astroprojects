// Search the U.S. (src/live.js): the request built from the UCM's picks, states and
// regions, the cars made from CarGurus' answer, shipping, and the end-to-end search
// with a fake CarGurus. No network.
import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../src/live.js");
const { CATALOG } = await import("../src/catalog.js");

const FORD = "m2";
const F150 = CATALOG.find((m) => m.id === FORD).models.find((m) => m.name === "F-150").id;

test("the catalog: CarGurus' makes and models by id, popular makes flagged", () => {
  assert.ok(CATALOG.length > 100);
  const ford = CATALOG.find((m) => m.id === FORD);
  assert.equal(ford.name, "Ford");
  assert.ok(ford.popular);
  assert.match(F150, /^d\d+$/);
  const c = L.liveCatalog();
  assert.equal(c.states.length, 51, "50 states + D.C.");
  assert.ok(c.regions.some((r) => r.name === "Gulf Coast"));
  assert.deepEqual(c.sorts.map((s) => s.key), ["deals", "price", "priceHigh", "miles", "newest", "oldest"]);
});

test("cleanLiveQuery: only real ids, the model must belong to the make, numbers in range, states real", () => {
  const q = L.cleanLiveQuery({ make: FORD, model: F150, yearMin: "2023", yearMax: "2019", priceMin: "$40,000", priceMax: "25000",
    milesMax: "80,000", where: "states", states: ["tx", "ok", "zz", "TX"], sort: "price", page: "3" }, { zip: "39540" });
  assert.deepEqual([q.make, q.model], [FORD, F150]);
  assert.deepEqual([q.yearMin, q.yearMax, q.priceMin, q.priceMax, q.milesMax], [2019, 2023, 25000, 40000, 80000], "swapped into order");
  assert.deepEqual(q.states, ["TX", "OK"]);
  assert.equal(q.where, "states");
  assert.equal(q.page, 3);
  assert.equal(L.cleanLiveQuery({ make: "m999999", model: F150 }).make, null, "unknown make");
  assert.equal(L.cleanLiveQuery({ make: "m1", model: F150 }).model, null, "an F-150 isn't a Chevrolet");
  assert.equal(L.cleanLiveQuery({ where: "states", states: [] }).where, "us", "no states picked = anywhere");
  assert.equal(L.cleanLiveQuery({ zip: "abc" }, { zip: "39540" }).zip, "39540");
  assert.equal(L.cleanLiveQuery({ sort: "nope", page: -2 }).sort, "deals");
  assert.equal(L.parseLiveQuery("not json", { zip: "39540" }).where, "us");
});

test("where to search: anywhere, a ZIP + radius, one state, a region, states far apart", () => {
  assert.deepEqual(L.liveArea(L.cleanLiveQuery({}, { zip: "39540" })), { zip: "39540", distance: 50000, keep: null });
  assert.deepEqual(L.liveArea(L.cleanLiveQuery({ where: "near", zip: "70112", radius: 150 })), { zip: "70112", distance: 150, keep: null });
  const tx = L.liveArea(L.cleanLiveQuery({ where: "states", states: ["TX"] }));
  assert.ok(tx.distance >= 400 && tx.distance <= 700, `Texas fits one circle (${tx.distance} mi)`);
  assert.deepEqual([...tx.keep], ["TX"]);
  const gulf = L.liveArea(L.cleanLiveQuery({ where: "states", states: L.REGIONS.find((r) => r.name === "Gulf Coast").states }));
  assert.ok(gulf.distance < 50000, `the Gulf Coast is one circle (${gulf.distance} mi from ${gulf.zip})`);
  const apart = L.liveArea(L.cleanLiveQuery({ where: "states", states: ["CA", "NY"] }, { zip: "39540" }));
  assert.deepEqual([apart.distance, [...apart.keep].sort()], [50000, ["CA", "NY"]], "too far apart: nationwide, kept to the two states");
});

test("the CarGurus request carries every pick", () => {
  const u = new URL(L.liveSearchUrl(L.cleanLiveQuery({ make: FORD, model: F150, yearMin: 2020, yearMax: 2022, priceMax: 35000,
    milesMax: 60000, where: "near", zip: "70112", radius: 300, sort: "oldest", page: 2 })));
  assert.equal(u.origin + u.pathname, "https://www.cargurus.com/Cars/searchResults.action");
  const p = Object.fromEntries(u.searchParams);
  assert.equal(p["entitySelectingHelper.selectedEntity"], F150, "the model, which already implies the make");
  assert.deepEqual([p.zip, p.distance, p.startYear, p.endYear, p.maxPrice, p.maxMileage], ["70112", "300", "2020", "2022", "35000", "60000"]);
  assert.deepEqual([p.sortType, p.sortDir, p.offset, p.maxResults], ["AGE_IN_DAYS", "DESC", String(2 * L.PAGE), String(L.PAGE)]);
  assert.ok(!("minPrice" in p), "unset limits aren't sent");
  const anyCar = Object.fromEntries(new URL(L.liveSearchUrl(L.cleanLiveQuery({}))).searchParams);
  assert.ok(!("entitySelectingHelper.selectedEntity" in anyCar), "any make = no make sent");
});

test("shipping: nothing nearby, then a rough per-mile price; distance from the store by ZIP area", () => {
  assert.equal(L.shippingEstimate(40), 0, "drive it back");
  assert.equal(L.shippingEstimate(500), 625);
  assert.equal(L.shippingEstimate(1000), 1000);
  assert.equal(L.shippingEstimate(2000), 1500);
  assert.equal(L.shippingEstimate(null), null);
  const houston = L.roadMiles("77002", "39540");
  assert.ok(houston > 380 && houston < 560, `Gulfport to Houston by road, roughly (${houston})`);
  assert.equal(L.roadMiles("39540", "39531"), 0, "same ZIP area");
  assert.equal(L.roadMiles("00000", "39540"), null);
});

// Shaped like the live feed (2026-11), with made-up VINs and 555 phones.
const feed = (cars) => JSON.stringify(cars.map((c, i) => ({
  id: 910000 + i, vin: `1FTEX1EP5JF${String(500 + i).padStart(6, "0")}`, listingTitle: `${c.year} Ford F-150 XLT`, makeName: "Ford",
  modelName: "F-150", carYear: c.year, price: c.price, expectedPrice: c.market, mileage: c.miles, daysOnMarket: c.days,
  bodyTypeName: "Pickup Truck", localizedDriveTrain: "Four-Wheel Drive", serviceProviderName: c.dealer, phoneNumberString: "(555) 010-01" + String(i).padStart(2, "0"),
  sellerCity: `${c.city}, ${c.state}`, sellerRegion: c.state, sellerPostalCode: c.zip, distance: 100, dealRating: "GOOD_PRICE",
})));

test("liveResults: used cars, kept to the picked states, with shipping, delivered price and vs market", () => {
  const text = feed([
    { year: 2021, price: 30000, market: 33000, miles: 50000, days: 40, dealer: "Example Motors", city: "Houston", state: "TX", zip: "77002" },
    { year: 2020, price: 28000, market: 27000, miles: 70000, days: 120, dealer: "Sample Auto Sales", city: "Tulsa", state: "OK", zip: "74103" },
    { year: 2022, price: 41000, market: 40000, miles: 20000, days: 9, dealer: "Demo Ford", city: "Gulfport", state: "MS", zip: "39501" },
  ]);
  const q = L.cleanLiveQuery({ where: "states", states: ["TX", "MS"] }, { zip: "39540" });
  const r = L.liveResults(text, q, { storeZip: "39540" });
  assert.deepEqual(r.rows.map((x) => x.dealer.state), ["TX", "MS"], "Oklahoma wasn't picked");
  const [hou, local] = r.rows;
  assert.equal(hou.days, 40);
  assert.equal(hou.dealer.city, "Houston");
  assert.equal(hou.dealer.phone, "(555) 010-0100");
  assert.ok(hou.shipping > 0 && hou.delivered === 30000 + hou.shipping);
  assert.equal(hou.vsMarket, hou.delivered - 33000);
  assert.match(hou.url, /^https:\/\/www\.cargurus\.com\/details\/910000$/);
  assert.equal(hou.body, "Pickup Truck");
  assert.deepEqual([local.shipping, local.delivered, local.vsMarket], [0, 41000, 1000], "local: drive it back");
  assert.equal(r.more, false, "3 cars came back: that's all of them");
  const cheap = L.liveResults(text, L.cleanLiveQuery({ sort: "price" }), { storeZip: "39540" });
  assert.deepEqual(cheap.rows.map((x) => x.price), [28000, 30000, 41000], "each page in the chosen order");
  const deals = L.liveResults(text, L.cleanLiveQuery({ sort: "deals" }), { storeZip: "39540" });
  assert.deepEqual(deals.rows.map((x) => x.price), [30000, 28000, 41000], "best deals keeps CarGurus' ranking");
  assert.throws(() => L.liveResults("<html>blocked</html>", q), /something other than a list of cars/);
});

test("runLiveSearch: a plain request (no browser headers), friendly errors", async () => {
  let seen = null;
  const ok = async (url, init) => { seen = { url, init }; return new Response(feed([{ year: 2021, price: 30000, market: 31000, miles: 50000, days: 70, dealer: "Example Motors", city: "Houston", state: "TX", zip: "77002" }])); };
  const r = await L.runLiveSearch(L.cleanLiveQuery({ make: FORD }), { fetchImpl: ok, storeZip: "39540" });
  assert.equal(r.rows.length, 1);
  assert.match(seen.url, /entitySelectingHelper\.selectedEntity=m2/);
  assert.equal(seen.init, undefined, "no headers: CarGurus refuses requests dressed up as a browser");
  await assert.rejects(L.runLiveSearch(L.cleanLiveQuery({}), { fetchImpl: async () => new Response("", { status: 406 }) }), /didn't answer the search \(HTTP 406\)/);
  await assert.rejects(L.runLiveSearch(L.cleanLiveQuery({}), { fetchImpl: async () => { throw new Error("offline"); } }), /couldn't be reached/);
});
