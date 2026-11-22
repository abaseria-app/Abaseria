import { describe, expect, it } from 'vitest';
import {
  NO_RECIPE_FILTERS,
  buildBook,
  costRecipe,
  filterRecipes,
  formatQty,
  lineAmount,
  scaleText,
  toggleSaved,
  withSaved,
  type Ingredient,
  type Recipe,
  type RecipeLine,
} from './recipes';
import type { CatalogItem, PricePoint } from './search';

const TODAY = '2026-11-18';
const price = (storeKey: string, centavos: number, over: Partial<PricePoint> = {}): PricePoint => ({
  storeKey,
  storeLabel: storeKey === 'rob' ? 'Robinsons Imus' : 'Puregold Imus',
  seenOn: '2026-11-15',
  priceType: 'each',
  unitPriceCentavos: centavos,
  bundleQty: null,
  bundlePriceCentavos: null,
  isPromo: false,
  source: 'shared',
  ...over,
});
const item = (barcode: string | null, name: string, size: string | null, prices: PricePoint[]): CatalogItem => ({
  key: barcode ?? `name:${name.toLowerCase()}`,
  barcode,
  name,
  size,
  category: 'other',
  image: null,
  prices,
});
const ing = (id: number, over: Partial<Ingredient>): Ingredient => ({
  id,
  nameEn: `Ingredient ${id}`,
  nameTl: null,
  pricingBasis: 'pack',
  unitKind: 'volume',
  isPantryStaple: false,
  gramsPerCup: null,
  aliases: [],
  products: [],
  ...over,
});
const line = (position: number, displayText: string, qty: number | null, unit: RecipeLine['unit'], ingredientId: number | null, optional = false): RecipeLine => ({
  position,
  group: null,
  displayText,
  qty,
  unit,
  ingredientId,
  optional,
});
const recipe = (lines: RecipeLine[], over: Partial<Recipe> = {}): Recipe => ({
  id: 1,
  slug: 'chicken-adobo',
  titleEn: 'Chicken Adobo',
  titleTl: 'Adobong Manok',
  summaryEn: null,
  category: 'chicken',
  mealTypes: ['lunch', 'dinner'],
  diets: ['high_protein'],
  prepMin: 10,
  cookMin: 40,
  servings: 4,
  youtubeId: null,
  image: null,
  thumb: null,
  steps: [{ en: 'Cook.' }],
  tipsEn: null,
  nutrition: null,
  nutritionSource: null,
  sponsor: null,
  publishedAt: '2026-11-18T00:00:00Z',
  lines,
  ...over,
});

const SOY = ing(1, { nameEn: 'Soy sauce', products: [{ barcode: '4800000000011', name: 'Silver Swan Soy Sauce', isDefault: true, isSponsored: false }] });
const CHICKEN = ing(2, { nameEn: 'Chicken thigh', pricingBasis: 'perkg', unitKind: 'mass', aliases: ['manok'] });
const SALT = ing(3, { nameEn: 'Salt', unitKind: 'mass', isPantryStaple: true });
const RICE = ing(4, { nameEn: 'Rice', unitKind: 'mass', gramsPerCup: 185 });
const EGG = ing(5, { nameEn: 'Egg', unitKind: 'count' });
const INGS = { 1: SOY, 2: CHICKEN, 3: SALT, 4: RICE, 5: EGG };
const soyBottle = item('4800000000011', 'Silver Swan Soy Sauce', '385ml', [price('rob', 2800)]);
const opts = (over = {}) => ({ storeKey: 'rob', servings: 4, toggled: new Set<number>(), today: TODAY, ...over });

