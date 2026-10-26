// End-to-end scan in a real (headless) browser against FAKE local sites that copy
// the shapes the real ones use: a CarGurus-style data feed and search page, and
// dealer websites of four kinds (data feed with paging, JSON-LD, plain HTML with a
// "Load more" button, and a broken one). No real site is contacted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { isolate } from "./helpers.mjs";

const dir = isolate({
  sources: {
    cargurus: { enabled: true, maxPages: 20, pageDelayMs: 0 },
    marketcheck: { enabled: true, apiKey: "test-key", maxPages: 2, monthlyCallCap: 450 },
    dealerSites: { enabled: true, file: path.join(process.env.TMPDIR || "/tmp", "unused.csv"), maxPagesPerDealer: 6, pageDelayMs: 0 },
  },
});
const { config } = await import("../src/config.js");
const { runScan } = await import("../src/scan.js");
const { readDb } = await import("../src/store.js");
const { buildCallList } = await import("../src/buyList.js");
const { launchBrowser } = await import("../src/browser.js");
const { fetchCarGurus } = await import("../src/sources/cargurus.js");

let server, base, feedHits = 0;
const vin = (p, i) => `1FTEX1EP5${p}${String(i).padStart(6, "0")}`; // 17 chars, no I/O/Q
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const SELLERS = [["Example Motors", "39501", "Gulfport"], ["Sample Auto Sales", "39530", "Biloxi"], ["Demo Chevrolet", "36602", "Mobile"]];

// CarGurus-style feed: 400 cars, oldest first (days 400 → 1)
const CG = Array.from({ length: 400 }, (_, i) => {
  const [name, zip, city] = SELLERS[i % 3];
  return {
    id: 900000 + i, vin: vin("CG", i), listingTitle: `${2014 + (i % 9)} Ford F-150 XLT`, price: 18000 + i * 10,
    mileage: 60000 + i * 100, daysOnMarket: Math.max(1, Math.round(400 - i * 1.5)), serviceProviderName: name,
    phoneNumberString: `(228) 555-01${String(i % 3).padStart(2, "0")}`, sellerCity: city, sellerPostalCode: zip, distance: 10 + (i % 50),
  };
});
const vehicles1 = (page) => Array.from({ length: 4 }, (_, i) => ({
  vin: vin("D1", page * 10 + i), year: 2018, make: "Toyota", model: "Tacoma", trim: "SR5", internetPrice: `$${(27000 + i * 500).toLocaleString()}`,
  odometer: 70000 + i, inStockDate: ago(120 + i), isNew: i === 3, vdpUrl: `/dealer1/vdp/${page}-${i}`,
}));

