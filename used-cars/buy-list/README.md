# Buy List

Every morning, a list of used cars for sale within 200 miles of 39540 that have
been listed a long time (60+ days), ranked and grouped by dealer, for the used car
manager to call and try to buy. It costs nothing (no paid services) and runs one
of two ways:

- **Web version (recommended):** a private web page that works on any phone or
  computer, with nothing to install. GitHub runs the morning scan for free and
  Cloudflare's free plan hosts the page behind a PIN. Setup is below.
- **PC version:** runs on a computer at the store (see "PC version" further down).

## What it does

- **Scans three free sources at 6:00 AM (Mon-Sat):**
  - **CarGurus** shows how many days every car has been listed. The tool reads it
    oldest-listed first within 200 miles (from $10,000 up, in price bands).
  - **Dealer websites** in `dealers.csv`, which comes filled in with 308 dealers
    within about 100 miles (see below). Most don't show days listed, so the tool
    counts from the first day it sees each car (and uses an in-stock date when a
    site publishes one).
  - **Marketcheck free tier** (optional): $0, no credit card, ~500 lookups a month.
    It's skipped unless you add a free key (`sources.marketcheck.apiKey` in config.json). Each
    scan reads the 500 nearest aged cars (the free tier's limit) and catches cars a dealer
    re-listed to reset CarGurus' day count. Use the key on one PC only: each copy counts its own
    lookups against the same monthly limit.
- **One record per car.** The same VIN on several sources is merged, and "days
  listed" is the longest any source reports.
- **Fords first, then cars under 80,000 miles,** then everything else; nothing under $10,000.
  Within each group it ranks every car with a reason for each point: days listed, price drops,
  distance, and anything that changed since your last call.
- **Groups by dealer**, so one call covers every aged car on that lot. Private
  sellers each get their own card.
- **Tracks calls.** Each car takes one tap: No answer (back tomorrow), Left a
  message (2 days), Price too high (10 days), Won't sell (21 days), Negotiating
  (pinned at the top), Bought it, Not interested. If a "too high" car drops its
  price, it comes back the next morning showing the drop since your call.
- **Easy-to-read page** built for a busy desk: large type, plain words, a big green
  Call button for each dealer, a spreadsheet download for Excel, and a print
  layout.

With ~300 dealer sites, the morning scan takes an hour or two; the list updates
when it finishes.

## Web version setup (one time, about 20 minutes)

Everything here is free. No credit card is needed for GitHub or Cloudflare.

1. **GitHub default branch.** In this repo on GitHub: **Settings → General →
   Default branch**, switch it to **`main`**. GitHub only runs the scheduled
   morning scan from the default branch.
2. **Cloudflare account.** Sign up at https://dash.cloudflare.com/sign-up. Open
   **Workers & Pages** once and pick a free `workers.dev` subdomain when it asks
   (for example `astro-ford`). Copy your **Account ID** (shown on the Workers &
   Pages page, or Account home → ⋯ next to the account → Copy account ID).
3. **Cloudflare API token.** Profile icon → **My Profile → API Tokens → Create
   Token → "Edit Cloudflare Workers"** template. Under Permissions click **+ Add
   more** and add **Account · D1 · Edit**. Account Resources: your account; Zone
   Resources: All zones. **Continue → Create Token**, then copy the token (it's
   shown once).
4. **GitHub secrets.** In this repo: **Settings → Secrets and variables → Actions
   → New repository secret**, one at a time:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the token from step 3 |
   | `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 2 |
   | `BUYLIST_PIN` | a PIN for the page, 6+ digits (the manager types it once per device) |
   | `MARKETCHECK_API_KEY` | optional: a free key from https://www.marketcheck.com/apis |
   | `BUYLIST_GITHUB_TOKEN` | optional: makes "Check for new cars now" work (see below) |

5. **Deploy.** **Actions** tab → **Buy List deploy** → **Run workflow**. When it
   turns green, open the run: the summary shows the link,
   `https://buy-list.<your-subdomain>.workers.dev`.
6. **First scan.** **Actions → Buy List scan → Run workflow.** It takes about an
   hour. After that it runs by itself Monday to Saturday before the store opens.
7. **Hand it over.** Send the manager the link and the PIN. On an iPhone: open
   the link in Safari → Share → **Add to Home Screen**. On Android: Chrome → ⋮ →
   **Add to Home screen**. It then opens like an app.

**"Check for new cars now" button (optional).** Without it, the button explains
that scans run every morning. To let it start a scan: GitHub → your picture →
**Settings → Developer settings → Fine-grained tokens → Generate new token**,
Repository access: only this repo, Permissions: **Actions: Read and write**. Save
it as the `BUYLIST_GITHUB_TOKEN` secret and run **Buy List deploy** again.

**Changes later:** edit `dealers.csv` (or anything in this folder) on GitHub and
commit. The page redeploys by itself; new dealers are read on the next morning
scan.

**What's private:** this repo is public, so the code and `dealers.csv` can be seen
by anyone. Call notes, offers, the call history and the PIN are stored only in
your Cloudflare account, behind the PIN. The scan's memory (public listing data:
prices, first-seen dates) is kept on the `buy-list-state` branch so each morning
picks up where the last one left off.