describe('amounts', () => {
  it('converts kitchen measures', () => {
    expect(lineAmount({ qty: 3, unit: 'tbsp' }, SOY)).toEqual({ kind: 'volume', amount: 45 });
    expect(lineAmount({ qty: 1, unit: 'kg' }, CHICKEN)).toEqual({ kind: 'mass', amount: 1000 });
    expect(lineAmount({ qty: 2, unit: 'cup' }, RICE)).toEqual({ kind: 'mass', amount: 370 });
    expect(lineAmount({ qty: 3, unit: 'pc' }, EGG, 2)).toEqual({ kind: 'count', amount: 6 });
    expect(lineAmount({ qty: null, unit: 'to_taste' }, SALT)).toBeNull();
    expect(lineAmount({ qty: 2, unit: 'pc' }, SOY)).toBeNull();
  });
  it('writes amounts as cooks do', () => {
    expect(formatQty(0.5)).toBe('1/2');
    expect(formatQty(1.5)).toBe('1 1/2');
    expect(formatQty(2)).toBe('2');
    expect(formatQty(1 / 3)).toBe('1/3');
    expect(formatQty(0.9)).toBe('0.9');
  });
  it('rescales the leading amount in a line', () => {
    expect(scaleText('1/2 cup toyo', 2)).toBe('1 cup toyo');
    expect(scaleText('1 1/2 kg chicken thighs', 2)).toBe('3 kg chicken thighs');
    expect(scaleText('3 tbsp vinegar', 0.5)).toBe('1 1/2 tbsp vinegar');
    expect(scaleText('Salt to taste', 2)).toBe('Salt to taste');
    expect(scaleText('3 tbsp vinegar', 1)).toBe('3 tbsp vinegar');
  });
});