before(async () => {
  const app = express();
  app.get("/", (req, res) => res.send("<html><title>Home</title><body>ok</body></html>"));
  app.get("/Cars/searchResults.action", (req, res) => {
    feedHits++;
    const off = Number(req.query.offset), n = Number(req.query.maxResults);
    res.json({ listings: CG.slice(off, off + n) });
  });
  // a CarGurus-like site whose feed is gone: the search page loads data + has a Next button
  app.get("/cg2/", (req, res) => res.send("<html><title>Home</title><body>ok</body></html>"));
  app.get("/cg2/Cars/searchResults.action", (req, res) => res.status(404).send("not found"));
  app.get("/cg2/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action", (req, res) => res.send(`<html><body>
    <div id="r"></div><button aria-label="Next page" id="nx">Next</button>
    <script>
      let p = 1;
      async function load() {
        const j = await (await fetch('/cg2/api/page?n=' + p)).json();
        document.getElementById('r').textContent = j.listings.length + ' cars';
        if (p >= 3) document.getElementById('nx').remove();
      }
      document.getElementById('nx').onclick = () => { p++; load(); };
      load();
    </script></body></html>`));
  app.get("/cg2/api/page", (req, res) => res.json({ listings: CG.slice((req.query.n - 1) * 15, req.query.n * 15) }));
  // dealer 1: inventory API with a Next button
  app.get("/dealer1/used", (req, res) => res.send(`<html><body><div id="cars"></div><button aria-label="Next page" id="nx">Next</button>
    <script>
      let p = 1;
      async function load() { const j = await (await fetch('/dealer1/api/inventory?page=' + p)).json(); document.getElementById('cars').textContent = JSON.stringify(j).length; if (p >= 2) document.getElementById('nx').remove(); }
      document.getElementById('nx').onclick = () => { p++; load(); };
      load();
    </script></body></html>`));
  app.get("/dealer1/api/inventory", (req, res) => res.json({ data: { vehicles: vehicles1(Number(req.query.page)) } }));
  // dealer 2: JSON-LD only
  app.get("/dealer2/used", (req, res) => res.send(`<html><body>
    <script type="application/ld+json">${JSON.stringify({ "@type": "Car", name: "2016 Honda Odyssey EX-L", vehicleIdentificationNumber: vin("D2", 1), mileageFromOdometer: { value: "112,300" }, offers: { price: "15,900" }, url: "/dealer2/vdp/1", datePosted: ago(95) })}</script>
    <script type="application/ld+json">${JSON.stringify([{ "@type": "Car", name: "2017 Chevrolet Tahoe LT", vehicleIdentificationNumber: vin("D2", 2), mileageFromOdometer: { value: 98000 }, offers: { price: 29900 }, datePosted: ago(200) }])}</script>
    </body></html>`));
  // dealer 3: plain HTML cards (no data feed), more behind "Load more"
  const card = (i, days) => `<div class="card"><h3>201${i} Honda Accord EX</h3><p>$1${i},500</p><p>9${i},000 miles</p><p>VIN: ${vin("D3", i)}</p><a href="/dealer3/vdp/${i}">Details</a></div>`;
  app.get("/dealer3/used", (req, res) => res.send(`<html><body><div id="list">${card(1)}${card(2)}</div>
    <button id="more">Load more</button>
    <script>document.getElementById('more').onclick = () => { document.getElementById('list').insertAdjacentHTML('beforeend', ${JSON.stringify(card(3) + card(4))}); document.getElementById('more').remove(); };</script>
    </body></html>`));
  // dealer 5: only the homepage is known; the tool must find "Used Vehicles" itself
  app.get("/dealer5/", (req, res) => res.send(`<html><body><nav>
    <a href="/dealer5/new-inventory">New Inventory</a> <a href="https://www.cars.com/shopping/used">Used cars on Cars.com</a>
    <a href="/dealer5/used-vehicles/">Used Vehicles</a> <a href="/dealer5/service">Service</a></nav>
    <script type="application/ld+json">${JSON.stringify({ "@type": "Car", name: "2026 Kia Sorento", vehicleIdentificationNumber: vin("D5", 9), offers: { price: 36000 }, itemCondition: "https://schema.org/NewCondition" })}</script>
    </body></html>`));
  app.get("/dealer5/used-vehicles/", (req, res) => res.send(`<html><body>
    <script type="application/ld+json">${JSON.stringify([1, 2].map((i) => ({ "@type": "Car", name: `2017 Kia Sorento LX`, vehicleIdentificationNumber: vin("D5", i), mileageFromOdometer: { value: 90000 + i }, offers: { price: 14000 + i } })))}</script>
    </body></html>`));
  app.get("/broken", (req, res) => res.status(500).send("down"));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const csv = path.join(dir, "dealers.csv");
  fs.writeFileSync(csv, [
    "name,phone,city,state,zip,used_inventory_url",
    `Example Imports,(228) 555-0120,Gulfport,MS,39501,${base}/dealer1/used`,
    `"Smith, Jones Motors",(228) 555-0121,Biloxi,MS,39530,${base}/dealer2/used`,
    `Placeholder Cars,(985) 555-0122,Slidell,LA,70458,${base}/dealer3/used`,
    `Broken Site Auto,(228) 555-0123,Gulfport,MS,39501,${base}/broken`,
    `Homepage Only Kia,(228) 555-0124,Gulfport,MS,39503,${base}/dealer5/`,
  ].join("\n"));
  config.sources.dealerSites.file = csv;
});
after(() => server?.close());

const fakeMarketcheck = async () => ({
  ok: true, status: 200,
  json: async () => ({
    num_found: 2,
    listings: [
      { id: "mc1", vin: vin("CG", 0), price: 17500, miles: 60000, dom: 390, build: { year: 2014, make: "Ford", model: "F-150" }, dealer: { name: "Example Motors", phone: "(228) 555-0100", zip: "39501" }, dist: 10 },
      { id: "mc2", vin: vin("MC", 2), price: 21000, miles: 45000, dom: 150, build: { year: 2019, make: "Nissan", model: "Frontier" }, dealer: { name: "Fictional Imports", zip: "39564" }, dist: 4 },
    ],
  }),
});

