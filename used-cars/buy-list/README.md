# Buy List

Every morning, a list of used cars for sale within 200 miles of 39540 that have
been listed a long time (60+ days), ranked and grouped by dealer, for the used car
manager to call and try to buy. It runs on a PC at the store and costs nothing:
no paid services, no hosting, no logins.

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
- **Tracks calls.** Each car takes one tap: No answer (back tomorrow), Left msg
  (2 days), Too high (10 days), Won't sell (21 days), Negotiating (pinned at the
  top), Bought, Pass. If a "too high" car drops its price, it comes back the next
  morning showing the drop since your call.
- **Phone-friendly page** with tap-to-call, a CSV download for Excel, and print.

Leave it running and the scan happens by itself. With ~300 dealer sites (read
three at a time), the morning scan takes an hour or two; the list updates when it
finishes. If the PC was off or asleep at
6:00, it scans as soon as the PC is back on.

## Setup (Windows, one time)

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

Open the **Buy List** shortcut, or go to http://localhost:4400.

- **Today**: who to call, best first. **Top 10 today** at the top is the ten best cars, one line each with the dealer's number; tap a car's name to jump to its full entry. Below that, the calls are grouped by dealer. Tap the phone number, then tap what happened.
  **Notes** and **Offer $** save with the call.
- **Whole lot: No answer / Left msg** logs it for every car at that dealer at once.
- **Hide dealer** takes a lot off the list for good. Undo it on the **Hidden** tab.
- **What we're looking for** (above the tabs): about two dozen filters, pick as many as you like in each:
  make, model, year, body style, drivetrain, fuel, engine, transmission, exterior and interior color,
  features (leather, sunroof, third row…), certified, price, miles, days listed, price vs. CarGurus'
  market value, CarGurus rating, price dropped, distance, state, city, dealer, franchise or independent,
  where it was found, and call status. The Top 10, today's calls, All aged and the CSV all follow them.
  **+ Save this search** keeps a set under a name ("Trucks under 40k"); tap it to switch back.
  **★ Astro default** clears them: everything aged, Fords first, then under 80k miles.
- **All aged** searches every aged car ("tacoma", "f-150 lariat", "gulfport").
- **Dealers** lists every dealer being watched, closest first, with how many aged
  cars each has and any site that couldn't be read on the last scan.
- **CSV** and **Print** give you a paper copy of today's calls.

### Using it from a phone

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

`npm test` runs 47 tests offline: the extractor against CarGurus, JSON-LD and
dealer-API data shapes; merging and price drops; ranking; call outcomes; and a full
headless-browser scan against fake local copies of each kind of site. See
`../../CLAUDE.md` for how it's built.
