// Hiring console API, mounted at /api. Every route needs the admin token.

import express from "express";
import { config } from "../config.js";
import {
  db, isBlocked, blockPhone, addAudit, listApplicants, getApplicant, findApplicantByPhone, createApplicant,
  updateApplicant, getConversation, addMessage, deleteApplicant, STATUSES,
} from "../db.js";
import { normalizePhone } from "../compliance.js";
import { getJobSettings, saveJobSettings, fmtInterviewSlot, nowLocalStamp } from "../settings.js";
import { noteOutbound } from "../pipeline.js";
import { sendPendingInvites } from "../jobs.js";
import { sendSms } from "../sms.js";
import { isQuietHours } from "../textingHours.js";

export const adminRouter = express.Router();

adminRouter.use((req, res, next) => {
  const token = req.get("x-admin-token") || req.query.token;
  if (!config.adminToken || token !== config.adminToken) return res.status(401).json({ error: "unauthorized" });
  next();
});
adminRouter.use(express.json({ limit: "1mb" }));

function load(req, res) {
  const a = getApplicant(Number(req.params.id));
  if (!a) res.status(404).json({ error: "applicant not found" });
  return a;
}

adminRouter.get("/status", (req, res) => {
  res.json({
    company: config.company.name,
    assistant: config.assistantName,
    number: config.twilio.phoneNumber || null,
    timezone: config.timezone,
    textingLive: !!(config.twilio.accountSid && config.twilio.phoneNumber),
    settings: getJobSettings(),
  });
});

adminRouter.post("/settings", (req, res) => {
  const b = req.body || {};
  if (b.applyUrl && !/^https?:\/\/\S+$/i.test(String(b.applyUrl).trim())) {
    return res.status(400).json({ error: "Application link must be a full URL starting with https://" });
  }
  const settings = saveJobSettings({
    applyUrl: b.applyUrl, role: b.role, interviewer: b.interviewer, interviewHours: b.interviewHours, jobFacts: b.jobFacts,
  });
  addAudit("settings", JSON.stringify({ ...settings, jobFacts: `${settings.jobFacts.length} chars` }));
  res.json({ ok: true, settings });
});

adminRouter.get("/applicants", (req, res) => res.json(listApplicants()));

adminRouter.get("/applicants/:id", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  res.json({ applicant: a, messages: getConversation(a.id, 200) });
});

// Manual add: someone who applied elsewhere (IdealTraits, Indeed, walk-in) and gave
// us their number. The attestation is the consent record for texting them about it.
adminRouter.post("/applicants", (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  if (!phone.valid) return res.status(400).json({ error: "Enter a valid 10-digit US mobile number." });
  if (b.attested !== true) return res.status(400).json({ error: "Confirm this person applied and gave you this number." });
  if (isBlocked(phone.e164)) return res.status(400).json({ error: "That number is blocked." });
  const existing = findApplicantByPhone(phone.e164);
  if (existing) return res.status(409).json({ error: `Already in the list as #${existing.id}.`, id: existing.id });
  const s = getJobSettings();
  const a = createApplicant(phone.e164, {
    name: String(b.name || "").trim().slice(0, 80) || null,
    role: String(b.role || "").trim().slice(0, 80) || s.role,
    source: "manual",
    status: "applied",
    applied_at: new Date().toISOString(),
    consent_at: new Date().toISOString(),
    consent_basis: "applied_attested",
    lang: b.lang === "es" ? "es" : "en",
  });
  addAudit("applicant_add", JSON.stringify({ id: a.id, source: "manual" }));
  res.json({ ok: true, applicant: a });
});

