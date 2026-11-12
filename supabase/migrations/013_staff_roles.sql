-- 013: staff roles (Module 2, Task 2, Nov 12, 2026). Spec: project doc Abaseria_Module2_Collector_Mode.md.
-- Run once in each project, dev first, after 012. Safe to run twice. Changes no existing data.
--
-- What this adds:
--   public.staff     who is staff: role (admin / product_manager / data_entry) and whether their prices are
--                    trusted (default yes). One row per account; removed with the account.
--   helpers          is_staff(), staff_role(), is_admin() for the app, later tasks and the dashboard.
--                    Signed-in callers only; each answers for the caller, never for someone else.
--   rules            a staff member reads their own row; Admins read, add, change and remove any row;
--                    everyone else gets an empty list. Nobody but an Admin can write.
--   last Admin       removing or demoting the last Admin is refused, so Abaseria can't lock itself out.
--   tripwires        a non-Admin account trying to add, change or remove a staff row records a
--                    staff_write_attempt alert (emailed like 012's alerts); the attempt changes nothing.
--                    Every real change to the table records staff_changed, so Brad hears about any new Admin.
--                    Reads can't be alerted on (Postgres has no read trigger, and the API runs reads in a
--                    read-only transaction); the nightly attacker test and npm run test:schema cover reads.
--
-- First Admins are added by hand in each project after this runs (SQL Editor, with the Admins' sign-in emails;
-- this repo is public, so the addresses aren't written here):
--   insert into public.staff (user_id, role)
--   select id, 'admin' from auth.users where email in ('<admin 1 email>', '<admin 2 email>')
--   on conflict (user_id) do nothing;

create table if not exists public.staff (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  role             text not null check (role in ('admin', 'product_manager', 'data_entry')),
  -- Trusted collectors' prices show to shoppers right away (Module 2, Nov 8). An Admin can switch it off.
  trusted          boolean not null default true,
  -- Stamped by the database, never typed: who added the row and when, who last flipped trusted and when.
  added_by         uuid references auth.users (id) on delete set null,
  added_at         timestamptz not null default now(),
  trust_changed_by uuid references auth.users (id) on delete set null,
  trust_changed_at timestamptz
);
comment on table public.staff is 'Staff roles (Module 2, Task 2). Admins manage it; each staff member can read only their own row.';


-- Helpers ------------------------------------------------------------------------------------------------
-- Security definer so the rules on staff can use them without the caller needing to read the table.

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.user_id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid() and s.role = 'admin')
$$;

-- Signed-in callers only. Supabase grants new functions in public to anon directly, so revoke that too.
revoke all on function public.staff_role(), public.is_staff(), public.is_admin() from public, anon;
grant execute on function public.staff_role(), public.is_staff(), public.is_admin() to authenticated;


-- Rules --------------------------------------------------------------------------------------------------

alter table public.staff enable row level security;

drop policy if exists "read own staff row or all as admin" on public.staff;
create policy "read own staff row or all as admin" on public.staff for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admins add staff" on public.staff;
create policy "admins add staff" on public.staff for insert to authenticated
  with check (public.is_admin());
drop policy if exists "admins change staff" on public.staff;
create policy "admins change staff" on public.staff for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins remove staff" on public.staff;
create policy "admins remove staff" on public.staff for delete to authenticated
  using (public.is_admin());

-- Logged-out phones get nothing. Signed-in accounts may write only role and trusted (the rules above decide
-- whether they can at all); the stamp columns are set by the trigger below.
revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;
grant insert (user_id, role, trusted) on public.staff to authenticated;
grant update (role, trusted) on public.staff to authenticated;
grant delete on public.staff to authenticated;


-- Stamps -------------------------------------------------------------------------------------------------

create or replace function security.staff_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Through the API, a non-Admin's row is dropped here, so the attempt commits with nothing added and its
    -- alert (staff_attempt below) is kept. A refused row would roll the alert back with it.
    if auth.uid() is not null and not public.is_admin() then
      return null;
    end if;
    new.added_by := coalesce(auth.uid(), new.added_by);
    new.added_at := now();
    new.trust_changed_by := null;
    new.trust_changed_at := null;
  else
    new.user_id := old.user_id;
    new.added_by := old.added_by;
    new.added_at := old.added_at;
    if new.trusted is distinct from old.trusted then
      new.trust_changed_by := auth.uid();
      new.trust_changed_at := now();
    else
      new.trust_changed_by := old.trust_changed_by;
      new.trust_changed_at := old.trust_changed_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_stamp on public.staff;
create trigger staff_stamp before insert or update on public.staff
  for each row execute function security.staff_stamp();


-- Tripwire and last-Admin guard -----------------------------------------------------------------------------

-- Before every write: one staff change at a time (so two Admins can't demote each other at the same moment),
-- and a write from a signed-in account that isn't an Admin is recorded as an attack.
create or replace function security.staff_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('abaseria.staff'));
  if auth.uid() is not null and not public.is_admin() then
    perform security.alert('staff_write_attempt', jsonb_build_object('key', auth.uid(), 'by_account', auth.uid(),
      'operation', tg_op, 'role', public.staff_role(),
      'note', 'A non-Admin account tried to change the staff table. Nothing was changed.'));
  end if;
  return null;
end;
$$;

drop trigger if exists staff_attempt on public.staff;
create trigger staff_attempt before insert or update or delete on public.staff
  for each statement execute function security.staff_attempt();

-- After each changed row: refuse losing the last Admin, then record the change.
create or replace function security.staff_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.staff where role = 'admin') then
    raise exception 'Abaseria needs at least one Admin. Add another Admin first.' using errcode = '23514';
  end if;
  perform security.alert('staff_changed', jsonb_build_object('key', 'staff:' || tg_op || ':' || target,
    'operation', tg_op, 'user_id', target,
    'old_role', case when tg_op <> 'INSERT' then old.role end,
    'new_role', case when tg_op <> 'DELETE' then new.role end,
    'old_trusted', case when tg_op <> 'INSERT' then old.trusted end,
    'new_trusted', case when tg_op <> 'DELETE' then new.trusted end,
    'by_account', auth.uid(), 'db_role', current_user));
  return null;
end;
$$;

-- Deferred to the end of the statement, so a multi-row change is judged on what's left afterwards.
drop trigger if exists staff_changed on public.staff;
create constraint trigger staff_changed after insert or update or delete on public.staff
  deferrable initially immediate
  for each row execute function security.staff_changed();

revoke all on function security.staff_stamp(), security.staff_attempt(), security.staff_changed()
  from public, anon, authenticated;
