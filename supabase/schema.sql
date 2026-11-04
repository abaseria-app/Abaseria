-- Abeseria shared price database.
-- Run once in the Supabase SQL Editor on a new project. Safe to read top to bottom: nothing here deletes data.
--
-- Four tables:
--   branches        one row per physical store
--   products        one row per barcode
--   price_sightings one row every time a shopper confirms a price; never updated or deleted by the app
--   product_photos  one row per uploaded product photo, pending until published (files in storage)
-- plus a latest_prices view: the newest sighting per barcode per branch.
--
-- Who can do what (enforced by row-level security below):
--   anyone with the app's public key can READ branches, products, sightings and latest_prices
--   a signed-in phone (anonymous sign-in is fine) can ADD rows, stamped with its own user id
--   nobody can edit or delete rows from the app; fixes are done here by you
--   which phone added a sighting (contributor) is stored but never readable through the app


-- Barcode check: 8, 12, 13 or 14 digits with a valid GTIN check digit.
create or replace function public.gtin_ok(code text)
returns boolean
language sql
immutable
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
  category    text not null default 'other'
              check (category in ('meat', 'vegetables', 'pantry', 'dry', 'household', 'other')),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- 13-digit codes starting with 2 are printed in-store (deli, meat, produce scales) and often contain
  -- the weight or price, so the same "product" would get a new barcode every day. Keep them out.
  check (not (char_length(barcode) = 13 and barcode like '2%'))
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
grant select on public.branches, public.products to anon, authenticated;
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


-- Product photos ----------------------------------------------------------------------------------
-- How it fits together:
--   product_photos   one row per uploaded photo; the row comes first, then the file
--   storage bucket   'product-photos' (private), files at <barcode>/<photo id>.jpg, 64 KB max, JPEG only
-- Who sees what:
--   everyone: published photos
--   the phone that uploaded it: its own pending photo
--   nobody through the app: who uploaded a photo, or anyone else's pending or rejected photo
-- To publish: set status to 'published' on the row (Supabase Table Editor, until the admin dashboard exists).

create table if not exists public.product_photos (
  -- Made on the phone, so a retry after a dropped connection uploads to the same file.
  id          uuid primary key,
  barcode     text not null references public.products (barcode),
  status      text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  path        text generated always as (barcode || '/' || id::text || '.jpg') stored,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- One photo per barcode per phone keeps a script from filling the bucket.
  unique (barcode, created_by)
);
create index if not exists product_photos_barcode_status on public.product_photos (barcode, status, created_at);
create unique index if not exists product_photos_path on public.product_photos (path);

alter table public.product_photos enable row level security;

drop policy if exists "read photos" on public.product_photos;
create policy "read photos" on public.product_photos
  for select to anon, authenticated
  using (status = 'published' or (created_by is not null and created_by = auth.uid()));

drop policy if exists "add photos" on public.product_photos;
create policy "add photos" on public.product_photos
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'pending');
-- No update or delete policies: publishing and rejecting happen in the dashboard, not the app.

revoke all on public.product_photos from anon, authenticated;
grant select (id, barcode, status, path, created_at) on public.product_photos to anon, authenticated;
grant insert (id, barcode) on public.product_photos to authenticated;


-- Storage ----------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 65536, array['image/jpeg'])
on conflict (id) do nothing;

-- A file can be read when its row can: published, or the uploader's own.
drop policy if exists "read product photo files" on storage.objects;
create policy "read product photo files" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-photos' and exists (select 1 from public.product_photos p where p.path = storage.objects.name));

-- A file can be added only at the path of the phone's own pending row (the only pending rows it can see).
drop policy if exists "add product photo files" on storage.objects;
create policy "add product photo files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-photos'
    and exists (select 1 from public.product_photos p where p.path = storage.objects.name and p.status = 'pending')
  );
-- No update or delete policies on files either: a photo can't be swapped after it's uploaded.
