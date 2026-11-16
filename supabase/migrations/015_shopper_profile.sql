-- 015: shopper profile and consents (Profile task P1, Nov 16, 2026). Spec: project doc Abaseria_Shopper_Profile_Spec.md.
-- Run once in each project, dev first, after 014. Safe to run twice. Changes no existing data.
--
-- What this adds:
--   public.consents          one row per switch change; the newest row per purpose is the shopper's current
--                            choice. Purposes: price_sharing, profile, offers, research. Insert-only from the app.
--   public.my_consents       the shopper's current choice per purpose (newest row wins).
--   public.has_consent(p)    true when the caller's newest row for p is "on". Off when there's no row.
--   public.shopper_profiles  one row per shopper, every answer optional.
--                              2nd visit:  birth_month + birth_year, gender, province_code + city_code
--                              3rd visit:  household_size_band, has_kids_under_12, has_senior_60plus,
--                                          payday_pattern, grocery_budget_band
--
-- Rules, enforced here and not only in the app:
--   own row only      a shopper reads, adds, changes and deletes only their own profile and consents.
--                     The public key (anon) gets nothing. Staff get nothing either; reports come later through
--                     the analytics layer with its minimum group sizes.
--   profile consent   answers can only be saved while the 'profile' switch is on. Turning it off deletes the
--                     profile row and turns 'offers' and 'research' off with it.
--   offers, research  can't be turned on unless 'profile' is on.
--   birthday          month and year go together. Under 18 (birthday counted as the last day of the birth
--                     month, Manila date) is refused, so nothing is stored for minors.
--   birthday lock     the first saved birthday stamps birthday_locked_at. After that the app can clear it but
--                     can't set a different one; corrections go through support (SQL Editor or the server
--                     key aren't 'authenticated', so they can change it). Deleting the whole profile removes
--                     the lock too, so one birthday offer per account per year has to be enforced by the offer
--                     itself when vouchers are built.
--   deleted account   the profile goes with it; consent rows stay with user_id emptied, as the record of what
--                     was agreed and when.

-- Consents ----------------------------------------------------------------------------------------------------

create table if not exists public.consents (
  id              bigint generated always as identity primary key,
  user_id         uuid default auth.uid() references auth.users (id) on delete set null,
  purpose         text not null check (purpose in ('price_sharing', 'profile', 'offers', 'research')),
  granted         boolean not null,
  -- Which privacy notice the shopper saw, e.g. '2026-11'. Set by the app.
  policy_version  text not null check (char_length(policy_version) between 1 and 20),
  created_at      timestamptz not null default now()
);
create index if not exists consents_user_purpose_idx on public.consents (user_id, purpose, created_at desc, id desc);

alter table public.consents enable row level security;
drop policy if exists "read own consents" on public.consents;
create policy "read own consents" on public.consents
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "add own consents" on public.consents;
create policy "add own consents" on public.consents
  for insert to authenticated with check (user_id = auth.uid());
-- No update or delete: the history is the record.

revoke all on public.consents from anon, authenticated;
-- user_id is readable so has_consent() and my_consents can match rows; RLS limits it to the shopper's own id.
grant select (id, user_id, purpose, granted, policy_version, created_at) on public.consents to authenticated;
grant insert (purpose, granted, policy_version) on public.consents to authenticated;

create or replace function public.has_consent(p text) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    (select c.granted from public.consents c
      where c.user_id = auth.uid() and c.purpose = p
      order by c.created_at desc, c.id desc limit 1),
    false);
$$;
revoke all on function public.has_consent(text) from public, anon;
grant execute on function public.has_consent(text) to authenticated;

create or replace view public.my_consents with (security_invoker = true) as
select distinct on (purpose) purpose, granted, policy_version, created_at
from public.consents
where user_id = auth.uid()
order by purpose, created_at desc, id desc;
revoke all on public.my_consents from anon, authenticated;
grant select on public.my_consents to authenticated;


-- Profiles ----------------------------------------------------------------------------------------------------

