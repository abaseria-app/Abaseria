-- 016: only real accounts (Google or email code) can use the profile and consent tables (Nov 16, 2026).
-- Run once in each project, dev first, after 015. Safe to run twice. Changes no existing data.
--
-- Supabase's anonymous sign-ins (still on in dev for older phones) give a guest session the 'authenticated' role.
-- The app never saves profiles or switches from a guest session, but a script could create unlimited guest
-- accounts and fill shopper_profiles with fake answers, which would poison the reports later. Guests now get
-- nothing from either table, the same as the public key.
-- The guest test is written into each rule (not hidden in a function) so Supabase's security advisor can see it.

drop policy if exists "read own consents" on public.consents;
create policy "read own consents" on public.consents
  for select to authenticated using (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);
drop policy if exists "add own consents" on public.consents;
create policy "add own consents" on public.consents
  for insert to authenticated with check (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

drop policy if exists "read own profile" on public.shopper_profiles;
create policy "read own profile" on public.shopper_profiles
  for select to authenticated using (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);
drop policy if exists "add own profile" on public.shopper_profiles;
create policy "add own profile" on public.shopper_profiles
  for insert to authenticated
  with check (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false and public.has_consent('profile'));
drop policy if exists "change own profile" on public.shopper_profiles;
create policy "change own profile" on public.shopper_profiles
  for update to authenticated
  using (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false)
  with check (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false and public.has_consent('profile'));
drop policy if exists "delete own profile" on public.shopper_profiles;
create policy "delete own profile" on public.shopper_profiles
  for delete to authenticated using (user_id = auth.uid() and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

-- An earlier draft of 016 used a helper function; the rules above no longer need it.
drop function if exists public.is_real_account();