describe('costing', () => {
  it('splits cost to cook from cost to buy (the soy sauce example in the plan)', () => {
    const c = costRecipe(recipe([line(1, '3 tbsp toyo', 3, 'tbsp', 1)]), INGS, [soyBottle], opts());
    expect(c.lines[0].status).toBe('priced');
    expect(c.cookCentavos).toBe(327); // 45 of 385 mL at ₱28
    expect(c.buyCentavos).toBe(2800);
    expect(c.show).toBe(true);
  });

  it('buys two bottles when one isn’t enough, and rescales for servings', () => {
    const c = costRecipe(recipe([line(1, '2 cups toyo', 2, 'cup', 1)]), INGS, [soyBottle], opts({ servings: 8 }));
    expect(c.lines[0].text).toBe('4 cups toyo');
    expect(c.lines[0].chosen?.packs).toBe(3); // 960 mL
    expect(c.buyCentavos).toBe(8400);
  });

  it('prices meat by the kilo from the phone’s own weighed items, by alias', () => {
    const manok = item(null, 'Manok', null, [price('rob', 22000, { priceType: 'perkg', source: 'phone' })]);
    const c = costRecipe(recipe([line(1, '1 kg chicken thighs', 1, 'kg', 2)]), INGS, [manok], opts({ servings: 6 }));
    expect(c.cookCentavos).toBe(33000); // 1.5 kg × ₱220
    expect(c.buyCentavos).toBe(33000);
  });

  it('leaves "already have" out of cost to buy, and pantry staples start ticked', () => {
    const salt = item('4800000000028', 'Iodized Salt', '500g', [price('rob', 2000)]);
    const SALT_LINKED = { ...SALT, products: [{ barcode: '4800000000028', name: 'Iodized Salt', isDefault: true, isSponsored: false }] };
    const r = recipe([line(1, '3 tbsp toyo', 3, 'tbsp', 1), line(2, '1 tsp salt', 1, 'tsp', 3)]);
    const a = costRecipe(r, { ...INGS, 3: SALT_LINKED }, [soyBottle, salt], opts());
    expect(a.lines[1].have).toBe(true);
    expect(a.buyCentavos).toBe(2800);
    expect(a.cookCentavos).toBe(327 + 20); // 5 g of 500 g at ₱20
    const b = costRecipe(r, { ...INGS, 3: SALT_LINKED }, [soyBottle, salt], opts({ toggled: new Set([2]) }));
    expect(b.lines[1].have).toBe(false);
    expect(b.buyCentavos).toBe(4800);
    const c = costRecipe(r, INGS, [soyBottle], opts({ toggled: new Set([1]) }));
    expect(c.buyCentavos).toBe(0);
  });

  it('prefers the chosen store, then shows other stores', () => {
    const both = item('4800000000011', 'Silver Swan Soy Sauce', '385ml', [price('pg', 2500), price('rob', 2800)]);
    expect(costRecipe(recipe([line(1, 'x', 3, 'tbsp', 1)]), INGS, [both], opts()).buyCentavos).toBe(2800);
    const elsewhere = item('4800000000011', 'Silver Swan Soy Sauce', '385ml', [price('pg', 2500)]);
    const c = costRecipe(recipe([line(1, 'x', 3, 'tbsp', 1)]), INGS, [elsewhere], opts());
    expect(c.buyCentavos).toBe(2500);
    expect(c.usesOtherStores).toBe(true);
  });

  it('ignores prices older than 30 days', () => {
    const old = item('4800000000011', 'Silver Swan Soy Sauce', '385ml', [price('rob', 2800, { seenOn: '2026-10-10' })]);
    const c = costRecipe(recipe([line(1, 'x', 3, 'tbsp', 1)]), INGS, [old], opts());
    expect(c.lines[0].status).toBe('noPrice');
    expect(c.show).toBe(false);
  });

  it('keeps a sponsored default but points to the cheaper option', () => {
    const SOY2 = {
      ...SOY,
      products: [
        { barcode: '4800000000011', name: 'Silver Swan', isDefault: false, isSponsored: false },
        { barcode: '4800000000035', name: 'Datu Puti', isDefault: true, isSponsored: true },
      ],
    };
    const datu = item('4800000000035', 'Datu Puti Soy Sauce', '385ml', [price('rob', 3100)]);
    const c = costRecipe(recipe([line(1, 'x', 3, 'tbsp', 1)]), { ...INGS, 1: SOY2 }, [soyBottle, datu], opts());
    expect(c.lines[0].chosen?.productName).toBe('Datu Puti Soy Sauce');
    expect(c.lines[0].chosen?.sponsored).toBe(true);
    expect(c.lines[0].cheaper?.productName).toBe('Silver Swan Soy Sauce');
  });

  it('hides the cost until 80% of the lines are priced', () => {
    const lines = [line(1, 'a', 3, 'tbsp', 1), line(2, 'b', 1, 'kg', 2), line(3, 'c', 2, 'cup', 4), line(4, 'd', 3, 'pc', 5), line(5, 'e', 1, 'pc', null)];
    const c = costRecipe(recipe(lines), INGS, [soyBottle], opts());
    expect(c.coverage).toBeCloseTo(0.2);
    expect(c.show).toBe(false);
  });

  it('never counts to-taste or optional lines, or an unpriced pantry staple', () => {
    const lines = [line(1, '3 tbsp toyo', 3, 'tbsp', 1), line(2, 'Salt to taste', null, 'to_taste', 3), line(3, '1 tsp salt', 1, 'tsp', 3), line(4, 'Chili (optional)', 2, 'pc', null, true)];
    const c = costRecipe(recipe(lines), INGS, [soyBottle], opts());
    expect(c.coverage).toBe(1);
    expect(c.show).toBe(true);
    expect(c.lines.map((l) => l.status)).toEqual(['priced', 'toTaste', 'noPrice', 'unmatched']);
  });

  it('prices eggs by the piece from a tray', () => {
    const tray = item('4800000000042', 'Fresh Eggs Medium', '12 pcs', [price('rob', 9600)]);
    const EGG_LINKED = { ...EGG, products: [{ barcode: '4800000000042', name: 'Eggs', isDefault: true, isSponsored: false }] };
    const c = costRecipe(recipe([line(1, '3 eggs', 3, 'pc', 5)]), { ...INGS, 5: EGG_LINKED }, [tray], opts());
    expect(c.cookCentavos).toBe(2400);
    expect(c.buyCentavos).toBe(9600);
  });
});

