import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";

// Job setup the manager edits in the console. Env vars are only defaults; an
// empty application link or job facts saved in the console means "none".
export function getJobSettings() {
  return {
    applyUrl: getSetting("job.apply_url") ?? config.job.applyUrl,
    role: getSetting("job.role") || config.job.role,
    interviewer: getSetting("job.interviewer") || config.manager.name,
    interviewHours: getSetting("job.interview_hours") || config.job.interviewHours,
    jobFacts: getSetting("job.facts") ?? "",
  };
}

const KEYS = {
  applyUrl: "job.apply_url",
  role: "job.role",
  interviewer: "job.interviewer",
  interviewHours: "job.interview_hours",
  jobFacts: "job.facts",
};

export function saveJobSettings(fields) {
  for (const [field, key] of Object.entries(KEYS)) {
    if (fields[field] !== undefined) setSetting(key, String(fields[field] ?? "").trim().slice(0, 4000));
  }
  return getJobSettings();
}

// "2026-10-28 10:00" (local wall time) → "Wednesday, Oct 28 at 10:00 AM"
export function fmtInterviewSlot(slot) {
  const d = parseLocal(slot);
  if (!d) return slot || "";
  return `${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${fmtClock(d)}`;
}

export function fmtClock(d) {
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}

// "YYYY-MM-DD HH:mm" wall time → a Date with the same components. Only ever
// compared with another parseLocal result, so the server's own zone cancels out.
export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// Current local wall time as "YYYY-MM-DD HH:mm" (sortable as a string).
export const nowLocalStamp = () => new Date().toLocaleString("sv-SE", { timeZone: config.timezone }).slice(0, 16);

// Parse a SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO timestamp → hours ago.
export function hoursSince(t) {
  if (!t) return Infinity;
  const s = String(t);
  return (Date.now() - new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").getTime()) / 3600000;
}
