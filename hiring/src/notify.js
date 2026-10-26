import twilio from "twilio";
import { config } from "./config.js";

let twilioClient = null;
if (config.twilio.accountSid && config.twilio.authToken) {
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
}
export const getTwilioClient = () => twilioClient;

// Discord keeps our messages on its servers, so alerts posted there lose the
// applicant's name, phone, and email. The manager's own phone gets the full text.
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const PHONE_RES = [/\+\d{10,15}\b/g, /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g, /\b\d{10}\b/g];

export function redactForThirdParty(text) {
  let t = String(text);
  t = t.replace(/(#\d+)\s*\([^)]*\)/g, "$1"); // "#12 (Jane Doe / +1228...)" -> "#12"
  t = t.replace(EMAIL_RE, "[email]");
  for (const re of PHONE_RES) t = t.replace(re, "[phone]");
  if (config.publicUrl) {
    const m = t.match(/#(\d+)/);
    t += `\nConsole: ${config.publicUrl.replace(/\/$/, "")}/${m ? ` (applicant #${m[1]})` : ""}`;
  }
  return t.slice(0, 1900);
}

/** Alert the hiring manager. Never throws. */
export async function notifyManager(text) {
  if (globalThis.__testMode) return;
  const jobs = [];
  if (twilioClient && config.twilio.phoneNumber && config.manager.phone) {
    jobs.push(
      twilioClient.messages.create({ from: config.twilio.phoneNumber, to: config.manager.phone, body: text })
        .catch((e) => console.error("[notify] SMS failed:", e.message))
    );
  }
  if (config.discordWebhookUrl) {
    jobs.push(
      fetch(config.discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: redactForThirdParty(text) }),
      }).catch((e) => console.error("[notify] Discord failed:", e.message))
    );
  }
  if (!jobs.length) console.log("[notify] (no alert channels configured)\n" + redactForThirdParty(text));
  await Promise.all(jobs);
}
