-- 018: profile photos (task P2b, Nov 16, 2026). Spec: project doc Abaseria_Shopper_Profile_Spec.md, section 3c.
-- Run once in each project, dev first, after 017. Safe to run twice. Changes no existing data.
--
-- One photo per shopper, seen only by that shopper (Nov 16 decision; Community will add a public/private choice).
--   bucket   profile-photos, private (no public links), 200 KB per file, WebP or JPEG only. The app shrinks
--            photos to 256x256 and re-saves them on the phone first, which also strips GPS and camera data.
--   path     <user id>/photo, exactly. Nothing else can be saved in the bucket from the app.
--   rules    a real account (not a guest session) can read, add, replace and delete its own file only.
--            The public key, guests, other shoppers and staff get nothing. "Delete my data" removes the file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 204800, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read own profile photo" on storage.objects;
create policy "read own profile photo" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/photo'
         and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

drop policy if exists "add own profile photo" on storage.objects;
create policy "add own profile photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/photo'
              and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

drop policy if exists "replace own profile photo" on storage.objects;
create policy "replace own profile photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/photo'
         and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false)
  with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/photo'
              and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

drop policy if exists "delete own profile photo" on storage.objects;
create policy "delete own profile photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/photo'
         and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);
