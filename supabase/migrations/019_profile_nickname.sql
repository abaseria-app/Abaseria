-- 019: nickname on the shopper profile (Nov 17, 2026). "What is your name? How do you want us to call you?"
-- Run once in each project, dev first, after 018. Safe to run twice. Changes no existing data.
--
-- Most shoppers go by a palayaw that isn't the name on their Google account. Saved with the other answers, so it
-- follows the same rules: own row only, real accounts only, needs the 'profile' switch, deleted when it goes off.
-- 1 to 30 characters, no leading or trailing spaces, no control characters or angle brackets.

alter table public.shopper_profiles add column if not exists nickname text
  check (nickname is null or (char_length(nickname) between 1 and 30 and nickname = btrim(nickname) and nickname !~ '[[:cntrl:]<>]'));

grant select (nickname), insert (nickname), update (nickname) on public.shopper_profiles to authenticated;
