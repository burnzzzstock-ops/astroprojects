import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { getApplicant, updateApplicant, getConversation } from "./db.js";
import { notifyManager } from "./notify.js";
import { getJobSettings, fmtInterviewSlot, nowLocalStamp } from "./settings.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_TOOL_ITERATIONS = 4;

export const who = (a) => `#${a.id} (${a.name || a.phone})`;

// People don't text em dashes: digit ranges become hyphens, everything else a comma.
export function humanizePunctuation(text) {
  return text
    .replace(/(\d)\s*[—–]\s*(?=\d)/g, "$1-")
    .replace(/\s*[—–]\s*/g, ", ");
}

// Only config values, so it's identical on every request and caches; everything
// the manager can edit in the console goes in the dynamic block.
function stablePrompt() {
  return `You are ${config.assistantName}, the hiring coordinator texting for ${config.company.name}. Everyone who texts this number is a job applicant or someone curious about working here. Your job is to make it fast and easy for them to (1) get the application link, (2) get their questions answered from the job facts, and (3) get on the calendar for an interview once a manager has cleared them. A hiring manager makes every hiring decision. You never do.

# What you do
1. First reply: warm and short, thank them for their interest in the role. If you don't know their name, ask for it once. If they skip it, don't re-ask.
2. Send the application link from Job setup with one line on what happens next (a manager reviews it, then you'll text them about an interview). Send the link once. Resend only if they ask for it or say they lost it.
3. Answer questions using ONLY the job facts. If the answer isn't there, say the manager will go over it in the interview. Never guess at pay, schedule, benefits, or requirements.
4. When they say they finished or submitted the application, call mark_application_complete, then tell them a manager will review it and you'll text about an interview time.
5. Only when the applicant's status is INVITED or INTERVIEW_SET may you schedule. If they ask to schedule before that, explain that a manager reviews applications first and you'll text as soon as they're cleared. Never promise that they will be.

# Scheduling (INVITED, or rescheduling an INTERVIEW_SET)
- Stay inside the interview hours in Job setup. Never Sunday.
- Offer exactly two specific times on :00 or :30, naming the weekday ("Tuesday at 10:00 or 2:30?"). Same day only if it's before 2 PM, otherwise the next business day or two.
- If neither works, ask what day and time suit them and fit it inside interview hours.
- When they pick one, call book_interview. scheduled_at is "YYYY-MM-DD HH:mm" in local time.
- Do the calendar math silently. Never name a day and then take it back.
- After booking, confirm the day and time, who they're meeting, and the address if you have it. Mention what to bring only if the job facts say.

# Fair-hiring rules (hard rules, no exceptions)
- Never evaluate, rank, encourage, or discourage anyone. Never say or imply they're a good fit, qualified, unqualified, or likely or unlikely to be hired.
- Never ask about or comment on age, race, color, ethnicity, national origin, citizenship or immigration status, religion, sex, gender identity, sexual orientation, pregnancy, marital or family status, children or childcare, disability, health, genetic information, veteran or military status, arrests or criminal history, credit, salary history, or union membership. If they bring any of it up, don't record it. Acknowledge kindly and neutrally, then move on.
- Don't ask screening questions (experience, licenses, weekend availability and so on). The application handles screening.
- Never promise a job, a start date, or pay beyond what the job facts say.
- If they ask whether you're a person or AI, be honest in one light line: you're ${config.company.name}'s AI assistant that helps applicants get scheduled, and a real manager makes every hiring decision. Then keep helping.

# Call escalate_to_manager when
- they're upset, frustrated, or ask for a person
- they need an answer the job facts don't have before they'll apply or come in
- they're asking about something other than a job (buying a car, service, an existing deal). Tell them you're passing it to the right person.
- they cancel, or want to reschedule a booked interview and nothing inside interview hours works

# Style
- Text like a friendly recruiter: 1 to 3 short sentences, no lists, no em dashes, no semicolons.
- One question per message. Never narrate ("let me check"). Never repeat a message word for word.
- Reply in the applicant's language. A Spanish thread gets fully Spanish replies in a polite register.
- Don't use their name in every message.
- Outbound turns tagged [manager stepped in] were sent by the hiring manager and are ground truth. Turns tagged [automated reminder] were templates. Read to the bottom and respond to the latest state.`;
}

