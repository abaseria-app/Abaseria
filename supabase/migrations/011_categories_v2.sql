-- 011: the 16 categories (Brad, Nov 11 2026). Replaces the 8 from 004; eggs move to "dairy & eggs" and poultry to
-- "meat, poultry & seafood", reversing the old "eggs under poultry" rule on purpose.
-- Run on abaseria-dev on Nov 11, 2026 (categories_v2_step1_backup_and_unlock, categories_v2_step2_constraint,
-- categories_v2_step3_unsorted). Run once in prod, before or together with the app release that uses them.
-- Safe to run twice.
--
-- products.category becomes optional: an item the app can't place uploads with no category instead of a wrong one.

-- Undo copy: every product's category before this ran.
create table if not exists public.products_category_v1_backup as
  select barcode, category, now() as backed_up_at from public.products;
alter table public.products_category_v1_backup enable row level security;

alter table public.products drop constraint if exists products_category_check;
alter table public.products alter column category drop not null;
alter table public.products alter column category drop default;

-- Old ids to new. In dev the 2,708 products from Brad's TOP_50/TOP_100 sheets took the sheet's category by barcode;
-- this is the fallback for anything else. "pantry", "dry" and "household" each split several ways, so a product
-- that lands in the wrong one here gets fixed by hand.
update public.products set category = case category
    when 'meat'       then 'meat, poultry & seafood'
    when 'poultry'    then case when name ~* '\m(egg|eggs|itlog|balut|penoy)\M' then 'dairy & eggs' else 'meat, poultry & seafood' end
    when 'vegetables' then 'fruits & vegetables'
    when 'dairy'      then 'dairy & eggs'
    when 'dry'        then 'pantry staples'
    when 'pantry'     then case
        when name ~* '\m(sardines?|tuna|corned|luncheon|spam|vienna|meat loaf|canned|fruit cocktail|nata de coco|kaong)\M' then 'canned & preserved food'
        when name ~* '\m(sauce|toyo|soy|vinegar|suka|patis|ketchup|catsup|oil|seasoning|mayonnaise)\M' then 'cooking essentials & condiments'
        when name ~* '\m(juice|soda|coke|pepsi|sprite|water|tea|coffee|milo|drink)\M' then 'beverages'
        when name ~* '\m(bread|pandesal|loaf)\M' then 'bread & bakery'
        when name ~* '\m(chips|biscuits?|crackers?|chocolate|candy|cookies)\M' then 'snacks, candies & sweets'
        else 'pantry staples' end
    when 'household'  then case
        when name ~* '\m(shampoo|conditioner|toothpaste|toothbrush|soap|lotion|deodorant|napkin)\M' then 'personal care & hygiene'
        when name ~* '\m(diapers?|pampers|huggies)\M' then 'baby & kids'
        else 'household & cleaning supplies' end
    when 'other'      then null
    else category end
  where category not in ('pantry staples', 'fruits & vegetables', 'meat, poultry & seafood', 'dairy & eggs',
    'canned & preserved food', 'cooking essentials & condiments', 'bread & bakery', 'snacks, candies & sweets',
    'beverages', 'frozen & ready-to-eat food', 'household & cleaning supplies', 'personal care & hygiene',
    'baby & kids', 'health & wellness', 'pet supplies', 'baking and desserts');

alter table public.products add constraint products_category_check check (category in (
  'pantry staples', 'fruits & vegetables', 'meat, poultry & seafood', 'dairy & eggs',
  'canned & preserved food', 'cooking essentials & condiments', 'bread & bakery', 'snacks, candies & sweets',
  'beverages', 'frozen & ready-to-eat food', 'household & cleaning supplies', 'personal care & hygiene',
  'baby & kids', 'health & wellness', 'pet supplies', 'baking and desserts'));
