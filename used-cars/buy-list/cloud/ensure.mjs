// Finds (or, the first time, creates) the Cloudflare storage the web version uses,
// a KV namespace for the scan data and a D1 database for call notes, and writes
// their ids into wrangler.toml. Runs in GitHub Actions with the
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets; wrangler.toml is never
// committed with real ids.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLOUD = path.dirname(fileURLToPath(import.meta.url));
const KV_NAME = "buylist-data";
const D1_NAME = "buylist";

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], {
  cwd: CLOUD, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, CI: "true" },
});
// wrangler prints a warning banner before JSON when a proxy is set; keep just the JSON.
function jsonOut(text) {
  const start = text.search(/^\s*[[{]/m);
  return JSON.parse(start >= 0 ? text.slice(start) : text);
}

function kvId() {
  const find = () => jsonOut(wrangler("kv", "namespace", "list"))
    .find((n) => n.title === KV_NAME || n.title.endsWith(`-${KV_NAME}`));
  let ns = find();
  if (!ns) {
    console.log(`creating KV namespace ${KV_NAME}`);
    wrangler("kv", "namespace", "create", KV_NAME);
    ns = find();
  }
  if (!ns) throw new Error(`couldn't find or create the ${KV_NAME} KV namespace`);
  return ns.id;
}

function d1Id() {
  const find = () => jsonOut(wrangler("d1", "list", "--json")).find((d) => d.name === D1_NAME);
  let db = find();
  if (!db) {
    console.log(`creating D1 database ${D1_NAME}`);
    wrangler("d1", "create", D1_NAME);
    db = find();
  }
  if (!db) throw new Error(`couldn't find or create the ${D1_NAME} D1 database`);
  return db.uuid;
}

const toml = path.join(CLOUD, "wrangler.toml");
const kv = kvId(), d1 = d1Id();
fs.writeFileSync(toml, fs.readFileSync(toml, "utf8")
  .replace(/^(binding = "DATA"\nid = )".*"$/m, `$1"${kv}"`)
  .replace(/^(database_id = )".*"$/m, `$1"${d1}"`));
console.log(`storage ready: KV ${kv}, D1 ${d1}`);
