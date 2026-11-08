-- 006: one form per barcode. UPC-A is stored as 12 digits, the way Chrome's scanner reads it,
-- never as 13 digits with a leading 0 (the same code in EAN-13 form).
--
-- Found Nov 8, 2026 on abaseria-dev: 4 Del Monte cans were in twice, once in each form:
--   024000010623 / 0024000010623  peaches        024000163015 / 0024000163015  cream style corn
--   024000010920 / 0024000010920  fruit cocktail 024000163022 / 0024000163022  whole kernel corn
-- Phones read these cans as 12 digits, so the 13-digit copies (the ones with photos) never matched a scan.
--
-- Brad's call: the 12-digit row keeps its name, size, category and status; it takes the 13-digit row's
-- image only if it has none. Prices on a 13-digit row move to the 12-digit row. Then the 13-digit row goes.
-- A 13-digit row with no 12-digit twin is moved to 12 digits the same way.
-- The image file in storage keeps its old name (e.g. 0024000010623.jpg); image_path still points to it.
--
-- Run once in each project, after 005. Safe to run twice. On prod (no such rows) it only adds the check.

-- 1. Make sure every 13-digit row has a 12-digit row to move into.
insert into public.products (barcode, name, size, category, status, image_path, created_by, created_at)
select substr(barcode, 2), name, size, category, status, image_path, created_by, created_at
from public.products
where char_length(barcode) = 13 and barcode like '0%'
on conflict (barcode) do update
  set image_path = coalesce(public.products.image_path, excluded.image_path);

-- 2. Move any prices to the 12-digit form.
update public.price_sightings
set barcode = substr(barcode, 2)
where char_length(barcode) = 13 and barcode like '0%';

-- 3. Remove the 13-digit copies.
delete from public.products
where char_length(barcode) = 13 and barcode like '0%';

-- 4. Refuse the 13-digit form from now on. The app drops the leading 0 before uploading (barcode.ts).
alter table public.products drop constraint if exists products_barcode_upca_12;
alter table public.products add constraint products_barcode_upca_12
  check (not (char_length(barcode) = 13 and barcode like '0%'));
