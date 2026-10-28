// The web version: what each scan publishes (src/publish.js) and the Cloudflare
// server (cloud/worker.js), run against a real SQLite database with the real
// schema.sql standing in for Cloudflare D1. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolate, obs } from "./helpers.mjs";

isolate();
const { config } = await import("../src/config.js");
const { applyObservations } = await import("../src/listings.js");
const { buildPublished } = await import("../src/publish.js");
const { localDay } = await import("../src/util.js");
const sqlite = await import("node:sqlite").catch(() => null);

const freshDb = () => ({ listings: {}, calls: [], scans: [], hiddenDealers: {}, csvDealers: {}, marketcheckCalls: {} });

test("publish: aged + still for sale, plus anything called; hidden dealers left out; small fields only", () => {
  const db = freshDb();
  applyObservations(db, [obs(0), obs(1, { daysListed: 10 }), obs(2), obs(5)], config);
  const stale = db.listings[obs(2).vin];
  stale.lastSeenAt = new Date(Date.now() - 10 * 86400e3).toISOString();
  db.hiddenDealers[db.listings[obs(5).vin].dealerKey] = "x";
  const young = obs(1).vin;
  const pub = buildPublished(db, config, [], new Set([stale.key]));
  const keys = pub.aged.map((l) => l.key).sort();
  assert.deepEqual(keys, [obs(0).vin, stale.key].sort(), "aged one + the called stale one; not the 10-day car or the hidden dealer");
  assert.ok(!keys.includes(young));
  assert.ok(!("srcPrice" in pub.aged[0]) && !("status" in pub.aged[0]), "no scan internals or call state");
  assert.equal(pub.status.filters.minDaysListed, 60);
  assert.ok(pub.status.publishedAt);
});

// Cloudflare D1, as far as worker.js uses it, on node:sqlite.
function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../cloud/schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => db.prepare(sql).run(...params),
    _exec: () => (/^\s*select/i.test(sql) ? { results: db.prepare(sql).all(...params) } : db.prepare(sql).run(...params)),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._exec()) };
}

async function worker() {
  const { default: w } = await import("../cloud/worker.js");
  const kv = new Map();
  const env = {
    ACCESS_PIN: "246810", TIMEZONE: "America/Chicago", DB: fakeD1(),
    DATA: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) },
    ASSETS: { fetch: async () => new Response("page") },
  };
  const call = (method, path, body, pin = "246810", ip = "10.0.0.1") => w.fetch(new Request(`https://buy-list.example.workers.dev${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}), "cf-connecting-ip": ip },
  }), env);
  return { env, kv, call };
}

test("server: the PIN gate (missing, wrong, too many wrong, not set up)", { skip: !sqlite && "needs node:sqlite (Node 22+)" }, async () => {
  const { env, call } = await worker();
  assert.equal(await (await call("GET", "/")).text(), "page", "the page itself needs no PIN");
  assert.equal((await call("GET", "/api/data", null, "")).status, 401);
  assert.equal((await call("GET", "/api/data", null, "1111")).status, 401);
  for (let i = 0; i < 19; i++) await call("GET", "/api/data", null, "1111");
  assert.equal((await call("GET", "/api/data")).status, 429, "20 wrong PINs from one IP locks it for an hour");
  assert.equal((await call("GET", "/api/data", null, "246810", "10.0.0.2")).status, 200, "other IPs unaffected");
  delete env.ACCESS_PIN;
  assert.equal((await call("GET", "/api/data", null, "246810", "10.0.0.3")).status, 503);
});

test("server: data passes the scan's files through and adds the call notes", { skip: !sqlite && "needs node:sqlite (Node 22+)" }, async () => {
  const { kv, call } = await worker();
  kv.set("status", JSON.stringify({ filters: { zip: "39540" } }));
  kv.set("aged", JSON.stringify([{ key: "K1", price: 20000 }]));
  const d = await (await call("GET", "/api/data")).json();
  assert.equal(d.status.filters.zip, "39540");
  assert.equal(d.aged[0].key, "K1");
  assert.deepEqual(d.dealers, [], "no dealers file yet → empty list, still valid JSON");
  assert.deepEqual(d.desk, { states: [], hidden: [], calls: [] });
});

test("server: call outcomes, reopen, hide/unhide, scan button", { skip: !sqlite && "needs node:sqlite (Node 22+)" }, async () => {
  const { env, call } = await worker();
  let r = await (await call("POST", "/api/outcome", { keys: ["K1"], outcome: "too_high", notes: "wants 20 back", offer: 18000, prices: { K1: 21000 } })).json();
  const s = r.states[0];
  assert.equal(s.status, "working");
  assert.equal(s.next_call_day, localDay(10, new Date(), "America/Chicago"), "due day counted in Central time");
  assert.equal(s.price_at_last_call, 21000);
  assert.equal(s.offer, 18000);
  assert.equal(s.notes, "wants 20 back");
  r = await (await call("POST", "/api/outcome", { keys: ["K1"], outcome: "negotiating" })).json();
  assert.equal(r.states[0].notes, "wants 20 back", "earlier notes kept when a later call has none");
  await call("POST", "/api/outcome", { keys: ["K1"], outcome: "bought" });
  assert.ok(env.DB.raw.prepare("SELECT bought_at FROM car_state WHERE key = 'K1'").get().bought_at);
  r = await (await call("POST", "/api/outcome", { keys: ["K1"], outcome: "reopen" })).json();
  assert.equal(r.states[0].status, "working");
  assert.equal(r.states[0].bought_at, null);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM calls").get().n, 4, "every tap logged");
  await call("POST", "/api/outcome", { keys: ["A", "B"], outcome: "left_message" });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM car_state").get().n, 3, "whole-lot tap saves each car");
  assert.equal((await call("POST", "/api/outcome", { keys: ["K1"], outcome: "maybe" })).status, 400);
  assert.equal((await call("POST", "/api/outcome", { keys: [], outcome: "pass" })).status, 400);

  await call("POST", "/api/hide", { dealerKey: "example motors", name: "Example Motors" });
  let d = await (await call("GET", "/api/data")).json();
  assert.deepEqual(d.desk.hidden, [{ dealer_key: "example motors", name: "Example Motors" }]);
  await call("POST", "/api/unhide", { dealerKey: "example motors" });
  d = await (await call("GET", "/api/data")).json();
  assert.deepEqual(d.desk.hidden, []);

  const scan = await (await call("POST", "/api/scan")).json();
  assert.match(scan.message, /every morning/, "without a GitHub token the button explains the schedule");
});
