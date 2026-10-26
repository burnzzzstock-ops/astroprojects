// Fast, free tests for the legally load-bearing paths: opt-out detection, quiet
// hours, the automation cap, STOP/HELP/START, the invite-before-booking gate,
// and alert redaction. No API cost: the Anthropic base URL points at a closed
// local port, so the one path that reaches the AI fails fast into the holding reply.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hiring-")), "t.db");
process.env.ANTHROPIC_API_KEY = "test-key-never-used";
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";
process.env.MANAGER_PHONE = "";
process.env.DISCORD_WEBHOOK_URL = "";
process.env.PUBLIC_URL = "https://example.test";
process.env.APPLY_URL = "https://apply.example.test/job/123";
process.env.COMPANY_NAME = "Test Motors";
delete process.env.TIMEZONE; // default America/Chicago, which the time tests assume
globalThis.__testMode = true; // no alerts

const { config } = await import("../src/config.js");
const { optOutLang, detectLang, isConfirmation, normalizePhone } = await import("../src/compliance.js");
const { isQuietHours } = await import("../src/textingHours.js");
const { handleInbound, noteOutbound } = await import("../src/pipeline.js");
const { executeTool } = await import("../src/agent.js");
const { getJobSettings, saveJobSettings } = await import("../src/settings.js");
const { redactForThirdParty } = await import("../src/notify.js");
const {
  createApplicant, getApplicant, findApplicantByPhone, updateApplicant, addMessage, countRecentAutomated, blockPhone,
} = await import("../src/db.js");

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; };
const at = (iso) => new Date(iso);
const localStamp = (d) => d.toLocaleString("sv-SE", { timeZone: config.timezone }).slice(0, 16);

// ── A. Text classifiers ──
ok("opt-out EN: 'stop texting me'", optOutLang("stop texting me") === "en");
ok("opt-out EN: 'take me off your list'", optOutLang("take me off your list") === "en");
ok("opt-out ES: 'no me manden mas mensajes'", optOutLang("no me manden mas mensajes") === "es");
ok("opt-out ES: 'darme de baja'", optOutLang("quiero darme de baja") === "es");
ok("no false positive: 'can I stop by tomorrow'", optOutLang("can I stop by tomorrow at 5?") === null);
ok("no false positive: 'stop by for the interview'", optOutLang("I can stop by for the interview friday") === null);
ok("detectLang: 'busco trabajo' is Spanish", detectLang("busco trabajo") === "es");
ok("detectLang: EMPLEO is Spanish", detectLang("EMPLEO") === "es");
ok("detectLang: English", detectLang("are you hiring") === "en");
ok("confirm: 'C'", isConfirmation("C"));
ok("confirm: 'sí'", isConfirmation("sí"));
ok("not a confirm: a question", !isConfirmation("what should I bring?"));
ok("phone: formats to E.164", normalizePhone("(228) 555-0177").e164 === "+12285550177");
ok("phone: rejects short", !normalizePhone("555-0177").valid);

// ── B. Quiet hours (TCPA 8AM-9PM recipient-local, Florida 8PM) ──
ok("MS 10:00 CT allowed", !isQuietHours(at("2026-07-01T15:00:00Z"), "2285550142"));
ok("MS 21:30 CT quiet", isQuietHours(at("2026-07-02T02:30:00Z"), "2285550142"));
ok("MS 7:59 AM CT quiet (boundary)", isQuietHours(at("2026-07-01T12:59:00Z"), "2285550142"));
ok("FL 20:30 ET quiet (FTSA 8PM cap)", isQuietHours(at("2026-07-02T00:30:00Z"), "3055550100"));

// ── C. A new texter becomes an applicant; the AI is unreachable → one holding reply ──
{
  const phone = "+12285550104";
  const r = await handleInbound(phone, "JOBS");
  const a = findApplicantByPhone(phone);
  ok("new texter: applicant created", !!a && a.source === "text_in");
  ok("consent record stamped", a.consent_basis === "inbound_text" && !!a.consent_at);
  ok("AI failure → holding reply", typeof r === "string" && r.length > 0);
  ok("holding reply deduped within 15 min", (await handleInbound(phone, "hello?")) === null);
  await handleInbound("+12285550112", "EMPLEO");
  ok("Spanish keyword tags the applicant Spanish", findApplicantByPhone("+12285550112").lang === "es");
  blockPhone("+12285550199");
  ok("blocked number: ignored, nothing created", (await handleInbound("+12285550199", "JOBS")) === null && !findApplicantByPhone("+12285550199"));
}

