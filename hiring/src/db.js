import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS applicants (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  phone                 TEXT NOT NULL UNIQUE,   -- E.164
  name                  TEXT,
  role                  TEXT,                   -- position they asked about
  status                TEXT DEFAULT 'new',     -- see STATUSES below
  source                TEXT,                   -- text_in | manual
  lang                  TEXT,                   -- es/en, for the templated reminders
  ai_paused             INTEGER DEFAULT 0,      -- 1 = the manager has the wheel
  consent_at            TEXT,
  consent_basis         TEXT,                   -- inbound_text | applied_attested
  opted_out_at          TEXT,
  link_sent_at          TEXT,                   -- first time the application link went out
  applied_at            TEXT,
  invited_at            TEXT,
  invite_sent_at        TEXT,                   -- the invite text actually went out
  invite_followup_at    TEXT,                   -- one follow-up if they never answered the invite
  interview_at          TEXT,                   -- 'YYYY-MM-DD HH:mm' local wall time
  interview_text        TEXT,
  interview_set_at      TEXT,
  interview_confirmed   INTEGER DEFAULT 0,
  interview_reminded_at TEXT,
  nudge_count           INTEGER DEFAULT 0,
  last_nudge_at         TEXT,
  notes                 TEXT,                   -- manager notes (logistics only; ground truth for the assistant)
  last_inbound_at       TEXT,
  last_outbound_at      TEXT,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id),
  direction    TEXT NOT NULL,                   -- in | out
  body         TEXT NOT NULL,
  meta         TEXT,                            -- manager | invite | nudge | reminder | optout | optin | help | fallback
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_applicant ON messages(applicant_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocked (
  phone      TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Append-only: there is no delete endpoint, by design.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

export const STATUSES = ["new", "link_sent", "applied", "invited", "interview_set", "interviewed", "no_show", "hired", "passed", "withdrawn"];
// The assistant replies on its own only while the applicant is moving toward an
// interview. After that the manager owns the relationship: inbound is relayed.
export const OPEN_STATUSES = ["new", "link_sent", "applied", "invited", "interview_set"];

// ── Settings ──────────────────────────────────────────────────

export function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value == null ? null : String(value));
}

// ── Applicants ────────────────────────────────────────────────

export function findApplicantByPhone(phone) {
  return db.prepare("SELECT * FROM applicants WHERE phone = ?").get(phone);
}

export function getApplicant(id) {
  return db.prepare("SELECT * FROM applicants WHERE id = ?").get(id);
}

export function createApplicant(phone, fields = {}) {
  db.prepare("INSERT OR IGNORE INTO applicants (phone) VALUES (?)").run(phone);
  return updateApplicant(findApplicantByPhone(phone).id, fields);
}

const UPDATABLE = [
  "name", "role", "status", "source", "lang", "ai_paused", "consent_at", "consent_basis", "opted_out_at",
  "link_sent_at", "applied_at", "invited_at", "invite_sent_at", "invite_followup_at", "interview_at", "interview_text",
  "interview_set_at", "interview_confirmed", "interview_reminded_at", "nudge_count", "last_nudge_at", "notes",
  "last_inbound_at", "last_outbound_at",
];

export function updateApplicant(id, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE.includes(k) && fields[k] !== undefined);
  if (!keys.length) return getApplicant(id);
  db.prepare(`UPDATE applicants SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
  return getApplicant(id);
}

export function listApplicants() {
  return db.prepare(
    `SELECT a.*,
            (SELECT body FROM messages m WHERE m.applicant_id = a.id ORDER BY m.id DESC LIMIT 1) AS last_message
     FROM applicants a ORDER BY a.id DESC`
  ).all();
}

export function deleteApplicant(id) {
  db.prepare("DELETE FROM messages WHERE applicant_id = ?").run(id);
  db.prepare("DELETE FROM applicants WHERE id = ?").run(id);
}

// ── Messages ──────────────────────────────────────────────────

export function addMessage(applicantId, direction, body, meta = null) {
  db.prepare("INSERT INTO messages (applicant_id, direction, body, meta) VALUES (?, ?, ?, ?)")
    .run(applicantId, direction, body, meta);
  updateApplicant(applicantId, { [direction === "in" ? "last_inbound_at" : "last_outbound_at"]: new Date().toISOString() });
}

export function getConversation(applicantId, limit = 40) {
  return db.prepare("SELECT * FROM messages WHERE applicant_id = ? ORDER BY id DESC LIMIT ?")
    .all(applicantId, limit).reverse();
}

// Proactive texts (not live replies, not the manager's own texts) are capped per
// applicant per 24h. Florida's FTSA allows 3; we hold to 2.
const AUTOMATED_METAS = ["invite", "nudge", "reminder"];
export const AUTOMATION_DAILY_CAP = 2;
export function countRecentAutomated(applicantId, hours = 24) {
  const ph = AUTOMATED_METAS.map(() => "?").join(",");
  return db.prepare(
    `SELECT COUNT(*) n FROM messages WHERE applicant_id = ? AND direction = 'out' AND meta IN (${ph}) AND created_at >= datetime('now', ?)`
  ).get(applicantId, ...AUTOMATED_METAS, `-${hours} hours`).n;
}

// ── Blocklist + audit ─────────────────────────────────────────

export function isBlocked(phone) {
  return !!db.prepare("SELECT 1 FROM blocked WHERE phone = ?").get(phone);
}

export function blockPhone(phone, reason = null) {
  db.prepare("INSERT OR IGNORE INTO blocked (phone, reason) VALUES (?, ?)").run(phone, reason);
}

export function addAudit(action, detail = null) {
  db.prepare("INSERT INTO audit_log (action, detail) VALUES (?, ?)").run(action, detail ? String(detail).slice(0, 4000) : null);
}