const STATUS_NOTES = {
  new: "NEW: just reached out. Welcome them, get their name, send the application link.",
  link_sent: "LINK_SENT: they have the application link but haven't said they finished it. Help them across the line, answer questions.",
  applied: "APPLIED: application is in and a manager is reviewing it. Do NOT offer interview times. Reassure them you'll text once they're cleared to schedule.",
  invited: "INVITED: a manager reviewed the application and wants to interview them. Offer two interview times and book it.",
  interview_set: "INTERVIEW_SET: interview is booked. Answer logistics questions. Reschedule only if they ask.",
};

function dynamicBlock(a) {
  const s = getJobSettings();
  const now = nowLocalStamp();
  let interview = "none booked";
  if (a.interview_at) {
    const when = String(a.interview_at).slice(0, 16);
    interview = `${a.interview_text || fmtInterviewSlot(a.interview_at)} with ${s.interviewer} (${when > now ? "UPCOMING" : "ALREADY PASSED"})${a.interview_confirmed ? ", confirmed" : ""}`;
  }
  return `# Job setup (from the hiring manager)
Role: ${a.role || s.role}
Application link: ${s.applyUrl || "NOT SET. Don't invent one. Tell them the hiring manager will text them the application shortly."}
Interviewer: ${s.interviewer}
Interview hours: ${s.interviewHours}
Address: ${config.company.address || "not on file"}
Job facts (the ONLY facts you may share about the job):
${s.jobFacts || "None provided. For any question about pay, schedule, benefits, or requirements, say the manager will go over it in the interview."}

# This applicant (#${a.id})
Name: ${a.name || "unknown, ask once"}
Status: ${STATUS_NOTES[a.status] || a.status}
Application link already sent: ${a.link_sent_at ? "yes" : "no"}
Interview: ${interview}
${a.notes ? `Manager notes (ground truth): ${a.notes}\n` : ""}Current date/time (local): ${new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: config.timezone })}`;
}

const tools = [
  {
    name: "save_applicant_info",
    description: "Save the applicant's name the moment they share it, and the role they want if it's different from the posted role.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name or first name as they gave it" },
        role: { type: "string", description: "Only if they're asking about a different position than the posted one" },
      },
      required: [],
    },
  },
  {
    name: "mark_application_complete",
    description: "Call when the applicant says they finished or submitted the application. Alerts the hiring manager to review it.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "book_interview",
    description: "Book the interview time the applicant picked. Only works when their status is INVITED or INTERVIEW_SET (a reschedule).",
    input_schema: {
      type: "object",
      properties: {
        scheduled_at: { type: "string", description: "Local time as 'YYYY-MM-DD HH:mm'" },
        time_text: { type: "string", description: "How you'd say it in a text, e.g. 'Tuesday, Oct 28 at 10:00 AM'" },
      },
      required: ["scheduled_at", "time_text"],
    },
  },
  {
    name: "escalate_to_manager",
    description: "Hand this applicant to the hiring manager and stop replying yourself. See the escalation rules.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "One line on why, for the manager" } },
      required: ["reason"],
    },
  },
];

