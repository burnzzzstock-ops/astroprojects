// The generic listing extractor, against the shapes real sites use: a CarGurus-style
// feed, schema.org JSON-LD on dealer pages, and a nested dealer-platform API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isolate } from "./helpers.mjs";

isolate();
const { extractListings, parseJsonLoose, normalizeObject } = await import("../src/extract.js");
const { toNumber, parseCsv, dealerKeyOf, zipForCity } = await import("../src/util.js");
const { isHomepage } = await import("../src/sources/dealerSites.js");
const { looksBlocked } = await import("../src/browser.js");

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

test("live CarGurus feed shape (2026-10): bare array, city with state, photo object, expectedPrice isn't the price", () => {
  const feed = [
    { id: 457065290, vin: "1FTEX1EP5JF000011", listingTitle: "2008 Lexus LS 460 L RWD", makeName: "Lexus", modelName: "LS",
      carYear: 2008, price: 12998, expectedPrice: 11800, mileage: 140000, daysOnMarket: 61, sellerType: "DEALER",
      sellerCity: "Gulfport, MS", sellerRegion: "MS", sellerPostalCode: "39501", serviceProviderName: "Example Motors",
      phoneNumberString: "(228) 555-0111", originalPictureData: { url: "https://static.example.com/p-1024x768.jpg" } },
    { id: 457065291, vin: "1FTEX1EP5JF000012", listingTitle: "2016 Ford Fusion SE", makeName: "Ford", modelName: "Fusion",
      carYear: 2016, expectedPrice: 9500, mileage: 98000, daysOnMarket: 61, sellerCity: "Biloxi, MS" },
  ];
  const [a, b] = extractListings(feed);
  assert.equal(a.price, 12998);
  assert.equal(a.daysListed, 61);
  assert.equal(a.dealer.city, "Gulfport");
  assert.equal(a.dealer.state, "MS");
  assert.equal(a.photo, "https://static.example.com/p-1024x768.jpg");
  assert.equal(b.price, null);
  assert.equal(b.dealer.city, "Biloxi");
});

test("DealerOn feed: Vehicle* fields, in-stock date, price from VehiclePriceLibrary when TaggingPrice is 0", () => {
  const lib = Buffer.from("MSRP:0.0;Selling Price:18873.0;reff_Flat Low Price:18873.0;calc_INTERNET PRICE:19822.0").toString("base64");
  const since = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10).replace(/-/g, "/");
  const [l] = extractListings({ DisplayCards: [{ VehicleVin: "1FTEX1EP5JF000013", VehicleYear: 2020, VehicleMake: "Ford", VehicleModel: "Explorer",
    VehicleTrim: "Platinum", VehicleName: "2020 Ford Explorer Platinum", TaggingPrice: 0, VehicleInternetPrice: 0, VehiclePriceLibrary: lib,
    Mileage: "66,585 mi", VehicleStockNumber: "5-1076A", VehicleTaggingInventoryDate: since, VehicleCondition: "Used",
    VehicleDetailUrl: "https://dealer.example/used-Mobile-2020-Ford-Explorer-Platinum-1FTEX1EP5JF000013" }] });
  assert.deepEqual([l.vin, l.year, l.make, l.model, l.trim], ["1FTEX1EP5JF000013", 2020, "Ford", "Explorer", "Platinum"]);
  assert.equal(l.price, 18873);
  assert.equal(l.miles, 66585);
  assert.equal(l.stock, "5-1076A");
  assert.ok(Math.abs(l.daysListed - 40) <= 1);
  assert.equal(l.isNew, false);
});

test("AutoCorner feed (/json/srp_vehicles.json): vehicle_* fields", () => {
  const [l] = extractListings({ total_count: 1, filtered_vehicles: [{ vehicle_id: "F5518A60", vehicle_stocknum: "P198",
    vehicle_caption: "2012 Gmc Acadia SLT-1 AWD", vehicle_vin: "1FTEX1EP5JF000014", vehicle_year: "2012", vehicle_make: "Gmc",
    vehicle_model: "Acadia", vehicle_trim: "SLT-1 AWD", vehicle_miles: "147306", vehicle_price: "5888", vehicle_sale_price: "" }] });
  assert.deepEqual([l.vin, l.year, l.make, l.model, l.trim, l.title], ["1FTEX1EP5JF000014", 2012, "Gmc", "Acadia", "SLT-1 AWD", "2012 Gmc Acadia SLT-1 AWD"]);
  assert.deepEqual([l.price, l.miles, l.stock], [5888, 147306, "P198"]);
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

test("bot walls vs a normal page that loads reCAPTCHA for its contact form", () => {
  const recaptcha = `<html><head><script src="https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js"></script></head>
    <body><input type="hidden" id="google_recaptcha_token" value=""><div class="g-recaptcha"></div></body></html>`;
  assert.equal(looksBlocked("Cars For Sale in Gulfport, MS - Example Motors", recaptcha), false);
  const widgets = `<html><head><style data-styles="">offer-refresh,dealer-listing,captcha-field,dealer-boost{visibility:hidden}</style></head><body>Used Kia</body></html>`;
  assert.equal(looksBlocked("Used Kia Sales in Gulfport", widgets), false);
  assert.equal(looksBlocked("Example Motors", "<html><body><h1>Please verify you are human</h1></body></html>"), true);
  const datadome = `<html><head><title>example.com</title></head><body><script src="https://ct.captcha-delivery.com/c.js"></script>
    <iframe src="https://geo.captcha-delivery.com/captcha/?x=1" title="DataDome CAPTCHA"></iframe></body></html>`;
  assert.equal(looksBlocked("example.com", datadome), true);
  assert.equal(looksBlocked("Access Denied", "<html></html>"), true);
  assert.equal(looksBlocked("Just a moment...", "<html></html>"), true);
});

test("ZIP from city/state when a dealer row has none", () => {
  assert.equal(zipForCity("D'Iberville", "MS"), "39540");
  assert.equal(zipForCity("Bay St. Louis", "MS"), "39520");
  assert.equal(zipForCity("Hattiesburg", "ms"), "39401");
  assert.equal(zipForCity("Nowhere Town", "MS"), null);
  assert.equal(zipForCity("LaPlace", "LA"), "70068");
});
