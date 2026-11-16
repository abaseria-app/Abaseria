-- 014: phones need a real barcode to add a product (security review G12, Nov 16, 2026).
-- Run once in each project, dev first, after 013 (uses is_staff()). Safe to run twice. Changes no existing data.
--
-- 008 accepted a bad check digit or no barcode from every source, so any signed-in phone could add a product
-- with no barcode, or with any text as its barcode. The Nov 9 rule was for spreadsheet imports, which go through
-- product_import with the server key and aren't touched by this. Staff (013) keep the looser rule for the
-- dashboard. The app already sends only valid barcodes, so shoppers see no change.

drop policy if exists "add products" on public.products;
create policy "add products" on public.products
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (public.is_staff() or (barcode is not null and public.gtin_ok(barcode)))
  );
