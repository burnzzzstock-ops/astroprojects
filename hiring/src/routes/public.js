// Public pages for the A2P 10DLC registration of the hiring number: a program
// page showing the opt-in (call to action + disclosures), privacy, and terms.

import express from "express";
import { config } from "../config.js";

export const publicRouter = express.Router();

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin:0; background:#f7f8fa; color:#1b2330; font:16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width:720px; margin:0 auto; padding:32px 20px 56px; }
  h1 { font-size:26px; margin:0 0 12px; } h2 { font-size:18px; margin:28px 0 8px; }
  .cta { background:#fff; border:1px solid #dfe3ea; border-radius:12px; padding:18px; margin:20px 0; }
  .cta b { font-size:20px; } .fine { color:#5b6575; font-size:14px; }
  a { color:#0b5cad; } footer { margin-top:32px; color:#5b6575; font-size:14px; }
</style></head><body><main>${body}
<footer><a href="/">Hiring text line</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer></main></body></html>`;

const co = () => esc(config.company.name);
const num = () => {
  const d = String(config.twilio.phoneNumber || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "our hiring number";
};
const contact = () => {
  const parts = [
    config.contactEmail ? `email <a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>` : null,
    config.twilio.phoneNumber ? `text ${num()}` : null,
  ].filter(Boolean);
  return parts.join(" or ") || "reply to any of our messages";
};

publicRouter.get("/", (req, res) => {
  res.type("html").send(page(`Careers text line — ${co()}`, `
<h1>Apply by text at ${co()}</h1>
<p>Interested in working at ${co()}? Text us and we'll send you the job application, answer questions about the position, and help you schedule an interview.</p>
<div class="cta">
  <b>Text JOBS to ${num()}</b>
  <p class="fine">By texting JOBS (or any message about a job) to ${num()}, you agree to receive text messages from ${co()} about your job application and interview scheduling, including up to two application reminders and an interview-day reminder. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of employment. See our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.</p>
</div>
<p>If you applied with us online and gave us your mobile number, we may also text you about scheduling your interview. Reply STOP at any time to stop.</p>
`));
});

publicRouter.get("/privacy", (req, res) => {
  res.type("html").send(page(`Privacy Policy — ${co()} hiring text line`, `
<h1>Privacy Policy: Hiring Text Line</h1>
<p>This policy covers the job-applicant text-messaging program operated by ${co()} ("we", "us").</p>
<h2>Information we collect</h2>
<p>When you text us about a job, or when you apply with us and give us your mobile number, we collect your phone number, the messages you send, your name if you share it, and interview scheduling details. We do not ask for sensitive information such as your Social Security number, date of birth, or financial details by text.</p>
<h2>How we use it</h2>
<p>Only to send you our application link, answer questions about the position, schedule your interview, and send related reminders. We do not use it for marketing.</p>
<h2>Automated assistance (AI)</h2>
<p>Some replies are written with the help of an AI assistant working on our behalf, so the content of your messages is processed by our AI provider. The assistant only shares information and schedules interviews. Every hiring decision is made by our managers.</p>
<h2>Service providers we share with</h2>
<p>We do not sell your information, and <strong>we do not share your mobile information with third parties or affiliates for their marketing or promotional purposes.</strong> We share it only with vendors that run this program:</p>
<ul>
  <li><strong>Twilio</strong> delivers the text messages.</li>
  <li><strong>Anthropic</strong> provides the AI that drafts replies. Under our commercial terms your messages are not used to train AI models.</li>
  <li><strong>Discord</strong> carries internal staff alerts, with your name and number removed.</li>
</ul>
<p>We may also disclose information if required by law.</p>
<h2>Data retention</h2>
<p>We keep applicant messages for at least as long as employment record-keeping laws require, then delete them. If you opt out, we keep the minimal record needed to make sure we don't text you again.</p>
<h2>Your choices</h2>
<p>Reply <strong>STOP</strong> at any time to stop receiving messages, or <strong>HELP</strong> for help. Message and data rates may apply. To ask about or delete your information, ${contact()}.</p>
`));
});

publicRouter.get("/terms", (req, res) => {
  res.type("html").send(page(`SMS Terms — ${co()} hiring text line`, `
<h1>SMS Terms: Hiring Text Line</h1>
<h2>Program description</h2>
<p>${co()} texts job applicants about their application and interview: the application link, answers about the position, up to two application reminders, an interview invitation, and an interview-day reminder. You join by texting JOBS (or any message about a job) to ${num()}, or by giving us your mobile number when you apply with us. Consent is not a condition of employment.</p>
<h2>Message frequency</h2>
<p>Varies with your conversation. Automated reminders are limited to two per day.</p>
<h2>Fees</h2>
<p>Message and data rates may apply. We do not charge for this program.</p>
<h2>Opt-out and help</h2>
<p>Reply <strong>STOP</strong> to cancel. We'll send one message confirming you're unsubscribed. Reply <strong>HELP</strong> for help, or ${contact()}.</p>
<h2>Carriers</h2>
<p>Carriers are not liable for delayed or undelivered messages.</p>
<h2>Privacy</h2>
<p>See our <a href="/privacy">Privacy Policy</a>.</p>
`));
});
