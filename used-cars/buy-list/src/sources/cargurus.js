// CarGurus: free, shows how many days every car has been listed, and can sort
// oldest-listed first within a radius. Read with a real browser at a polite pace.
// Note: automated use isn't allowed by CarGurus' terms; they may block it or change
// their site. When nothing can be read, debug files are saved to data/debug so the
// parser can be updated.
//
// Two ways in, tried in order:
//   A. the search-results data feed the CarGurus site itself calls (fast, 1 request/page)
//   B. open the search page like a person, read the data it loads, click "next"
import fs from "node:fs";
import path from "node:path";
import { extractListings, parseJsonLoose } from "../extract.js";
import { collectJson, embeddedJson, looksBlocked, settle, friendlyNetError } from "../browser.js";
import { sleep } from "../util.js";

export const BASE = "https://www.cargurus.com";
const PER_PAGE = 50;

export function feedUrl(cfg, offset, base = BASE) {
  const q = new URLSearchParams({
    zip: cfg.zip, distance: String(cfg.radiusMiles), inventorySearchWidgetType: "AUTO",
    sortDir: "DESC", sortType: "AGE_IN_DAYS", offset: String(offset), maxResults: String(PER_PAGE),
    filtersModified: "true",
  });
  return `${base}/Cars/searchResults.action?${q}`;
}

export function searchPageUrl(cfg, base = BASE) {
  const q = new URLSearchParams({ zip: cfg.zip, distance: String(cfg.radiusMiles), sortDir: "DESC", sortType: "AGE_IN_DAYS" });
  return `${base}/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?${q}`;
}

function finish(l, base) {
  let url = l.url;
  if (url && url.startsWith("/")) url = base + url;
  if (!url && l.sourceId) url = `${base}/details/${encodeURIComponent(l.sourceId)}`;
  return { ...l, source: "cargurus", url };
}

// Tracks the "oldest first" sort so we can stop once results drop below the aged
// window, but only if the site actually honored the sort (else keep paging).
function makeAgeGate(minDays) {
  let prevMin = Infinity, sorted = true;
  return (rows) => {
    const days = rows.map((r) => r.daysListed).filter((n) => n != null);
    if (!days.length) return false;
    const max = Math.max(...days), min = Math.min(...days);
    if (max > prevMin + 1) sorted = false;
    prevMin = min;
    return sorted && max < minDays; // true = everything from here on is too new
  };
}

async function viaFeed(page, cfg, { base, maxPages, delay, log }) {
  const found = new Map();
  const pastWindow = makeAgeGate(cfg.minDaysListed);
  let offset = 0, pages = 0, lastStatus = null, done = false;
  for (let p = 0; p < maxPages; p++) {
    const r = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { headers: { accept: "application/json, text/plain, */*" }, credentials: "include" });
        return { status: res.status, body: await res.text() };
      } catch (e) {
        return { status: 0, body: String(e) };
      }
    }, feedUrl(cfg, offset, base));
    pages++;
    lastStatus = r.status;
    if (r.status !== 200) break;
    const rows = extractListings(parseJsonLoose(r.body)).filter((l) => !l.isNew);
    let added = 0;
    for (const l of rows) {
      const k = l.vin || l.sourceId;
      if (k && !found.has(k)) { found.set(k, finish(l, base)); added++; }
    }
    log(`cargurus feed page ${pages}: ${rows.length} listings (${added} new)`);
    if (!added) { done = true; break; } // end of results, or the feed ignores paging
    offset += rows.length;
    if (pastWindow(rows)) { done = true; break; }
    await sleep(delay + Math.random() * 1000);
  }
  return { listings: [...found.values()], pages, truncated: !done, lastStatus };
}

const NEXT_SELECTORS = [
  'button[aria-label*="next" i]', 'a[aria-label*="next" i]', '[data-testid*="next" i]', 'a[rel="next"]',
];

async function viaSearchPage(page, cfg, { base, maxPages, delay, log, sink }) {
  const found = new Map();
  const pastWindow = makeAgeGate(cfg.minDaysListed);
  sink.length = 0;
  await page.goto(searchPageUrl(cfg, base), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await settle(page);
  let pages = 0, done = false;
  for (let p = 0; p < maxPages; p++) {
    pages++;
    const blobs = [...sink.splice(0).map((b) => b.body), ...(await embeddedJson(page))];
    const rows = [];
    for (const b of blobs) rows.push(...extractListings(parseJsonLoose(b)).filter((l) => !l.isNew));
    let added = 0;
    for (const l of rows) {
      const k = l.vin || l.sourceId;
      if (k && !found.has(k)) { found.set(k, finish(l, base)); added++; }
    }
    log(`cargurus page ${pages}: ${added} new listings`);
    if (!added || pastWindow(rows)) { done = true; break; }
    let clicked = false;
    for (const sel of NEXT_SELECTORS) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) && (await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false))) {
        await btn.click({ timeout: 8000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) { done = true; break; }
    await settle(page);
    await sleep(delay + Math.random() * 1000);
  }
  return { listings: [...found.values()], pages, truncated: !done };
}

export async function saveDebug(page, debugDir, name, extra = null) {
  try {
    fs.mkdirSync(debugDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(debugDir, `${name}-${stamp}`);
    fs.writeFileSync(base + ".html", await page.content());
    await page.screenshot({ path: base + ".png", fullPage: false }).catch(() => {});
    if (extra) fs.writeFileSync(base + ".json", JSON.stringify(extra, null, 1).slice(0, 2_000_000));
    return base;
  } catch {
    return null;
  }
}

/**
 * fetchCarGurus(cfg, { context, log, debugDir, base }) → { listings, pages, truncated, method }
 */
export async function fetchCarGurus(cfg, { context, log = () => {}, debugDir, base = BASE }) {
  const s = cfg.sources.cargurus;
  const page = await context.newPage();
  const sink = [];
  collectJson(page, sink);
  try {
    const home = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch((e) => { throw new Error(friendlyNetError(e, "CarGurus")); });
    if ((home && home.status() >= 400) || looksBlocked(await page.title(), await page.content())) {
      const dbg = await saveDebug(page, debugDir, "cargurus-blocked");
      throw new Error(`CarGurus blocked the browser (bot check). Try "browser": { "headless": false } in config.json.${dbg ? ` Debug: ${dbg}.html` : ""}`);
    }
    await sleep(1500);
    const opts = { base, maxPages: s.maxPages, delay: s.pageDelayMs, log, sink };
    const a = await viaFeed(page, cfg, opts);
    if (a.listings.length) return { ...a, method: "feed" };
    log(`cargurus feed gave nothing (HTTP ${a.lastStatus}); reading the search page instead`);
    const b = await viaSearchPage(page, cfg, opts);
    if (b.listings.length) return { ...b, method: "page" };
    const captured = sink.slice(0, 8).map((x) => ({ url: x.url, body: x.body.slice(0, 40000) }));
    const dbg = await saveDebug(page, debugDir, "cargurus-empty", captured);
    throw new Error(`CarGurus: no listings could be read; the site may have changed.${dbg ? ` Debug files: ${dbg}.*` : ""}`);
  } finally {
    await page.close().catch(() => {});
  }
}
