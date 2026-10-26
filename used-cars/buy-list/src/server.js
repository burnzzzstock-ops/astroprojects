// The Buy List app: a small web page on this PC (http://localhost:4400) plus the
// morning scan. Leave it running (start.bat / setup puts it in Startup); it scans
// at config.scanTime on scan days, or as soon as the PC is on if it missed it.
import express from "express";
import os from "node:os";
import path from "node:path";
import { config, ROOT } from "./config.js";
import { readDb, withDb } from "./store.js";
import { OUTCOMES, buildCallList, browseListings, recordOutcome, status, callListCsv, dealerRoster } from "./buyList.js";
import { readDealers } from "./sources/dealerSites.js";
import { runScan, scanRunning } from "./scan.js";
import { localDay } from "./util.js";

const MANUAL_COOLDOWN_MIN = 30; // be gentle with the sites (and the free API quota)

const app = express();
app.use(express.json({ limit: "1mb" }));

// Phones on the network must know the PIN; the PC itself always gets in.
app.use("/api", (req, res, next) => {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  if (local || !config.accessPin || (req.get("x-pin") || req.query.pin) === config.accessPin) return next();
  res.status(401).json({ error: "pin required" });
});

app.get("/api/status", (req, res) => {
  res.json({
    ...status(readDb(), config),
    running: scanRunning(),
    outcomes: Object.fromEntries(Object.entries(OUTCOMES).map(([k, o]) => [k, o.label])),
  });
});

app.get("/api/today", (req, res) => res.json(buildCallList(readDb(), config)));

app.get("/api/today.csv", (req, res) => {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="buy-list-${localDay()}.csv"`);
  res.send("﻿" + callListCsv(buildCallList(readDb(), config))); // BOM so Excel shows − and 📉
});

app.get("/api/listings", (req, res) => {
  res.json(browseListings(readDb(), config, {
    q: String(req.query.q || ""), sort: String(req.query.sort || "score"), limit: Math.min(Number(req.query.limit) || 150, 500),
  }));
});

// Body: { keys: [...], outcome, notes?, offer? } — several keys = a whole-lot tap.
app.post("/api/outcome", (req, res) => {
  const keys = (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).filter(Boolean);
  const outcome = String(req.body?.outcome || "");
  if (!keys.length) return res.status(400).json({ error: "keys required" });
  if (!OUTCOMES[outcome]) return res.status(400).json({ error: "unknown outcome" });
  res.json(withDb((db) => recordOutcome(db, keys, outcome, { notes: req.body?.notes, offer: req.body?.offer })));
});

app.post("/api/scan", (req, res) => {
  if (scanRunning()) return res.status(409).json({ error: "a scan is already running" });
  const last = readDb().scans[0];
  const ageMin = last ? (Date.now() - new Date(last.startedAt).getTime()) / 60000 : Infinity;
  if (ageMin < MANUAL_COOLDOWN_MIN) {
    return res.status(429).json({ error: `Scanned ${Math.round(ageMin)} min ago. Try again in ${Math.ceil(MANUAL_COOLDOWN_MIN - ageMin)} min.` });
  }
  runScan({ trigger: "manual" }).catch((e) => console.error("[scan] failed:", e.message));
  res.status(202).json({ started: true });
});

app.get("/api/dealers", (req, res) => {
  res.json(dealerRoster(readDb(), config, readDealers(config.sources.dealerSites.file)));
});

app.get("/api/hidden", (req, res) => {
  res.json(Object.entries(readDb().hiddenDealers).map(([dealerKey, name]) => ({ dealerKey, name })));
});
app.post("/api/hide", (req, res) => {
  const key = String(req.body?.dealerKey || "");
  if (!key) return res.status(400).json({ error: "dealerKey required" });
  withDb((db) => { db.hiddenDealers[key] = String(req.body?.name || key).slice(0, 200); });
  res.json({ ok: true });
});
app.post("/api/unhide", (req, res) => {
  const key = String(req.body?.dealerKey || "");
  withDb((db) => { delete db.hiddenDealers[key]; });
  res.json({ ok: true });
});

app.use(express.static(path.join(ROOT, "public")));

// ── Morning scan: once per scan day, at/after scanTime (catches up if the PC was off) ──
function scheduledScanDue(now = new Date()) {
  if (!config.scanDays.includes(now.getDay())) return false;
  const [h, m] = String(config.scanTime).split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + (m || 0)) return false;
  const last = readDb().scans.find((s) => s.trigger === "schedule");
  return !(last && localDay(0, new Date(last.startedAt)) === localDay(0, now));
}
function tick() {
  if (scheduledScanDue() && !scanRunning()) {
    runScan({ trigger: "schedule" }).catch((e) => console.error("[scan] failed:", e.message));
  }
}

const phones = config.allowPhoneAccess && config.accessPin;
if (config.allowPhoneAccess && !config.accessPin) {
  console.warn("allowPhoneAccess is on but accessPin is empty; staying on this PC only. Set an accessPin in config.json.");
}
app.listen(config.port, phones ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Buy List running: http://localhost:${config.port}`);
  if (phones) {
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const n of nets || []) if (n.family === "IPv4" && !n.internal) console.log(`  on phones (same Wi-Fi): http://${n.address}:${config.port}`);
    }
  }
  console.log(`Morning scan: ${config.scanTime} on scan days. Leave this window open.`);
  setTimeout(tick, 20000);
  setInterval(tick, 5 * 60 * 1000);
});
