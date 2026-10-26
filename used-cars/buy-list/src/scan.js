// One morning scan: run every enabled source, then merge what they found into the
// list in one quick step at the end. Each source fails on its own (CarGurus being
// blocked doesn't stop the dealer sites), and the scan records what each one did.
import fs from "node:fs";
import path from "node:path";
import { config as defaultConfig } from "./config.js";
import { readDb, withDb } from "./store.js";
import { applyObservations } from "./listings.js";
import { launchBrowser } from "./browser.js";
import { fetchMarketcheck } from "./sources/marketcheck.js";
import { fetchCarGurus } from "./sources/cargurus.js";
import { fetchDealerSites, readDealers } from "./sources/dealerSites.js";

const LOCK_STALE_MS = 6 * 3600 * 1000; // a scan never takes this long; an older lock is from a crash

function lockFile(cfg) { return path.join(cfg.dataDir, "scan.lock"); }

export function scanRunning(cfg = defaultConfig) {
  const f = lockFile(cfg);
  if (!fs.existsSync(f)) return false;
  return Date.now() - fs.statSync(f).mtimeMs < LOCK_STALE_MS;
}

/**
 * runScan({ trigger, only, cfg, fetchImpl, openBrowser, cargurusBase, log })
 * `only` limits it to one source; the rest are test hooks.
 */
export async function runScan({
  trigger = "manual", only = null, cfg = defaultConfig, fetchImpl = fetch,
  openBrowser = launchBrowser, cargurusBase, log = (m) => console.log(`[scan] ${m}`),
} = {}) {
  if (scanRunning(cfg)) return { ok: false, error: "a scan is already running" };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(lockFile(cfg), String(process.pid));
  const debugDir = path.join(cfg.dataDir, "debug");
  const scan = { startedAt: new Date().toISOString(), trigger, sources: {} };
  const obs = [];
  const want = (k) => cfg.sources[k]?.enabled && (!only || only === k);
  let handle = null;
  const context = async () => (handle ||= await openBrowser()).context;

  try {
    if (want("marketcheck")) {
      if (!cfg.sources.marketcheck.apiKey) {
        scan.sources.marketcheck = { ok: false, skipped: true, note: "no free API key in config.json (optional)" };
      } else {
        const month = new Date().toISOString().slice(0, 7);
        try {
          const r = await fetchMarketcheck(cfg, { callsUsedThisMonth: readDb().marketcheckCalls[month] || 0, fetchImpl, log });
          obs.push(...r.listings);
          scan.sources.marketcheck = { ok: true, found: r.listings.length, apiCalls: r.apiCalls, truncated: r.truncated, numFound: r.numFound };
        } catch (e) {
          const p = e.partial || {};
          obs.push(...(p.listings || []));
          scan.sources.marketcheck = { ok: false, error: e.message, found: p.listings?.length || 0, apiCalls: p.apiCalls || 0 };
        }
      }
    }
    if (want("cargurus")) {
      try {
        const r = await fetchCarGurus(cfg, { context: await context(), log, debugDir, base: cargurusBase });
        obs.push(...r.listings);
        scan.sources.cargurus = { ok: true, found: r.listings.length, pages: r.pages, truncated: r.truncated, method: r.method };
      } catch (e) {
        scan.sources.cargurus = { ok: false, error: e.message.split("\n")[0] };
      }
    }
    if (want("dealerSites")) {
      const dealers = readDealers(cfg.sources.dealerSites.file);
      if (!dealers.length) {
        scan.sources.dealerSites = { ok: false, skipped: true, note: "no dealers in dealers.csv yet" };
      } else {
        try {
          const r = await fetchDealerSites(cfg, { context: await context(), log, debugDir, dealers });
          obs.push(...r.listings);
          scan.sources.dealerSites = { ok: r.dealersOk > 0, found: r.listings.length, dealersOk: r.dealersOk, dealerCount: r.dealerCount, failed: r.dealersFailed };
        } catch (e) {
          scan.sources.dealerSites = { ok: false, error: e.message.split("\n")[0] };
        }
      }
    }
  } finally {
    if (handle) await handle.browser.close().catch(() => {});
  }

  scan.finishedAt = new Date().toISOString();
  const ran = Object.values(scan.sources).filter((s) => !s.skipped);
  scan.ok = ran.some((s) => s.ok); // false when every source failed or none is set up yet
  try {
    const tally = withDb((db) => {
      const t = applyObservations(db, obs, cfg);
      const month = scan.startedAt.slice(0, 7);
      const mcCalls = scan.sources.marketcheck?.apiCalls || 0;
      if (mcCalls) db.marketcheckCalls[month] = (db.marketcheckCalls[month] || 0) + mcCalls;
      Object.assign(scan, t);
      db.scans.unshift(scan);
      db.scans = db.scans.slice(0, 60);
      return t;
    });
    log(`done: ${tally.kept} cars kept (${tally.newCount} new, ${tally.dropCount} price drops, ${tally.excluded} excluded)`);
  } finally {
    fs.rmSync(lockFile(cfg), { force: true });
  }
  return scan;
}
