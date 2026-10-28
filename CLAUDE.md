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

The used car manager's daily call sheet: used cars for sale within 200 mi of 39540 (CarGurus; the
dealer-site list covers ~100 mi) listed 60+ days, ranked, grouped by dealer, with call outcomes
tracked. Node 20+. Two ways to run the same code: the WEB VERSION (primary, since store IT won't
allow installs; see "Web version" below) or locally (`npm start` → http://localhost:4400). The
Windows install is `setup.bat`, which runs npm install, `npx playwright install chromium`, copies
the config template, adds a Startup shortcut to `start.bat` (restart loop) and a desktop `.url` link.

- **Storage:** one JSON file, `data/buylist.json` (`src/store.js`), with no native deps. `readDb` reuses the
  last parse while the file's mtime/size are unchanged (tens of MB at 200 mi; every page request reads it);
  `withDb` always parses fresh. The UCM's filter + saved searches live in `data/prefs.json`
  (`readPrefs`/`savePrefs`) so a filter tap never rewrites the big file. Every write
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
    **Live-tested 2026-10-26 on the store PC:** the feed (A) works with no bot wall. It returns a bare
    JSON array, 48 cars per page; the sort is honored, so a full read stops by itself at the 60-day
    line after ~142 pages / ~6,800 cars in ~10 min (hence `maxPages` 150). `daysOnMarket` checks out
    against listing ids (they rise ~86k/day at every age). Field notes: photo is
    `originalPictureData.url`; `sellerCity` is "Gulfport, MS" (the extractor strips the state);
    `expectedPrice` is CarGurus' market-value estimate, NOT the asking price, so it isn't a price
    alias. CarGurus' detail pages sit behind DataDome (a captcha in a normal browser); the feed
    wasn't challenged. **200 mi (2026-10-26):** the feed returns `null` past offset 10,000, and at 200 mi
    the oldest-first list only gets to ~84 days by then, so the search runs once per price band
    (`priceBands` edges from `minPrice`: $10k/15k/20k/25k/30k/40k/60k+, via the `minPrice`/`maxPrice`
    params, which it honors), each to its own 60-day line. A band that hits the cap is logged and
    marked `capped` in the scan record's `cargurus.bands`. `maxPages` (400) is the total across bands.
    The feed also carries what the filters use: `bodyTypeName`, `localizedDriveTrain`,
    `localizedFuelType`, `localizedTransmission`, `localizedEngineDisplayName`,
    `normalizedExteriorColor`, `localizedInteriorColor`, `isCPO`, `options` (features),
    `isFranchiseDealer`, `expectedPrice` (kept as `marketValue`).
  - `dealerSites.js`: one page per `dealers.csv` row. `dealers.csv` is TRACKED and pre-filled
    (2026-10-26) with 313 dealers within 98 mi (MS 111, AL 98, LA 104), sorted closest-first. They
    were researched by web search only: URLs and phones were seen in results but never fetched, and
    many rows are homepages. After the first live run it's 308: closed dealers removed (Breezy Auto
    Sales, Hooney's, Autoplus, iKon: dead or parked domains with no other web presence; Premier
    Clearance Center of St. Bernard: dead, the Metairie store is its own row) and moved sites fixed
    (Turan Foley → turanfoleychevrolet.com, Encore CDJR → rossdowningcdjrmobile.com, Fairway →
    fairwayautobrokers.com, Tameron Honda Eastern Shore → /searchused.aspx). Same-name stores carry the city in their name ("Wholesale Auto Group
    Kenner"), so they don't merge into one card. A missing zip falls back to `zipForCity(city, state)`
    (also splits "LaPlace"). Sites are read `concurrency` (3) at a time with a per-site
    `dealerTimeoutMs` (3 min). Some groups (e.g. Sandy Sansing) show group-wide inventory on every
    store's site, so cars get attributed to whichever row read them last. A homepage link (`isHomepage`) is resolved
    to the site's used-inventory page via `findUsedLink` (same-site links scored on used/pre-owned
    text, with new/service/etc. penalized; "#" menu toggles skipped; with no used link at all, a
    plain "Inventory" / "All Inventory" link, which is how most independent lots label it). Reads JSON responses, JSON-LD and
    `script[type=application/json]`, then a DOM fallback: (1) VINs printed on the page, starting
    from the smallest element holding both "VIN" and the number (a leaf, or
    `<p><label>VIN:</label> 1FT…</p>` as on DealerCarSearch `/newandusedcars` sites), climbing to the
    single-VIN card; (2) if no VINs at all (Carsforsale.com `/cars-for-sale` keeps the VIN on the
    detail page), one car per same-site detail link with a model year in its path, keyed by that
    link. Cards marked sold with no price are skipped; a VIN card's link prefers the dealer's own
    site over Carfax. A feed car with a VIN but no price takes the price from its card on screen
    (re-checked on every read, since prices can draw after the feed). Scrolls, then clicks
    next/load-more, with `settle()` waiting for the page to go quiet; with nothing to click it
    follows `<link rel="next">` (DealerOn's `?pt=2`, whose pager is drawn later by script). CSV
    contact info overrides scraped dealer info; distance comes from the zip via the free
    `zipcodes` table.
    **Live run 2026-10-26:** Dealer Inspire sites (Cloudflare, "Sorry, you have been blocked") and
    Dealer.com sites (Akamai, "Access Denied") answer the headless browser with HTTP 403. That's
    a deliberate bot block, so it's reported, not worked around. `looksBlocked` reads only the title,
    the visible text and wall-vendor markup (`captcha-delivery.com`, Incapsula, PerimeterX):
    reading raw HTML flagged normal pages that load reCAPTCHA or a "captcha-field" widget. A
    blocked site saves `dealer-<name>-blocked-*.html/png` to `data/debug`. First full pass (before
    the fixes above): 136 read, 21 read 0 cars, 137 HTTP 403, 12 unreachable, 2×404, 2×503, 2
    timeouts, 1 link that downloads a file. First pass with the fixes (the app's catch-up scan):
    151/308 read, 8,486 dealer-site cars, 137×403. Changing how a source reads prices makes
    one-time fake "price drops" on the next scan (583 that day, undone in the local data from
    `buylist.json.bak`), so after such a change, check `dropCount` on the next scan. Platforms that read: DealerOn (`/searchused.aspx`),
    space.auto, Carsforsale.com, DealerCarSearch, AutoCorner (`/docs/vehicle_search.html`), and
    the small-lot `inventory.php` sites. Known leftovers: sites with broken TLS/redirect loops/
    octet-stream pages (Eleven Automotive, Paul's of Picayune, Independent Auto Brokers), inventory
    inside a third-party iframe (2741 Autosales/AutoRevo on Wix), no inventory online (Wholesale
    Solutions, Captain Ron's).
  - `marketcheck.js`: v2 `/search/car/active`, FREE tier only (key optional). `dom_range`
    filter, 50 rows per call, `start` = offset. Monthly cap tracked in `db.marketcheckCalls[YYYY-MM]`.
    The key lives in the gitignored `config.json` only (the operator pastes it; never commit it).
    **Live 2026-10-26:** radius is capped at 100 mi in code (free tier); the API pages through the
    first 500 results of a search only (`start=500` → HTTP 422), so a scan is 10 calls = the 500
    nearest aged cars, which that day were all within ~1 mi of 39540 (the D'Iberville dealer row) out
    of 14,537 in 100 mi. Its `dom` is the car's whole time on the dealer's site, while CarGurus resets
    its count when a dealer re-uploads a listing: 50 of 199 cars on both were under 60 days on
    CarGurus and 60-326 on Marketcheck, and the merge takes the longest, so they surface. Build details
    (`body_type`, `drivetrain`, `fuel_type`, `transmission`, `engine`, `base_ext_color`…) feed the filters.
    The status chips and the Dealers tab show each source's most recent run (`lastRun`), so a
    one-source scan doesn't blank the others.
- **Generic extractor** (`src/extract.js`): walks any JSON for listing-like objects (valid VIN with
  no I/O/Q, or price + year + name + miles) and reads each field from an alias list (daysOnMarket,
  inStockDate, serviceProviderName, phoneNumberString, JSON-LD offers/seller/address…). One
  extractor serves every site, so a renamed field means adding an alias, not a rewrite.
  `inventoryDate` (space.auto dealer sites) counts as an in-stock date. DealerOn's feed uses
  `Vehicle*` names (`VehicleVin`, `VehicleName`, `TaggingPrice`, `VehicleDetailUrl`) with an in-stock
  date in `VehicleTaggingInventoryDate`; when `TaggingPrice` is 0 the price is "Selling Price" in its
  base64 `VehiclePriceLibrary`. AutoCorner's `/json/srp_vehicles.json` uses `vehicle_*` names.
- **Merge** (`src/listings.js`): keyed by VIN (else `source:id`). Dealer cards: `resolveDealerKey`
  maps other sources' names onto `db.csvDealers` (the dealers.csv names). Every scan registers ALL
  dealers.csv rows there with their phone (`registerCsvDealers`), not only the ones whose site
  read, so a blocked dealer's CarGurus cars land on its card. On a CSV dealer's card the CSV phone
  always wins (CarGurus often shows a call-tracking number, e.g. a 417 area code for a Biloxi lot)
  and the CSV city/state fill gaps. It merges when one
  normalized name contains the other (2+ words) and the state matches, with city as the
  tie-breaker; anything ambiguous stays separate. Dealer-source rows are applied first in each scan.
  A VIN-less dealer-site car and a VIN'd car from another source on the same dealer card with the
  same year, make and exact miles are one record (re-keyed to the VIN). Days listed = max(each source's
  reported days aged forward from when it said so, days since we first saw the car). Price drops
  are detected per source against that same source only (≥$100), so two sites with different
  prices never look like a drop. A provider's previous price on first sight counts as one drop.
  A drop on a `working` car clears `nextCallDay` (back on today's list). It excludes `excludeSellers`
  name fragments, hidden dealers, cars beyond radius+5 mi, and new cars. Cars nobody called that
  are unseen for 45 days get pruned. A car is "active" if any source saw it within 3 days.
- **Ranking / list / outcomes** (`src/buyList.js`): score = days listed 0-40, drops 0-20, dropped
  since your last call +10, closeness 0-15, no price −10, 150k+ mi −5, each with a "why" chip
  (CarGurus' "NA" deal rating gets no chip).
  Due cars rank by the store's priority tier first (`priorityOf`: `focusMakes` = Ford +2, under
  `focusUnderMiles` = 80k +1, each shown as a chip; config template and this store's config set them, the
  code defaults are off), then score, then days listed, then distance (many tie at the top score).
  `minPrice` is 10000 (the store doesn't want cars under $10k). Today's `top` =
  the best `topListSize` (10) as a plain ranked list. Today = top `dailyListSize` due cars grouped by dealer (`dealerKeyOf`: normalized name minus
  LLC/Inc; private sellers get one key per car), plus up to 6 per card riding along, with
  negotiating cars pinned. Outcomes: no_answer +1d, left_message +2d, too_high +10d,
  not_selling +21d, negotiating, bought, pass, reopen. Due days are local calendar days.
- **Filters** (`src/filters.js`): 28 categories (`FACETS`), each a getter that buckets what the sites
  sent (`body` → Truck/SUV/Sedan…, `drive` → 4WD/AWD/FWD/RWD, fuel, engine cylinders, transmission,
  exterior/interior color, canonical features), falling back to the title/trim (known truck models,
  "4WD" in the trim). Kinds: multi (any pick, OR), all (features: every pick), range [min,max], flag.
  Across categories: AND. `cleanFilter` drops anything unknown. `facetCounts` counts each category's
  options under all the OTHER filters in one pass (a car counts toward a category if it fails only that
  one). The details are stored per car by `listings.js` (`DETAIL_FIELDS`) from any source. API:
  `?f=<json>` on `/api/today`, `/api/today.csv`, `/api/listings`; `GET /api/filters` (defs + counts);
  `GET/PUT /api/prefs` (`{active, saved:[{name, filter}]}`). No filter = "Astro default".
- **Pure modules** (bundle for the browser, no Node imports): `src/buyList.js`, `src/filters.js`,
  `src/age.js` (`daysListed`, `isActive`, `ACTIVE_DAYS`), `src/util.js` (`localDay(offset, now,
  timeZone)`: cloud code passes "America/Chicago" since Cloudflare/GitHub run on UTC). Node-only:
  `src/geo.js` (`zipDistance`, `zipForCity` via `zipcodes`), `src/roster.js`, `src/publish.js`.
  Keep it that way: an import of geo.js/store.js/config.js from a pure module breaks the web bundle.
- **Dealers tab** (`dealerRoster` in roster.js, `GET /api/dealers`; uses `lastRun` from buyList.js): every dealers.csv row with
  distance, aged count, cars seen on its site in 3 days, and the last scan's error for it.
- **Server** (`src/server.js`): Express 5 on 127.0.0.1, or 0.0.0.0 only when `allowPhoneAccess`
  AND `accessPin` are set (non-local requests need the PIN). Manual scan has a 30-min cooldown.
  The scheduler ticks every 5 min: on scan days at/after `scanTime`, it runs once per day if no
  scheduled scan ran today (catches up after sleep). `data/scan.lock` (6h stale) prevents
  overlap with `npm run scan`.
- **Page** (`public/index.html`, shared by both versions): deliberately NOT Riley's look. Light
  "business desk" style for Gen X/boomer users (2026-10-28): white cards on #eef1f5, navy
  #1c3f6e masthead/primary buttons, a full-width green #16733a "Call (xxx) xxx-xxxx" button per
  dealer, Public Sans (Google Fonts, plain zeros; Atkinson Hyperlegible Next was dropped for its
  slashed zeros in prices) at 18px base, 48px+ tap targets, sentence case, plain words ("Price
  too high", "Not interested", a "Why it's on the list:" sentence that also spells out the store
  priority, e.g. "Ford (a store priority), under 80,000 miles"). High/Medium priority badge instead
  of the raw score (`priorityLevel`: tier ≥2 or score ≥60 = High; tier ≥1 or score ≥40 = Medium).
  2×2 tabs and 2-column outcome buttons on phones. In-page PIN dialog (`askPin`, re-asks on every
  401) instead of `prompt()`. "What we're looking for" card above the tabs: saved-search pills
  (★ Astro default, named searches with ×, + Save this search), removable amber filter chips, the
  panel (groups of `<details>` with Show/Hide, 22px tick boxes with counts, find box for long
  lists, Lowest/Highest boxes); every change saves `prefs.active` and reloads counts + the visible
  list (debounced). Filter values reach the page only as escaped `data-` attributes read by
  delegated handlers. Today opens with "Top 10 today" (numbered rows with VIN/stock, the why
  sentence and a green Call button; the name links to its full entry `#unit-N`). The status card
  shows one line for failed dealer sites (count + how many are 403s) with a "See which ones" link
  to the Dealers tab, never the whole list. Print layout hides controls. Buttons reference cars by
  index (never embed site text). Third-party URLs go through `safeUrl` (http/https only) and all
  text is escaped. Keep the element ids/function names: `cloud/adapter.js` and `cloud/build.mjs`
  (needs `<title>` and the first `<script>` to be the inline one) depend on them. Don't reuse a
  class name between the masthead and the content (a `.top` header once turned the Top 10 navy).
- **Web version** (`cloud/`, `scripts/cloud-scan.mjs`, `.github/workflows/buy-list-*.yml`):
  - **Scan** = GitHub Actions `buy-list-scan.yml`, cron `45 10 * * 1-6` (5:45 AM CDT / 4:45 AM
    CST) + manual. Restores `market.json.gz` (the scan's db) from the orphan `buy-list-state`
    branch, exports called keys + hidden dealers from D1, runs `cloud-scan.mjs` with
    `cloud/scan-config.json` (the store's settings: 200 mi, $10k floor, Ford + under 80k first,
    price bands, excludes "astro ford"; dealer concurrency 6, 2-min site timeout; keep it in step
    with the store PC's config.json), writes KV `status`/`aged`/`dealers` (`publish.js`: only
    aged-and-active cars plus anything called, KEEP fields + `DETAIL_FIELDS` for the filters;
    status = `status()`'s per-source latest run + focusMakes/focusUnderMiles/topListSize) and
    force-pushes the new state branch. Debug files → artifact.
  - **Site** = Cloudflare Worker `cloud/worker.js` + static assets (`cloud/public/`, built by
    `cloud/build.mjs`: the shared page + `logic.js` [esbuild IIFE `BuyLogic` of buyList.js +
    filters.js `parseFilter`] + `adapter.js`). The worker never parses the scan data (stays under
    the 10ms CPU limit): `GET /api/data` = KV status + dealers strings + the desk from D1
    (`schema.sql`: car_state, calls, hidden, prefs [one row], pin_failures); `GET /api/aged` streams
    the KV value as is (several MB at 200 mi). `adapter.js` overrides `fetch("/api/…")` and answers
    status/today/listings/filters/prefs/dealers/hidden in the browser with the same ranking and
    filter code (`?f=` honored); outcomes, hide/unhide and `PUT /api/prefs` (cleaned with
    `cleanFilter`, same rules as server.js) go to the worker and are mirrored locally;
    `BUYLIST_CLOUD.downloadCsv(filter)` builds the CSV client-side. PIN: `ACCESS_PIN` secret,
    `x-pin` header, constant-time compare, 20 wrong tries/IP/hour → 429. `/api/scan` explains the
    schedule, or dispatches the scan workflow when `GITHUB_TOKEN` (from BUYLIST_GITHUB_TOKEN) is
    set (30-min cooldown).
  - **Deploy** = `buy-list-deploy.yml` on push to main (skips quietly without secrets) or manual:
    tests → `cloud/ensure.mjs` (finds/creates KV `buylist-data` + D1 `buylist`, patches ids into
    wrangler.toml, which stays committed with placeholders) → schema → build → `wrangler deploy`
    → sets ACCESS_PIN. Secrets: CLOUDFLARE_API_TOKEN ("Edit Cloudflare Workers" + Account·D1·Edit),
    CLOUDFLARE_ACCOUNT_ID, BUYLIST_PIN; optional MARKETCHECK_API_KEY, BUYLIST_GITHUB_TOKEN.
  - Local try-out: `node cloud/build.mjs`, `cloud/.dev.vars` with ACCESS_PIN, `npx wrangler dev
    --local` in cloud/ (gitignored: cloud/public, .wrangler, .dev.vars, .scan-data). Restart
    `wrangler dev` after a rebuild if the page starts answering 500 (it loses the rebuilt folder).
- **Tests:** `npm test` (node --test, 55 tests, offline). `test/filters.test.mjs`: buckets, matching,
  counts, and the call list following a filter. `test/cloud.test.mjs` covers publish and the worker
  (PIN gate, streamed cars, prefs, outcomes) against a fake D1 on `node:sqlite`. `test/scan.test.mjs` runs a real headless
  browser against an Express server that copies each site shape: CarGurus feed (400 cars,
  oldest-first, asserts the early stop after 6 requests), CarGurus page fallback, a bot wall,
  dealer API + Next, JSON-LD, plain HTML + Load more, "VIN:" label cards, VIN-less
  Carsforsale-style cards, a homepage with only "Inventory", DealerOn-style `rel=next` paging with
  a price only on the page, and a broken site. `test/extract.test.mjs` includes the live CarGurus,
  DealerOn and AutoCorner feed shapes and bot-wall vs reCAPTCHA pages.
- **Next ideas:** list dealers seen on CarGurus that aren't in dealers.csv yet; an
  offer-range hint from comparable cars in the data.