create table if not exists public.shopper_profiles (
  user_id              uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- 2nd visit
  birth_month          smallint check (birth_month between 1 and 12),
  birth_year           smallint check (birth_year between 1900 and 2100),
  gender               text check (gender in ('woman', 'man', 'another', 'no_answer')),
  -- PSGC 10-digit codes (PSA), so results line up with census data.
  province_code        text check (province_code ~ '^[0-9]{10}$'),
  city_code            text check (city_code ~ '^[0-9]{10}$'),
  -- 3rd visit
  household_size_band  text check (household_size_band in ('1', '2', '3-4', '5-6', '7+', 'no_answer')),
  has_kids_under_12    text check (has_kids_under_12 in ('yes', 'no', 'no_answer')),
  has_senior_60plus    text check (has_senior_60plus in ('yes', 'no', 'no_answer')),
  payday_pattern       text check (payday_pattern in ('kinsenas_katapusan', 'weekly', 'monthly', 'daily_irregular', 'no_answer')),
  grocery_budget_band  text check (grocery_budget_band in ('under_3000', '3000_5999', '6000_9999', '10000_14999', '15000_plus', 'no_answer')),
  -- Set by the database, never by the app.
  birthday_locked_at   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- A blank answer (null) means not asked or skipped; 'no_answer' means the shopper chose "Prefer not to say".

create or replace function public.shopper_profile_rules() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  manila_today date := (now() at time zone 'Asia/Manila')::date;
  last_day date;
  from_app boolean := current_user = 'authenticated';
begin
  if (new.birth_month is null) <> (new.birth_year is null) then
    raise exception 'birth month and birth year go together' using errcode = '23514';
  end if;

  if new.birth_year is not null then
    last_day := (make_date(new.birth_year, new.birth_month, 1) + interval '1 month' - interval '1 day')::date;
    if last_day + interval '18 years' > manila_today then
      raise exception 'under 18: no profile answers are stored' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if from_app then
      new.birthday_locked_at := old.birthday_locked_at;
      if old.birthday_locked_at is not null and new.birth_year is not null
         and (new.birth_year, new.birth_month) is distinct from (old.birth_year, old.birth_month) then
        raise exception 'birthday is locked; contact support to correct it' using errcode = '42501';
      end if;
    end if;
  else
    new.created_at := now();
    if from_app then new.birthday_locked_at := null; end if;
  end if;

  if new.birth_year is not null and new.birthday_locked_at is null then
    new.birthday_locked_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.shopper_profile_rules() from public, anon, authenticated;

drop trigger if exists shopper_profile_rules on public.shopper_profiles;
create trigger shopper_profile_rules before insert or update on public.shopper_profiles
  for each row execute function public.shopper_profile_rules();

alter table public.shopper_profiles enable row level security;
drop policy if exists "read own profile" on public.shopper_profiles;
create policy "read own profile" on public.shopper_profiles
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "add own profile" on public.shopper_profiles;
create policy "add own profile" on public.shopper_profiles
  for insert to authenticated with check (user_id = auth.uid() and public.has_consent('profile'));
drop policy if exists "change own profile" on public.shopper_profiles;
create policy "change own profile" on public.shopper_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.has_consent('profile'));
drop policy if exists "delete own profile" on public.shopper_profiles;
create policy "delete own profile" on public.shopper_profiles
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.shopper_profiles from anon, authenticated;
grant select (user_id, birth_month, birth_year, gender, province_code, city_code, household_size_band,
              has_kids_under_12, has_senior_60plus, payday_pattern, grocery_budget_band,
              birthday_locked_at, created_at, updated_at)
  on public.shopper_profiles to authenticated;
grant insert (birth_month, birth_year, gender, province_code, city_code, household_size_band,
              has_kids_under_12, has_senior_60plus, payday_pattern, grocery_budget_band)
  on public.shopper_profiles to authenticated;
grant update (birth_month, birth_year, gender, province_code, city_code, household_size_band,
              has_kids_under_12, has_senior_60plus, payday_pattern, grocery_budget_band)
  on public.shopper_profiles to authenticated;
grant delete on public.shopper_profiles to authenticated;


-- Switch rules ------------------------------------------------------------------------------------------------

create or replace function public.consent_rules() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and tg_when = 'BEFORE' then
    if new.purpose in ('offers', 'research') and new.granted and not public.has_consent('profile') then
      raise exception '% needs the profile switch on first', new.purpose using errcode = '23514';
    end if;
    return new;
  end if;

  -- After 'profile' is turned off: delete the answers and turn offers and research off too.
  if new.purpose = 'profile' and not new.granted then
    delete from public.shopper_profiles where user_id = new.user_id;
    if public.has_consent('offers') then
      insert into public.consents (purpose, granted, policy_version) values ('offers', false, new.policy_version);
    end if;
    if public.has_consent('research') then
      insert into public.consents (purpose, granted, policy_version) values ('research', false, new.policy_version);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.consent_rules() from public, anon, authenticated;

drop trigger if exists consent_check on public.consents;
create trigger consent_check before insert on public.consents
  for each row execute function public.consent_rules();
drop trigger if exists consent_follow_up on public.consents;
create trigger consent_follow_up after insert on public.consents
  for each row execute function public.consent_rules();
