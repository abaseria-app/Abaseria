-- 025: SRP, a reference price per product (Nov 23 2026).
--
-- One row per product: the SRP shown on Search when no store price is known. It is an estimate (the average of
-- the price list master files' store prices, moved to a clean retail price), so it lives apart from
-- price_sightings: it is never a sighting, never counts toward the bad-price filter, and any real store price
-- replaces it on screen. Phones can only read it; staff add and change it, publishers can remove it.
--
-- avg/low/high_centavos: the average before it was moved to a clean price, and the cheapest and dearest store
--   price in the files. stores_counted: how many store prices went into the average.
-- source_type: 'srp_estimate' (price list files), later 'online_listing', 'retailer_list' or 'shelf'.
--
-- Run once in each project's SQL Editor. Safe to run twice. The app works without it (no SRP shown), so the
-- live project can get it when the products it prices are there.

create table if not exists public.reference_prices (
  barcode        text primary key references public.products(barcode) on update cascade on delete cascade,
  srp_centavos   integer not null check (srp_centavos > 0),
  avg_centavos   integer,
  low_centavos   integer,
  high_centavos  integer,
  stores_counted smallint,
  source_type    text not null default 'srp_estimate',
  source_note    text,
  as_of          date not null default current_date,
  updated_at     timestamptz not null default now()
);

comment on table public.reference_prices is 'SRP (reference) price, one per product, an estimate shown when no store-specific sighting exists (025). Real price_sightings always win over this.';

alter table public.reference_prices enable row level security;

drop policy if exists "read reference prices" on public.reference_prices;
create policy "read reference prices" on public.reference_prices for select to anon, authenticated using (true);
drop policy if exists "staff add reference prices" on public.reference_prices;
create policy "staff add reference prices" on public.reference_prices for insert to authenticated with check (is_staff());
drop policy if exists "staff change reference prices" on public.reference_prices;
create policy "staff change reference prices" on public.reference_prices for update to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "publishers remove reference prices" on public.reference_prices;
create policy "publishers remove reference prices" on public.reference_prices for delete to authenticated using (can_publish());
