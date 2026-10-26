// Run a scan right now from the command line (the app does this every morning on
// its own). Handy for testing one source:
//   npm run scan                       all enabled sources
//   npm run scan -- --only cargurus    just CarGurus (or marketcheck / dealerSites)
//   npm run scan -- --show             show the browser window while it works
import { config } from "../src/config.js";
import { runScan } from "../src/scan.js";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (args.includes("--show")) config.browser.headless = false;

const scan = await runScan({ trigger: "manual", only });
if (scan.error) {
  console.error(scan.error);
  process.exit(1);
}
for (const [name, s] of Object.entries(scan.sources)) {
  const what = s.skipped ? `skipped: ${s.note}` : s.ok ? `${s.found} cars` : `FAILED: ${s.error}`;
  console.log(`${name.padEnd(12)} ${what}`);
  for (const f of s.failed || []) console.log(`  - ${f.name}: ${f.error}`);
}
console.log(`kept ${scan.kept} · new ${scan.newCount} · price drops ${scan.dropCount} · excluded ${scan.excluded}`);
process.exit(scan.ok ? 0 : 1);
