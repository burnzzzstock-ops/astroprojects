import "dotenv/config";

const env = (key, fallback = "") => (process.env[key] ?? fallback).trim();

export const config = {
  port: Number(env("PORT", "3000")),
  adminToken: env("ADMIN_TOKEN"),
  dbPath: env("DB_PATH", "./data/hiring.db"),

  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  agentModel: env("AGENT_MODEL", "claude-opus-5-5"),

  // The hiring assistant's first name. Deliberately its own persona, separate from
  // the sales assistant, so applicants and car buyers never talk to the same "person".
  assistantName: env("ASSISTANT_NAME", "Jordan"),

  // Drives the assistant's clock, interview math, quiet hours fallback, and crons.
  timezone: env("TIMEZONE", "America/Chicago"),

  company: {
    name: env("COMPANY_NAME", "the dealership"),
    address: env("COMPANY_ADDRESS"),
  },
  contactEmail: env("CONTACT_EMAIL"),

  // Who gets alerts and is the default interviewer.
  manager: {
    name: env("MANAGER_NAME", "the hiring manager"),
    phone: env("MANAGER_PHONE"),
  },

  // A dedicated Twilio number for hiring (NOT the sales assistant's number), with
  // its own A2P 10DLC campaign registered for recruiting messages.
  twilio: {
    accountSid: env("TWILIO_ACCOUNT_SID"),
    authToken: env("TWILIO_AUTH_TOKEN"),
    phoneNumber: env("TWILIO_PHONE_NUMBER"),
    validateSignature: env("TWILIO_VALIDATE_SIGNATURE", "true") !== "false",
  },

  discordWebhookUrl: env("DISCORD_WEBHOOK_URL"),
  // Base URL of this app, used for the console link in redacted Discord alerts.
  publicUrl: env("PUBLIC_URL"),

  // Job setup defaults. The console's Setup tab overrides all of these.
  job: {
    applyUrl: env("APPLY_URL"),
    role: env("JOB_ROLE", "Sales Consultant"),
    interviewHours: env("INTERVIEW_HOURS", "Monday-Friday, 9 AM to 5 PM"),
  },

  // After the manager texts an applicant from the console, the assistant stays
  // quiet this many minutes so the two never talk over each other.
  copilotCooldownMin: Number(env("COPILOT_COOLDOWN_MIN", "12")),
};

export function assertConfig() {
  const problems = [];
  if (!config.anthropicApiKey) problems.push("ANTHROPIC_API_KEY is not set — the assistant cannot reply.");
  if (!config.adminToken || config.adminToken.length < 16) problems.push("ADMIN_TOKEN is not set to a long random secret — the console is unprotected.");
  if (!config.twilio.accountSid || !config.twilio.phoneNumber) problems.push("Twilio is not configured — texts are logged, not sent.");
  if (!config.manager.phone && !config.discordWebhookUrl) problems.push("Neither MANAGER_PHONE nor DISCORD_WEBHOOK_URL is set — alerts have nowhere to go.");
  return problems;
}