// ── D. STOP / HELP / opt-out language / START ──
{
  const phone = "+12285550105";
  createApplicant(phone, { status: "link_sent" });
  const help = await handleInbound(phone, "HELP");
  ok("HELP: identifies sender + STOP", /STOP/.test(help) && help.includes("Test Motors"));
  ok("STOP: no reply", (await handleInbound(phone, "STOP")) === null);
  ok("STOP: opted out", !!findApplicantByPhone(phone).opted_out_at);
  ok("opted out: later text relayed, no reply", (await handleInbound(phone, "wait what about the job")) === null);
  const start = await handleInbound(phone, "START");
  ok("START: re-subscribed with a reply", !!start && !findApplicantByPhone(phone).opted_out_at);
  const p2 = "+12285550106";
  createApplicant(p2, { status: "new" });
  const es = await handleInbound(p2, "ya no me manden mensajes");
  ok("Spanish opt-out: honored, Spanish confirmation", !!findApplicantByPhone(p2).opted_out_at && /mensajes/.test(es));
}

// ── E. Closed / paused applicants are relayed, never auto-answered ──
{
  createApplicant("+12285550107", { status: "hired" });
  ok("hired: relayed, no auto reply", (await handleInbound("+12285550107", "what time do I start monday")) === null);
  createApplicant("+12285550108", { status: "link_sent", ai_paused: 1 });
  ok("paused: relayed, no auto reply", (await handleInbound("+12285550108", "question about pay")) === null);
}

// ── F. The booking gate: no interview until a manager invites ──
{
  let a = createApplicant("+12285550109", { status: "applied" });
  const future = new Date(Date.now() + 3 * 86400000);
  while (future.getDay() === 0) future.setDate(future.getDate() + 1);
  const slot = `${localStamp(future).slice(0, 10)} 10:00`;
  const blocked = await executeTool(a, "book_interview", { scheduled_at: slot, time_text: "x" });
  ok("book refused before the manager invites", blocked.isError && getApplicant(a.id).status === "applied");
  a = updateApplicant(a.id, { status: "invited" });
  ok("book refuses a past time", (await executeTool(a, "book_interview", { scheduled_at: localStamp(new Date(Date.now() - 86400000)), time_text: "x" })).isError);
  const sun = new Date(Date.now() + 7 * 86400000);
  while (sun.getDay() !== 0) sun.setDate(sun.getDate() + 1);
  ok("book refuses Sunday", (await executeTool(a, "book_interview", { scheduled_at: `${localStamp(sun).slice(0, 10)} 11:00`, time_text: "x" })).isError);
  ok("book refuses 10 PM", (await executeTool(a, "book_interview", { scheduled_at: `${slot.slice(0, 10)} 22:00`, time_text: "x" })).isError);
  ok("book rejects a bad format", (await executeTool(a, "book_interview", { scheduled_at: "next tuesday", time_text: "x" })).isError);
  const booked = await executeTool(a, "book_interview", { scheduled_at: slot, time_text: "that day at 10" });
  a = getApplicant(a.id);
  ok("book works once invited", !booked.isError && a.status === "interview_set" && a.interview_at === slot);
  updateApplicant(a.id, { interview_reminded_at: new Date().toISOString() });
  ok("'C' after the reminder confirms", !!(await handleInbound("+12285550109", "C")) && getApplicant(a.id).interview_confirmed === 1);
  const n = createApplicant("+12285550110", { status: "new" });
  ok("mark_application_complete → applied", !(await executeTool(n, "mark_application_complete", {})).isError && getApplicant(n.id).status === "applied");
}

// ── G. Link tracking + the automation cap ──
{
  const a = createApplicant("+12285550111", { status: "new" });
  noteOutbound(a.id, "Here you go: https://other.example.test");
  ok("unrelated link doesn't count", getApplicant(a.id).status === "new");
  noteOutbound(a.id, `Here's the application: ${getJobSettings().applyUrl}`);
  ok("application link moves new → link_sent", getApplicant(a.id).status === "link_sent" && !!getApplicant(a.id).link_sent_at);
  addMessage(a.id, "out", "live reply");
  addMessage(a.id, "out", "manager text", "manager");
  ok("cap ignores live replies + manager texts", countRecentAutomated(a.id) === 0);
  addMessage(a.id, "out", "nudge", "nudge");
  addMessage(a.id, "out", "invite", "invite");
  ok("cap counts nudge + invite", countRecentAutomated(a.id) === 2);
}

// ── H. Settings + redaction ──
{
  saveJobSettings({ applyUrl: "", role: "BDC Rep" });
  ok("console-saved empty link overrides the env default", getJobSettings().applyUrl === "" && getJobSettings().role === "BDC Rep");
  const red = redactForThirdParty("NEW APPLICANT by text: #12 (Jane Doe / +12285550199) asked about the job. jane@x.com");
  ok("redaction strips name, phone, email", !/Jane|555|jane@/.test(red) && red.includes("#12"));
}

console.log(`✓ ${pass} assertions passed`);
process.exit(0);
