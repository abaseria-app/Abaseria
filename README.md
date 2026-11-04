# Abeseria prototype

A grocery tally PWA for the 10-shopper test in Imus. The shopper snaps the shelf tag, picks the price, and watches a running total against their budget. At the counter they compare with the register and count the receipt lines.

The test answers one question: **will people keep logging past item 15?**

## How it works

- **Barcode first.** Scan item opens the camera on the package barcode; it reads on its own, no tap. If this phone logged that barcode at this branch before, the name and last price fill in and the shopper checks the tag and taps Add. If not, the camera switches to the shelf tag. "No barcode" skips to the tag (loose produce, meat). Store scale stickers (13 digits starting with 2) go to the tag step too. Phones without a built-in barcode reader (iPhones today) start at the tag.
- **Tag reading.** One photo of the shelf tag gives the price and usually the name. OCR runs on the phone with Tesseract.js.
- **Price chips, not a guess.** The parser finds every price on the tag and ranks them by text size and ₱/P marker. The top chip is preselected, so a good read is one tap on Add.
- **Offline.** The app, OCR engine and language data are cached by a service worker. After one visit with signal, it works in a mall basement.
- **Money** is integer centavos everywhere. Items are sold each, as a bundle ("3 for ₱100") or per kilo (price per kg × amount bought, e.g. ₱320/kg × 0.75 kg = ₱240). A per-kg or per-100g price on a tag switches the item to per kilo.
- **Phone first.** Trips live on the phone (IndexedDB) and work offline. No ads, no analytics.
- **Shared prices (dev app only for now).** When a trip ends, each item with a real barcode uploads its product, store, price and day to the shared database; with no signal it waits and retries the next time the app opens online. Scanning a barcode this phone hasn't logged at this store asks the database for other shoppers' latest price there (2 seconds at most) and offers it to check against the tag. Location, time of day, tester ids and items without a barcode never leave the phone. The live app turns this on once the consent screen exists.
- **Store picker.** New trip takes one location reading and preselects the nearest saved branch. Two stores within 100 m of each other means the shopper taps. The first time at a store, the shopper adds it and the phone's position becomes the branch location.

## What gets measured

| Measure | Where it comes from |
|---|---|
| Coverage | Items logged ÷ receipt lines, entered at the counter |
| Second trip | Trip number per tester ID, plus "Did someone ask you to use the app?" |
| Speed | Seconds from Snap to Add for every tag item |
| Read quality | Which chip was picked (rank 1–4 or typed), and whether it was edited after |
| Drop-off | Every abandoned capture and the step it happened at |

**Pass line (set before any data):** at least 6 testers with 20+ receipt items log 80% or more of them on trip 1. Settings → Combine tester results checks this from everyone's CSVs.

## Checkpoints

Each one has a done-state. Don't move to the next until it's met.

1. **Tag reading on real tags.** Take 10 shelf-tag photos at Puregold or SM: straight-on, angled, a promo tag, a crossed-out price. Settings → Check tag reading on photos. **Done when:** the right price is in the chips 8 of 10 times and the average read time is under 3 seconds on your phone.
2. **Your own trip.** Shop a real 20+ item trip with the app. **Done when:** coverage is 100%, the total matches the register, and nothing confused you.
3. **Install on 3 other phones.** Open the link in Chrome, Add to Home screen, open it once at home. **Done when:** all 3 can snap a tag in airplane mode.
4. **Tester sheet.** One page in English and Tagalog: open the link, add to home screen, enter the tester ID, shop normally, count receipt lines, export. Have a native speaker check the Tagalog. **Done when:** someone follows it without asking you anything.
5. **The 10-shopper test.** Get the store's OK first. Don't shadow testers; meet them at the counter. **Done when:** 10 trip-1 CSVs are in hand.
6. **Second trip.** A week later, don't remind anyone. **Done when:** you've collected exports again and run Combine tester results.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173, also on your Wi-Fi so your phone can open it
npm test         # parser, money and metrics tests
npm run test:schema  # database rules, in an in-memory Postgres
npm run build    # production build in dist/
```

Camera access needs HTTPS (or localhost), so test the camera on your phone through the GitHub Pages link, not the Wi-Fi address.

## Deploy

One GitHub Pages site holds two apps:

| Address | Built from | Database | Phone storage |
|---|---|---|---|
| `https://<user>.github.io/<repo>/` | `main` | abeseria-prod | `abeseria` |
| `https://<user>.github.io/<repo>/dev/` | `dev` | abeseria-dev | `abeseria-dev` |

- **Pushing to `dev`** runs `.github/workflows/dev.yml`: tests, then a rebuild that updates `/dev/` only. Test new features here on a real phone.
- **Merging `dev` into `main`** runs `.github/workflows/deploy.yml` and updates the live app (and `/dev/` along with it).
- The dev app shows a red **DEV · test data** badge and installs as "Abeseria Dev", so the two can sit side by side on one phone without sharing trips or offline files.

In the repo: Settings → Pages → Source: **GitHub Actions**.

## Files

| Path | What it does |
|---|---|
| `src/lib/priceParser.ts` | Finds and ranks prices on a tag. 30+ test strings in `priceParser.test.ts` |
| `src/lib/ocr.ts` | Tesseract setup, guide-box crop, contrast stretch |
| `src/lib/money.ts` | Centavo formatting and line totals |
| `src/lib/export.ts` | trips/events/items CSV, coverage, pass-line math |
| `src/lib/db.ts` | IndexedDB tables (trips, items, events, settings, branches) |
| `src/lib/location.ts` | One location reading at trip start → nearest saved branch. The reading is never stored |
| `.env.development` | Dev database address and publishable key (abeseria-dev) |
| `src/lib/sync.ts` | Uploading finished trips and looking up other shoppers' prices |
| `src/lib/supabase.ts` | Connection to the shared price database; picks dev or prod and refuses a mismatch |
| `supabase/` | Shared price database schema, setup steps for the dev and prod projects, schema checks |
| `src/strings.ts` | Every user-facing string, ready for translation |
| `scripts/copy-ocr.mjs` | Copies the OCR engine into `public/` so nothing loads from a CDN |
