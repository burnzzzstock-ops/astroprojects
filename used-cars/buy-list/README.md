# Buy List

Every morning, a list of used cars for sale within 100 miles of 39540 that have
been listed a long time (60+ days), ranked and grouped by dealer, for the used car
manager to call and try to buy. It runs on a PC at the store and costs nothing:
no paid services, no hosting, no logins.

## What it does

- **Scans three free sources at 6:00 AM (Mon-Sat):**
  - **CarGurus** shows how many days every car has been listed. The tool reads it
    oldest-listed first within 100 miles.
  - **Dealer websites** in `dealers.csv`, which comes filled in with 313 dealers
    within about 100 miles (see below). Most don't show days listed, so the tool
    counts from the first day it sees each car (and uses an in-stock date when a
    site publishes one).
  - **Marketcheck free tier** (optional): $0, no credit card, ~500 lookups a month.
    It's skipped unless you add a free key.
- **One record per car.** The same VIN on several sources is merged, and "days
  listed" is the longest any source reports.
- **Ranks every car with a reason for each point:** days listed, price drops,
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
2. Get this folder onto the PC: on GitHub, click **Code → Download ZIP**, unzip it,
   and open `used-cars\buy-list`. Any location works, e.g. `Documents\buy-list`.
3. Double-click **`setup.bat`**. It installs everything (a few minutes the first
   time), makes the Buy List start whenever you log in, puts a **Buy List** shortcut
   on the desktop, and opens the page.
4. Open **`config.json`** in Notepad and check `excludeSellers`: your own store's
   name has to be in there so your lot isn't on the list.
5. Look over **`dealers.csv`** (Excel or Notepad). It comes with 313 dealers within
   about 100 miles, closest first: the Mississippi Coast, Pascagoula to Picayune,
   Hattiesburg/Laurel/Columbia, Mobile and Baldwin County, Slidell, the north
   shore, Hammond and the New Orleans metro (171 franchise stores, 142
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

- **Today**: who to call, best first. Tap the phone number, then tap what happened.
  **Notes** and **Offer $** save with the call.
- **Whole lot: No answer / Left msg** logs it for every car at that dealer at once.
- **Hide dealer** takes a lot off the list for good. Undo it on the **Hidden** tab.
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
| `zip`, `radiusMiles` | 39540, 100 | Center and radius of the search |
| `minDaysListed` / `maxDaysListed` | 60 / 365 | "Listed a long time" window; past 365 days is usually a dead listing |
| `minPrice`, `maxMiles` | 4000, 175000 | Skip junk |
| `dailyListSize` | 25 | Cars on today's list |
| `scanTime`, `scanDays` | "06:00", Mon-Sat | When the morning scan runs (0 = Sunday) |
| `excludeSellers` | your store + CarMax, Carvana… | Seller-name words to never list |
| `browser.headless` | true | Set `false` to watch the browser work (helps if a site asks "are you human?") |
| `sources.cargurus.maxPages` | 60 | How deep into CarGurus' oldest-first results to go |
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

`npm test` runs 29 tests offline: the extractor against CarGurus, JSON-LD and
dealer-API data shapes; merging and price drops; ranking; call outcomes; and a full
headless-browser scan against fake local copies of each kind of site. See
`../../CLAUDE.md` for how it's built.