test("full scan: all three sources, merged, ranked", async () => {
  const scan = await runScan({ cargurusBase: base, fetchImpl: fakeMarketcheck, log: () => {} });
  const s = scan.sources;

  assert.ok(s.cargurus.ok, s.cargurus.error);
  assert.equal(s.cargurus.method, "feed");
  assert.equal(feedHits, 6, "stops paging once results drop below 60 days (oldest-first sort)");
  assert.equal(s.cargurus.found, 300);

  assert.ok(s.marketcheck.ok);
  assert.equal(s.marketcheck.apiCalls, 1);

  assert.ok(s.dealerSites.ok);
  assert.equal(s.dealerSites.dealerCount, 5);
  assert.equal(s.dealerSites.dealersOk, 4);
  assert.equal(s.dealerSites.failed[0].name, "Broken Site Auto");

  const db = readDb();
  const L = db.listings;
  // dealer 1: 2 pages × 3 used (the new one skipped), days from the in-stock date, CSV contact info
  const d1 = Object.values(L).filter((l) => l.dealer.name === "Example Imports");
  assert.equal(d1.length, 6);
  assert.ok(d1.every((l) => l.dealer.phone === "(228) 555-0120" && l.distance > 0 && l.distance < 20));
  assert.ok(d1[0].urls.dealer.startsWith(`${base}/dealer1/vdp/`), "relative links resolved");
  // dealer 2: JSON-LD
  assert.ok(L[vin("D2", 1)] && L[vin("D2", 2)]);
  assert.equal(L[vin("D2", 1)].price, 15900);
  // dealer 3: plain HTML, including the cards behind "Load more"
  assert.equal(Object.values(L).filter((l) => l.dealer.name === "Placeholder Cars").length, 4);
  assert.equal(L[vin("D3", 3)].price, 13500);
  // dealer 5: found "Used Vehicles" from the homepage (not the new car, not the off-site link)
  const d5 = Object.values(L).filter((l) => l.dealer.name === "Homepage Only Kia");
  assert.deepEqual(d5.map((l) => l.vin).sort(), [vin("D5", 1), vin("D5", 2)]);
  // same car on CarGurus + Marketcheck = one record seen by both
  assert.deepEqual(Object.keys(L[vin("CG", 0)].seen).sort(), ["cargurus", "marketcheck"]);
  assert.equal(db.marketcheckCalls[new Date().toISOString().slice(0, 7)], 1);

  const list = buildCallList(db, config);
  assert.ok(list.dealers.length > 0);
  assert.ok(list.dealers.flatMap((d) => d.units).every((u) => u.days >= 60 && u.days <= 365));
  assert.ok(!fs.existsSync(path.join(config.dataDir, "scan.lock")), "lock released");
});

test("CarGurus fallback: when the feed is gone, read the search page and click Next", async () => {
  const { browser, context } = await launchBrowser();
  try {
    const r = await fetchCarGurus(config, { context, base: `${base}/cg2`, debugDir: path.join(dir, "debug") });
    assert.equal(r.method, "page");
    assert.equal(r.listings.length, 45, "3 pages × 15");
    assert.ok(r.listings.every((l) => l.source === "cargurus" && l.url));
  } finally {
    await browser.close();
  }
});

test("CarGurus blocked: clear error + debug files saved", async () => {
  const app = express();
  app.get("/", (req, res) => res.status(403).send("<html><title>Access Denied</title></html>"));
  const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const { browser, context } = await launchBrowser();
  try {
    const debugDir = path.join(dir, "debug-blocked");
    await assert.rejects(
      fetchCarGurus(config, { context, base: `http://127.0.0.1:${srv.address().port}`, debugDir }),
      /blocked/,
    );
    assert.ok(fs.readdirSync(debugDir).some((f) => f.endsWith(".html")));
  } finally {
    await browser.close();
    srv.close();
  }
});

test("a dealer site that never finishes loading is dropped, not waited on forever", async () => {
  const { fetchDealerSites } = await import("../src/sources/dealerSites.js");
  const app = express();
  app.get("/hang", () => {}); // never responds
  const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const { browser, context } = await launchBrowser();
  try {
    const cfg = { ...config, sources: { ...config.sources, dealerSites: { ...config.sources.dealerSites, dealerTimeoutMs: 3000 } } };
    const t0 = Date.now();
    const r = await fetchDealerSites(cfg, { context, dealers: [{ name: "Hanging Motors", url: `http://127.0.0.1:${srv.address().port}/hang` }] });
    assert.ok(Date.now() - t0 < 15000);
    assert.equal(r.dealersFailed[0].error, "site took too long to load");
  } finally {
    await browser.close();
    srv.closeAllConnections?.();
    srv.close();
  }
});
