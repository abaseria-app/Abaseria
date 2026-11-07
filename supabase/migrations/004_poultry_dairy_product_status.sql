-- 004: Poultry and Dairy categories, and a Pending / Published status on every product.
-- Already run on abaseria-dev on Nov 5, 2026 (as add_poultry_dairy_and_product_status). Run once in prod.
-- Safe to run twice.
--
-- New products wait as Pending until a Product Manager or Admin publishes them (Nov 4 decision).
-- Products already in the table were already visible, so they start as Published.

alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('meat', 'poultry', 'vegetables', 'dairy', 'pantry', 'dry', 'household', 'other'));

alter table public.products add column if not exists status text not null default 'published'
  check (status in ('pending', 'published'));
alter table public.products alter column status set default 'pending';
