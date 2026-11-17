// Recipes (plan: project doc Abaseria_Recipes_Plan.md, migration 021).
//
// Recipes come from the shared database and are kept on the phone, so a saved recipe opens in a mall basement.
// Prices aren't stored with recipes: the phone prices each ingredient line from what the search screen already
// knows (shared latest prices plus this phone's own trips), at the shopper's chosen store when it can.
//
// Two numbers per recipe (Brad, Nov 12: stores sell whole bottles, not 3 tbsp of soy sauce):
//   cost to cook   the share of each pack the recipe uses: 45 mL of a 385 mL ₱28 bottle = ₱3.27
//   cost to buy    the whole packs carried to the counter, minus anything ticked "already have": ₱28
// A cost only shows when enough of the recipe is priced from prices seen in the last 30 days (COVERAGE_NEEDED);
// otherwise the screen says "Price coming soon" so nobody plans a meal around a guess.
//
// Everything above the "Loading" line is pure, so it's tested without a phone (recipes.test.ts).
import { getSetting, setSetting } from './db';
import { dbConfig, getSupabase } from './supabase';
import { comparable, fold, parseSize, type CatalogItem, type PricePoint, type Size, type SizeKind } from './search';

// ---------------------------------------------------------------------------------------------------------
// Lists (same as abaseria.com/recipes, and the checks in migration 021)

export const RECIPE_CATEGORIES = ['chicken', 'pork', 'beef', 'fish', 'seafoods', 'vegetables', 'pasta', 'rice', 'others'] as const;
export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const DIETS = ['keto', 'vegan', 'vegetarian', 'high_protein'] as const;
export type Diet = (typeof DIETS)[number];
/** Cooking time bands, in minutes: [min, max) with null for open-ended. */
export const TIME_BANDS = { any: [0, null], under15: [0, 15], '15to30': [15, 30], '30to60': [30, 60], over60: [60, null] } as const;
export type TimeBand = keyof typeof TIME_BANDS;
/** "Under ₱150 / ₱300 / ₱500 to buy", in centavos. */
export const BUDGETS = [15_000, 30_000, 50_000] as const;
export const RECIPE_SORTS = ['newest', 'time', 'az', 'cheapest'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

/** Only prices seen this recently count toward a recipe cost. */
export const PRICE_MAX_AGE_DAYS = 30;
/** Share of the recipe's priceable lines that must have a price before a cost shows (D3, Nov 16 plan). */
export const COVERAGE_NEEDED = 0.8;

// ---------------------------------------------------------------------------------------------------------
// Shapes

export type RecipeUnit = 'g' | 'kg' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'pc' | 'to_taste';

export interface IngredientProduct {
  barcode: string | null;
  name: string;
  isDefault: boolean;
  isSponsored: boolean;
}

export interface Ingredient {
  id: number;
  nameEn: string;
  nameTl: string | null;
  pricingBasis: 'pack' | 'perkg';
  unitKind: SizeKind;
  isPantryStaple: boolean;
  gramsPerCup: number | null;
  aliases: string[];
  products: IngredientProduct[];
}

export interface RecipeLine {
  position: number;
  group: string | null;
  displayText: string;
  qty: number | null;
  unit: RecipeUnit;
  ingredientId: number | null;
  optional: boolean;
}

export interface Nutrition {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
}

export interface Recipe {
  id: number;
  slug: string;
  titleEn: string;
  titleTl: string | null;
  summaryEn: string | null;
  category: RecipeCategory;
  mealTypes: MealType[];
  diets: Diet[];
  prepMin: number;
  cookMin: number;
  servings: number;
  youtubeId: string | null;
  /** Web address of the full picture, and of the list thumbnail (falls back to the full one). */
  image: string | null;
  thumb: string | null;
  steps: Array<{ en: string; tl?: string }>;
  tipsEn: string | null;
  nutrition: Nutrition | null;
  nutritionSource: 'fnri' | 'estimated' | null;
  sponsor: string | null;
  publishedAt: string | null;
  lines: RecipeLine[];
}

export interface RecipeBook {
  recipes: Recipe[];
  ingredients: Record<number, Ingredient>;
  /** When this copy came from the database (ISO). */
  fetchedAt: string;
}

// ---------------------------------------------------------------------------------------------------------
// Amounts

const VOLUME_ML: Partial<Record<RecipeUnit, number>> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };
const MASS_G: Partial<Record<RecipeUnit, number>> = { g: 1, kg: 1000 };

