import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set([".git", "node_modules", "data", "coverage"]);
const sourceExt = /\.(?:js|mjs|cjs)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (sourceExt.test(entry.name)) out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

const failures = [];

for (const file of walk(root)) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(`Syntax check failed: ${relative(file)}\n${result.stderr || result.stdout}`);
  }
}

const configPath = path.join(root, "src", "config.js");
const envExamplePath = path.join(root, ".env.example");
const configSource = fs.readFileSync(configPath, "utf8");
const envExample = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, "utf8") : "";
const envKeys = [...new Set([...configSource.matchAll(/env\("([A-Z0-9_]+)"/g)].map((m) => m[1]))].sort();
const documentedKeys = new Set(
  envExample
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^([A-Z0-9_]+)=/)?.[1])
    .filter(Boolean)
);
const missing = envKeys.filter((key) => !documentedKeys.has(key));
if (missing.length) {
  failures.push(`.env.example is missing key(s) used by src/config.js: ${missing.join(", ")}`);
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(`Checked ${walk(root).length} JS/MJS/CJS files and ${envKeys.length} documented env keys.`);
