-- 010: security review fixes (Nov 11, 2026). See the project doc Abaseria_Security_Review.md, gaps G1-G4.
-- Numbered 010 because abaseria-dev already has 007-009 applied (not yet in this repo).
-- Run once in each project, dev first, after the app's connection check stops using select('*').
-- Safe to run twice. Changes no data.

-- Every product is visible to everyone, Pending or Published (Nov 9 decision).
-- Already live in both projects; recorded here so the repo matches.
drop policy if exists "read products" on public.products;
create policy "read products" on public.products for select to anon, authenticated using (true);

-- G1: who added a product or a store stays in the database, like price_sightings.contributor.
-- The app reads every other column. A column added later is hidden from the app until a migration grants it.
do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['products', 'branches'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name <> 'created_by';
    execute format('revoke select on public.%I from anon, authenticated', t);
    execute format('revoke select (created_by) on public.%I from anon, authenticated', t);
    execute format('grant select (%s) on public.%I to anon, authenticated', cols, t);
  end loop;
end $$;

-- G2: the view had picked up write grants. Read only.
revoke all on public.latest_prices from anon, authenticated;
grant select on public.latest_prices to anon, authenticated;

-- G3: every product is visible now, so known_barcodes no longer needs the owner's rights.
alter function public.known_barcodes(text[]) security invoker;

-- G4: fixed search path.
alter function public.gtin_ok(text) set search_path = '';
