# Abeseria prototype

A grocery tally PWA for the 10-shopper test in Imus. The shopper snaps the shelf tag, picks the price, and watches a running total against their budget. At the counter they compare with the register and count the receipt lines.

The test answers one question: **will people keep logging past item 15?**

## How it works

- **Tag-first capture.** One photo of the shelf tag gives the price and usually the name. OCR runs on the phone with Tesseract.js. No barcode step.
- **Price chips, not a guess.** The parser finds every price on the tag and ranks them by text size and ₱/P marker. The top chip is preselected, so a good read is one tap on Add.
- **Offline.** The app, OCR engine and language data are cached by a service worker. After one visit with signal, it works in a mall basement.
- **Money** is integer centavos everywhere. Bundles ("3 for ₱100") are supported. Per-kilo isn't: supermarket weighed items carry a sticker with the total.
- **Everything stays on the phone** (IndexedDB). No login, no backend, no ads, no analytics.

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
npm run build    # production build in dist/
```

Camera access needs HTTPS (or localhost), so test the camera on your phone through the GitHub Pages link, not the Wi-Fi address.

## Deploy

Pushing to `main` runs tests, builds, and publishes to GitHub Pages through `.github/workflows/deploy.yml`. In the repo: Settings → Pages → Source: **GitHub Actions**. The app lands at `https://<user>.github.io/<repo>/`.

## Files

| Path | What it does |
|---|---|
| `src/lib/priceParser.ts` | Finds and ranks prices on a tag. 30+ test strings in `priceParser.test.ts` |
| `src/lib/ocr.ts` | Tesseract setup, guide-box crop, contrast stretch |
| `src/lib/money.ts` | Centavo formatting and line totals |
| `src/lib/export.ts` | trips/events/items CSV, coverage, pass-line math |
| `src/lib/db.ts` | IndexedDB tables (trips, items, events, settings) |
| `src/strings.ts` | Every user-facing string, ready for translation |
| `scripts/copy-ocr.mjs` | Copies the OCR engine into `public/` so nothing loads from a CDN |
