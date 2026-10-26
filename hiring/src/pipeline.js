import { config } from "./config.js";
import {
  db, isBlocked, findApplicantByPhone, createApplicant, updateApplicant, getApplicant, addMessage, OPEN_STATUSES,
} from "./db.js";
import { optOutLang, detectLang, isConfirmation, OPT_OUT_WORDS, OPT_IN_WORDS, HELP_WORDS } from "./compliance.js";
import { notifyManager } from "./notify.js";
import { getJobSettings, hoursSince } from "./settings.js";
import { runAgent, who } from "./agent.js";

/**
 * Every text to the hiring number lands here. Records it, handles the
 * compliance keywords, and returns the reply to send (or null for silence).
 */
export async function handleInbound(phone, text) {
  if (isBlocked(phone)) return null;
  let a = findApplicantByPhone(phone);
  if (!a) {
    const s = getJobSettings();
    a = createApplicant(phone, {
      source: "text_in",
      role: s.role,
      consent_at: new Date().toISOString(),
      consent_basis: "inbound_text",
      lang: detectLang(text),
    });
    await notifyManager(
      `🧑‍💼 NEW APPLICANT by text: ${who(a)} asked about the ${s.role} job. ${config.assistantName} is sending the application link.` +
      (s.applyUrl ? "" : "\n⚠️ No application link is set, so there's nothing to send. Add it in the hiring console → Setup.")
    );
  }
  return respond(a, text);
}

