-- 011: breach tripwires and shopper notices (Nov 11, 2026). See the project docs Abaseria_Breach_Plan.md and
-- Abaseria_Security_Review.md. Run once in each project, dev first. Safe to run twice. Changes no existing data.
--
-- What this adds:
--   security schema   alerts, counters and paused accounts. Never exposed through the API.
--   price flood       one account adding more than 300 prices in a day emails Brad; past 1,000 the database
--                     refuses that account's prices until midnight (Manila). 3,000 prices from everyone in one
--                     day also emails. Limits live in security.settings.
--   paused accounts   an account Brad pauses can't add prices, and its earlier prices disappear from the app.
--   deletes           any delete or truncate on stores, products or prices emails Brad. Shoppers can't delete,
--                     so this only fires for someone holding a server key, or for your own SQL. For your own
--                     fixes, start the script with: set local abaseria.maintenance = 'on';
--   watch_changes     an alert trigger to attach to the staff roles table when it's built (Module 2, Task 2).
--   public.notices    a banner the app shows on open. Brad adds rows in the dashboard; shoppers can only read.
--
-- Turn on pg_net first (Database → Extensions, or: create extension if not exists pg_net with schema extensions;).
-- Emails go out only once pg_net is on and the vault holds 'alert_url' and 'alert_secret' (see the
-- security-alert Edge Function). Until then every alert is still written to security.events.

create schema if not exists security;
revoke all on schema security from public;
-- The price read rule calls security.is_paused(), so the app's roles need to reach that one function.
-- The schema isn't in the API's exposed schemas, so nothing here is reachable over HTTP.
grant usage on schema security to anon, authenticated;

create table if not exists security.settings (
  key   text primary key,
  value integer not null
);
insert into security.settings (key, value) values
  ('price_alert_per_day', 300),
  ('price_block_per_day', 1000),
  ('all_prices_alert_per_day', 3000)
on conflict (key) do nothing;

create table if not exists security.events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  kind    text not null,
  detail  jsonb not null default '{}',
  -- true once handed to the security-alert Edge Function (which emails Brad)
  sent    boolean not null default false
);
create index if not exists events_kind_at on security.events (kind, at desc);

create table if not exists security.paused_accounts (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  paused_at timestamptz not null default now(),
  reason    text not null check (char_length(reason) between 1 and 300)
);

-- Prices added per account per day (Manila). Counts only, kept 14 days. The all-zero id is everyone combined.
create table if not exists security.daily_counts (
  user_id uuid not null,
  day     date not null,
  n       integer not null default 0,
  primary key (user_id, day)
);

alter table security.settings        enable row level security;
alter table security.events          enable row level security;
alter table security.paused_accounts enable row level security;
alter table security.daily_counts    enable row level security;
revoke all on all tables in schema security from public, anon, authenticated;


create or replace function security.today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Manila')::date $$;

create or replace function security.setting(k text) returns integer
language sql stable security definer set search_path = '' as $$ select value from security.settings where key = k $$;