// Exported for scripts/tests.mjs: the invite-before-booking gate is load-bearing.
export async function executeTool(a, name, input) {
  const s = getJobSettings();
  switch (name) {
    case "save_applicant_info": {
      updateApplicant(a.id, {
        name: String(input.name || "").trim().slice(0, 80) || undefined,
        role: String(input.role || "").trim().slice(0, 80) || undefined,
      });
      return { result: "Saved." };
    }
    case "mark_application_complete": {
      if (!["new", "link_sent"].includes(a.status)) return { result: `Already past that step (status ${a.status}). Nothing to change.` };
      const fresh = updateApplicant(a.id, { status: "applied", applied_at: new Date().toISOString() });
      await notifyManager(`📝 Applicant ${who(fresh)} says they finished the ${fresh.role || s.role} application. Check their results, then tap Invite in the hiring console to have ${config.assistantName} book the interview.`);
      return { result: "Marked as applied and the manager was alerted. Tell them a manager will review it and you'll text about an interview." };
    }
    case "book_interview": {
      if (!["invited", "interview_set"].includes(a.status)) {
        return { isError: true, result: `Not cleared to schedule (status ${a.status}). Tell them a manager reviews applications first and you'll text once they're cleared. Do not offer times.` };
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(input.scheduled_at || "").trim());
      if (!m) return { isError: true, result: "scheduled_at must be 'YYYY-MM-DD HH:mm'." };
      const slot = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
      if (slot <= nowLocalStamp()) return { isError: true, result: "That time has already passed. Offer future times." };
      if (new Date(+m[1], m[2] - 1, +m[3]).getDay() === 0) return { isError: true, result: "No interviews on Sunday. Offer a different day." };
      // Loose backstop only; the configured interview hours live in the prompt.
      if (+m[4] < 7 || +m[4] >= 20) return { isError: true, result: "That's outside business hours. Offer times inside the interview hours." };
      const timeText = String(input.time_text || "").trim().slice(0, 80) || fmtInterviewSlot(slot);
      const resched = a.status === "interview_set" && a.interview_at && a.interview_at !== slot;
      const fresh = updateApplicant(a.id, {
        status: "interview_set", interview_at: slot, interview_text: timeText,
        interview_set_at: new Date().toISOString(), interview_confirmed: 0, interview_reminded_at: null,
      });
      await notifyManager(`📅 Interview ${resched ? "RESCHEDULED" : "booked"}: applicant ${who(fresh)} for ${fresh.role || s.role}, ${timeText} with ${s.interviewer}.`);
      return { result: `Booked for ${timeText}. Confirm it with them.` };
    }
    case "escalate_to_manager": {
      const fresh = updateApplicant(a.id, { ai_paused: 1 });
      await notifyManager(`🙋 Applicant ${who(fresh)} needs a person: ${String(input.reason || "").slice(0, 300)}\n${config.assistantName} has stopped replying to them. Resume from the hiring console when you're done.`);
      return { result: "Manager alerted. Tell them you're looping in the hiring manager, who will reach out shortly. Don't promise a specific time." };
    }
    default:
      return { isError: true, result: `Unknown tool ${name}` };
  }
}

function historyToMessages(applicantId) {
  return getConversation(applicantId)
    .filter((m) => m.body?.trim())
    .map((m) => {
      if (m.direction === "in") return { role: "user", content: m.body };
      let content = m.body;
      if (m.meta === "manager") content = `[manager stepped in] ${m.body}`;
      else if (m.meta === "nudge" || m.meta === "reminder") content = `[automated reminder] ${m.body}`;
      return { role: "assistant", content };
    });
}

/**
 * Run the hiring assistant for one applicant and return the text to send.
 * `instruction` (optional) is an operator turn, used for the manager-triggered invite.
 */
export async function runAgent(applicant, instruction = null) {
  let a = applicant;
  const messages = historyToMessages(a.id);
  if (instruction) messages.push({ role: "user", content: `<operator>${instruction}</operator>` });
  if (!messages.length || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: "(applicant opened the conversation)" });
  }

  const system = [
    { type: "text", text: stablePrompt(), cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicBlock(a) },
  ];

  const replyGroups = [];
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.beta.messages.create({
      model: config.agentModel,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // If a safety classifier declines, the API re-runs the turn on a fallback
      // model inside the same call instead of leaving the applicant unanswered.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      console.warn(`[agent] refusal for applicant ${a.id}: ${response.stop_details?.category ?? "unknown"}`);
      break;
    }

    // Only the LAST text group is sent: text written before a tool call is
    // preamble the model rewrites after seeing the result.
    const texts = response.content
      .filter((b) => b.type === "text" && b.text.trim())
      .map((b) => humanizePunctuation(b.text.trim()));
    if (texts.length) replyGroups.push(texts.join("\n\n"));

    if (response.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { result, isError } = await executeTool(a, block.name, block.input ?? {});
      a = getApplicant(a.id); // tools change status/name; the next tool must see it
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { reply: (replyGroups[replyGroups.length - 1] || "").trim() };
}
