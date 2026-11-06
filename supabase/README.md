# Shared price database

The app is the way in; this database is the product. Every confirmed price becomes a row: which barcode, which branch, which day, how much.

The app can connect and read from it (Settings → Check connection). Uploading sightings and pulling the latest price for a scanned barcode come next.

## Tables

| Table | One row per | Notes |
|---|---|---|
| `branches` | physical store | id is made on the phone; lat/lng is the store's position, never a shopper's |
| `products` | barcode | 8/12/13/14 digits with a valid check digit. In-store scale codes (13 digits starting with 2) are rejected because they change daily. `image_path` names the product's one reference image |
| `price_sightings` | confirmed price | day only (no time), never edited by the app, `client_id` stops double uploads |
| `latest_prices` (view) | barcode × branch | newest sighting |

## Rules

- Anyone with the app's public key can read branches, products and prices.
- A signed-in shopper can add rows. Each row is stamped with their user id. Since Nov 6, 2026 the app asks every shopper to sign in with Google before their first trip and no longer creates anonymous users (see Sign-in below).
- Nobody can edit or delete from the app. You fix bad rows in the Supabase dashboard.
- Which phone added a price is stored but can't be read through the app.
- Sightings older than 14 days or dated in the future are refused.
- Product images are yours to set. Phones can view them but can't add, replace or delete one.

## Product images

One image per product, shown as the thumbnail in the shopper's list so they can see the scan found the right thing.

1. Storage → `product-images` → upload the file (JPEG, PNG or WebP, 512 KB max). Name it after the barcode, e.g. `4800016644818.jpg`.
2. Table Editor → `products` → that barcode's row → put the file name in `image_path`.

To replace one, upload the new file under the same name, or a new name and change `image_path`. Phones that already scanned the product keep their copy until it's scanned on a phone that hasn't.

## Sign-in (Google)

Every shopper signs in with Google on first open. After that the app opens offline too: it keeps a "signed in as" record on the phone, and Supabase checks it whenever there's signal. Trips stay on the phone; signing out doesn't delete them.

Phones that were already sharing anonymously keep their user id when they pick Google (manual linking), so their past prices stay credited to them. If that Google account already has an Abeseria user, the phone switches to it.

### One-time setup, about 25 minutes

**Google Cloud** (console.cloud.google.com, signed in with the Google account that should own Abeseria, not a Mako Moto one):

1. Create a project named `Abeseria`.
2. **Google Auth Platform → Branding:** app name `Abeseria`, your support email. Skip the logo for now: uploading one sends the app to Google for review.
3. **Audience:** User type **External**, leave it in **Testing**. Under Test users, add every Gmail that will sign in (you, Jovie, each tester). Testing mode allows 100. Before the app is public, press **Publish app** (name, email and profile scopes don't need Google's security review).
4. **Clients → Create client → Web application**, name `Abeseria web`:
   - Authorized JavaScript origins: `https://bkarkos86-mako.github.io` and `http://localhost:5173`
   - Authorized redirect URIs: `https://psffjwaezfspmbebqbgg.supabase.co/auth/v1/callback` (dev) and `https://xjztzqwyzkfzvgizlucc.supabase.co/auth/v1/callback` (prod)
5. Copy the **Client ID** and **Client secret**. The secret goes into Supabase only, never into this repo or the app.

**Supabase, abeseria-dev first:**

1. **Authentication → Sign In / Providers → Google:** turn on, paste the Client ID and Client secret, save.
2. Same page: turn on **Allow manual linking**. With it, old anonymous test phones keep their user id when they add Google. Without it, they sign in to Google as a new user and their past prices stay under the old anonymous id.
3. **Authentication → URL Configuration:** Site URL `https://bkarkos86-mako.github.io/Abaseria/dev/`. Redirect URLs: add `https://bkarkos86-mako.github.io/**` and `http://localhost:5173/**`.
4. Once your test phones have signed in with Google, turn **off** Allow anonymous sign-ins. The app no longer uses it, and leaving it on lets scripts create users.

**abeseria-prod:** the same 4 steps with Site URL `https://bkarkos86-mako.github.io/Abaseria/`, **before** the login branch reaches `main`. Otherwise the live app asks for a sign-in that can't finish.

To confirm: open `/Abaseria/dev/` on your phone, tap Continue with Google, pick your account, and you land on Home. Settings → Account shows your name. In SQL Editor, `select email, is_anonymous from auth.users` shows your Gmail with `is_anonymous = false`.

### CAPTCHA

With Google as the only way in, Google's own sign-in page does the bot checking, and turning off anonymous sign-ins closes the one door scripts could use without it. Cloudflare Turnstile goes in with the first email or password sign-in (the admin dashboard's staff login, or email-link sign-in for shoppers).

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

Changes after the first setup go in `supabase/migrations/`, numbered in order. `schema.sql` always holds the full current version for new projects.

| Migration | What it does | Run in dev | Run in prod |
|---|---|---|---|
| `002_shared_capture.sql` | Allows capture method `shared` (another shopper's price, checked against the tag) | Needed for module 2 | Before price sharing turns on in the live app |
| `003_product_images.sql` | `products.image_path` and the public `product-images` bucket; images set in the dashboard only | Before adding images | Before images show in the live app |

Run `npm run test:schema` first. It loads `schema.sql` into an in-memory Postgres with stand-ins for Supabase's sign-in and roles and runs 28 checks. The deploy workflow runs it on every push. Apply a change to dev, test, then apply the same change to prod.

## Before real testers use it

- The free plan pauses a project after a week with no activity. The quiet week between trip 1 and trip 2 could hit that on `abeseria-prod`, so either open its dashboard mid-week or move prod to Pro ($25/month) for the test.
- Anonymous sign-ins can be abused by scripts. Turn on CAPTCHA protection before the app is public.

## Checked

Before `npm run test:schema` existed, `schema.sql` was run against Postgres with a stand-in for Supabase's auth and roles. 22 checks passed, covering: adding as a signed-in phone, duplicate branches, swapped coordinates, faked contributor ids, scale barcodes, double uploads, old dates, bad bundles, unknown barcodes, latest-price logic, blocked edits and deletes, the hidden contributor column, and logged-out reads.
