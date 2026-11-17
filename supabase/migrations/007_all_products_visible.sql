-- 007: every product is visible to everyone, Pending or Published (Nov 9 decision).
-- Applied to abaseria-dev on Nov 9 as 007_all_products_visible; recovered into the repo Nov 11.
-- Prod got the same policy by hand. Migration 010 repeats it. Safe to run twice.

drop policy if exists "read products" on public.products;
create policy "read products" on public.products for select to anon, authenticated using (true);
