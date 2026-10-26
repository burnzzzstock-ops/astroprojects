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
  marketcheckCalls: {}, // "YYYY-MM" → API calls used
});

export function dbFile() {
  return path.join(config.dataDir, "buylist.json");
}

export function readDb() {
  const f = dbFile();
  if (!fs.existsSync(f)) return EMPTY();
  const raw = fs.readFileSync(f, "utf8");
  try {
    return { ...EMPTY(), ...JSON.parse(raw) };
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
}

export function withDb(fn) {
  const db = readDb();
  const result = fn(db);
  saveDb(db);
  return result;
}
