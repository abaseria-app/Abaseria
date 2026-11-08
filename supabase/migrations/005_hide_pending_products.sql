-- 005: shoppers see Published products only (Nov 4 decision).
-- A Pending product's row is hidden from everyone except the shopper who added it, so its name,
-- category and image don't show. Its prices still show: a scan gets the price, and the shopper types the name.
-- Run once in each project, after 004. Safe to run twice.

drop policy if exists "read products" on public.products;
create policy "read products" on public.products for select to anon, authenticated
  using (status = 'published' or created_by = auth.uid());

-- Uploading a price needs to know its barcode is already in the database, Pending or not.
-- This answers only that: which of these barcodes exist. No names, no status.
create or replace function public.known_barcodes(codes text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.barcode from public.products p where p.barcode = any (codes[1:200]);
$$;
revoke all on function public.known_barcodes(text[]) from public;
-- Supabase also grants new functions to anon directly, so revoke that too: signed-in phones only.
revoke execute on function public.known_barcodes(text[]) from anon;
grant execute on function public.known_barcodes(text[]) to authenticated;
