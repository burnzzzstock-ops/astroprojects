import express from "express";
import twilio from "twilio";
import { config } from "./config.js";
import { getTwilioClient } from "./notify.js";
import { handleInbound } from "./pipeline.js";

export const smsRouter = express.Router();

export async function sendSms(to, body) {
  const client = getTwilioClient();
  if (!client || !config.twilio.phoneNumber) {
    console.log(`[sms:dry-run] -> ${to}: ${body}`);
    return;
  }
  await client.messages.create({ from: config.twilio.phoneNumber, to, body });
}

function validSignature(req) {
  if (!config.twilio.validateSignature) return true;
  if (!config.twilio.authToken) return false;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return twilio.validateRequest(config.twilio.authToken, req.get("X-Twilio-Signature") || "", url, req.body);
}

const isManager = (phone) =>
  !!config.manager.phone && phone.replace(/\D/g, "").slice(-10) === config.manager.phone.replace(/\D/g, "").slice(-10);

// Calls to the hiring number: point them to text.
smsRouter.post("/voice", express.urlencoded({ extended: false }), (req, res) => {
  if (!validSignature(req)) return res.status(403).send("invalid signature");
  res.type("text/xml").send(
    `<Response><Say>Thanks for calling the ${config.company.name} hiring line. The fastest way to apply is by text. Text the word JOBS to this number and we'll send you the application right away.</Say></Response>`
  );
});

smsRouter.post("/sms", express.urlencoded({ extended: false }), async (req, res) => {
  if (!validSignature(req)) return res.status(403).send("invalid signature");
  const from = req.body.From || "";
  const body = (req.body.Body || "").trim();
  // Acknowledge right away; the reply goes out over the REST API so a slow AI
  // turn never times out Twilio's webhook.
  res.type("text/xml").send("<Response></Response>");
  if (!from || !body) return;
  try {
    if (isManager(from)) {
      const link = config.publicUrl ? ` ${config.publicUrl.replace(/\/$/, "")}/` : "";
      await sendSms(from, `This is the hiring line. Manage applicants in the console:${link || " open the app's admin page."}`);
      return;
    }
    const reply = await handleInbound(from, body);
    if (reply) await sendSms(from, reply);
  } catch (err) {
    console.error("[sms] inbound handling failed:", err);
  }
});
