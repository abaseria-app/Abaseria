-- 022: what a promo price was discounted from, and what the deal is (Nov 20 2026, Jovie's observations).
--
-- regular_price_centavos: the price before the promo, in the same terms as unit_price_centavos (per piece,
--   or per kilo for 'perkg'). The discount is regular minus paid; it's worked out, never stored, so the
--   three numbers can't disagree.
-- promo_note: a few words on the deal, e.g. "free shaker", "20% off", "buy 1 take 1". Freebies taped to a
--   product with its usual barcode are a promo on the price, not a different product.
--
-- Both are optional and only make sense on a promo price. Run once in each project's SQL Editor. Safe to run
-- twice. Changes no existing rows.

alter table public.price_sightings add column if not exists regular_price_centavos integer;
alter table public.price_sightings add column if not exists promo_note text;

alter table public.price_sightings drop constraint if exists price_sightings_regular_price_check;
alter table public.price_sightings add constraint price_sightings_regular_price_check
  check (regular_price_centavos is null
         or (is_promo and regular_price_centavos between 1 and 10000000 and regular_price_centavos > unit_price_centavos));

alter table public.price_sightings drop constraint if exists price_sightings_promo_note_check;
alter table public.price_sightings add constraint price_sightings_promo_note_check
  check (promo_note is null or (is_promo and char_length(btrim(promo_note)) between 1 and 60));

-- Phones may read and add both. (Column grants: a new column stays hidden until granted.)
grant select (regular_price_centavos, promo_note) on public.price_sightings to anon, authenticated;
grant insert (regular_price_centavos, promo_note) on public.price_sightings to authenticated;

-- latest_prices carries them too. New columns go at the end, so the view can be replaced in place
-- and keeps its grants and security_invoker setting.
create or replace view public.latest_prices with (security_invoker = true) as
select distinct on (barcode, branch_id)
  barcode, branch_id, seen_on, price_type, unit_price_centavos, bundle_qty, bundle_price_centavos, is_promo, capture_method,
  regular_price_centavos, promo_note
from public.price_sightings
order by barcode, branch_id, seen_on desc, id desc;