-- Records an alert and, when email is set up, sends it. The same kind + key is emailed at most once an hour.
-- Never raises: an alert must not block a shopper's upload.
create or replace function security.alert(alert_kind text, alert_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dedupe_key text := coalesce(alert_detail ->> 'key', '');
  recent boolean;
  new_id bigint;
  url text;
  secret text;
begin
  select exists (
    select 1 from security.events
     where kind = alert_kind and sent and coalesce(detail ->> 'key', '') = dedupe_key and at > now() - interval '1 hour'
  ) into recent;
  insert into security.events (kind, detail) values (alert_kind, alert_detail) returning id into new_id;
  if recent or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  begin
    execute $q$select max(decrypted_secret) filter (where name = 'alert_url'),
                      max(decrypted_secret) filter (where name = 'alert_secret')
                 from vault.decrypted_secrets where name in ('alert_url', 'alert_secret')$q$
      into url, secret;
    if url is null or secret is null then
      return;
    end if;
    -- pg_net sends after the transaction commits, so an alert inside a refused statement is never sent.
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using url,
            jsonb_build_object('id', new_id, 'kind', alert_kind, 'detail', alert_detail, 'at', now()),
            jsonb_build_object('Content-Type', 'application/json', 'x-alert-secret', secret);
    update security.events set sent = true where id = new_id;
  exception when others then
    raise warning 'security.alert could not send %: %', alert_kind, sqlerrm;
  end;
end;
$$;

create or replace function security.is_paused(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists (select 1 from security.paused_accounts where user_id = uid)
$$;


-- Price flood ------------------------------------------------------------------------------------------------

-- Before each price: a paused account, or one past today's limit, is refused. 23514 is a check error, which
-- the app's upload treats as "skip this row", so a refused phone doesn't retry forever.
create or replace function security.before_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.contributor is null then
    return new;
  end if;
  if security.is_paused(new.contributor) then
    raise exception 'This account is paused.' using errcode = '23514';
  end if;
  if coalesce((select n from security.daily_counts where user_id = new.contributor and day = security.today()), 0)
     >= security.setting('price_block_per_day') then
    raise exception 'Daily price limit reached.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- After each upload: count what actually went in (re-uploads skipped by ON CONFLICT aren't counted).
create or replace function security.after_prices() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  total integer;
  alert_at integer := security.setting('price_alert_per_day');
  block_at integer := security.setting('price_block_per_day');
  all_at   integer := security.setting('all_prices_alert_per_day');
  everyone constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  for r in select contributor, count(*)::int as c from added where contributor is not null group by contributor loop
    insert into security.daily_counts as d (user_id, day, n) values (r.contributor, security.today(), r.c)
      on conflict (user_id, day) do update set n = d.n + excluded.n
      returning n into total;
    if total >= alert_at and total - r.c < alert_at then
      perform security.alert('price_flood', jsonb_build_object('key', r.contributor, 'user_id', r.contributor,
        'prices_today', total, 'alert_at', alert_at, 'block_at', block_at));
    end if;
    if total >= block_at and total - r.c < block_at then
      perform security.alert('price_limit_reached', jsonb_build_object('key', r.contributor, 'user_id', r.contributor,
        'prices_today', total, 'note', 'Further prices from this account are refused until midnight Manila time.'));
    end if;
  end loop;

  insert into security.daily_counts as d (user_id, day, n) values (everyone, security.today(), (select count(*) from added))
    on conflict (user_id, day) do update set n = d.n + excluded.n
    returning n into total;
  if total >= all_at and total - (select count(*) from added) < all_at then
    perform security.alert('price_flood_all', jsonb_build_object('key', 'all', 'prices_today', total, 'alert_at', all_at));
  end if;

  delete from security.daily_counts where day < security.today() - 14;
  return null;
end;
$$;

drop trigger if exists price_flood_check on public.price_sightings;
create trigger price_flood_check before insert on public.price_sightings
  for each row execute function security.before_price();
drop trigger if exists price_flood_count on public.price_sightings;
create trigger price_flood_count after insert on public.price_sightings
  referencing new table as added for each statement execute function security.after_prices();

-- A paused account's prices drop out of the app (and out of latest_prices, which follows this rule).
drop policy if exists "read sightings" on public.price_sightings;
create policy "read sightings" on public.price_sightings for select to anon, authenticated
  using (not security.is_paused(contributor));


-- Deletes ------------------------------------------------------------------------------------------------------

create or replace function security.after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  select count(*) into n from gone;
  if n > 0 and coalesce(current_setting('abaseria.maintenance', true), '') <> 'on' then
    perform security.alert('rows_deleted', jsonb_build_object('key', tg_table_name, 'table', tg_table_name,
      'rows', n, 'db_role', current_user));
  end if;
  return null;
end;
$$;

create or replace function security.after_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('abaseria.maintenance', true), '') <> 'on' then
    perform security.alert('table_emptied', jsonb_build_object('key', tg_table_name, 'table', tg_table_name,
      'db_role', current_user));
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['branches', 'products', 'price_sightings'] loop
    execute format('drop trigger if exists alert_on_delete on public.%I', t);
    execute format('create trigger alert_on_delete after delete on public.%I referencing old table as gone
                    for each statement execute function security.after_delete()', t);
    execute format('drop trigger if exists alert_on_truncate on public.%I', t);
    execute format('create trigger alert_on_truncate after truncate on public.%I
                    for each statement execute function security.after_truncate()', t);
  end loop;
end $$;


-- Watched tables (attach to the staff roles table when it exists) -------------------------------------------
--   create trigger alert_on_change after insert or update or delete on public.staff
--     for each statement execute function security.watch_changes();
create or replace function security.watch_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform security.alert('watched_table_changed', jsonb_build_object('key', tg_table_name || ':' || tg_op,
    'table', tg_table_name, 'operation', tg_op, 'db_role', current_user,
    'by_account', auth.uid()));
  return null;
end;
$$;

-- Only is_paused() is callable by the app's roles; triggers don't need execute rights.
revoke all on all functions in schema security from public, anon, authenticated;
grant execute on function security.is_paused(uuid) to anon, authenticated;


-- Shopper notices ------------------------------------------------------------------------------------------

create table if not exists public.notices (
  id        bigint generated always as identity primary key,
  kind      text not null default 'info' check (kind in ('info', 'incident')),
  title_en  text not null check (char_length(title_en) between 1 and 80),
  body_en   text not null check (char_length(body_en) between 1 and 800),
  title_tl  text check (char_length(title_tl) between 1 and 80),
  body_tl   text check (char_length(body_tl) between 1 and 800),
  starts_at timestamptz not null default now(),
  ends_at   timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notices enable row level security;
drop policy if exists "read current notices" on public.notices;
create policy "read current notices" on public.notices for select to anon, authenticated
  using (starts_at <= now() and (ends_at is null or ends_at > now()));
revoke all on public.notices from anon, authenticated;
grant select (id, kind, title_en, body_en, title_tl, body_tl, starts_at, ends_at) on public.notices to anon, authenticated;
