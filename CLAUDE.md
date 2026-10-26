# astroprojects: developer guide

Side projects for the dealership (used cars, staffing, service, …), one folder per
department/project. Read this first in any new session.

## Standing rules

- **Separate from Riley / TextDrive.** Riley (the AI SDR) lives in `burnzzzstock-ops/sales1`.
  Nothing here imports from, writes to, or deploys with it, and nothing here goes into it.
  A first Buy List was built inside Riley and backed out at the operator's request.
- **No paid services.** Free data sources and free tiers that can't bill (no card on file).
  Projects run on a store PC, not paid hosting.
- **No customer PII in the repo.** Test data uses obviously fake names, 555-01xx phones and
  made-up VINs. Real data stays in each project's gitignored `data/` folder on the PC.
- **Keep this file current.** When a session changes how a project works, update its section
  here in the same commit.

## used-cars/buy-list: aged-inventory Buy List

The used car manager's daily call sheet: used cars for sale within 100 mi of 39540 listed
60+ days, ranked, grouped by dealer, with call outcomes tracked. Node 20+, runs locally
(`npm start` → http://localhost:4400). Windows install is `setup.bat`, which runs npm install,
`npx playwright install chromium`, copies the config template, adds a Startup shortcut to
`start.bat` (restart loop) and a desktop `.url` link.

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
    **Live-tested 2026-10-26 on the store PC:** the feed (A) works with no bot wall. It returns a bare
    JSON array, 48 cars per page; the sort is honored, so a full read stops by itself at the 60-day
    line after ~142 pages / ~6,800 cars in ~10 min (hence `maxPages` 150). `daysOnMarket` checks out
    against listing ids (they rise ~86k/day at every age). Field notes: photo is
    `originalPictureData.url`; `sellerCity` is "Gulfport, MS" (the extractor strips the state);
    `expectedPrice` is CarGurus' market-value estimate, NOT the asking price, so it isn't a price
    alias. CarGurus' detail pages sit behind DataDome (a captcha in a normal browser); the feed
    wasn't challenged.
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
  read, so a blocked dealer's CarGurus cars land on its card and take the CSV phone/city when
  the source has none (CarGurus often has no phone). It merges when one
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
  Today = top `dailyListSize` due cars grouped by dealer (`dealerKeyOf`: normalized name minus
  LLC/Inc; private sellers get one key per car), plus up to 6 per card riding along, with
  negotiating cars pinned. Outcomes: no_answer +1d, left_message +2d, too_high +10d,
  not_selling +21d, negotiating, bought, pass, reopen. Due days are local calendar days.
- **Dealers tab** (`dealerRoster` in buyList.js, `GET /api/dealers`): every dealers.csv row with
  distance, aged count, cars seen on its site in 3 days, and the last scan's error for it.
- **Server** (`src/server.js`): Express 5 on 127.0.0.1, or 0.0.0.0 only when `allowPhoneAccess`
  AND `accessPin` are set (non-local requests need the PIN). Manual scan has a 30-min cooldown.
  The scheduler ticks every 5 min: on scan days at/after `scanTime`, it runs once per day if no
  scheduled scan ran today (catches up after sleep). `data/scan.lock` (6h stale) prevents
  overlap with `npm run scan`.
- **Page** (`public/index.html`): dark, phone-first, tap-to-call. Buttons reference cars by index
  (never embed site text). Third-party URLs go through `safeUrl` (http/https only) and all
  text is escaped.
- **Tests:** `npm test` (node --test, 36 tests, offline). `test/scan.test.mjs` runs a real headless
  browser against an Express server that copies each site shape: CarGurus feed (400 cars,
  oldest-first, asserts the early stop after 6 requests), CarGurus page fallback, a bot wall,
  dealer API + Next, JSON-LD, plain HTML + Load more, "VIN:" label cards, VIN-less
  Carsforsale-style cards, a homepage with only "Inventory", DealerOn-style `rel=next` paging with
  a price only on the page, and a broken site. `test/extract.test.mjs` includes the live CarGurus,
  DealerOn and AutoCorner feed shapes and bot-wall vs reCAPTCHA pages.
- **Next ideas:** list dealers seen on CarGurus that aren't in dealers.csv yet; an
  offer-range hint from comparable cars in the data.