/**
 * How much of the ingredient a line needs, in the ingredient's own kind (grams, millilitres or pieces), for
 * `factor` times the recipe. Cups of rice become grams through gramsPerCup; otherwise a liquid's millilitres
 * and grams are treated as equal (close enough for soy sauce and vinegar). Null when it can't be priced.
 */
export function lineAmount(line: Pick<RecipeLine, 'qty' | 'unit'>, ing: Pick<Ingredient, 'unitKind' | 'gramsPerCup'>, factor = 1): Size | null {
  if (line.qty == null || line.unit === 'to_taste' || !(factor > 0)) return null;
  const qty = line.qty * factor;
  const ml = VOLUME_ML[line.unit];
  const g = MASS_G[line.unit];
  if (line.unit === 'pc') return ing.unitKind === 'count' ? { kind: 'count', amount: qty } : null;
  if (ing.unitKind === 'count') return null;
  if (ing.unitKind === 'mass') {
    if (g) return { kind: 'mass', amount: qty * g };
    if (ml) return { kind: 'mass', amount: ing.gramsPerCup ? (qty * ml * ing.gramsPerCup) / 240 : qty * ml };
  }
  if (ing.unitKind === 'volume') {
    if (ml) return { kind: 'volume', amount: qty * ml };
    if (g) return { kind: 'volume', amount: qty * g };
  }
  return null;
}

