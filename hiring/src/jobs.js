import cron from "node-cron";
import { config } from "./config.js";
import {
  db, getApplicant, updateApplicant, addMessage, getConversation, countRecentAutomated, AUTOMATION_DAILY_CAP,
} from "./db.js";
import { sendSms } from "./sms.js";
import { isQuietHours } from "./textingHours.js";
import { notifyManager } from "./notify.js";
import { runAgent, who } from "./agent.js";
import { getJobSettings, fmtClock, nowLocalStamp, parseLocal, hoursSince } from "./settings.js";
import { noteOutbound } from "./pipeline.js";

// Every proactive text passes two gates: the recipient's local quiet hours
// (8 AM-9 PM, Florida 8 PM) and the 2-per-24h automation cap.
function mayText(a) {
  return !isQuietHours(new Date(), a.phone) && countRecentAutomated(a.id) < AUTOMATION_DAILY_CAP;
}

const firstName = (a) => (a.name || "").trim().split(/\s+/)[0] || "";

function lastMessage(applicantId) {
  return db.prepare("SELECT direction, created_at FROM messages WHERE applicant_id = ? ORDER BY id DESC LIMIT 1").get(applicantId);
}

async function send(a, body, meta) {
  addMessage(a.id, "out", body, meta);
  await sendSms(a.phone, body);
}

// ── Invite: the manager tapped Invite, so text the applicant two interview times ──

function inviteTemplate(a, s) {
  const first = firstName(a);
  return a.lang === "es"
    ? `Hola${first ? " " + first : ""}, soy ${config.assistantName} de ${config.company.name}. ${s.interviewer} quiere programar una entrevista con usted para el puesto de ${a.role || s.role}. ¿Qué día y hora le funcionan mejor?`
    : `Hi${first ? " " + first : ""}, this is ${config.assistantName} with ${config.company.name}. ${s.interviewer} would like to set up an interview with you for the ${a.role || s.role} position. What day and time work best for you?`;
}

export async function sendPendingInvites() {
  const pending = db.prepare(
    "SELECT * FROM applicants WHERE status = 'invited' AND invite_sent_at IS NULL AND opted_out_at IS NULL AND ai_paused = 0"
  ).all();
  let sent = 0;
  for (const a of pending) {
    if (!mayText(a)) continue;
    // Claim it first so the cron tick and a console tap can't both send.
    const claimed = db.prepare("UPDATE applicants SET invite_sent_at = datetime('now') WHERE id = ? AND invite_sent_at IS NULL").run(a.id).changes;
    if (!claimed) continue;
    const s = getJobSettings();
    const fresh = getApplicant(a.id);
    const firstTouch = getConversation(a.id, 1).length === 0;
    let body = "";
    try {
      ({ reply: body } = await runAgent(fresh,
        `${s.interviewer} reviewed this applicant and wants to interview them for the ${fresh.role || s.role} role. Write the text that invites them. ` +
        (firstTouch
          ? "You have NOT texted them before: introduce yourself with your name and the company, and mention their application for the role. "
          : "Pick up naturally from the thread. ") +
        `Say ${s.interviewer} would like to meet, and offer exactly two specific interview times inside interview hours. ONE short text.`));
    } catch (err) {
      console.error(`[jobs] invite agent failed for applicant ${a.id}:`, err.message);
    }
    if (!body) body = inviteTemplate(fresh, s);
    try {
      await send(fresh, body, "invite");
      noteOutbound(fresh.id, body);
      sent++;
    } catch (err) {
      console.error(`[jobs] invite send failed for applicant ${a.id}:`, err.message);
      await notifyManager(`⚠️ Couldn't text the interview invite to applicant ${who(fresh)}: ${err.message}. Give them a call.`);
    }
  }
  return sent;
}

// ── Application reminders: link went out, no "done" yet. Two max, then stop. ──

function nudgeTemplate(a, s, n) {
  const first = firstName(a);
  const role = a.role || s.role;
  if (a.lang === "es") {
    return n === 0
      ? `Hola${first ? " " + first : ""}, soy ${config.assistantName} de ${config.company.name}. Solo para confirmar que le llegó la solicitud para el puesto de ${role}: ${s.applyUrl} Cuando la complete, el gerente la revisa y le escribo con los siguientes pasos.`
      : `Hola${first ? " " + first : ""}, un último recordatorio sobre el puesto de ${role}. Aquí está la solicitud otra vez si le interesa: ${s.applyUrl} Si no es buen momento, no se preocupe.`;
  }
  return n === 0
    ? `Hi${first ? " " + first : " there"}, it's ${config.assistantName} at ${config.company.name}. Just making sure the ${role} application came through okay: ${s.applyUrl} Once it's in, the hiring manager takes a look and I'll text you about next steps.`
    : `Hey${first ? " " + first : ""}, one last nudge from me on the ${role} opening. Here's the application again if you still want in: ${s.applyUrl} If the timing's not right, no worries at all.`;
}

