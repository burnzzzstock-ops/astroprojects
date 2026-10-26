// Dealer websites: free, public inventory pages listed in dealers.csv. Each site is
// opened in the browser and its cars are read from whatever it loads: data feeds,
// schema.org JSON-LD, or (last resort) the VINs printed on the page. Scrolls and
// clicks "next"/"load more" to reach the rest of the lot.
//
// Most dealer sites don't show how long a car has been listed, so "days listed"
// counts from the first day this tool saw the car (it starts building on day one;
// a site that publishes an in-stock date is used directly).
import fs from "node:fs";
import { extractListings, parseJsonLoose, normalizeObject } from "../extract.js";
import { collectJson, embeddedJson, looksBlocked, settle, friendlyNetError } from "../browser.js";
import { parseCsv, sleep, zipDistance, zipForCity } from "../util.js";
import { saveDebug } from "./cargurus.js";

export function readDealers(file) {
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"))
    .map((r) => ({
      name: r.name || r.dealer || r.dealer_name || "",
      phone: r.phone || "",
      city: r.city || "",
      state: r.state || "",
      zip: r.zip || r.zip_code || "",
      url: r.used_inventory_url || r.inventory_url || r.url || r.website || "",
      type: (r.type || "").toLowerCase() || null,
    }))
    .filter((d) => d.name && /^https?:\/\//i.test(d.url));
}

// Last resort: cars whose VIN is printed on the page, with the price/miles/title
// read from the surrounding card.
async function domListings(page) {
  const raw = await page.evaluate(() => {
    const VIN = /\b([A-HJ-NPR-Z0-9]{17})\b/;
    const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA"]);
    const nodes = new Set(document.querySelectorAll("[data-vin]"));
    for (const el of document.querySelectorAll("body *")) {
      if (SKIP.has(el.tagName) || el.children.length) continue;
      if (/\bVIN\b/i.test(el.textContent || "") && VIN.test(el.textContent)) nodes.add(el);
    }
    const vinCount = (t) => new Set(t.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []).size;
    const out = [];
    for (const el of nodes) {
      const vin = (el.getAttribute("data-vin") || (el.textContent.match(VIN) || [])[1] || "").toUpperCase();
      if (!vin) continue;
      // Climb to this car's card: the biggest block that still holds only this one
      // VIN, stopping as soon as it shows a price.
      let card = el;
      for (let node = el, i = 0; node && i < 9; node = node.parentElement, i++) {
        const t = node.innerText || "";
        if (vinCount(t) > 1) break;
        card = node;
        if (/\$\s?\d{1,3}(,\d{3})+/.test(t)) break;
      }
      const t = (card.innerText || "").replace(/\s+/g, " ");
      out.push({
        vin,
        price: (t.match(/\$\s?(\d{1,3}(?:,\d{3})+)/) || [])[1] || null,
        miles: (t.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:mi\b|miles)/i) || [])[1] || null,
        title: (t.match(/\b(19[89]\d|20[0-4]\d)\s+[A-Z][\w-]+(?:\s+[\w-]+){1,4}/) || [])[0] || null,
        stock: (t.match(/Stock\s*(?:#|No\.?|Number)?[:\s]*([A-Z0-9-]{3,})/i) || [])[1] || null,
        url: card.querySelector("a[href]")?.href || null,
      });
    }
    return out;
  });
  return raw.map(normalizeObject);
}

async function clickMore(page) {
  const selectors = [
    'a[rel="next"]', 'button[aria-label*="next" i]', 'a[aria-label*="next" i]', '[data-testid*="next" i]',
    "li.next a", ".pagination-next a", "a.next", "button.next",
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false)) && (await el.isEnabled().catch(() => false))) {
      await el.click({ timeout: 8000 }).catch(() => {});
      return true;
    }
  }
  const label = /^\s*(load more|show more|view more|see more|more vehicles|next( page)?)\s*[›»>]?\s*$/i;
  for (const role of ["button", "link"]) {
    const el = page.getByRole(role, { name: label }).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false))) {
      await el.click({ timeout: 8000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// A dealers.csv link that's just the homepage ("https://www.dealer.com/") rather
// than an inventory page: we'll find the used-inventory link on it ourselves.
export function isHomepage(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return /^\/?[^/]*\/?$/.test(p) && !/used|inventory|vehicle|pre-?owned|search|cars|stock|index/.test(p);
  } catch {
    return false;
  }
}

// Best "Used / Pre-Owned inventory" link on the page (same site only), or null.
async function findUsedLink(page) {
  return page.evaluate(() => {
    const here = location.hostname.replace(/^www\./, "");
    const root = here.split(".").slice(-2).join(".");
    let best = null, bestScore = 5;
    for (const a of document.querySelectorAll("a[href]")) {
      let u;
      try { u = new URL(a.getAttribute("href"), location.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || !u.hostname.replace(/^www\./, "").endsWith(root)) continue;
      const t = `${a.innerText || a.textContent || ""} ${a.getAttribute("aria-label") || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
      const h = (u.pathname + u.search).toLowerCase();
      if (!/used|pre-?owned|preowned/.test(t + " " + h)) continue;
      let s = 0;
      if (/^(shop |view |all |search )?(used|pre-?owned)( inventory| vehicles| cars( (&|and) trucks)?)?$/.test(t)) s += 10;
      if (/used|pre-?owned/.test(t)) s += 5;
      if (/inventory|vehicles|cars|search|shop/.test(t)) s += 2;
      if (/used|pre-?owned|preowned/.test(h)) s += 4;
      if (/inventory|vehicles|search|cars/.test(h)) s += 1;
      if (/\bnew\b|certified|cpo|specials?|sell|trade|value|financ|service|parts/.test(t)) s -= 4;
      if (s > bestScore) { best = u.href; bestScore = s; }
    }
    return best;
  });
}

export async function scrapeDealer(context, dealer, { maxPages = 8, delay = 1500, log = () => {}, debugDir } = {}) {
  const page = await context.newPage();
  const sink = [];
  collectJson(page, sink);
  const found = new Map();
  const harvest = async () => {
    let added = 0;
    const blobs = [...sink.splice(0).map((b) => b.body), ...(await embeddedJson(page))];
    const rows = [];
    for (const b of blobs) rows.push(...extractListings(parseJsonLoose(b)));
    if (!rows.length) rows.push(...(await domListings(page)));
    for (const l of rows) {
      if (l.isNew) continue;
      const k = l.vin || l.stock || l.sourceId;
      if (k && !found.has(k)) { found.set(k, l); added++; }
    }
    return added;
  };
  try {
    const resp = await page.goto(dealer.url, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch((e) => { throw new Error(friendlyNetError(e, "the site")); });
    if ((resp && resp.status() >= 400) || looksBlocked(await page.title(), await page.content())) {
      throw new Error(`site blocked or unavailable (HTTP ${resp?.status() ?? "?"})`);
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await settle(page);
    // Given a homepage (or a page with no cars), hop to its used-inventory page first.
    const home = isHomepage(dealer.url);
    if (!home) await harvest();
    if (home || !found.size) {
      const used = await findUsedLink(page);
      if (used && used !== page.url()) {
        log(`dealer site ${dealer.name}: using ${used}`);
        sink.length = 0;
        await page.goto(used, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await settle(page);
      }
      await harvest();
    }
    for (let p = 1; p < maxPages; p++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); // infinite-scroll sites
      await settle(page);
      let added = await harvest();
      if (!added) {
        if (!(await clickMore(page))) break;
        await settle(page);
        await sleep(delay);
        added = await harvest();
        if (!added) break;
      }
    }
    if (!found.size && debugDir) await saveDebug(page, debugDir, `dealer-${dealer.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}`);
    log(`dealer site ${dealer.name}: ${found.size} used cars`);
    return [...found.values()];
  } finally {
    await page.close().catch(() => {});
  }
}

/** fetchDealerSites(cfg, { context, log, debugDir }) → { listings, dealersOk, dealersFailed } */
export async function fetchDealerSites(cfg, { context, log = () => {}, debugDir, dealers = null }) {
  const s = cfg.sources.dealerSites;
  const list = dealers || readDealers(s.file);
  const listings = [];
  const failed = [];
  let ok = 0;
  // A few sites at a time (different dealers, so still gentle on each one), and
  // no single site can hold up the whole morning scan.
  const timeoutMs = s.dealerTimeoutMs || 180000;
  const one = async (d) => {
    let timer;
    try {
      const rows = await Promise.race([
        scrapeDealer(context, d, { maxPages: s.maxPagesPerDealer, delay: s.pageDelayMs, log, debugDir }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("site took too long to load")), timeoutMs); }),
      ]);
      if (!rows.length) { failed.push({ name: d.name, error: "no cars found on the page" }); return; }
      ok++;
      const distance = zipDistance(cfg.zip, d.zip || zipForCity(d.city, d.state));
      for (const l of rows) {
        let url = null;
        try { url = l.url ? new URL(l.url, d.url).href : null; } catch { /* unparseable link */ }
        listings.push({
          ...l,
          url,
          source: "dealer",
          distance: distance ?? l.distance,
          // dealers.csv is the source of truth for who the dealer is and how to reach them
          dealer: {
            ...l.dealer, name: d.name, phone: d.phone || l.dealer?.phone || null, city: d.city || l.dealer?.city || null,
            state: d.state || l.dealer?.state || null, zip: d.zip || l.dealer?.zip || null, website: d.url,
            type: d.type || l.dealer?.type || null,
          },
        });
      }
    } catch (e) {
      failed.push({ name: d.name, error: e.message.split("\n")[0] });
      log(`dealer site ${d.name} failed: ${e.message.split("\n")[0]}`);
    } finally {
      clearTimeout(timer);
    }
  };
  let next = 0;
  const workers = Math.max(1, Math.min(s.concurrency || 3, list.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < list.length) await one(list[next++]);
  }));
  return { listings, dealersOk: ok, dealersFailed: failed, dealerCount: list.length };
}
