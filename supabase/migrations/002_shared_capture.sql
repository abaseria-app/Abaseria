-- 002: allow capture_method 'shared' (another shopper's price, accepted after checking the tag).
-- For projects set up with the original schema.sql. Run once in the SQL Editor of each project.
-- Safe to run twice. Changes no data.

alter table public.price_sightings drop constraint if exists price_sightings_capture_method_check;
alter table public.price_sightings add constraint price_sightings_capture_method_check
  check (capture_method in ('tag', 'tag+typed', 'typed', 'recall', 'shared'));