const NUDGE_AFTER_HOURS = [20, 44]; // ~a day after the link, then ~2 days after that

export async function runApplicationNudges() {
  const s = getJobSettings();
  if (!s.applyUrl) return 0;
  const rows = db.prepare(
    "SELECT * FROM applicants WHERE status = 'link_sent' AND opted_out_at IS NULL AND ai_paused = 0 AND nudge_count < ?"
  ).all(NUDGE_AFTER_HOURS.length);
  let sent = 0;
  for (const a of rows) {
    // Only while we're the ones waiting. An unanswered applicant message is a human's job.
    const last = lastMessage(a.id);
    if (!last || last.direction !== "out" || hoursSince(last.created_at) < NUDGE_AFTER_HOURS[a.nudge_count]) continue;
    if (!mayText(a)) continue;
    try {
      await send(a, nudgeTemplate(a, s, a.nudge_count), "nudge");
      updateApplicant(a.id, { nudge_count: a.nudge_count + 1, last_nudge_at: new Date().toISOString() });
      sent++;
    } catch (err) {
      console.error(`[jobs] nudge failed for applicant ${a.id}:`, err.message);
    }
  }
  return sent;
}

// ── Invite follow-up: they never answered the interview invite. One text, ~a day later. ──

export async function runInviteFollowups() {
  const s = getJobSettings();
  const rows = db.prepare(
    "SELECT * FROM applicants WHERE status = 'invited' AND invite_sent_at IS NOT NULL AND invite_followup_at IS NULL AND opted_out_at IS NULL AND ai_paused = 0"
  ).all();
  let sent = 0;
  for (const a of rows) {
    const last = lastMessage(a.id);
    if (!last || last.direction !== "out" || hoursSince(last.created_at) < 22) continue;
    if (!mayText(a)) continue;
    const first = firstName(a);
    const role = a.role || s.role;
    const body = a.lang === "es"
      ? `Hola${first ? " " + first : ""}, le escribo para dar seguimiento a la entrevista para el puesto de ${role}. ¿Qué día y hora le quedan bien esta semana?`
      : `Hi${first ? " " + first : ""}, just following up on the interview for the ${role} spot. Is there a day and time this week that works for you?`;
    try {
      await send(a, body, "nudge");
      updateApplicant(a.id, { invite_followup_at: new Date().toISOString() });
      sent++;
    } catch (err) {
      console.error(`[jobs] invite follow-up failed for applicant ${a.id}:`, err.message);
    }
  }
  return sent;
}

// ── Interview-day reminder: one text the morning of, "reply C to confirm". ──

export async function runInterviewReminders() {
  const s = getJobSettings();
  const now = nowLocalStamp();
  const rows = db.prepare(
    "SELECT * FROM applicants WHERE status = 'interview_set' AND interview_at IS NOT NULL AND interview_reminded_at IS NULL AND opted_out_at IS NULL AND ai_paused = 0"
  ).all();
  let sent = 0;
  for (const a of rows) {
    const slot = String(a.interview_at).slice(0, 16);
    if (slot.slice(0, 10) !== now.slice(0, 10)) continue;
    const t = parseLocal(slot);
    if (!t || (t - parseLocal(now)) / 60000 < 60) continue; // passed, or too close to be useful
    if (hoursSince(a.interview_set_at) < 3) continue;       // they just booked it
    if (!mayText(a)) continue;
    const first = firstName(a);
    const addr = config.company.address ? `, ${config.company.address}` : "";
    const body = a.lang === "es"
      ? `Hola${first ? " " + first : ""}, le esperamos hoy a las ${fmtClock(t)} para su entrevista con ${s.interviewer} en ${config.company.name}${addr}. Responda C para confirmar, o escríbame si algo cambió.`
      : `Hi${first ? " " + first : ""}, looking forward to your interview today at ${fmtClock(t)} with ${s.interviewer} at ${config.company.name}${addr}. Reply C to confirm, or text me if anything changed.`;
    try {
      await send(a, body, "reminder");
      updateApplicant(a.id, { interview_reminded_at: new Date().toISOString() });
      sent++;
    } catch (err) {
      console.error(`[jobs] reminder failed for applicant ${a.id}:`, err.message);
    }
  }
  return sent;
}

export async function runJobsOnce() {
  return {
    invites: await sendPendingInvites(),
    nudges: await runApplicationNudges(),
    followups: await runInviteFollowups(),
    reminders: await runInterviewReminders(),
  };
}

export function scheduleJobs() {
  // Every 5 minutes; every send is quiet-hours + cap gated per recipient.
  cron.schedule("*/5 * * * *", () => {
    runJobsOnce().catch((err) => console.error("[jobs] run failed:", err.message));
  }, { timezone: config.timezone });
}
