// The generic listing extractor, against the shapes real sites use: a CarGurus-style
// feed, schema.org JSON-LD on dealer pages, and a nested dealer-platform API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isolate } from "./helpers.mjs";

isolate();
const { extractListings, parseJsonLoose, normalizeObject } = await import("../src/extract.js");
const { toNumber, parseCsv, dealerKeyOf } = await import("../src/util.js");
const { zipForCity } = await import("../src/geo.js");
const { isHomepage } = await import("../src/sources/dealerSites.js");

test("CarGurus-style feed: price, miles, days listed, seller, distance, deal rating", () => {
  const feed = {
    listings: [{
      id: 402358133, vin: "1FTEX1EP5JF000001", listingTitle: "2018 Ford F-150 XLT", price: 24995, mileage: 80000,
      daysOnMarket: 143, serviceProviderName: "Example Motors", phoneNumberString: "(228) 555-0101",
      sellerCity: "Gulfport", sellerRegion: "MS", sellerPostalCode: "39501", distance: 9.4, dealRating: "GOOD_PRICE",
    }],
  };
  const [l] = extractListings(feed);
  assert.equal(l.vin, "1FTEX1EP5JF000001");
  assert.deepEqual([l.year, l.make, l.model], [2018, "Ford", "F-150"]);
  assert.equal(l.price, 24995);
  assert.equal(l.miles, 80000);
  assert.equal(l.daysListed, 143);
  assert.equal(l.dealer.name, "Example Motors");
  assert.equal(l.dealer.phone, "(228) 555-0101");
  assert.equal(l.dealer.city, "Gulfport");
  assert.equal(l.dealer.zip, "39501");
  assert.equal(l.distance, 9);
  assert.equal(l.dealRating, "GOOD_PRICE");
  assert.equal(l.sourceId, "402358133");
});

test("schema.org JSON-LD car on a dealer page (strings with $ and commas, nested offers/seller)", () => {
  const ld = parseJsonLoose(JSON.stringify({
    "@context": "https://schema.org", "@type": "Car", name: "2019 Jeep Wrangler Sport",
    vehicleIdentificationNumber: "1FTEX1EP5JF000002", brand: { "@type": "Brand", name: "Jeep" }, model: "Wrangler",
    vehicleModelDate: "2019", mileageFromOdometer: { value: "71,200", unitCode: "SMI" }, url: "/used/2",
    itemCondition: "https://schema.org/UsedCondition", image: ["https://example.com/p.jpg"],
    offers: { "@type": "Offer", price: "28,950", seller: { name: "Sample Auto", telephone: "(228) 555-0102", address: { addressLocality: "Biloxi", postalCode: "39530" } } },
  }));
  const [l] = extractListings(ld);
  assert.equal(l.make, "Jeep");
  assert.equal(l.model, "Wrangler");
  assert.equal(l.year, 2019);
  assert.equal(l.price, 28950);
  assert.equal(l.miles, 71200);
  assert.equal(l.isNew, false);
  assert.equal(l.url, "/used/2");
  assert.equal(l.photo, "https://example.com/p.jpg");
  assert.equal(l.dealer.name, "Sample Auto");
  assert.equal(l.dealer.phone, "(228) 555-0102");
  assert.equal(l.dealer.city, "Biloxi");
});

test("new cars are flagged so they can be skipped", () => {
  const [l] = extractListings({ "@type": "Car", vehicleIdentificationNumber: "1FTEX1EP5JF000003", name: "2025 Ford Escape", offers: { price: 31000 }, itemCondition: "https://schema.org/NewCondition" });
  assert.equal(l.isNew, true);
  const [m] = extractListings([{ vin: "1FTEX1EP5JF000004", year: 2025, make: "Ford", model: "Edge", price: 39000, isNew: true }]);
  assert.equal(m.isNew, true);
});

test("nested dealer-platform API with an in-stock date → days listed from the date", () => {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const api = { data: { results: { vehicles: [{ vin: "1FTEX1EP5JF000005", year: 2020, make: "Toyota", model: "Camry", trim: "SE", internetPrice: "$19,450", odometer: 41000, inStockDate: since }] } } };
  const [l] = extractListings(api);
  assert.equal(l.trim, "SE");
  assert.equal(l.price, 19450);
  assert.equal(l.daysListed, 90);
});

test("no false positives: random objects with a year or a VIN alone aren't cars", () => {
  assert.equal(extractListings({ user: { name: "x", year: 2020 }, settings: { price: 5 } }).length, 0);
  assert.equal(extractListings({ saved: [{ vin: "1FTEX1EP5JF000006" }] }).length, 0);
  assert.equal(extractListings({ vin: "NOT-A-VIN", price: 1000, year: 2019, make: "Ford" }).length, 0);
});

test("duplicates across one payload are collapsed", () => {
  const car = { vin: "1FTEX1EP5JF000007", year: 2017, make: "Honda", model: "Odyssey", price: 18000 };
  assert.equal(extractListings({ a: [car], b: [car] }).length, 1);
});

test("title-only listings still get year/make/model", () => {
  const l = normalizeObject({ title: "2015 GMC Sierra 1500 SLE", price: "$21,500", miles: "128,700" });
  assert.deepEqual([l.year, l.make, l.model, l.price, l.miles], [2015, "GMC", "Sierra", 21500, 128700]);
});

test("helpers: money parsing, JSON guards, CSV, dealer keys", () => {
  assert.equal(toNumber("$24,995"), 24995);
  assert.equal(toNumber({ value: "71,200" }), 71200);
  assert.equal(toNumber("call for price"), null);
  assert.deepEqual(parseJsonLoose(")]}'\n{\"a\":1}"), { a: 1 });
  assert.equal(parseJsonLoose("<html>"), null);
  const rows = parseCsv('name,phone,used_inventory_url\n"Smith, Jones Motors",(228) 555-0110,https://example.com/used\n');
  assert.equal(rows[0].name, "Smith, Jones Motors");
  assert.equal(rows[0].used_inventory_url, "https://example.com/used");
  assert.equal(dealerKeyOf({ name: "Example Motors LLC" }, "k1"), dealerKeyOf({ name: "Example Motors" }, "k2"));
  assert.equal(dealerKeyOf({ name: "Private Seller" }, "k3"), "private:k3");
  assert.notEqual(dealerKeyOf({ type: "private", name: "Bob" }, "a"), dealerKeyOf({ type: "private", name: "Bob" }, "b"));
});

test("homepage vs inventory links in dealers.csv", () => {
  assert.equal(isHomepage("https://www.example-motors.com/"), true);
  assert.equal(isHomepage("https://example-motors.com"), true);
  assert.equal(isHomepage("https://www.example-motors.com/used-inventory/index.htm"), false);
  assert.equal(isHomepage("https://www.example-motors.com/searchused.aspx"), false);
  assert.equal(isHomepage("https://www.example-motors.com/inventory"), false);
  assert.equal(isHomepage("https://www.example-motors.com/pre-owned/"), false);
});

test("ZIP from city/state when a dealer row has none", () => {
  assert.equal(zipForCity("D'Iberville", "MS"), "39540");
  assert.equal(zipForCity("Bay St. Louis", "MS"), "39520");
  assert.equal(zipForCity("Hattiesburg", "ms"), "39401");
  assert.equal(zipForCity("Nowhere Town", "MS"), null);
  assert.equal(zipForCity("LaPlace", "LA"), "70068");
});