**Heads-up:** CarGurus may block cloud servers. If it does, on the web version the
dealer websites (and Marketcheck, if you add the free key) do most of the work.
The **Dealers** tab shows which sites were read.

## PC version

Leave it running and the scan happens by itself at 6:00 AM. If the PC was off or
asleep at 6:00, it scans as soon as the PC is back on.

### Setup (Windows, one time)

1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Get this folder onto the PC: download
   https://github.com/burnzzzstock-ops/astroprojects/archive/refs/heads/main.zip (the
   repo's default branch on GitHub isn't `main`, so **Code → Download ZIP** gets a copy
   without this folder), unzip it, and open `used-cars\buy-list`. Any location works,
   e.g. `Documents\buy-list`. Moving it from another PC instead? Copy the folder without
   `node_modules`; bring `config.json` and `data\buylist.json` along to keep its settings,
   list and call history.
3. Double-click **`setup.bat`**. It installs everything (a few minutes the first
   time), makes the Buy List start whenever you log in, puts a **Buy List** shortcut
   on the desktop, and opens the page.
4. Open **`config.json`** in Notepad and check `excludeSellers`: your own store's
   name has to be in there so your lot isn't on the list.
5. Look over **`dealers.csv`** (Excel or Notepad). It comes with 308 dealers within
   about 100 miles, closest first: the Mississippi Coast, Pascagoula to Picayune,
   Hattiesburg/Laurel/Columbia, Mobile and Baldwin County, Slidell, the north
   shore, Hammond and the New Orleans metro (171 franchise stores, 137
   independent lots). They were found by web search on 2026-10-26, so expect a
   few dead links and call-tracking phone numbers; the **Dealers** tab shows which
   sites read and which didn't after each scan. Delete lots you'd never buy from
   and add any that are missing, one per row:

   ```csv
   name,phone,city,state,zip,used_inventory_url,type
   Example Motors,(228) 555-0100,Gulfport,MS,39501,https://www.example-motors.com/,independent
   ```

   The link can be the dealer's homepage: the tool finds their "Used / Pre-Owned"
   inventory page on its own. The zip is used to work out the distance.

**Mac:** install Node.js LTS, then in Terminal from this folder run `npm install`,
`npx playwright install chromium`, `cp config.example.json config.json`, and
`npm start`. Open http://localhost:4400.

## Daily use

