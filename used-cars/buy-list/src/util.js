// Pure helpers, no Node-only imports: this file also runs in the browser and on
// Cloudflare (the web version). ZIP-code math lives in geo.js.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");

// Calendar day, YYYY-MM-DD, optionally offset by whole days. Uses the machine's
// clock, or an explicit time zone (Cloudflare and GitHub's servers run on UTC).
export function localDay(offsetDays = 0, now = new Date(), timeZone = null) {
  let y, m, d;
  if (timeZone) {
    [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(now).split("-").map(Number);
    m -= 1;
  } else {
    [y, m, d] = [now.getFullYear(), now.getMonth(), now.getDate()];
  }
  return new Date(Date.UTC(y, m, d + offsetDays)).toISOString().slice(0, 10);
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
