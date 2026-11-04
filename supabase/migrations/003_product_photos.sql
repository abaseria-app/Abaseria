-- 003: product photos. One small JPEG per barcode per phone, waiting as 'pending' until someone publishes it.
-- For projects set up before this was in schema.sql. Run once in the SQL Editor of each project.
-- Safe to run twice. Changes no existing data.
--
-- How it fits together:
--   product_photos   one row per uploaded photo; the row comes first, then the file
--   storage bucket   'product-photos' (private), files at <barcode>/<photo id>.jpg, 64 KB max, JPEG only
-- Who sees what:
--   everyone: published photos
--   the phone that uploaded it: its own pending photo
--   nobody through the app: who uploaded a photo, or anyone else's pending or rejected photo
-- To publish: set status to 'published' on the row (Supabase Table Editor, until the admin dashboard exists).

create table if not exists public.product_photos (
  -- Made on the phone, so a retry after a dropped connection uploads to the same file.
  id          uuid primary key,
  barcode     text not null references public.products (barcode),
  status      text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  path        text generated always as (barcode || '/' || id::text || '.jpg') stored,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- One photo per barcode per phone keeps a script from filling the bucket.
  unique (barcode, created_by)
);
create index if not exists product_photos_barcode_status on public.product_photos (barcode, status, created_at);
create unique index if not exists product_photos_path on public.product_photos (path);

alter table public.product_photos enable row level security;

drop policy if exists "read photos" on public.product_photos;
create policy "read photos" on public.product_photos
  for select to anon, authenticated
  using (status = 'published' or (created_by is not null and created_by = auth.uid()));

drop policy if exists "add photos" on public.product_photos;
create policy "add photos" on public.product_photos
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'pending');
-- No update or delete policies: publishing and rejecting happen in the dashboard, not the app.

revoke all on public.product_photos from anon, authenticated;
grant select (id, barcode, status, path, created_at) on public.product_photos to anon, authenticated;
grant insert (id, barcode) on public.product_photos to authenticated;


-- Storage ----------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 65536, array['image/jpeg'])
on conflict (id) do nothing;

-- A file can be read when its row can: published, or the uploader's own.
drop policy if exists "read product photo files" on storage.objects;
create policy "read product photo files" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-photos' and exists (select 1 from public.product_photos p where p.path = storage.objects.name));

-- A file can be added only at the path of the phone's own pending row (the only pending rows it can see).
drop policy if exists "add product photo files" on storage.objects;
create policy "add product photo files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-photos'
    and exists (select 1 from public.product_photos p where p.path = storage.objects.name and p.status = 'pending')
  );
-- No update or delete policies on files either: a photo can't be swapped after it's uploaded.
