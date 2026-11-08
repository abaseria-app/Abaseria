-- 003: one reference image per product, so a shopper can see that the scan found the right thing.
-- For projects set up before this was in schema.sql. Run once in the SQL Editor of each project.
-- Safe to run twice. Changes no existing data.
--
-- Images are set by you (and later the admin dashboard), never by shoppers' phones:
--   products.image_path  the file's name in the public 'product-images' bucket, e.g. 4800016644818.jpg
--   the bucket           anyone can view; only the dashboard or the secret key can add, replace or delete
-- To add one: Storage → product-images → upload the file, then put its name in that product's image_path.

alter table public.products add column if not exists image_path text
  check (image_path is null or image_path ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$');

-- Apps can already read every products column and add only barcode, name, size and category, so they
-- can see image_path but can't set it. No update policy exists, so they can't change it either.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
-- No storage policies for this bucket on purpose: with none, the app's keys can't upload, replace or delete.