describe('list', () => {
  const a = recipe([], { slug: 'a', titleEn: 'Adobo', prepMin: 10, cookMin: 40, publishedAt: '2026-11-10' });
  const b = recipe([line(1, '2 cups monggo', 2, 'cup', null)], { slug: 'b', titleEn: 'Ginisang Monggo', category: 'vegetables', mealTypes: ['lunch'], diets: ['vegetarian'], prepMin: 5, cookMin: 5, publishedAt: '2026-11-12' });
  const costs = new Map([['a', 25000]]);
  it('filters by category, diet, time, budget, saved and words in the ingredients', () => {
    const f = (over = {}) => filterRecipes([a, b], { ...NO_RECIPE_FILTERS, ...over }, 'newest', costs, new Set(['b'])).map((r) => r.slug);
    expect(f()).toEqual(['b', 'a']);
    expect(f({ category: 'vegetables' })).toEqual(['b']);
    expect(f({ diet: 'vegetarian' })).toEqual(['b']);
    expect(f({ time: 'under15' })).toEqual(['b']);
    expect(f({ time: '30to60' })).toEqual(['a']);
    expect(f({ budget: 30000 })).toEqual(['a']);
    expect(f({ budget: 15000 })).toEqual([]);
    expect(f({ savedOnly: true })).toEqual(['b']);
    expect(f({ text: 'monggo' })).toEqual(['b']);
  });
  it('sorts cheapest first with unpriced last', () => {
    expect(filterRecipes([b, a], NO_RECIPE_FILTERS, 'cheapest', costs, new Set()).map((r) => r.slug)).toEqual(['a', 'b']);
    expect(filterRecipes([a, b], NO_RECIPE_FILTERS, 'time', costs, new Set()).map((r) => r.slug)).toEqual(['b', 'a']);
  });
});

describe('book and saved copies', () => {
  it('builds recipes from database rows', () => {
    const book = buildBook(
      [
        {
          id: 7, slug: 'chicken-adobo', title_en: 'Chicken Adobo', title_tl: null, summary_en: null, category: 'chicken', meal_types: ['dinner', 'brunch'], diets: null,
          prep_min: 10, cook_min: 40, servings: 4, youtube_id: null, image_path: 'chicken-adobo.webp', steps: [{ en: 'Marinate.' }, 'Simmer.', 3],
          tips_en: null, nutrition: { kcal: 420 }, nutrition_source: 'estimated', sponsor: null, published_at: '2026-11-18',
          recipe_ingredients: [
            { position: 2, grp: null, display_text: '1/2 cup vinegar', qty: '0.5', unit: 'cup', ingredient_id: null, optional: false },
            { position: 1, grp: null, display_text: '1 kg chicken', qty: 1, unit: 'kg', ingredient_id: 2, optional: false },
          ],
        },
        { id: 8, slug: 'lamb', title_en: 'Lamb', title_tl: null, summary_en: null, category: 'lamb', meal_types: [], diets: [], prep_min: 0, cook_min: 0, servings: 2, youtube_id: null, image_path: null, steps: [], tips_en: null, nutrition: null, nutrition_source: null, sponsor: null, published_at: null, recipe_ingredients: [] },
      ],
      [{ id: 2, name_en: 'Chicken thigh', name_tl: null, pricing_basis: 'perkg', unit_kind: 'mass', is_pantry_staple: false, grams_per_cup: null, aliases: ['manok'], ingredient_products: [{ is_default: true, is_sponsored: false, products: { barcode: null, name: 'x' } }, { is_default: false, is_sponsored: false, products: null }] }],
      (p) => `https://img/${p}`,
      '2026-11-18T00:00:00Z',
    );
    expect(book.recipes).toHaveLength(1);
    const r = book.recipes[0];
    expect(r.mealTypes).toEqual(['dinner']);
    expect(r.steps).toEqual([{ en: 'Marinate.' }, { en: 'Simmer.' }]);
    expect(r.lines.map((l) => l.position)).toEqual([1, 2]);
    expect(r.lines[1].qty).toBe(0.5);
    expect(r.image).toBe('https://img/chicken-adobo.webp');
    expect(r.thumb).toBe('https://img/chicken-adobo-thumb.webp');
    expect(book.ingredients[2].products).toHaveLength(1);
  });
  it('keeps a saved recipe even after it leaves the book', () => {
    const r = recipe([line(1, 'x', 3, 'tbsp', 1)]);
    const saved = toggleSaved({ slugs: [], copies: {} }, r, INGS);
    expect(Object.keys(saved.copies[r.slug].ingredients)).toEqual(['1']);
    const merged = withSaved({ recipes: [], ingredients: {}, fetchedAt: '' }, saved);
    expect(merged.recipes.map((x) => x.slug)).toEqual([r.slug]);
    expect(merged.ingredients[1].nameEn).toBe('Soy sauce');
    expect(toggleSaved(saved, r, INGS).slugs).toEqual([]);
  });
});
