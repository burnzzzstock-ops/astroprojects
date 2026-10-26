import zipcodes from "zipcodes";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");

// Local (PC clock) calendar day, YYYY-MM-DD, optionally offset by whole days.
export function localDay(offsetDays = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysSince(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : null;
}

// "$24,995" / "24995" / 24995 / { value: 24995 } → 24995 (null if not a sane number)
export function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "object") return toNumber(v.value ?? v.amount ?? v.price ?? null);
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Straight-line miles between two US ZIPs (free offline table), or null if unknown.
export function zipDistance(a, b) {
  const za = String(a ?? "").slice(0, 5), zb = String(b ?? "").slice(0, 5);
  if (!/^\d{5}$/.test(za) || !/^\d{5}$/.test(zb)) return null;
  const d = zipcodes.distance(za, zb);
  return Number.isFinite(d) ? d : null;
}

// A ZIP for "City, ST" when a dealer row has none (for distance only).
export function zipForCity(city, state) {
  if (!city || !state) return null;
  const c = String(city).trim();
  for (const name of [c, c.replace(/[^a-z ]/gi, ""), c.replace(/\bSt\.?\s/i, "Saint ")]) {
    const hit = zipcodes.lookupByName(name, String(state).trim().toUpperCase())[0];
    if (hit) return hit.zip;
  }
  return null;
}

const SUFFIX = /\b(llc|inc|incorporated|co|corp|corporation|ltd|the)\b/g;

// One key per dealership across sources ("Example Motors LLC" == "Example Motors").
// Private sellers each get their own key so they never get lumped into one card.
export function dealerKeyOf(dealer, listingKey) {
  if (!dealer || dealer.type === "private" || /^private\b/i.test(dealer.name || "") || !dealer.name) {
    return `private:${listingKey}`;
  }
  return norm(norm(dealer.name).replace(SUFFIX, " ")) || `private:${listingKey}`;
}

export function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Small CSV reader for dealers.csv (handles quoted cells with commas).
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map((h) => norm(h).replace(/ /g, "_"));
  return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
