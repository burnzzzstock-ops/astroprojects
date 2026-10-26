import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, assertConfig } from "./config.js";
import { smsRouter } from "./sms.js";
import { adminRouter } from "./routes/admin.js";
import { publicRouter } from "./routes/public.js";
import { scheduleJobs } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", true);

const BOOTED_AT = new Date().toISOString();
app.get("/health", (req, res) => res.json({
  ok: true,
  booted: BOOTED_AT,
  sha: (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || undefined,
}));

app.use("/", publicRouter);
app.use("/webhooks/twilio", smsRouter);
app.use("/api", adminRouter);
app.use("/admin", express.static(path.join(__dirname, "..", "public")));

const server = app.listen(config.port, () => {
  console.log(`hiring line listening on :${config.port}`);
  console.log(`  console:        http://localhost:${config.port}/admin/`);
  console.log(`  twilio webhook: POST /webhooks/twilio/sms (voice: /webhooks/twilio/voice)`);
  for (const warning of assertConfig()) console.warn(`  ⚠ ${warning}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

scheduleJobs();
