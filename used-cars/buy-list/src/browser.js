// One shared browser per scan. Prefers the PC's installed Google Chrome (looks
// like a normal visitor, so sites are less likely to block it), then Playwright's
// own Chromium (setup.bat downloads it), or an explicit path from config.json.
import { chromium } from "playwright";
import { config } from "./config.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launchBrowser() {
  const headless = config.browser.headless !== false;
  const exe = process.env.BUYLIST_CHROME || config.browser.executablePath;
  const attempts = exe
    ? [{ executablePath: exe }]
    : [{ channel: "chrome" }, {}];
  let lastErr;
  for (const opts of attempts) {
    try {
      const browser = await chromium.launch({ headless, ...opts });
      const context = await browser.newContext({
        userAgent: opts.channel === "chrome" ? undefined : UA,
        viewport: { width: 1366, height: 900 },
        locale: "en-US",
      });
      return { browser, context };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Couldn't start a browser. Install Google Chrome, or run "npx playwright install chromium" in the buy-list folder. (${lastErr?.message?.split("\n")[0]})`);
}

// Collect every JSON response a page loads (that's where most sites keep their listings).
export function collectJson(page, sink) {
  page.on("response", async (resp) => {
    try {
      const type = resp.headers()["content-type"] || "";
      if (!/json/i.test(type)) return;
      const len = Number(resp.headers()["content-length"] || 0);
      if (len > 8_000_000) return;
      sink.push({ url: resp.url(), body: await resp.text() });
    } catch {
      // response body unavailable (redirect/aborted): ignore
    }
  });
}

// Embedded JSON in the page itself: schema.org JSON-LD + script-tag state blobs.
export async function embeddedJson(page) {
  return page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"], script#__NEXT_DATA__')) {
      if (s.textContent && s.textContent.length < 8_000_000) out.push(s.textContent);
    }
    return out;
  });
}

// After a click/scroll: wait until the page stops loading things (quiet for quietMs),
// so cars fetched by the click are in hand before we read them.
export async function settle(page, { quietMs = 900, maxMs = 12000 } = {}) {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  page.on("request", bump);
  page.on("response", bump);
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 150));
  while (Date.now() - last < quietMs && Date.now() - start < maxMs) await new Promise((r) => setTimeout(r, 100));
  page.off("request", bump);
  page.off("response", bump);
  await new Promise((r) => setTimeout(r, 250)); // response bodies are read just after the event
}

// Browser network errors ("net::ERR_NAME_NOT_RESOLVED at https://...") → plain words.
export function friendlyNetError(e, what) {
  const m = String(e?.message || e);
  if (/net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(m)) return `${what} couldn't be reached (is the internet up?)`;
  if (/Timeout .*exceeded/i.test(m)) return `${what} took too long to load`;
  return m.split("\n")[0];
}

export function looksBlocked(title, html) {
  return /access denied|just a moment|are you a human|verify you are human|captcha|request blocked|pardon our interruption/i
    .test(`${title} ${String(html).slice(0, 5000)}`);
}
