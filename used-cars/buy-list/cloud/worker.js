// The Buy List web app on Cloudflare's free tier. Serves the page (public/, built
// by build.mjs) and a small API behind a PIN:
//   GET  /api/data     the morning scan's cars + dealers (KV, written by the GitHub
//                      scan) and the manager's call notes (D1), in one response;
//                      the phone does the ranking
//   POST /api/outcome  log a call (same rules as the local app's recordOutcome)
//   POST /api/hide | /api/unhide   hide a dealer / bring it back
//   POST /api/scan     start a scan on GitHub (needs the optional GITHUB_TOKEN secret)
// The big scan data is passed through as text, never parsed here, so requests stay
// inside the free plan's CPU limit.
import { OUTCOMES } from "../src/buyList.js";
import { localDay } from "../src/util.js";

const json = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const MAX_WRONG_PINS = 20; // per IP per hour
const SCAN_COOLDOWN_MIN = 30;

function samePin(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function checkPin(request, env) {
  if (!env.ACCESS_PIN) return json({ error: "The Buy List isn't set up yet: the PIN hasn't been set (run the deploy workflow)." }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM pin_failures WHERE ip = ? AND at > ?").bind(ip, hourAgo).first();
  if (n >= MAX_WRONG_PINS) return json({ error: "Too many wrong PINs. Try again in an hour." }, 429);
  const pin = request.headers.get("x-pin") || "";
  if (pin && samePin(pin, env.ACCESS_PIN)) return null;
  if (pin) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO pin_failures (ip, at) VALUES (?, ?)").bind(ip, new Date().toISOString()),
      env.DB.prepare("DELETE FROM pin_failures WHERE at < ?").bind(hourAgo),
    ]);
    return json({ error: "Wrong PIN" }, 401);
  }
  return json({ error: "pin required" }, 401);
}

async function getData(env) {
  const [status, aged, dealers] = await Promise.all(["status", "aged", "dealers"].map((k) => env.DATA.get(k)));
  const weekAgo = new Date(Date.now() - 8 * 86400e3).toISOString();
  const [states, hidden, calls] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM car_state"),
    env.DB.prepare("SELECT dealer_key, name FROM hidden"),
    env.DB.prepare("SELECT key, outcome, at FROM calls WHERE at > ?").bind(weekAgo),
  ]);
  const desk = JSON.stringify({ states: states.results, hidden: hidden.results, calls: calls.results });
  return json(`{"status":${status || "null"},"aged":${aged || "[]"},"dealers":${dealers || "[]"},"desk":${desk}}`);
}

// Body: { keys, outcome, notes?, offer?, prices: { key: askingPrice } }
async function logOutcome(request, env) {
  const body = await request.json().catch(() => ({}));
  const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter(Boolean).slice(0, 50);
  const o = OUTCOMES[body.outcome];
  if (!keys.length) return json({ error: "keys required" }, 400);
  if (!o) return json({ error: "unknown outcome" }, 400);
  const note = body.notes && String(body.notes).trim() ? String(body.notes).trim().slice(0, 1000) : null;
  const offer = Number(body.offer) > 0 ? Math.round(Number(body.offer)) : null;
  const now = new Date(), at = now.toISOString();
  const prev = new Map((await env.DB.prepare(`SELECT * FROM car_state WHERE key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys).all()).results.map((r) => [r.key, r]));
  const states = [], calls = [], stmts = [];
  for (const key of keys) {
    const p = prev.get(key) || {};
    const price = Number(body.prices?.[key]) > 0 ? Math.round(Number(body.prices[key])) : null;
    const s = { ...p, key };
    if (body.outcome === "reopen") {
      s.status = p.last_call_at ? "working" : "new";
      s.next_call_day = null;
      s.bought_at = null;
    } else {
      s.status = o.status;
      s.last_outcome = body.outcome;
      s.last_call_at = at;
      s.price_at_last_call = price;
      s.next_call_day = o.days ? localDay(o.days, now, env.TIMEZONE || "America/Chicago") : null;
      if (body.outcome === "bought") s.bought_at = at;
    }
    if (note) s.notes = note;
    if (offer) s.offer = offer;
    const row = {
      key, status: s.status, next_call_day: s.next_call_day ?? null, last_call_at: s.last_call_at ?? null,
      last_outcome: s.last_outcome ?? null, price_at_last_call: s.price_at_last_call ?? null, offer: s.offer ?? null,
      notes: s.notes ?? null, bought_at: s.bought_at ?? null,
    };
    states.push(row);
    calls.push({ key, outcome: body.outcome, at });
    stmts.push(
      env.DB.prepare(`INSERT INTO car_state (key, status, next_call_day, last_call_at, last_outcome, price_at_last_call, offer, notes, bought_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET status = excluded.status, next_call_day = excluded.next_call_day,
          last_call_at = excluded.last_call_at, last_outcome = excluded.last_outcome,
          price_at_last_call = excluded.price_at_last_call, offer = excluded.offer, notes = excluded.notes,
          bought_at = excluded.bought_at`)
        .bind(row.key, row.status, row.next_call_day, row.last_call_at, row.last_outcome, row.price_at_last_call, row.offer, row.notes, row.bought_at),
      env.DB.prepare("INSERT INTO calls (key, outcome, notes, offer, price, at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(key, body.outcome, note, offer, price, at),
    );
  }
  await env.DB.batch(stmts);
  return json({ updated: keys.length, states, calls });
}

async function hideDealer(request, env, hide) {
  const body = await request.json().catch(() => ({}));
  const key = String(body.dealerKey || "");
  if (!key) return json({ error: "dealerKey required" }, 400);
  if (hide) {
    await env.DB.prepare("INSERT INTO hidden (dealer_key, name, at) VALUES (?, ?, ?) ON CONFLICT(dealer_key) DO UPDATE SET name = excluded.name")
      .bind(key, String(body.name || key).slice(0, 200), new Date().toISOString()).run();
  } else {
    await env.DB.prepare("DELETE FROM hidden WHERE dealer_key = ?").bind(key).run();
  }
  return json({ ok: true });
}

// Starts .github/workflows/buy-list-scan.yml when a GitHub token is set up.
async function startScan(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json({ message: "Scans run on their own every morning (Mon-Sat, about 6 AM). An admin can start one early from GitHub: Actions → Buy List scan → Run workflow." });
  }
  const last = await env.DATA.get("scan_requested");
  if (last && Date.now() - Number(last) < SCAN_COOLDOWN_MIN * 60e3) {
    return json({ message: "A scan was started in the last 30 minutes. The list updates when it finishes (about an hour)." });
  }
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/buy-list-scan.yml/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "buy-list", "content-type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!r.ok) return json({ error: `GitHub wouldn't start the scan (${r.status}). Check the GITHUB_TOKEN secret.` }, 502);
  await env.DATA.put("scan_requested", String(Date.now()));
  return json({ message: "Scan started. The list updates when it finishes, usually within an hour." });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const denied = await checkPin(request, env);
    if (denied) return denied;
    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /api/data") return getData(env);
    if (route === "POST /api/outcome") return logOutcome(request, env);
    if (route === "POST /api/hide") return hideDealer(request, env, true);
    if (route === "POST /api/unhide") return hideDealer(request, env, false);
    if (route === "POST /api/scan") return startScan(env);
    return json({ error: "not found" }, 404);
  },
};
