# Shared price database

The app is the way in; this database is the product. Every confirmed price becomes a row: which barcode, which branch, which day, how much.

The app doesn't talk to it yet. This folder sets it up so the next build can upload sightings and pull the latest price for a scanned barcode at the current branch.

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

## Setup (about 10 minutes)

1. Sign up at supabase.com and create a project named `abeseria`. Pick the **Southeast Asia (Singapore)** region, the closest to the Philippines. Save the database password in your password manager.
2. Open **SQL Editor**, start a new query, paste all of `schema.sql`, and run it. It should finish with no errors.
3. In **Authentication** settings, turn on **Allow anonymous sign-ins**.
4. From the project's **API** settings, copy the **Project URL** and the **publishable (anon) key**. These two are meant to sit inside the app.
5. Never put the **secret / service_role key** or the database password in the app or in this repo. Either one bypasses every rule above.

## Before real testers use it

- The free plan pauses a project after a week with no activity. The quiet week between trip 1 and trip 2 could hit that, so either open the dashboard mid-week or move to Pro ($25/month) for the test.
- Anonymous sign-ins can be abused by scripts. Turn on CAPTCHA protection before the app is public.

## Checked

`schema.sql` was run against Postgres with a stand-in for Supabase's auth and roles. 22 checks passed, covering: adding as a signed-in phone, duplicate branches, swapped coordinates, faked contributor ids, scale barcodes, double uploads, old dates, bad bundles, unknown barcodes, latest-price logic, blocked edits and deletes, the hidden contributor column, and logged-out reads.
