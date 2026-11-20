-- 024: tester feedback with a screenshot (Nov 20, 2026). Settings → Send feedback.
-- Run once in each project, dev first, after 013 (uses is_staff() / is_admin()) and 012 (alert emails).
-- Safe to run twice. Changes no existing data.
--
-- What this adds:
--   public.feedback   one row per message: kind (problem / comment / suggestion / concern), where in the app
--                     (optional), the message, an optional screenshot, and what the phone sends with it
--                     (dev or live app, build, phone model, screen size). Staff set status and a note.
--   rules             a real account (not a guest session) sends feedback as itself and reads its own;
--                     staff read everyone's and can change status and note only; only an Admin deletes.
--                     Logged-out phones get nothing. 20 messages per account per day, then refused.
--   bucket            feedback-screenshots, private, 1 MB per file, WebP or JPEG only. The app redraws the
--                     picture on the phone first (max 1600 px tall), which also strips GPS and camera data.
--                     A real account adds files only as <own user id>/<random id>.webp|.jpg and can't
--                     replace them; staff view them; only an Admin deletes.
--   email             each new message records a tester_feedback alert, which the security-alert function
--                     emails to Brad with the message and a 7-day link to the screenshot (redeploy it).
--                     The alert row holds only the feedback id, never the message itself.
--
-- Account deletion: deleting the user removes their feedback rows (cascade). Their screenshots stay in
-- Storage until removed by hand: Storage → feedback-screenshots → the folder named with their user id.
--
-- Reading feedback before the admin dashboard exists: Table Editor → feedback (newest first), or
--   select id, created_at, kind, area, app_env, message, screenshot_path, status from public.feedback order by id desc;

create table if not exists public.feedback (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('problem', 'comment', 'suggestion', 'concern')),
  area            text check (area is null or area in ('scan', 'trip', 'products', 'list', 'recipes', 'budget', 'profile', 'signin', 'other')),
  message         text not null check (char_length(btrim(message)) between 3 and 2000),
  screenshot_path text check (screenshot_path is null
                              or screenshot_path ~ ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$')),
  app_env         text not null check (app_env in ('dev', 'prod')),
  app_build       text check (app_build is null or char_length(app_build) <= 40),
  device          text check (device is null or char_length(device) <= 300),
  screen          text check (screen is null or char_length(screen) <= 40),
  status          text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wont_fix')),
  staff_note      text check (staff_note is null or char_length(staff_note) <= 1000),
  handled_by      uuid references auth.users (id) on delete set null,
  handled_at      timestamptz
);
comment on table public.feedback is 'Tester feedback from Settings → Send feedback (024). Shoppers add and read their own; staff read all and set status/note.';
create index if not exists feedback_new on public.feedback (created_at desc) where status = 'new';
create index if not exists feedback_user_day on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant insert (kind, area, message, screenshot_path, app_env, app_build, device, screen) on public.feedback to authenticated;
grant update (status, staff_note) on public.feedback to authenticated;
grant delete on public.feedback to authenticated;

drop policy if exists "real accounts send feedback" on public.feedback;
create policy "real accounts send feedback" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid())
              and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

drop policy if exists "read own feedback or all as staff" on public.feedback;
create policy "read own feedback or all as staff" on public.feedback for select to authenticated
  using ((user_id = (select auth.uid())
          and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false)
         or public.is_staff());

drop policy if exists "staff mark feedback" on public.feedback;
create policy "staff mark feedback" on public.feedback for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "admins delete feedback" on public.feedback;
create policy "admins delete feedback" on public.feedback for delete to authenticated
  using (public.is_admin());


-- Daily limit, and who handled it ------------------------------------------------------------------------

create or replace function public.before_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.feedback f
         where f.user_id = new.user_id and f.created_at > now() - interval '1 day') >= 20 then
      raise exception 'feedback_daily_limit' using errcode = 'P0001',
        hint = '20 messages a day per account. Try again tomorrow.';
    end if;
    new.status := 'new';
    new.staff_note := null;
    new.handled_by := null;
    new.handled_at := null;
  elsif new.status is distinct from old.status or new.staff_note is distinct from old.staff_note then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.before_feedback() from public, anon, authenticated;

drop trigger if exists before_feedback on public.feedback;
create trigger before_feedback before insert or update on public.feedback
  for each row execute function public.before_feedback();


-- Email Brad ---------------------------------------------------------------------------------------------
-- Only the id goes into security.events; the function reads the message with the server key.

create or replace function public.after_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform security.alert('tester_feedback',
    jsonb_build_object('key', 'feedback-' || new.id, 'feedback_id', new.id, 'kind', new.kind, 'env', new.app_env));
  return null;
end;
$$;
revoke all on function public.after_feedback() from public, anon, authenticated;

drop trigger if exists after_feedback on public.feedback;
create trigger after_feedback after insert on public.feedback
  for each row execute function public.after_feedback();


-- Screenshots --------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "add own feedback screenshot" on storage.objects;
create policy "add own feedback screenshot" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-screenshots'
              and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$')
              and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false);

drop policy if exists "read own feedback screenshots or all as staff" on storage.objects;
create policy "read own feedback screenshots or all as staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-screenshots'
         and ((split_part(name, '/', 1) = (select auth.uid())::text
               and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false)
              or public.is_staff()));

drop policy if exists "admins delete feedback screenshots" on storage.objects;
create policy "admins delete feedback screenshots" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-screenshots' and public.is_admin());
