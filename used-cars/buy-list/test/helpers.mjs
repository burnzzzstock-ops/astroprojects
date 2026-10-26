// Shared test setup: a throwaway data folder + config, set BEFORE src/ is imported.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function isolate(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buylist-test-"));
  const cfg = {
    zip: "39540", radiusMiles: 100, minDaysListed: 60, maxDaysListed: 365, minPrice: 4000, maxMiles: 175000,
    dailyListSize: 5, excludeSellers: ["example ford", "carmax"], dataDir: path.join(dir, "data"),
    sources: { dealerSites: { file: path.join(dir, "dealers.csv") } },
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg));
  process.env.BUYLIST_CONFIG = path.join(dir, "config.json");
  return dir;
}

// A fake observation as any source would hand it over. All names/phones/VINs are made up.
export function obs(i, over = {}) {
  const dealers = [
    { name: "Example Motors", phone: "(228) 555-0101", city: "Gulfport", state: "MS", zip: "39501" },
    { name: "Sample Auto Sales LLC", phone: "(228) 555-0102", city: "Biloxi", state: "MS", zip: "39530" },
    { name: "Demo Chevrolet", phone: "(251) 555-0103", city: "Mobile", state: "AL", zip: "36602" },
    { name: "CarMax Mobile", phone: "(251) 555-0107", city: "Mobile", state: "AL", zip: "36606" },
  ];
  const cars = [["Ford", "F-150", "XLT"], ["Jeep", "Wrangler", "Sport"], ["Toyota", "Camry", "SE"]];
  const [make, model, trim] = cars[i % cars.length];
  return {
    source: "cargurus", sourceId: `cg${i}`, vin: `1FTEX1EP5JF${String(i).padStart(6, "0")}`,
    year: 2016 + (i % 6), make, model, trim, title: null, price: 15000 + i * 100, prevPrice: null,
    miles: 50000 + i * 1000, daysListed: 60 + i * 3, url: `https://example.com/listing/${i}`, photo: null,
    color: "White", stock: `S${i}`, isNew: false, distance: 5 + i, dealRating: null,
    dealer: { ...dealers[i % dealers.length], street: null, website: null, type: null },
    ...over,
  };
}
