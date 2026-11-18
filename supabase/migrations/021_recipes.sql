-- 021: recipes (Nov 18, 2026). Plan: project doc Abaseria_Recipes_Plan.md.
-- Run once in each project, dev first, after 020. Safe to run twice. Changes no existing data.
--
-- Recipes say "soy sauce", not "Silver Swan 385 mL", so a generic ingredient sits between recipes and products:
--   ingredients          one row per generic ingredient (soy sauce, chicken thigh, garlic)
--   ingredient_products  which products can stand in for an ingredient; one may be the default, any may be sponsored
--   recipes              the recipe itself; category, meal types and diets use the website's lists (abaseria.com/recipes)
--   recipe_ingredients   one row per ingredient line: what the shopper reads ("3 tbsp toyo") and the amount the app prices
--   recipe-images        public bucket, 300 KB per file; uploaded from the dashboard only, like product-images
--
-- Prices aren't stored here. The phone works out "cost to cook" and "cost to buy" from the prices it already
-- has (shared latest_prices plus its own trips), so per-kilo meat and produce logged on the phone count too.
--
-- Who can do what:
--   anyone with the app's key   reads published recipes and their lines, and every ingredient and product link
--   staff (013)                 read every recipe, including drafts
--   Collector (data_entry)      adds recipes as draft or pending, edits their own until published, can't publish or delete
--   Product Manager             adds, edits and publishes any recipe; deletes one recipe at a time
--   Admin                       everything, including deleting several at once
--   shoppers                    nothing else; who added a recipe (created_by) isn't readable through the app


-- Ingredients ----------------------------------------------------------------------------------------------

create table if not exists public.ingredients (
  id               bigint generated always as identity primary key,
  name_en          text not null check (char_length(name_en) between 1 and 80),
  name_tl          text check (char_length(name_tl) between 1 and 80),
  -- pack: bought in packs (a 385 mL bottle). perkg: weighed at the counter (chicken, onions).
  pricing_basis    text not null default 'pack' check (pricing_basis in ('pack', 'perkg')),
  unit_kind        text not null check (unit_kind in ('mass', 'volume', 'count')),
  -- Salt, water, cooking oil: counted as "already have" until the shopper unticks it.
  is_pantry_staple boolean not null default false,
  -- Only for dry goods a recipe measures in cups (rice, flour, sugar).
  grams_per_cup    numeric check (grams_per_cup is null or grams_per_cup between 1 and 1000),
  -- Names a phone's own per-kilo items go by ("manok", "chicken thigh"): those have no barcode to link.
  aliases          text[] not null default '{}' check (cardinality(aliases) <= 12),
  created_at       timestamptz not null default now()
);
create unique index if not exists ingredients_name_en_key on public.ingredients (lower(name_en));
comment on table public.ingredients is 'Generic recipe ingredients (Recipes, 021). Linked to products through ingredient_products.';

create table if not exists public.ingredient_products (
  ingredient_id bigint not null references public.ingredients (id) on delete cascade,
  product_id    bigint not null references public.products (id) on delete cascade,
  is_default    boolean not null default false,
  -- A brand paid to be the default. The app labels it Sponsored and still shows the cheaper option.
  is_sponsored  boolean not null default false,
  primary key (ingredient_id, product_id)
);
create unique index if not exists ingredient_products_one_default on public.ingredient_products (ingredient_id) where is_default;
create index if not exists ingredient_products_product on public.ingredient_products (product_id);


-- Recipes --------------------------------------------------------------------------------------------------

create table if not exists public.recipes (
  id               bigint generated always as identity primary key,
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title_en         text not null check (char_length(title_en) between 1 and 100),
  title_tl         text check (char_length(title_tl) between 1 and 100),
  summary_en       text check (char_length(summary_en) <= 400),
  summary_tl       text check (char_length(summary_tl) <= 400),
  category         text not null check (category in ('chicken', 'pork', 'beef', 'fish', 'seafoods', 'vegetables', 'pasta', 'rice', 'others')),
  meal_types       text[] not null default '{}' check (meal_types <@ array['breakfast', 'lunch', 'dinner', 'snacks', 'dessert']),
  diets            text[] not null default '{}' check (diets <@ array['keto', 'vegan', 'vegetarian', 'high_protein']),
  prep_min         smallint not null default 0 check (prep_min between 0 and 1440),
  cook_min         smallint not null default 0 check (cook_min between 0 and 1440),
  servings         smallint not null check (servings between 1 and 50),
  youtube_id       text check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  image_path       text check (image_path is null or image_path ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$'),
  -- [{"en": "Marinate the chicken...", "tl": "..."}], in order.
  steps            jsonb not null default '[]' check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 40),
  tips_en          text check (char_length(tips_en) <= 1000),
  tips_tl          text check (char_length(tips_tl) <= 1000),
  -- Per serving: {"kcal": 420, "protein_g": 31, "carbs_g": 12, "fat_g": 27, "sodium_mg": 980}
  nutrition        jsonb check (nutrition is null or jsonb_typeof(nutrition) = 'object'),
  nutrition_source text check (nutrition_source in ('fnri', 'estimated')),
  status           text not null default 'draft' check (status in ('draft', 'pending', 'published')),
  -- A brand that paid for this recipe, shown as "Sponsored by ...". Null for most.
  sponsor          text check (char_length(sponsor) between 1 and 80),
  -- The matching abaseria.com post once the website push exists (plan step 7).
  wp_post_id       bigint,
  published_at     timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((nutrition is null) = (nutrition_source is null))
);
create index if not exists recipes_published on public.recipes (published_at desc) where status = 'published';
comment on table public.recipes is 'Recipes (021). Published ones show in the app and, later, on abaseria.com/recipes.';

