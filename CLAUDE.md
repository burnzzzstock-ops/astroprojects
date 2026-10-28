# astroprojects: developer guide

Side projects for the dealership (used cars, staffing, service, …), one folder per
department/project. Read this first in any new session.

## Standing rules

- **Separate from Riley / TextDrive.** Riley (the AI SDR) lives in `burnzzzstock-ops/sales1`.
  Nothing here imports from, writes to, or deploys with it, and nothing here goes into it.
  A first Buy List was built inside Riley and backed out at the operator's request.
- **No paid services.** Free data sources and free tiers that can't bill (no card on file).
  Hosting is a store PC or free tiers only: GitHub Actions (public repo = unlimited minutes)
  and Cloudflare Workers/KV/D1 free plan. Never Railway or anything with a card on file.
- **No customer PII in the repo.** Test data uses obviously fake names, 555-01xx phones and
  made-up VINs. Real data stays in each project's gitignored `data/` folder on the PC, or in
  the project's Cloudflare storage. The repo is PUBLIC: secrets live only in GitHub
  repository secrets, never in chat or files.
- **Default branch must be `main`.** Scheduled workflows only run from the default branch.
  (`claude/gifted-thompson-ju8pa5` holds another session's Hiring Line work: leave it alone.)
- **Keep this file current.** When a session changes how a project works, update its section
  here in the same commit.

## used-cars/buy-list: aged-inventory Buy List

The used car manager's daily call sheet: used cars for sale within 100 mi of 39540 listed
60+ days, ranked, grouped by dealer, with call outcomes tracked. Node 20+. Two ways to run
the same code: the WEB VERSION (primary, since store IT won't allow installs; see "Web
version" below) or locally (`npm start` → http://localhost:4400). The Windows install is
`setup.bat`, which runs npm install, `npx playwright install chromium`, copies the config
template, adds a Startup shortcut to `start.bat` (restart loop) and a desktop `.url` link.

- **Storage:** one JSON file, `data/buylist.json` (`src/store.js`), with no native deps. Every write
  is a synchronous load → modify → save (`withDb`) and atomic (tmp file + rename, plus a `.bak`),
  so outcome taps and a finishing scan can't clobber each other. A scan gathers everything async
  first and touches the file only once, at the end.
- **Sources** (`src/sources/`), each fails on its own and reports `{ok, found, error}` into the
  scan record:
  - `cargurus.js`: real browser (Playwright, installed Chrome first, then Chromium).
    A. fetches `/Cars/searchResults.action?...sortType=AGE_IN_DAYS&sortDir=DESC&offset=&maxResults=50`
    from inside the page (same-origin, cookies). B. falls back to opening the search page,
    capturing its JSON responses and clicking Next. The oldest-first sort lets it stop once a
    page's newest car is under `minDaysListed`, but only while the site actually honors the sort
    (`makeAgeGate`). It detects bot walls (`looksBlocked`) and saves html/png/json to `data/debug`
    when nothing is read. Automated use is against CarGurus' terms (the operator chose it knowingly).
    **Untested against the live site** (the dev sandbox can't reach it); the operator runs it and
    sends debug files.
  - `dealerSites.js`: one page per `dealers.csv` row. `dealers.csv` is TRACKED and pre-filled
    (2026-10-26) with 313 dealers within 98 mi (MS 111, AL 98, LA 104), sorted closest-first. They
    were researched by web search only: URLs and phones were seen in results but never fetched, and
    many rows are homepages. Same-name stores carry the city in their name ("Wholesale Auto Group
    Kenner"), so they don't merge into one card. A missing zip falls back to `zipForCity(city, state)`
    (also splits "LaPlace"). Sites are read `concurrency` (3) at a time with a per-site
    `dealerTimeoutMs` (3 min). Some groups (e.g. Sandy Sansing) show group-wide inventory on every
    store's site, so cars get attributed to whichever row read them last. A homepage link (`isHomepage`) is resolved
    to the site's used-inventory page via `findUsedLink` (same-site links scored on used/pre-owned
    text, with new/service/etc. penalized). Reads JSON responses, JSON-LD and
    `script[type=application/json]`, then a DOM fallback (VINs printed on the page; climbs to the
    single-VIN card; skips script/style tags). Scrolls, then clicks next/load-more, with `settle()`
    waiting for the page to go quiet. CSV contact info overrides scraped dealer info; distance
    comes from the zip via the free `zipcodes` table.
  - `marketcheck.js`: v2 `/search/car/active`, FREE tier only (key optional). `dom_range`
    filter, 50 rows per call, `start` = offset. Monthly cap tracked in `db.marketcheckCalls[YYYY-MM]`.
- **Generic extractor** (`src/extract.js`): walks any JSON for listing-like objects (valid VIN with
  no I/O/Q, or price + year + name + miles) and reads each field from an alias list (daysOnMarket,
  inStockDate, serviceProviderName, phoneNumberString, JSON-LD offers/seller/address…). One
  extractor serves every site, so a renamed field means adding an alias, not a rewrite.
- **Merge** (`src/listings.js`): keyed by VIN (else `source:id`). Dealer cards: `resolveDealerKey`
  maps other sources' names onto `db.csvDealers` (the dealers.csv names). It merges when one
  normalized name contains the other (2+ words) and the state matches, with city as the
  tie-breaker; anything ambiguous stays separate. Dealer-source rows are applied first in each scan. Days listed = max(each source's
  reported days aged forward from when it said so, days since we first saw the car). Price drops
  are detected per source against that same source only (≥$100), so two sites with different
  prices never look like a drop. A provider's previous price on first sight counts as one drop.
  A drop on a `working` car clears `nextCallDay` (back on today's list). It excludes `excludeSellers`
  name fragments, hidden dealers, cars beyond radius+5 mi, and new cars. Cars nobody called that
  are unseen for 45 days get pruned. A car is "active" if any source saw it within 3 days.
- **Ranking / list / outcomes** (`src/buyList.js`): score = days listed 0-40, drops 0-20, dropped
  since your last call +10, closeness 0-15, no price −10, 150k+ mi −5, each with a "why" chip.
  Today = top `dailyListSize` due cars grouped by dealer (`dealerKeyOf`: normalized name minus
  LLC/Inc; private sellers get one key per car), plus up to 6 per card riding along, with
  negotiating cars pinned. Outcomes: no_answer +1d, left_message +2d, too_high +10d,
  not_selling +21d, negotiating, bought, pass, reopen. Due days are local calendar days.
- **Pure modules** (bundle for the browser, no Node imports): `src/buyList.js`, `src/age.js`
  (`daysListed`, `isActive`, `ACTIVE_DAYS`), `src/util.js` (`localDay(offset, now, timeZone)`:
  cloud code passes "America/Chicago" since Cloudflare/GitHub run on UTC). Node-only:
  `src/geo.js` (`zipDistance`, `zipForCity` via `zipcodes`), `src/roster.js`, `src/publish.js`.
- **Dealers tab** (`dealerRoster` in roster.js, `GET /api/dealers`): every dealers.csv row with
  distance, aged count, cars seen on its site in 3 days, and the last scan's error for it.
- **Server** (`src/server.js`): Express 5 on 127.0.0.1, or 0.0.0.0 only when `allowPhoneAccess`
  AND `accessPin` are set (non-local requests need the PIN). Manual scan has a 30-min cooldown.
  The scheduler ticks every 5 min: on scan days at/after `scanTime`, it runs once per day if no
  scheduled scan ran today (catches up after sleep). `data/scan.lock` (6h stale) prevents
  overlap with `npm run scan`.
- **Page** (`public/index.html`, shared by both versions): deliberately NOT Riley's look. Light
  "business desk" style for Gen X/boomer users (2026-10-28): white cards on #eef1f5, navy
  #1c3f6e header/primary buttons, a full-width green #16733a "Call (xxx) xxx-xxxx" button per
  dealer, Public Sans (Google Fonts, plain zeros; Atkinson Hyperlegible Next was dropped for its
  slashed zeros in prices) at 18px base, 48px+ tap targets, sentence case, plain words ("Price
  too high", "Not interested", "Why it's on the list:" sentence, High/Medium priority badge
  instead of the raw score: ≥60/≥40 of 85). 2×2 tabs and 2-column outcome buttons on phones.
  In-page PIN dialog (`askPin`, re-asks on every 401) instead of `prompt()`. Print layout hides
  controls. Buttons reference cars by index (never embed site text). Third-party URLs go
  through `safeUrl` (http/https only) and all text is escaped. Keep the element ids/function
  names: `cloud/adapter.js` and `cloud/build.mjs` (needs `<title>` and the first `<script>` to
  be the inline one) depend on them.
- **Web version** (`cloud/`, `scripts/cloud-scan.mjs`, `.github/workflows/buy-list-*.yml`):
  - **Scan** = GitHub Actions `buy-list-scan.yml`, cron `45 10 * * 1-6` (5:45 AM CDT / 4:45 AM
    CST) + manual. Restores `market.json.gz` (the scan's db) from the orphan `buy-list-state`
    branch, exports called keys + hidden dealers from D1, runs `cloud-scan.mjs` with
    `cloud/scan-config.json` (excludes "astro ford", dealer concurrency 6, 2-min site timeout),
    writes KV `status`/`aged`/`dealers` (`publish.js`: only aged-and-active cars plus anything
    called, KEEP fields only) and force-pushes the new state branch. Debug files → artifact.
  - **Site** = Cloudflare Worker `cloud/worker.js` + static assets (`cloud/public/`, built by
    `cloud/build.mjs`: the shared page + `logic.js` [esbuild IIFE `BuyLogic` of buyList.js] +
    `adapter.js`). The worker only passes KV strings through (`GET /api/data`, stays under the
    10ms CPU limit) and stores the desk in D1 (`schema.sql`: car_state, calls, hidden,
    pin_failures). `adapter.js` overrides `fetch("/api/…")` and answers status/today/listings/
    dealers/hidden in the browser with the same ranking code; outcomes and hide/unhide POST to
    the worker and are mirrored locally; `BUYLIST_CLOUD.downloadCsv()` builds the CSV
    client-side. PIN: `ACCESS_PIN` secret, `x-pin` header, constant-time compare, 20 wrong
    tries/IP/hour → 429. `/api/scan` explains the schedule, or dispatches the scan workflow when
    `GITHUB_TOKEN` (from BUYLIST_GITHUB_TOKEN) is set (30-min cooldown).
  - **Deploy** = `buy-list-deploy.yml` on push to main (skips quietly without secrets) or manual:
    tests → `cloud/ensure.mjs` (finds/creates KV `buylist-data` + D1 `buylist`, patches ids into
    wrangler.toml, which stays committed with placeholders) → schema → build → `wrangler deploy`
    → sets ACCESS_PIN. Secrets: CLOUDFLARE_API_TOKEN ("Edit Cloudflare Workers" + Account·D1·Edit),
    CLOUDFLARE_ACCOUNT_ID, BUYLIST_PIN; optional MARKETCHECK_API_KEY, BUYLIST_GITHUB_TOKEN.
  - Local try-out: `node cloud/build.mjs`, `cloud/.dev.vars` with ACCESS_PIN, `npx wrangler dev
    --local` in cloud/ (gitignored: cloud/public, .wrangler, .dev.vars, .scan-data).
- **Tests:** `npm test` (node --test, 35 tests, offline). `test/cloud.test.mjs` covers publish and
  the worker against a fake D1 on `node:sqlite`. `test/scan.test.mjs` runs a real headless
  browser against an Express server that copies each site shape: CarGurus feed (400 cars,
  oldest-first, asserts the early stop after 6 requests), CarGurus page fallback, a bot wall,
  dealer API + Next, JSON-LD, plain HTML + Load more, and a broken site.
- **Next ideas:** list dealers seen on CarGurus that aren't in dealers.csv yet; an
  offer-range hint from comparable cars in the data.
