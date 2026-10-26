# Hiring Line — Developer Guide

Text-to-apply hiring assistant for Astro Ford. Applicants text JOBS to a dedicated
hiring number; the assistant (persona from ASSISTANT_NAME, default "Jordan", NOT
Riley) sends the IdealTraits application link, answers questions only from the job
facts the manager writes, reminds them to finish, and books the interview only
after the manager reviews IdealTraits and taps Invite. Operator setup + A2P
checklist: README.md. Repo-wide standing rules (keep docs current, no real PII):
../CLAUDE.md.

## Status (2026-10-26)

Built and tested locally, NOT deployed. Needs: its own Twilio number + A2P 10DLC
recruiting campaign, a Railway service (Root Directory `hiring`, volume at /app/data),
and the job setup filled in. Split out of TextDrive at the operator's request
("separate from Riley"); the earlier in-TextDrive version was reverted there.

## Architecture

- `src/server.js` — Express. Public: `/` program page (A2P call to action +
  disclosures), `/privacy`, `/terms`, `/health` ({ok, booted, sha}). Webhooks:
  `/webhooks/twilio/sms`, `/webhooks/twilio/voice` (says "text JOBS"). Console
  `/admin` (public/index.html), API `/api` (x-admin-token or ?token=).
- `src/pipeline.js` — handleInbound(phone, text): EVERY text to the number is an
  applicant (dedicated number, no keyword routing). Blocklist drops silently. First
  text creates the applicant with consent_at/consent_basis='inbound_text'. Order:
  STOP words → HELP/INFO/AYUDA → plain-language/Spanish opt-out (one confirmation)
  → START after opt-out → record + sticky Spanish → opted-out relay → reply-C
  interview confirm → closed status or ai_paused = relay to manager, no reply →
  co-pilot (manager texted within COPILOT_COOLDOWN_MIN = relay) → runAgent → holding
  reply on failure (meta 'fallback', 15-min dedupe). A live reply while an invite is
  still queued stamps invite_sent_at so the queued invite never double-sends.
  noteOutbound(): any outbound carrying the apply link moves new → link_sent.
- `src/agent.js` — the assistant. Stable prompt (config only, cached) + dynamic block
  (job setup from the console, applicant state, local time). Tools:
  save_applicant_info, mark_application_complete (→ applied + alert),
  book_interview (CODE-GATED: only status invited/interview_set; rejects past,
  Sunday, before 7 / after 20, bad format), escalate_to_manager (ai_paused=1 + alert).
  FAIR-HIRING rules in the prompt: never evaluates/encourages/discourages, no
  protected-class or screening questions, no promises beyond job facts, honest
  about being AI if asked. Model: AGENT_MODEL (default claude-opus-5-5) via
  client.beta.messages.create with adaptive thinking, effort medium, and the
  server-side refusal fallback (betas server-side-fallback-2026-07-01, fallbacks
  "default"). Reply = LAST text group only; em dashes scrubbed in code.
- `src/jobs.js` — every 5 min: pending invites (manager tapped Invite; agent-written
  two-time offer, template fallback; claimed via invite_sent_at so cron + console
  can't double-send), application nudges (status link_sent, ~20h then ~44h after our
  last outbound, max 2), invite follow-up (one, ~22h of silence), morning-of interview
  reminder (same local day, ≥60 min out, booked ≥3h ago; reply C to confirm). ALL
  gated by isQuietHours (recipient local 8AM-9PM, FL 8PM) + countRecentAutomated
  < 2/24h (metas invite/nudge/reminder; live replies and 'manager' never counted).
- `src/db.js` — better-sqlite3. Tables: applicants, messages, settings (k/v job
  setup), blocked, audit_log (append-only). Statuses: new → link_sent → applied →
  invited → interview_set → interviewed / no_show / hired / passed / withdrawn.
  Only new..interview_set get auto-replies.
- `src/compliance.js` — optOutLang (EN/ES), detectLang, isConfirmation,
  normalizePhone, keyword lists. `src/textingHours.js` copied from TextDrive.
- `src/notify.js` — notifyManager: full text to MANAGER_PHONE by SMS; Discord gets
  redactForThirdParty (`#12 (Name / phone)` → `#12`, emails/phones stripped).
- `src/routes/admin.js` — status, settings, applicants list/detail, manual add
  (requires attested=true → consent_basis 'applied_attested', status applied),
  status, invite, interview time, send (meta 'manager'), pause/resume, notes,
  block (blocklist + delete), delete, audit.
- `public/index.html` — console: Applicants (funnel, add applicant, groups: interview
  passed / ready for review / upcoming / in progress / closed), Setup (apply link,
  role, interviewer, interview hours, job facts, webhook URLs), applicant page
  (thread polls every 8s, Invite, outcomes, interview time, pause, manual send, notes).

## Env

See .env.example (scripts/check.js fails if a config.js env key is undocumented).
Key: ADMIN_TOKEN, ANTHROPIC_API_KEY, AGENT_MODEL, ASSISTANT_NAME, TIMEZONE,
COMPANY_NAME/ADDRESS, CONTACT_EMAIL, MANAGER_NAME/PHONE, TWILIO_* (the HIRING
number), DISCORD_WEBHOOK_URL, PUBLIC_URL, APPLY_URL/JOB_ROLE/INTERVIEW_HOURS
(defaults; console Setup overrides), COPILOT_COOLDOWN_MIN.

## Tests

`npm test` = check + scripts/tests.mjs (46 assertions, no API cost; the Anthropic
base URL points at a closed port so the AI path fails fast into the holding reply).
Covers opt-out EN/ES + false positives, quiet hours, new-texter consent record,
holding-reply dedupe, blocklist, STOP/HELP/START/Spanish opt-out, closed/paused
relay, the invite-before-booking gate + past/Sunday/late/format rejects, reply-C
confirm, link tracking, the cap, settings override, redaction. If a compliance
rule changes, update the tests in the same push.

## Not built yet

Applicant transcript retention (EEOC record-keeping, ~1 year minimum, needs a
decision), IdealTraits integration (manual add today), hiring stats beyond the
console funnel, a CI workflow.