create table if not exists public.recipe_ingredients (
  id            bigint generated always as identity primary key,
  recipe_id     bigint not null references public.recipes (id) on delete cascade,
  position      smallint not null check (position between 1 and 60),
  -- "Marinade", "Sauce". Null for a recipe with one list.
  grp           text check (char_length(grp) between 1 and 40),
  -- What the shopper reads, as written in the recipe: "3 tbsp toyo (soy sauce)".
  display_text  text not null check (char_length(display_text) between 1 and 120),
  -- What the app prices. Null qty with unit to_taste ("salt to taste") is never priced.
  qty           numeric check (qty is null or (qty > 0 and qty <= 100000)),
  unit          text not null check (unit in ('g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pc', 'to_taste')),
  -- Empty until staff confirm which ingredient this line is. Unmatched lines show without a price.
  ingredient_id bigint references public.ingredients (id) on delete set null,
  optional      boolean not null default false,
  unique (recipe_id, position),
  check ((unit = 'to_taste') = (qty is null))
);
create index if not exists recipe_ingredients_ingredient on public.recipe_ingredients (ingredient_id);


-- Helpers --------------------------------------------------------------------------------------------------

-- Product Manager or Admin: may publish, edit anyone's recipe and delete.
create or replace function public.can_publish() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid() and s.role in ('admin', 'product_manager'))
$$;
revoke all on function public.can_publish() from public, anon;
grant execute on function public.can_publish() to authenticated;

-- Can the caller edit this recipe? Publishers: any. Collectors: their own, while not published.
create or replace function public.can_edit_recipe(rid bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_publish() or exists (
    select 1 from public.recipes r
    where r.id = rid and r.created_by = auth.uid() and r.status <> 'published' and public.is_staff())
$$;
revoke all on function public.can_edit_recipe(bigint) from public, anon;
grant execute on function public.can_edit_recipe(bigint) to authenticated;

-- Is the caller staff? Like is_staff(), but callable with the public key too (answers false), so the read
-- rules below work for logged-out phones without a permission error.
create or replace function public.staff_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.staff s where s.user_id = auth.uid())
$$;
revoke all on function public.staff_viewer() from public;
grant execute on function public.staff_viewer() to anon, authenticated;

