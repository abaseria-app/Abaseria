-- 017: birth year on its own; birth month waits for birthday offers (Nov 16, 2026).
-- Run once in each project, dev first, after 016. Safe to run twice. Changes no existing data.
--
-- Decision (Nov 16): no birthday gifts yet, so the app asks only for birth year. Birth month will be asked when
-- birthday offers launch, with the offer as the reason. Until then:
--   - the app can't write birth_month at all (grants removed), so the month isn't collected by accident;
--   - birth_year can be saved alone; under-18 is checked against Dec 31 of that year (the latest possible
--     birthday), so anyone who might still be 17 is refused;
--   - a saved month still needs a year;
--   - the lock covers the year once saved, and the month once saved, separately, so a month can be added later.

create or replace function public.shopper_profile_rules() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  manila_today date := (now() at time zone 'Asia/Manila')::date;
  last_day date;
  from_app boolean := current_user = 'authenticated';
begin
  if new.birth_month is not null and new.birth_year is null then
    raise exception 'birth month needs a birth year' using errcode = '23514';
  end if;

  if new.birth_year is not null then
    if new.birth_month is null then
      last_day := make_date(new.birth_year, 12, 31);
    else
      last_day := (make_date(new.birth_year, new.birth_month, 1) + interval '1 month' - interval '1 day')::date;
    end if;
    if last_day + interval '18 years' > manila_today then
      raise exception 'under 18: no profile answers are stored' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if from_app then
      new.birthday_locked_at := old.birthday_locked_at;
      if old.birthday_locked_at is not null and (
           (new.birth_year is not null and new.birth_year is distinct from old.birth_year)
        or (new.birth_month is not null and old.birth_month is not null and new.birth_month is distinct from old.birth_month)
        or (new.birth_month is not null and old.birth_year is null)
      ) then
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

-- The app can't write the month until birthday offers launch.
revoke insert (birth_month), update (birth_month) on public.shopper_profiles from authenticated;