async function respond(a, text) {
  const word = (text || "").trim().toLowerCase();

  // STOP: the carrier blocks our number for them; record it and go silent.
  if (OPT_OUT_WORDS.includes(word)) {
    addMessage(a.id, "in", text, "optout");
    updateApplicant(a.id, { opted_out_at: new Date().toISOString() });
    await notifyManager(`🛑 OPT-OUT: applicant ${who(a)} texted STOP. No more texts to them unless they text START. Call them if you still want to talk.`);
    return null;
  }

  if (HELP_WORDS.includes(word)) {
    addMessage(a.id, "in", text, "help");
    const reply = word === "ayuda"
      ? `Soy ${config.assistantName} de ${config.company.name}, y le ayudo con su solicitud de empleo. Responda con cualquier pregunta. Escriba STOP para darse de baja, START para reanudar.`
      : `This is ${config.assistantName} with ${config.company.name}, helping with your job application. Reply with any question. Text STOP to opt out anytime, START to resume.`;
    addMessage(a.id, "out", reply, "help");
    return reply;
  }

  // An opt-out in their own words (FCC: honor any reasonable request): one
  // confirmation in their language, then silence.
  const optLang = !a.opted_out_at ? optOutLang(text) : null;
  if (optLang) {
    addMessage(a.id, "in", text, "optout");
    updateApplicant(a.id, { opted_out_at: new Date().toISOString() });
    await notifyManager(`🛑 OPT-OUT (in their own words): applicant ${who(a)} asked to stop: "${text}". No more texts to them unless they text START.`);
    const reply = optLang === "es"
      ? "Listo, no le enviaremos más mensajes. Responda START en cualquier momento si cambia de opinión."
      : "Got it, you're unsubscribed and we won't text you again. Reply START anytime if you change your mind.";
    addMessage(a.id, "out", reply, "optout");
    return reply;
  }

  if (a.opted_out_at && OPT_IN_WORDS.includes(word)) {
    addMessage(a.id, "in", text, "optin");
    updateApplicant(a.id, { opted_out_at: null });
    await notifyManager(`🎉 RE-SUBSCRIBED: applicant ${who(a)} texted START.`);
    const reply = a.lang === "es"
      ? "¡Bienvenido de nuevo! ¿En qué le puedo ayudar con su solicitud?"
      : "Welcome back! What can I help you with on your application?";
    addMessage(a.id, "out", reply, "optin");
    return reply;
  }

  addMessage(a.id, "in", text);
  if (detectLang(text) === "es" && a.lang !== "es") a = updateApplicant(a.id, { lang: "es" });

  if (a.opted_out_at) {
    await notifyManager(`🛑 Opted-out applicant ${who(a)} texted: "${text}". Can't text back until they send START. Call them if needed.`);
    return null;
  }

  // "Reply C to confirm" on the interview-day reminder.
  if (a.status === "interview_set" && a.interview_reminded_at && !a.interview_confirmed && isConfirmation(word)) {
    updateApplicant(a.id, { interview_confirmed: 1 });
    const s = getJobSettings();
    await notifyManager(`✅ Interview CONFIRMED by reply: applicant ${who(a)}, ${a.interview_text || a.interview_at} with ${s.interviewer}.`);
    const reply = a.lang === "es"
      ? "¡Perfecto, le esperamos! Escríbame aquí si algo cambia."
      : "Perfect, see you then! Text me here if anything changes.";
    addMessage(a.id, "out", reply, "reminder");
    return reply;
  }

  // Past the interview, or the manager paused the assistant: a person owns this now.
  if (!OPEN_STATUSES.includes(a.status) || a.ai_paused) {
    const paused = a.ai_paused ? `, ${config.assistantName} paused` : "";
    await notifyManager(`💬 Applicant ${who(a)} [${a.status}${paused}] texted:\n"${text}"\nReply from the hiring console.`);
    return null;
  }

  // The manager texted them from the console recently: stay out of the way and relay.
  const lastManager = db.prepare(
    "SELECT created_at FROM messages WHERE applicant_id = ? AND meta = 'manager' ORDER BY id DESC LIMIT 1"
  ).get(a.id);
  if (lastManager && hoursSince(lastManager.created_at) * 60 < config.copilotCooldownMin) {
    await notifyManager(`💬 Applicant ${who(a)} replied while you're mid-conversation:\n"${text}"`);
    return null;
  }

  try {
    const { reply } = await runAgent(getApplicant(a.id));
    if (reply) {
      addMessage(a.id, "out", reply);
      noteOutbound(a.id, reply);
      // Invited, but the invite was still queued (quiet hours / cap): this live reply
      // already offered times, so the queued invite must not go out on top of it.
      const fresh = getApplicant(a.id);
      if (fresh.status === "invited" && !fresh.invite_sent_at) updateApplicant(a.id, { invite_sent_at: new Date().toISOString() });
      return reply;
    }
    await notifyManager(`⚠️ No AI reply for applicant ${who(a)}. Their message: "${text}". You may want to reply from the console.`);
  } catch (err) {
    console.error(`[pipeline] agent failed for applicant ${a.id}:`, err.message);
    await notifyManager(`⚠️ AI error replying to applicant ${who(a)}: ${err.message}\nTheir message: "${text}". Sending a holding reply.`);
  }
  return sendFallback(a);
}

// One holding reply (deduped to 15 min) so a live applicant never gets silence.
function sendFallback(a) {
  const recent = db.prepare(
    "SELECT 1 FROM messages WHERE applicant_id = ? AND direction = 'out' AND meta = 'fallback' AND created_at >= datetime('now','-15 minutes') LIMIT 1"
  ).get(a.id);
  if (recent) return null;
  const msg = a.lang === "es"
    ? "¡Gracias por su mensaje! Le respondo en un momento."
    : "Thanks for the message! Give me just a minute and I'll get right back to you.";
  addMessage(a.id, "out", msg, "fallback");
  return msg;
}

// Any outbound (the assistant's or the manager's) that carries the application
// link moves a brand-new applicant to link_sent, which arms the reminders.
export function noteOutbound(applicantId, body) {
  const a = getApplicant(applicantId);
  const { applyUrl } = getJobSettings();
  if (!a || !applyUrl || a.link_sent_at || !String(body).includes(applyUrl)) return;
  updateApplicant(a.id, { link_sent_at: new Date().toISOString(), status: a.status === "new" ? "link_sent" : a.status });
}