Open the web link (or, on the PC version, the **Buy List** shortcut or
http://localhost:4400).

- **Today's calls**: who to call, best first. **Top 10 today** at the top is the
  ten best cars, each with its dealer's green **Call** button; tap a car's name to
  jump to its full entry. Below that, the calls are grouped by dealer, with a High
  or Medium priority tag and a plain "Why it's on the list" line. Tap **Call**, then
  tap how the call went. **Notes from the call** and **Our offer** save with it.
- **Nobody picked up?** One tap marks every car at that dealer No answer or Left a
  message.
- **Hide this dealer** takes a lot off the list for good. Undo it on the **Hidden
  dealers** tab with **Show again**.
- **What we're looking for** (above the tabs): about two dozen filters, pick as
  many as you like in each: make, model, year, body style, drivetrain, fuel,
  engine, transmission, exterior and interior color, features (leather, sunroof,
  third row…), certified, price, miles, days listed, price vs. CarGurus' market
  value, CarGurus rating, price dropped, distance, state, city, dealer, franchise
  or independent, where it was found, and call status. The Top 10, today's calls,
  Search all cars and the spreadsheet all follow them. **+ Save this search** keeps
  a set under a name ("Trucks under 40k"); tap it to switch back. **★ Astro
  default** clears them: everything aged, Fords first, then under 80k miles. On the
  web version the filters and saved searches are kept online, so they're the same
  on every phone and computer.
- **Search all cars** searches every aged car ("tacoma", "f-150 lariat",
  "gulfport").
- **Dealers** lists every dealer being watched, closest first, with how many aged
  cars each has and any site that couldn't be read on the last scan.
- **Download spreadsheet** and **Print today's list** give you a copy for Excel or
  paper.

### Using the PC version from a phone

In `config.json`, set `"allowPhoneAccess": true` and an `"accessPin"` (for example
`"4821"`), then restart (close the Buy List window and open `start.bat`). The
window shows a `http://192.168.x.x:4400` address. Open that on a phone connected to
the store Wi-Fi and enter the PIN. Windows may ask you to allow Node.js through the
firewall: allow it on **private** networks.

## Settings (`config.json`)

| Setting | Default | What it does |
| --- | --- | --- |
| `zip`, `radiusMiles` | 39540, 200 | Center and radius of the search (CarGurus; the dealer-site list covers ~100 mi) |
| `minDaysListed` / `maxDaysListed` | 60 / 365 | "Listed a long time" window; past 365 days is usually a dead listing |
| `minPrice`, `maxMiles` | 10000, 175000 | Skip junk |
| `focusMakes` | ["Ford"] | Makes ranked first (add "Lincoln" etc.; `[]` = off) |
| `focusUnderMiles` | 80000 | Then cars under this many miles (`0` = off) |
| `dailyListSize` | 25 | Cars on today's list |
| `topListSize` | 10 | Cars in the "Top 10 today" list |
| `scanTime`, `scanDays` | "06:00", Mon-Sat | When the morning scan runs (0 = Sunday) |
| `excludeSellers` | your store + CarMax, Carvana… | Seller-name words to never list |
| `browser.headless` | true | Set `false` to watch the browser work (helps if a site asks "are you human?") |
| `sources.cargurus.maxPages` | 400 | Most CarGurus pages per scan, all price bands together (each band stops on its own at 60 days) |
| `sources.cargurus.priceBands` | 10000 … 60000 | Price edges the CarGurus search is split on (it returns at most 10,000 results per search) |
| `sources.marketcheck.apiKey` | "" | Optional free key from https://www.marketcheck.com/apis |
| `sources.dealerSites.maxPagesPerDealer` | 8 | Pages or "load more" clicks per dealer site |
| `sources.dealerSites.concurrency` | 3 | Dealer sites read at the same time |
| `sources.dealerSites.dealerTimeoutMs` | 180000 | Give up on one site after this long (3 minutes) |

## When something doesn't work

The top of the page shows how each source did on the last scan.

**Web version:** open the latest **Buy List scan** run in the GitHub **Actions**
tab. Its log lists each source, and when a site couldn't be read the run has a
**buy-list-debug** download with what the scanner saw. Send those files to Claude
to update the reader. The PC tips below apply too, except `config.json` (the web
scan's settings are in `cloud/scan-config.json`).

- **CarGurus blocked / no listings read.** CarGurus doesn't allow automated reading
  in its terms and may block it or change its site. Try `"headless": false` in
  config.json. The tool saves what it saw in `data\debug` (an `.html`, a `.png`,
  and sometimes a `.json`). Send those files to Claude to update the reader.
- **A dealer site shows "no cars found".** Check the link goes to the *used
  inventory* page. Some sites can't be read; the debug files for that dealer land
  in `data\debug` too.
- **Test one source by itself:** open a command prompt in this folder and run
  `npm run scan -- --only cargurus` (or `dealerSites` / `marketcheck`). Add
  `--show` to watch the browser.

Everything the tool knows is stored in `data\buylist.json`, with a backup copy at
`data\buylist.json.bak`.

## For developers

`npm test` runs 55 tests offline: the extractor against CarGurus, JSON-LD and
dealer-API data shapes; merging and price drops; ranking; filters; call outcomes;
a full headless-browser scan against fake local copies of each kind of site; and
the web version's published data and Cloudflare API (PIN gate, outcomes,
hide/unhide, saved searches). To try the web version locally: `node
cloud/build.mjs`, put `ACCESS_PIN=123456` in `cloud/.dev.vars`, then `npx wrangler
dev --local` in `cloud/`. See
`../../CLAUDE.md` for how it's built.