const MANUAL_STATUSES = ["applied", "interviewed", "no_show", "hired", "passed", "withdrawn"];
adminRouter.post("/applicants/:id/status", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  const status = String(req.body?.status || "");
  if (!MANUAL_STATUSES.includes(status) || !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${MANUAL_STATUSES.join(", ")}` });
  }
  const fields = { status };
  if (status === "applied" && !a.applied_at) fields.applied_at = new Date().toISOString();
  addAudit("applicant_status", JSON.stringify({ id: a.id, from: a.status, to: status }));
  res.json({ ok: true, applicant: updateApplicant(a.id, fields) });
});

// The manager reviewed the application and wants an interview: the assistant texts two times.
adminRouter.post("/applicants/:id/invite", async (req, res) => {
  const a = load(req, res);
  if (!a) return;
  if (a.opted_out_at) return res.status(400).json({ error: "This applicant opted out of texts. Call them instead." });
  updateApplicant(a.id, { status: "invited", invited_at: new Date().toISOString(), invite_sent_at: null, invite_followup_at: null, ai_paused: 0 });
  addAudit("applicant_invite", JSON.stringify({ id: a.id }));
  try {
    await sendPendingInvites();
  } catch (err) {
    console.error("[admin] invite send failed:", err.message);
  }
  const fresh = getApplicant(a.id);
  res.json({
    ok: true,
    sent: !!fresh.invite_sent_at,
    note: fresh.invite_sent_at ? null
      : isQuietHours(new Date(), fresh.phone) ? "Quiet hours for them right now. The invite goes out at 8 AM their time."
      : "Queued. It goes out within a few minutes (this applicant may have hit today's text limit).",
    applicant: fresh,
  });
});

// The manager booked it by phone (or fixed a time): record it so the reminder fires.
adminRouter.post("/applicants/:id/interview", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(req.body?.scheduled_at || ""));
  if (!m) return res.status(400).json({ error: "Pick a date and time." });
  const slot = `${m[1]} ${m[2]}`;
  if (slot <= nowLocalStamp()) return res.status(400).json({ error: "That time has already passed." });
  res.json({
    ok: true,
    applicant: updateApplicant(a.id, {
      status: "interview_set", interview_at: slot, interview_text: fmtInterviewSlot(slot),
      interview_set_at: new Date().toISOString(), interview_confirmed: 0, interview_reminded_at: null,
    }),
  });
});

adminRouter.post("/applicants/:id/send", async (req, res) => {
  const a = load(req, res);
  if (!a) return;
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Message is empty." });
  if (a.opted_out_at) return res.status(400).json({ error: "This applicant opted out of texts." });
  try {
    await sendSms(a.phone, body);
  } catch (err) {
    return res.status(502).json({ error: `Text failed: ${err.message}` });
  }
  addMessage(a.id, "out", body, "manager");
  noteOutbound(a.id, body);
  res.json({ ok: true });
});

adminRouter.post("/applicants/:id/pause", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  res.json({ ok: true, applicant: updateApplicant(a.id, { ai_paused: 1 }) });
});

adminRouter.post("/applicants/:id/resume", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  res.json({ ok: true, applicant: updateApplicant(a.id, { ai_paused: 0 }) });
});

adminRouter.post("/applicants/:id/notes", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  const notes = String(req.body?.notes ?? "").slice(0, 2000).trim();
  res.json({ ok: true, applicant: updateApplicant(a.id, { notes: notes || null }) });
});

// Spam / abuse: delete them and ignore that number from now on.
adminRouter.post("/applicants/:id/block", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  blockPhone(a.phone, "blocked from console");
  addAudit("applicant_block", JSON.stringify({ id: a.id, status: a.status }));
  deleteApplicant(a.id);
  res.json({ ok: true });
});

adminRouter.delete("/applicants/:id", (req, res) => {
  const a = load(req, res);
  if (!a) return;
  addAudit("applicant_delete", JSON.stringify({ id: a.id, status: a.status, source: a.source, created_at: a.created_at }));
  deleteApplicant(a.id);
  res.json({ ok: true });
});

adminRouter.get("/audit", (req, res) => {
  res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200").all());
});
