-- 008: accept products with a bad check digit or no barcode, and flag them for review (Nov 9 import rule):
--   valid barcode   -> barcode_status 'valid'
--   bad check digit -> accepted, barcode_status 'invalid'
--   no barcode      -> accepted, barcode_status 'missing'
-- Products get a numeric id as primary key; barcode stays unique, so price_sightings still points at it.
-- Applied to abaseria-dev on Nov 9 as 008_flag_invalid_and_missing_barcodes; recovered into the repo Nov 11.
-- Not yet run in prod. Guarded so it's safe to run twice (the original wasn't).

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'products' and column_name = 'id') then
    alter table public.price_sightings drop constraint price_sightings_barcode_fkey;
    alter table public.products drop constraint products_pkey;
    alter table public.products add column id bigint generated always as identity primary key;
    alter table public.products alter column barcode drop not null;
    -- products_barcode_check is the gtin_ok() check-digit rule in both projects (checked Nov 11).
    alter table public.products drop constraint products_barcode_check;
    alter table public.products add constraint products_barcode_key unique (barcode);
    alter table public.price_sightings add constraint price_sightings_barcode_fkey
      foreign key (barcode) references public.products (barcode);
    alter table public.products add column barcode_status text generated always as (
      case when barcode is null then 'missing' when public.gtin_ok(barcode) then 'valid' else 'invalid' end
    ) stored;
    create index products_barcode_status_idx on public.products (barcode_status) where barcode_status <> 'valid';
  end if;
end $$;