-- Readable recipe: published, or any recipe for staff. Used by recipe_ingredients' read rule.
create or replace function public.recipe_visible(rid bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.staff_viewer() or exists (select 1 from public.recipes r where r.id = rid and r.status = 'published')
$$;
revoke all on function public.recipe_visible(bigint) from public;
grant execute on function public.recipe_visible(bigint) to anon, authenticated;


-- Stamps: who added a recipe, when it changed, when it was first published. Collectors can't publish. -------

create or replace function security.recipe_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  -- Through the API only a Product Manager or Admin can publish; imports with the server key can too.
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published')
     and auth.uid() is not null and not public.can_publish() then
    raise exception 'Only a Product Manager or Admin can publish a recipe' using errcode = '42501';
  end if;
  if new.status = 'published' then
    new.published_at := coalesce(case when tg_op = 'UPDATE' then old.published_at end, now());
  end if;
  return new;
end;
$$;
drop trigger if exists recipe_stamp on public.recipes;
create trigger recipe_stamp before insert or update on public.recipes
  for each row execute function security.recipe_stamp();

-- Deleting several recipes at once is Admin-only (Nov 4 rule). Imports with the server key aren't limited.
create or replace function security.recipe_bulk_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_admin() and (select count(*) from gone) > 1 then
    raise exception 'Only an Admin can delete more than one recipe at a time' using errcode = '42501';
  end if;
  return null;
end;
$$;
drop trigger if exists recipe_bulk_delete on public.recipes;
create trigger recipe_bulk_delete after delete on public.recipes referencing old table as gone
  for each statement execute function security.recipe_bulk_delete();

revoke all on all functions in schema security from public, anon, authenticated;
grant execute on function security.is_paused(uuid) to anon, authenticated;


-- Rules ----------------------------------------------------------------------------------------------------

alter table public.ingredients         enable row level security;
alter table public.ingredient_products enable row level security;
alter table public.recipes             enable row level security;
alter table public.recipe_ingredients  enable row level security;

-- Ingredients and their product links: reference data, readable by everyone, written by staff.
drop policy if exists "read ingredients" on public.ingredients;
create policy "read ingredients" on public.ingredients for select to anon, authenticated using (true);
drop policy if exists "staff add ingredients" on public.ingredients;
create policy "staff add ingredients" on public.ingredients for insert to authenticated with check (public.is_staff());
drop policy if exists "staff change ingredients" on public.ingredients;
create policy "staff change ingredients" on public.ingredients for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "publishers remove ingredients" on public.ingredients;
create policy "publishers remove ingredients" on public.ingredients for delete to authenticated using (public.can_publish());

drop policy if exists "read ingredient products" on public.ingredient_products;
create policy "read ingredient products" on public.ingredient_products for select to anon, authenticated using (true);
drop policy if exists "staff link ingredient products" on public.ingredient_products;
create policy "staff link ingredient products" on public.ingredient_products for insert to authenticated
  with check (public.is_staff() and (not is_sponsored or public.can_publish()));
drop policy if exists "publishers change ingredient products" on public.ingredient_products;
create policy "publishers change ingredient products" on public.ingredient_products for update to authenticated
  using (public.can_publish()) with check (public.can_publish());
drop policy if exists "publishers unlink ingredient products" on public.ingredient_products;
create policy "publishers unlink ingredient products" on public.ingredient_products for delete to authenticated
  using (public.can_publish());

-- Recipes.
drop policy if exists "read published recipes" on public.recipes;
create policy "read published recipes" on public.recipes for select to anon, authenticated
  using (status = 'published' or public.staff_viewer());
drop policy if exists "staff add recipes" on public.recipes;
create policy "staff add recipes" on public.recipes for insert to authenticated with check (public.is_staff());
drop policy if exists "staff edit recipes" on public.recipes;
create policy "staff edit recipes" on public.recipes for update to authenticated
  using (public.can_edit_recipe(id)) with check (public.is_staff());
drop policy if exists "publishers remove recipes" on public.recipes;
create policy "publishers remove recipes" on public.recipes for delete to authenticated using (public.can_publish());

drop policy if exists "read recipe lines" on public.recipe_ingredients;
create policy "read recipe lines" on public.recipe_ingredients for select to anon, authenticated
  using (public.recipe_visible(recipe_id));
drop policy if exists "editors add recipe lines" on public.recipe_ingredients;
create policy "editors add recipe lines" on public.recipe_ingredients for insert to authenticated
  with check (public.can_edit_recipe(recipe_id));
drop policy if exists "editors change recipe lines" on public.recipe_ingredients;
create policy "editors change recipe lines" on public.recipe_ingredients for update to authenticated
  using (public.can_edit_recipe(recipe_id)) with check (public.can_edit_recipe(recipe_id));
drop policy if exists "editors remove recipe lines" on public.recipe_ingredients;
create policy "editors remove recipe lines" on public.recipe_ingredients for delete to authenticated
  using (public.can_edit_recipe(recipe_id));

-- Column rights: everything but the stamps is writable by whoever the rules allow; created_by is never readable.
revoke all on public.ingredients, public.ingredient_products, public.recipes, public.recipe_ingredients from anon, authenticated;
grant select on public.ingredients, public.ingredient_products, public.recipe_ingredients to anon, authenticated;
grant select (id, slug, title_en, title_tl, summary_en, summary_tl, category, meal_types, diets, prep_min, cook_min,
              servings, youtube_id, image_path, steps, tips_en, tips_tl, nutrition, nutrition_source, status, sponsor,
              wp_post_id, published_at, created_at, updated_at)
  on public.recipes to anon, authenticated;
grant insert (name_en, name_tl, pricing_basis, unit_kind, is_pantry_staple, grams_per_cup, aliases),
      update (name_en, name_tl, pricing_basis, unit_kind, is_pantry_staple, grams_per_cup, aliases),
      delete on public.ingredients to authenticated;
grant insert, update (is_default, is_sponsored), delete on public.ingredient_products to authenticated;
grant insert (slug, title_en, title_tl, summary_en, summary_tl, category, meal_types, diets, prep_min, cook_min,
              servings, youtube_id, image_path, steps, tips_en, tips_tl, nutrition, nutrition_source, status, sponsor),
      update (slug, title_en, title_tl, summary_en, summary_tl, category, meal_types, diets, prep_min, cook_min,
              servings, youtube_id, image_path, steps, tips_en, tips_tl, nutrition, nutrition_source, status, sponsor),
      delete on public.recipes to authenticated;
grant insert (recipe_id, position, grp, display_text, qty, unit, ingredient_id, optional),
      update (position, grp, display_text, qty, unit, ingredient_id, optional),
      delete on public.recipe_ingredients to authenticated;


-- Images ---------------------------------------------------------------------------------------------------
-- Name files after the slug (chicken-adobo.webp, chicken-adobo-thumb.webp). No storage policies on purpose:
-- with none, the app's keys can't upload, replace or delete.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', true, 307200, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;