/** "1/2" → 0.5, "1 1/2" → 1.5, 0.333 → "1/3". Amounts shown after changing servings. */
export function formatQty(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const fracs: Array<[number, string]> = [[0, ''], [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'], [1, '']];
  let best = fracs[0];
  for (const f of fracs) if (Math.abs(frac - f[0]) < Math.abs(frac - best[0])) best = f;
  if (Math.abs(frac - best[0]) > 0.04) return String(Math.round(n * 10) / 10);
  const w = best[0] === 1 ? whole + 1 : whole;
  if (!best[1]) return String(w);
  return w ? `${w} ${best[1]}` : best[1];
}

/** The display text with its leading amount rescaled: "1/2 cup toyo" ×2 → "1 cup toyo". Unchanged if it has none. */
export function scaleText(text: string, factor: number): string {
  if (factor === 1) return text;
  const m = text.match(/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?=\s|[a-z])/i);
  if (!m) return text;
  const raw = m[1].trim();
  let n: number;
  if (raw.includes('/')) {
    const parts = raw.split(/\s+/);
    const [a, b] = parts[parts.length - 1].split('/').map(Number);
    n = (parts.length === 2 ? Number(parts[0]) : 0) + a / b;
  } else n = Number(raw);
  if (!(n > 0)) return text;
  return formatQty(n * factor) + text.slice(m[0].length);
}

// ---------------------------------------------------------------------------------------------------------
// Pricing

export type LineStatus = 'priced' | 'noPrice' | 'unmatched' | 'toTaste';

export interface PricedOption {
  productName: string;
  size: string | null;
  storeKey: string;
  storeLabel: string;
  seenOn: string;
  /** The shelf price used: per piece (bundle split evenly) or per kilo. */
  shelfCentavos: number;
  perKg: boolean;
  /** Packs to carry to the counter (0 for per-kilo items). */
  packs: number;
  cookCentavos: number;
  buyCentavos: number;
  sponsored: boolean;
  isDefault: boolean;
  atStore: boolean;
}

export interface LineCost {
  line: RecipeLine;
  ingredient: Ingredient | null;
  status: LineStatus;
  /** Shown text, rescaled for the chosen servings. */
  text: string;
  chosen: PricedOption | null;
  /** A cheaper option than the chosen one when the chosen one is the default or sponsored. */
  cheaper: PricedOption | null;
  /** The shopper ticked "already have" (pantry staples start ticked). Not counted in cost to buy. */
  have: boolean;
}

export interface RecipeCost {
  lines: LineCost[];
  cookCentavos: number;
  buyCentavos: number;
  /** Priced lines ÷ lines that should be priced (not to-taste, not optional, not an unpriced pantry staple). */
  coverage: number;
  /** Coverage is enough to show a cost (D3). */
  show: boolean;
  /** Some prices came from a store other than the chosen one. */
  usesOtherStores: boolean;
}

export interface CostOptions {
  /** The catalog prices file the chosen store under (shared branch id or phone key). Null: any store. */
  storeKey: string | null;
  servings: number;
  /** Ingredient line positions the shopper changed from the default "already have" state. */
  toggled: ReadonlySet<number>;
  /** YYYY-MM-DD. */
  today: string;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Every catalog item that can stand in for this ingredient: linked products, then (per-kilo) phone items by name. */
export function candidatesFor(ing: Ingredient, byKey: Map<string, CatalogItem>, catalog: CatalogItem[]): Array<{ item: CatalogItem; link: IngredientProduct | null }> {
  const out: Array<{ item: CatalogItem; link: IngredientProduct | null }> = [];
  for (const p of ing.products) {
    const item = p.barcode ? byKey.get(p.barcode) : undefined;
    if (item) out.push({ item, link: p });
  }
  // Meat and produce bought by the kilo have no barcode; the phone files them by name.
  const names = [ing.nameEn, ing.nameTl ?? '', ...ing.aliases].map(fold).filter(Boolean);
  if (names.length) {
    for (const item of catalog) {
      if (item.barcode) continue;
      const n = fold(item.name);
      if (names.some((a) => n === a || n.startsWith(`${a} `))) out.push({ item, link: null });
    }
  }
  return out;
}

/** Prices one option. Null when the pack size is unknown or doesn't match what the recipe measures. */
export function priceOption(need: Size, item: CatalogItem, p: PricePoint, link: IngredientProduct | null, storeKey: string | null): PricedOption | null {
  const shelf = comparable(p);
  if (!(shelf > 0)) return null;
  const base = {
    productName: item.name,
    size: item.size,
    storeKey: p.storeKey,
    storeLabel: p.storeLabel,
    seenOn: p.seenOn,
    shelfCentavos: shelf,
    sponsored: link?.isSponsored ?? false,
    isDefault: link?.isDefault ?? false,
    atStore: storeKey != null && p.storeKey === storeKey,
  };
  if (p.priceType === 'perkg') {
    if (need.kind === 'count') return null;
    const c = Math.round((shelf * need.amount) / 1000);
    return { ...base, perKg: true, packs: 0, cookCentavos: c, buyCentavos: c };
  }
  const pack = parseSize(item.size) ?? parseSize(item.name) ?? (need.kind === 'count' ? { kind: 'count' as const, amount: 1 } : null);
  if (!pack || pack.kind !== need.kind || !(pack.amount > 0)) return null;
  const share = need.amount / pack.amount;
  const packs = Math.max(1, Math.ceil(share - 1e-9));
  return { ...base, perKg: false, packs, cookCentavos: Math.round(shelf * share), buyCentavos: packs * shelf };
}

/** Default (or sponsored) product when it has a price; otherwise the cheapest to buy. Chosen store first. */
function pick(options: PricedOption[]): { chosen: PricedOption | null; cheaper: PricedOption | null } {
  if (!options.length) return { chosen: null, cheaper: null };
  const atStore = options.filter((o) => o.atStore);
  const pool = atStore.length ? atStore : options;
  const byBuy = [...pool].sort((a, b) => a.buyCentavos - b.buyCentavos || b.seenOn.localeCompare(a.seenOn));
  const preferred = pool.filter((o) => o.sponsored || o.isDefault).sort((a, b) => Number(b.sponsored) - Number(a.sponsored) || a.buyCentavos - b.buyCentavos)[0];
  const chosen = preferred ?? byBuy[0];
  const cheaper = byBuy[0] !== chosen && byBuy[0].buyCentavos < chosen.buyCentavos ? byBuy[0] : null;
  return { chosen, cheaper };
}

/** Starting "already have" state for a line: pantry staples start ticked. */
export const startsHave = (ing: Ingredient | null) => !!ing?.isPantryStaple;

export function costRecipe(recipe: Recipe, ingredients: Record<number, Ingredient>, catalog: CatalogItem[], opts: CostOptions): RecipeCost {
  const factor = opts.servings / recipe.servings;
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  let cook = 0;
  let buy = 0;
  let needed = 0;
  let priced = 0;
  let otherStores = false;
  const lines: LineCost[] = recipe.lines.map((line) => {
    const ing = line.ingredientId != null ? (ingredients[line.ingredientId] ?? null) : null;
    const have = startsHave(ing) !== opts.toggled.has(line.position);
    const text = scaleText(line.displayText, factor);
    const base = { line, ingredient: ing, text, have, chosen: null, cheaper: null };
    if (line.unit === 'to_taste' || line.qty == null) return { ...base, status: 'toTaste' as const };
    const counts = !line.optional;
    if (!ing) {
      if (counts) needed++;
      return { ...base, status: 'unmatched' as const };
    }
    const need = lineAmount(line, ing, factor);
    const options: PricedOption[] = [];
    if (need) {
      for (const { item, link } of candidatesFor(ing, byKey, catalog)) {
        for (const p of item.prices) {
          const age = daysBetween(p.seenOn, opts.today);
          if (age < 0 || age > PRICE_MAX_AGE_DAYS) continue;
          const o = priceOption(need, item, p, link, opts.storeKey);
          if (o) options.push(o);
        }
      }
    }
    const { chosen, cheaper } = pick(options);
    if (!chosen) {
      // An unpriced pinch of salt shouldn't hold back the whole recipe's cost.
      if (counts && !ing.isPantryStaple) needed++;
      return { ...base, status: 'noPrice' as const };
    }
    if (counts) {
      needed++;
      priced++;
      cook += chosen.cookCentavos;
      if (!have) buy += chosen.buyCentavos;
      if (opts.storeKey && !chosen.atStore) otherStores = true;
    }
    return { ...base, status: 'priced' as const, chosen, cheaper };
  });
  const coverage = needed ? priced / needed : 0;
  return { lines, cookCentavos: cook, buyCentavos: buy, coverage, show: needed > 0 && coverage >= COVERAGE_NEEDED, usesOtherStores: otherStores };
}

// ---------------------------------------------------------------------------------------------------------
// Filtering and sorting the list

export interface RecipeFilters {
  text: string;
  category: RecipeCategory | null;
  meal: MealType | null;
  diet: Diet | null;
  time: TimeBand;
  /** Most it may cost to buy, in centavos. Recipes without a shown cost drop out when set. */
  budget: number | null;
  savedOnly: boolean;
}

export const NO_RECIPE_FILTERS: RecipeFilters = { text: '', category: null, meal: null, diet: null, time: 'any', budget: null, savedOnly: false };

export const totalMinutes = (r: Pick<Recipe, 'prepMin' | 'cookMin'>) => r.prepMin + r.cookMin;

/** `costs` maps slug → cost to buy when a cost can be shown. */
export function filterRecipes(recipes: Recipe[], f: RecipeFilters, sort: RecipeSort, costs: Map<string, number>, saved: ReadonlySet<string>): Recipe[] {
  const words = fold(f.text).split(' ').filter(Boolean);
  const [min, max] = TIME_BANDS[f.time];
  const out = recipes.filter((r) => {
    if (f.category && r.category !== f.category) return false;
    if (f.meal && !r.mealTypes.includes(f.meal)) return false;
    if (f.diet && !r.diets.includes(f.diet)) return false;
    const t = totalMinutes(r);
    if (t < min || (max != null && t >= max)) return false;
    if (f.savedOnly && !saved.has(r.slug)) return false;
    if (f.budget != null) {
      const c = costs.get(r.slug);
      if (c == null || c > f.budget) return false;
    }
    if (words.length) {
      const hay = fold([r.titleEn, r.titleTl ?? '', r.summaryEn ?? '', ...r.lines.map((l) => l.displayText)].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const cmp: Record<RecipeSort, (a: Recipe, b: Recipe) => number> = {
    newest: (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
    time: (a, b) => totalMinutes(a) - totalMinutes(b),
    az: (a, b) => a.titleEn.localeCompare(b.titleEn),
    // Unpriced recipes go last.
    cheapest: (a, b) => (costs.get(a.slug) ?? Infinity) - (costs.get(b.slug) ?? Infinity),
  };
  return out.sort((a, b) => cmp[sort](a, b) || a.titleEn.localeCompare(b.titleEn));
}

// ---------------------------------------------------------------------------------------------------------
// Database rows → shapes

export interface RecipeRow {
  id: number;
  slug: string;
  title_en: string;
  title_tl: string | null;
  summary_en: string | null;
  category: string;
  meal_types: string[] | null;
  diets: string[] | null;
  prep_min: number;
  cook_min: number;
  servings: number;
  youtube_id: string | null;
  image_path: string | null;
  steps: unknown;
  tips_en: string | null;
  nutrition: unknown;
  nutrition_source: string | null;
  sponsor: string | null;
  published_at: string | null;
  recipe_ingredients: Array<{
    position: number;
    grp: string | null;
    display_text: string;
    qty: number | string | null;
    unit: string;
    ingredient_id: number | null;
    optional: boolean;
  }> | null;
}

export interface IngredientRow {
  id: number;
  name_en: string;
  name_tl: string | null;
  pricing_basis: string;
  unit_kind: string;
  is_pantry_staple: boolean;
  grams_per_cup: number | string | null;
  aliases: string[] | null;
  ingredient_products: Array<{ is_default: boolean; is_sponsored: boolean; products: { barcode: string | null; name: string } | null }> | null;
}

const UNITS: RecipeUnit[] = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pc', 'to_taste'];
const only = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** `imageUrl` turns a file name in the recipe-images bucket into a web address. */
export function buildBook(recipes: RecipeRow[], ingredients: IngredientRow[], imageUrl: (path: string) => string, fetchedAt: string): RecipeBook {
  const ings: Record<number, Ingredient> = {};
  for (const r of ingredients) {
    ings[r.id] = {
      id: r.id,
      nameEn: r.name_en,
      nameTl: r.name_tl,
      pricingBasis: r.pricing_basis === 'perkg' ? 'perkg' : 'pack',
      unitKind: r.unit_kind === 'mass' || r.unit_kind === 'volume' ? r.unit_kind : 'count',
      isPantryStaple: r.is_pantry_staple,
      gramsPerCup: r.grams_per_cup == null ? null : Number(r.grams_per_cup),
      aliases: r.aliases ?? [],
      products: (r.ingredient_products ?? [])
        .filter((l) => l.products)
        .map((l) => ({ barcode: l.products!.barcode, name: l.products!.name, isDefault: l.is_default, isSponsored: l.is_sponsored })),
    };
  }
  const list: Recipe[] = recipes
    .filter((r) => only(RECIPE_CATEGORIES, r.category))
    .map((r) => {
      const steps = Array.isArray(r.steps)
        ? (r.steps as unknown[]).flatMap((s) =>
            typeof s === 'string' ? [{ en: s }] : s && typeof (s as { en?: unknown }).en === 'string' ? [s as { en: string; tl?: string }] : [],
          )
        : [];
      const nutrition = r.nutrition && typeof r.nutrition === 'object' && !Array.isArray(r.nutrition) ? (r.nutrition as Nutrition) : null;
      const thumbPath = r.image_path ? r.image_path.replace(/(\.[a-z]+)$/i, '-thumb$1') : null;
      return {
        id: r.id,
        slug: r.slug,
        titleEn: r.title_en,
        titleTl: r.title_tl,
        summaryEn: r.summary_en,
        category: r.category as RecipeCategory,
        mealTypes: (r.meal_types ?? []).filter((m): m is MealType => only(MEAL_TYPES, m)),
        diets: (r.diets ?? []).filter((d): d is Diet => only(DIETS, d)),
        prepMin: r.prep_min,
        cookMin: r.cook_min,
        servings: r.servings,
        youtubeId: r.youtube_id,
        image: r.image_path ? imageUrl(r.image_path) : null,
        // The list uses the -thumb file; if it's missing, the screen falls back to the full picture.
        thumb: thumbPath ? imageUrl(thumbPath) : null,
        steps,
        tipsEn: r.tips_en,
        nutrition,
        nutritionSource: r.nutrition_source === 'fnri' || r.nutrition_source === 'estimated' ? r.nutrition_source : null,
        sponsor: r.sponsor,
        publishedAt: r.published_at,
        lines: (r.recipe_ingredients ?? [])
          .filter((l) => only(UNITS, l.unit))
          .map((l) => ({
            position: l.position,
            group: l.grp,
            displayText: l.display_text,
            qty: l.qty == null ? null : Number(l.qty),
            unit: l.unit as RecipeUnit,
            ingredientId: l.ingredient_id,
            optional: l.optional,
          }))
          .sort((a, b) => a.position - b.position),
      };
    });
  return { recipes: list, ingredients: ings, fetchedAt };
}

// ---------------------------------------------------------------------------------------------------------
// Loading and saving

/** Recipes are on in the dev app; the live app keeps the coming-soon cover until migration 021 is on prod. */
export const RECIPES_ON = dbConfig?.target === 'dev';
export const RECIPE_IMAGE_BUCKET = 'recipe-images';
const BOOK_KEY = 'recipeBook';
const SAVED_KEY = 'savedRecipes';
const LOAD_TIMEOUT_MS = 10_000;

export type BookState = 'ok' | 'cached' | 'offline' | 'error' | 'off';

/**
 * The latest recipes from the database, kept on the phone for next time. When the database can't be reached,
 * the phone's last copy (if any) with the reason. A recipe's text is about 4 KB, so the whole book is small.
 */
export async function loadRecipeBook(): Promise<{ state: BookState; book: RecipeBook | null; error?: string }> {
  const cached = await readCachedBook();
  if (!RECIPES_ON) return { state: 'off', book: null };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { state: cached ? 'cached' : 'offline', book: cached };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOAD_TIMEOUT_MS);
  try {
    const client = await getSupabase();
    if (!client) return { state: 'off', book: null };
    const [recipes, ingredients] = await Promise.all([
      client
        .from('recipes')
        .select(
          'id, slug, title_en, title_tl, summary_en, category, meal_types, diets, prep_min, cook_min, servings, youtube_id, image_path, steps, tips_en, nutrition, nutrition_source, sponsor, published_at, recipe_ingredients(position, grp, display_text, qty, unit, ingredient_id, optional)',
        )
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(500)
        .retry(false)
        .abortSignal(ctrl.signal),
      client
        .from('ingredients')
        .select('id, name_en, name_tl, pricing_basis, unit_kind, is_pantry_staple, grams_per_cup, aliases, ingredient_products(is_default, is_sponsored, products(barcode, name))')
        .limit(5000)
        .retry(false)
        .abortSignal(ctrl.signal),
    ]);
    if (recipes.error) throw new Error(recipes.error.message);
    if (ingredients.error) throw new Error(ingredients.error.message);
    const imageUrl = (path: string) => client.storage.from(RECIPE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    const book = buildBook(recipes.data as unknown as RecipeRow[], ingredients.data as unknown as IngredientRow[], imageUrl, new Date().toISOString());
    await setSetting(BOOK_KEY, JSON.stringify(book));
    return { state: 'ok', book };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const error = ctrl.signal.aborted ? 'it took too long' : /failed to fetch|network/i.test(msg) ? 'no connection' : msg;
    return { state: cached ? 'cached' : 'error', book: cached, error };
  } finally {
    clearTimeout(timer);
  }
}

async function readCachedBook(): Promise<RecipeBook | null> {
  try {
    const raw = await getSetting(BOOK_KEY);
    const book = raw ? (JSON.parse(raw) as RecipeBook) : null;
    return book && Array.isArray(book.recipes) ? book : null;
  } catch {
    return null;
  }
}

/**
 * Saved recipes keep their own copy (recipe plus its ingredients), so one that's later edited or taken down
 * still opens on the phone exactly as it was saved.
 */
export interface SavedRecipes {
  slugs: string[];
  copies: Record<string, { recipe: Recipe; ingredients: Record<number, Ingredient> }>;
}

export async function readSaved(): Promise<SavedRecipes> {
  try {
    const raw = await getSetting(SAVED_KEY);
    const v = raw ? (JSON.parse(raw) as SavedRecipes) : null;
    if (v && Array.isArray(v.slugs) && v.copies) return v;
  } catch {
    // fall through
  }
  return { slugs: [], copies: {} };
}

export function toggleSaved(saved: SavedRecipes, recipe: Recipe, ingredients: Record<number, Ingredient>): SavedRecipes {
  if (saved.slugs.includes(recipe.slug)) {
    const copies = { ...saved.copies };
    delete copies[recipe.slug];
    return { slugs: saved.slugs.filter((s) => s !== recipe.slug), copies };
  }
  const used: Record<number, Ingredient> = {};
  for (const l of recipe.lines) if (l.ingredientId != null && ingredients[l.ingredientId]) used[l.ingredientId] = ingredients[l.ingredientId];
  return { slugs: [recipe.slug, ...saved.slugs], copies: { ...saved.copies, [recipe.slug]: { recipe, ingredients: used } } };
}

export async function writeSaved(saved: SavedRecipes): Promise<void> {
  await setSetting(SAVED_KEY, JSON.stringify(saved));
}

/** The book plus any saved recipe that's no longer in it, so saved ones always show. */
export function withSaved(book: RecipeBook | null, saved: SavedRecipes): RecipeBook {
  const recipes = [...(book?.recipes ?? [])];
  const ingredients = { ...(book?.ingredients ?? {}) };
  const have = new Set(recipes.map((r) => r.slug));
  for (const slug of saved.slugs) {
    const c = saved.copies[slug];
    if (!c || have.has(slug)) continue;
    recipes.push(c.recipe);
    for (const [id, ing] of Object.entries(c.ingredients)) ingredients[Number(id)] ??= ing;
  }
  return { recipes, ingredients, fetchedAt: book?.fetchedAt ?? '' };
}
