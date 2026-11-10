-- Abaseria shared price database.
-- Run once in the Supabase SQL Editor on a new project. Safe to read top to bottom: nothing here deletes data.
--
-- Three tables:
--   branches        one row per physical store
--   products        one row per barcode
--   price_sightings one row every time a shopper confirms a price; never updated or deleted by the app
-- plus a latest_prices view: the newest sighting per barcode per branch.
--
-- Who can do what (enforced by row-level security below):
--   anyone with the app's public key can READ branches, products (Pending and Published), sightings and latest_prices
--   a signed-in phone (anonymous sign-in is fine) can ADD rows, stamped with its own user id
--   nobody can edit or delete rows from the app; fixes are done here by you
--   who added a sighting, product or store (contributor / created_by) is stored but never readable through the app


-- Barcode check: 8, 12, 13 or 14 digits with a valid GTIN check digit.
create or replace function public.gtin_ok(code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select code ~ '^([0-9]{8}|[0-9]{12,14})$'
     and (
       select sum(substr(code, i, 1)::int * case when (length(code) - i) % 2 = 1 then 3 else 1 end) % 10 = 0
       from generate_series(1, length(code)) as i
     );
$$;


create table public.branches (
  -- Made on the phone, so a store added with no signal keeps its id after upload.
  id          uuid primary key,
  chain       text not null check (char_length(chain) between 1 and 60),
  name        text not null check (char_length(name) between 1 and 80),
  -- The store's position, from the phone that added it. Rough Philippines box to catch swapped lat/lng.
  lat         double precision check (lat between 4 and 22),
  lng         double precision check (lng between 116 and 127.5),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create unique index branches_chain_name_key on public.branches (lower(chain), lower(name));


create table public.products (
  barcode     text primary key check (public.gtin_ok(barcode)),
  name        text not null check (char_length(name) between 1 and 120),
  size        text check (char_length(size) <= 40),
  -- One of Brad's 16 (011, Nov 11 2026), or null when nobody has sorted the product yet.
  category    text
              constraint products_category_check
              check (category in ('pantry staples', 'fruits & vegetables', 'meat, poultry & seafood', 'dairy & eggs',
                'canned & preserved food', 'cooking essentials & condiments', 'bread & bakery', 'snacks, candies & sweets',
                'beverages', 'frozen & ready-to-eat food', 'household & cleaning supplies', 'personal care & hygiene',
                'baby & kids', 'health & wellness', 'pet supplies', 'baking and desserts')),
  -- New products wait as Pending until a Product Manager or Admin publishes them. Phones can't set this.
  status      text not null default 'pending' check (status in ('pending', 'published')),
  -- Reference image: a file name in the public 'product-images' bucket. Set in the dashboard, never by the app.
  image_path  text check (image_path is null or image_path ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$'),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- 13-digit codes starting with 2 are printed in-store (deli, meat, produce scales) and often contain
  -- the weight or price, so the same "product" would get a new barcode every day. Keep them out.
  check (not (char_length(barcode) = 13 and barcode like '2%')),
  -- One form per product. UPC-A is stored as 12 digits, the way Chrome's scanner reads it. The same code
  -- written as 13 digits with a leading 0 would become a second copy of the same can (migration 006).
  constraint products_barcode_upca_12
  check (not (char_length(barcode) = 13 and barcode like '0%'))
);


create table public.price_sightings (
  id                     bigint generated always as identity primary key,
  -- Made on the phone. Uploading the same sighting twice hits this and is ignored.
  client_id              uuid not null unique,
  barcode                text not null references public.products (barcode),
  branch_id              uuid not null references public.branches (id),
  -- Day only, on purpose: a time of day plus a branch is someone's routine.
  seen_on                date not null,
  -- 'perkg': unit_price_centavos is the price per kilo.
  price_type             text not null check (price_type in ('each', 'bundle', 'perkg')),
  unit_price_centavos    integer not null check (unit_price_centavos between 1 and 10000000),
  bundle_qty             smallint check (bundle_qty between 2 and 100),
  bundle_price_centavos  integer check (bundle_price_centavos between 1 and 10000000),
  is_promo               boolean not null default false,
  -- 'tag' = price read from the shelf tag and accepted as is; 'tag+typed' = read then corrected; 'typed' = typed.
  -- 'recall' = this phone's last price for the barcode at this branch, accepted after checking the tag.
  -- 'shared' = another shopper's latest price at this branch, accepted after checking the tag.
  capture_method         text not null check (capture_method in ('tag', 'tag+typed', 'typed', 'recall', 'shared')),
  contributor            uuid default auth.uid() references auth.users (id) on delete set null,
  check ((price_type = 'bundle') = (bundle_qty is not null and bundle_price_centavos is not null))
);
create index price_sightings_lookup on public.price_sightings (barcode, branch_id, seen_on desc, id desc);
create index price_sightings_branch_day on public.price_sightings (branch_id, seen_on);


-- Newest price per barcode per branch. security_invoker makes it obey the same rules as the table.
create view public.latest_prices with (security_invoker = true) as
select distinct on (barcode, branch_id)
  barcode, branch_id, seen_on, price_type, unit_price_centavos, bundle_qty, bundle_price_centavos, is_promo, capture_method
from public.price_sightings
order by barcode, branch_id, seen_on desc, id desc;


-- Row-level security ---------------------------------------------------------------------------------

alter table public.branches        enable row level security;
alter table public.products        enable row level security;
alter table public.price_sightings enable row level security;

create policy "read branches"  on public.branches        for select to anon, authenticated using (true);
-- Everyone sees every product, Pending or Published (Nov 9 decision).
create policy "read products"  on public.products        for select to anon, authenticated using (true);
create policy "read sightings" on public.price_sightings for select to anon, authenticated using (true);

create policy "add branches" on public.branches
  for insert to authenticated with check (created_by = auth.uid());
create policy "add products" on public.products
  for insert to authenticated with check (created_by = auth.uid());
create policy "add sightings" on public.price_sightings
  for insert to authenticated
  with check (contributor = auth.uid() and seen_on between current_date - 14 and current_date + 1);
-- No update or delete policies: the app can only add.

-- Supabase grants every table to the app roles by default. Narrow that to read + add.
revoke all on public.branches, public.products, public.price_sightings from anon, authenticated;
-- Every column except created_by is readable. A column added later stays hidden until a migration grants it.
grant select (id, chain, name, lat, lng, created_at) on public.branches to anon, authenticated;
grant select (barcode, name, size, category, status, image_path, created_at) on public.products to anon, authenticated;
grant insert (id, chain, name, lat, lng) on public.branches to authenticated;
grant insert (barcode, name, size, category) on public.products to authenticated;
-- Every sighting column except contributor is readable.
grant select (id, client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, bundle_qty,
              bundle_price_centavos, is_promo, capture_method)
  on public.price_sightings to anon, authenticated;
grant insert (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, bundle_qty,
              bundle_price_centavos, is_promo, capture_method)
  on public.price_sightings to authenticated;
grant select on public.latest_prices to anon, authenticated;

-- Uploading a price needs to know its barcode is already in the database, Pending or not.
-- This answers only that: which of these barcodes exist (200 at most per call). Runs with the caller's rights.
create or replace function public.known_barcodes(codes text[])
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select p.barcode from public.products p where p.barcode = any (codes[1:200]);
$$;
revoke all on function public.known_barcodes(text[]) from public;
-- Supabase also grants new functions to anon directly, so revoke that too: signed-in phones only.
revoke execute on function public.known_barcodes(text[]) from anon;
grant execute on function public.known_barcodes(text[]) to authenticated;


-- Product images ---------------------------------------------------------------------------------------
-- One reference image per product, set by you (and later the admin dashboard), never by shoppers' phones.
-- Anyone can view the bucket; with no storage policies for it, the app's keys can't upload, replace or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
