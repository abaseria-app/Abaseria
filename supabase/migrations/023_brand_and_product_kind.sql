-- 023: brand, and what kind of product a barcode is (Nov 20 2026, Jovie's observations).
--
-- brand:    as printed, e.g. "Del Monte", "Lucky Me!". The product name stays the full name shoppers see;
--           brand is for filtering and brand-level reports. Null until someone fills it in.
-- kind:     'single'    one item
--           'multipack' several of the same item under one barcode (6 cans, a pack of 10 sachets); size is
--                       written "6x330ml" (see src/lib/size.ts)
--           'bundle'    different items under one barcode and price (a gift set, a combo kit)
--           Multi-buy deals ("2 for ₱100") are prices, not kinds: price_sightings.price_type = 'bundle'.
--           A freebie taped to an item with its usual barcode is a promo: price_sightings.promo_note.
-- contents: bundles only, what's inside, e.g. "Protein powder 1kg + shaker".
--
-- Phones may add all three on a new product. Run once in each project's SQL Editor. Safe to run twice.

alter table public.products add column if not exists brand text;
alter table public.products add column if not exists kind text not null default 'single';
alter table public.products add column if not exists contents text;

alter table public.products drop constraint if exists products_brand_check;
alter table public.products add constraint products_brand_check
  check (brand is null or char_length(btrim(brand)) between 1 and 60);
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check
  check (kind in ('single', 'multipack', 'bundle'));
alter table public.products drop constraint if exists products_contents_check;
alter table public.products add constraint products_contents_check
  check (contents is null or (kind = 'bundle' and char_length(btrim(contents)) between 1 and 200));

create index if not exists products_brand on public.products (lower(brand)) where brand is not null;

grant select (brand, kind, contents) on public.products to anon, authenticated;
grant insert (brand, kind, contents) on public.products to authenticated;
