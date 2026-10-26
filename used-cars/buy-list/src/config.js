// Settings live in config.json next to package.json (copied from config.example.json
// by setup.bat). Anything missing falls back to the defaults below, so an old
// config.json keeps working when new settings are added.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  zip: "39540",
  radiusMiles: 100,
  minDaysListed: 60,          // "listed a long time"
  maxDaysListed: 365,         // older than this is usually a stale/zombie listing
  minPrice: 4000,
  maxMiles: 175000,
  dailyListSize: 25,          // units on today's call list
  scanTime: "06:00",          // local PC time
  scanDays: [1, 2, 3, 4, 5, 6], // 0 = Sunday
  // Seller-name fragments to never list: your own store + retail chains that don't wholesale.
  excludeSellers: ["carmax", "carvana", "vroom", "enterprise car sales", "hertz car sales"],
  port: 4400,
  allowPhoneAccess: false,    // true = phones on the store Wi-Fi can open it (needs accessPin)
  accessPin: "",
  browser: {
    headless: true,           // false = show the browser window (helps if a site asks "are you human?")
    executablePath: "",       // leave blank: uses installed Google Chrome, else Playwright's Chromium
  },
  sources: {
    cargurus: { enabled: true, maxPages: 60, pageDelayMs: 2500 },
    marketcheck: { enabled: true, apiKey: "", maxPages: 15, monthlyCallCap: 450 },
    dealerSites: { enabled: true, file: "dealers.csv", maxPagesPerDealer: 8, pageDelayMs: 1500 },
  },
  dataDir: "data",
};

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === "object" && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(file = process.env.BUYLIST_CONFIG || path.join(ROOT, "config.json")) {
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`config.json has a typo and can't be read (${e.message}). Fix it or copy config.example.json again.`);
    }
  }
  const c = merge(DEFAULTS, user);
  c.dataDir = path.resolve(ROOT, c.dataDir);
  c.sources.dealerSites.file = path.resolve(ROOT, c.sources.dealerSites.file);
  return c;
}

export const config = loadConfig();
