// Everything is kept in one JSON file (data/buylist.json): no database to install.
// A few thousand listings is a few MB, which loads in milliseconds.
//
// Every change is load → modify → save in one synchronous step (withDb), so the
// web page logging a call and a scan finishing can't overwrite each other: a scan
// gathers listings first (slow, async) and only touches the file at the very end.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const EMPTY = () => ({
  version: 1,
  listings: {},       // key (VIN, else source:id) → listing
  calls: [],          // call log
  scans: [],          // most recent first
  hiddenDealers: {},  // dealerKey → name
  csvDealers: {},     // dealerKey → { name, city, state } for dealers.csv rows (the names other sources map onto)
  marketcheckCalls: {}, // "YYYY-MM" → API calls used
});

// The UCM's current filter + named saved searches (src/filters.js), in their own small
// file (data/prefs.json) so a filter tap never rewrites the big one.
const prefsFile = () => path.join(config.dataDir, "prefs.json");
export function readPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return { active: p.active || {}, saved: Array.isArray(p.saved) ? p.saved : [] };
  } catch {
    return { active: {}, saved: [] };
  }
}
export function savePrefs(p) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(prefsFile() + ".tmp", JSON.stringify(p, null, 1));
  fs.renameSync(prefsFile() + ".tmp", prefsFile());
  return p;
}

export function dbFile() {
  return path.join(config.dataDir, "buylist.json");
}

// At 200 miles the file runs tens of MB, and every page request reads it: reuse the last
// parse while the file is unchanged. Only for reading; withDb always parses fresh.
let cache = null;

export function readDb({ fresh = false } = {}) {
  const f = dbFile();
  if (!fs.existsSync(f)) return EMPTY();
  const st = fs.statSync(f);
  if (!fresh && cache && cache.file === f && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.db;
  const raw = fs.readFileSync(f, "utf8");
  try {
    const db = { ...EMPTY(), ...JSON.parse(raw) };
    if (!fresh) cache = { file: f, mtimeMs: st.mtimeMs, size: st.size, db };
    return db;
  } catch {
    // A torn write should be impossible (we write a temp file then rename), but
    // never lose the list over it: fall back to the last good copy.
    const bak = f + ".bak";
    if (fs.existsSync(bak)) return { ...EMPTY(), ...JSON.parse(fs.readFileSync(bak, "utf8")) };
    throw new Error(`${f} is unreadable`);
  }
}

export function saveDb(db) {
  const f = dbFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, f);
  cache = null;
}

export function withDb(fn) {
  const db = readDb({ fresh: true });
  const result = fn(db);
  saveDb(db);
  return result;
}
