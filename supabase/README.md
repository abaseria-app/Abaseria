# Shared price database

The app is the way in; this database is the product. Every confirmed price becomes a row: which barcode, which branch, which day, how much.

The app can connect and read from it (Settings → Check connection). Uploading sightings and pulling the latest price for a scanned barcode come next.

## Tables

| Table | One row per | Notes |
|---|---|---|
| `branches` | physical store | id is made on the phone; lat/lng is the store's position, never a shopper's |
| `products` | barcode | 8/12/13/14 digits with a valid check digit. In-store scale codes (13 digits starting with 2) are rejected because they change daily |
| `price_sightings` | confirmed price | day only (no time), never edited by the app, `client_id` stops double uploads |
| `latest_prices` (view) | barcode × branch | newest sighting |

## Rules

- Anyone with the app's public key can read branches, products and prices.
- A signed-in phone (anonymous sign-in, no account needed) can add rows. Each row is stamped with that phone's id.
- Nobody can edit or delete from the app. You fix bad rows in the Supabase dashboard.
- Which phone added a price is stored but can't be read through the app.
- Sightings older than 14 days or dated in the future are refused.

## Two databases

| Project | Used by | Data |
|---|---|---|
| `abeseria-dev` | `npm run dev` on your computer | Test scans, made-up stores. Wipe it whenever you like. |
| `abeseria-prod` | The GitHub Pages app shoppers use | Real prices only. Nothing typed during development goes here. |

The app checks the label: the dev server only connects to a database marked `dev`, a production build only to one marked `prod`. Mismatched or missing settings mean the app runs phone-only, as before.

## Setup (about 20 minutes, both projects)

Do these steps twice, once for `abeseria-dev` and once for `abeseria-prod`. The free plan allows two active projects.

1. Sign up at supabase.com. Create the project, pick **Southeast Asia (Singapore)**, the region closest to the Philippines, and save the database password in your password manager.
2. Open **SQL Editor**, start a new query, paste all of `schema.sql`, and run it. It should finish with no errors.
3. In **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**.
4. From **Project Settings → API**, copy the **Project URL** and the **publishable key** (starts with `sb_publishable_`, or the older `anon` key).
5. Never put the **secret / service_role key** or the database password in the app or in this repo. Either one bypasses every rule above. The app refuses to start its connection if a secret key is pasted in.

Where the two values go:

- **Dev:** `.env.development` in the repo (see `.env.example`).
- **Prod:** GitHub repo → Settings → Secrets and variables → Actions → **Variables** tab: `SUPABASE_PROD_URL` and `SUPABASE_PROD_PUBLISHABLE_KEY`. The next push to `main` builds them in.

To confirm: open the app → Settings → Shared price database → Check connection. It shows which database it reached and how many stores, products and prices it holds.

## Changing the schema

Run `npm run test:schema` first. It loads `schema.sql` into an in-memory Postgres with stand-ins for Supabase's sign-in and roles and runs 17 checks. The deploy workflow runs it on every push. Apply a change to dev, test, then apply the same change to prod.

## Before real testers use it

- The free plan pauses a project after a week with no activity. The quiet week between trip 1 and trip 2 could hit that on `abeseria-prod`, so either open its dashboard mid-week or move prod to Pro ($25/month) for the test.
- Anonymous sign-ins can be abused by scripts. Turn on CAPTCHA protection before the app is public.

## Checked

Before `npm run test:schema` existed, `schema.sql` was run against Postgres with a stand-in for Supabase's auth and roles. 22 checks passed, covering: adding as a signed-in phone, duplicate branches, swapped coordinates, faked contributor ids, scale barcodes, double uploads, old dates, bad bundles, unknown barcodes, latest-price logic, blocked edits and deletes, the hidden contributor column, and logged-out reads.
