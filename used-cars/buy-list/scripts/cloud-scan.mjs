// The web version's morning scan. Runs on GitHub Actions (.github/workflows/
// buy-list-scan.yml), not on a store PC:
//
//   node scripts/cloud-scan.mjs --state market.json.gz --called called.json \
//     --hidden hidden.json --out <dir>
//
// --state   what the last scan knew (first-seen dates, price history), gzipped
// --called  cars the manager has called about (kept even after they age out),
// --hidden  hidden dealers: both as `wrangler d1 execute --json` output
// Writes <dir>/status.json, aged.json and dealers.json for the website, and
// <dir>/market.json.gz for the next scan.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BUYLIST_CONFIG ||= path.join(ROOT, "cloud", "scan-config.json");
const { config } = await import("../src/config.js");
const { readDb, saveDb } = await import("../src/store.js");
const { runScan } = await import("../src/scan.js");
const { readDealers } = await import("../src/sources/dealerSites.js");
const { buildPublished } = await import("../src/publish.js");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};

// `wrangler d1 execute --json` prints [{ results: [...] }]; tolerate log lines around it.
function d1Rows(file) {
  if (!file || !fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const a = text.indexOf("["), b = text.lastIndexOf("]");
    if (a < 0 || b < a) return [];
    parsed = JSON.parse(text.slice(a, b + 1));
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results || [];
}

const outDir = path.resolve(arg("out") || path.join(ROOT, ".scan-data", "out"));
fs.rmSync(config.dataDir, { recursive: true, force: true });
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// Rebuild the scan's memory from the last run, then apply the manager's side.
const stateFile = arg("state");
let db = readDb();
if (stateFile && fs.existsSync(stateFile) && fs.statSync(stateFile).size > 0) {
  db = { ...db, ...JSON.parse(zlib.gunzipSync(fs.readFileSync(stateFile)).toString("utf8")) };
}
db.hiddenDealers = Object.fromEntries(d1Rows(arg("hidden")).map((r) => [r.dealer_key, r.name]));
const called = new Set(d1Rows(arg("called")).map((r) => r.key));
for (const key of called) {
  const l = db.listings[key];
  if (l && !l.lastCallAt) l.lastCallAt = new Date().toISOString(); // keeps it from being pruned
}
saveDb(db);

const scan = await runScan({ trigger: process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "manual" });
if (scan.error) {
  console.error(scan.error);
  process.exit(1);
}
const after = readDb();
const pub = buildPublished(after, config, readDealers(config.sources.dealerSites.file), called);
fs.writeFileSync(path.join(outDir, "status.json"), JSON.stringify(pub.status));
fs.writeFileSync(path.join(outDir, "aged.json"), JSON.stringify(pub.aged));
fs.writeFileSync(path.join(outDir, "dealers.json"), JSON.stringify(pub.dealers));
fs.writeFileSync(path.join(outDir, "market.json.gz"), zlib.gzipSync(JSON.stringify(after)));

for (const [name, s] of Object.entries(scan.sources)) {
  const what = s.skipped ? `skipped: ${s.note}` : s.ok ? `${s.found} cars` : `FAILED: ${s.error}`;
  console.log(`${name.padEnd(12)} ${what}`);
  if (!s.ok && !s.skipped) console.log(`::warning::${name}: ${s.error}`);
}
console.log(`published ${pub.aged.length} cars, ${pub.dealers.length} dealers`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${scan.ok}\n`);
