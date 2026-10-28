// Builds cloud/public/ for the web version: the shared page (../public/index.html)
// with the phone-side scripts added, the ranking code bundled as logic.js, and
// the adapter. Run by the deploy workflow (and before local `wrangler dev`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const CLOUD = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(CLOUD, "public");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [path.join(CLOUD, "browser-entry.js")],
  bundle: true,
  format: "iife",
  globalName: "BuyLogic",
  platform: "browser",
  target: "es2020",
  minify: true,
  outfile: path.join(OUT, "logic.js"),
});
fs.copyFileSync(path.join(CLOUD, "adapter.js"), path.join(OUT, "adapter.js"));

let html = fs.readFileSync(path.join(CLOUD, "..", "public", "index.html"), "utf8");
const head = `<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1c3f6e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Buy List">
<link rel="icon" href="icon.svg">
<link rel="apple-touch-icon" href="icon.svg">
<title>`;
if (!html.includes("<title>") || !html.includes("<script>")) throw new Error("public/index.html changed shape: expected <title> and an inline <script>");
html = html.replace("<title>", head).replace("<script>", `<script src="logic.js"></script>\n<script src="adapter.js"></script>\n<script>`);
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
fs.writeFileSync(path.join(OUT, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1c3f6e"/><g transform="translate(12 12) scale(1.67)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></g></svg>`);
console.log(`built ${path.relative(process.cwd(), OUT)} (logic.js ${(fs.statSync(path.join(OUT, "logic.js")).size / 1024).toFixed(1)} KB)`);
