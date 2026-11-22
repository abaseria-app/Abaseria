import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addLines, addToCurrent, allLists, catalogLine, clearTicked, createList, currentList, deleteList, ensureCurrentList, formatGrams, listLines,
  openQuantities,
  recipeLines, renameList, setCurrent, toggleLine, updateLine,
} from './lists';
import { costRecipe, type Ingredient, type Recipe, type RecipeLine } from './recipes';
import type { CatalogItem } from './search';

beforeEach(async () => {
  await Promise.all([db.shoppingLists.clear(), db.listItems.clear()]);
});

describe('lists', () => {
  it('keeps exactly one Current list', async () => {
    const a = await createList('Lingguhan');
    expect(a.isCurrent).toBe(true);
    const b = await createList('Noche Buena', false);
    expect(b.isCurrent).toBe(false);
    const c = await createList('Sweldo stock-up');
    expect((await allLists()).filter((l) => l.isCurrent).map((l) => l.name)).toEqual(['Sweldo stock-up']);
    await setCurrent(b.id!);
    expect((await currentList())?.id).toBe(b.id);
    expect((await allLists()).filter((l) => l.isCurrent)).toHaveLength(1);
    expect(c.id).toBeGreaterThan(0);
  });

  it('makes the first list Current even when asked not to', async () => {
    expect((await createList('Only', false)).isCurrent).toBe(true);
  });

  it('makes a default list when there is none', async () => {
    const l = await ensureCurrentList();
    expect(l.name).toBe('Shopping list');
    expect((await ensureCurrentList()).id).toBe(l.id);
  });

  it('hands Current on and deletes the lines when the Current list is deleted', async () => {
    const a = await createList('A');
    const b = await createList('B');
    await addLines(b.id!, [{ label: 'bigas', source: 'typed' }]);
    await deleteList(b.id!);
    expect((await currentList())?.id).toBe(a.id);
    expect(await db.listItems.count()).toBe(0);
  });

  it('trims names and ignores a blank rename', async () => {
    const l = await createList('   Lingguhan    ngayon  ');
    expect(l.name).toBe('Lingguhan ngayon');
    await renameList(l.id!, '   ');
    expect((await db.shoppingLists.get(l.id!))?.name).toBe('Lingguhan ngayon');
    expect((await createList('')).name).toBe('Shopping list');
  });
});

describe('lines', () => {
  it('adds typed lines with a guessed category and merges repeats', async () => {
    const l = await createList('L');
    expect(await addLines(l.id!, [{ label: '  itlog ', source: 'typed' }, { label: '', source: 'typed' }])).toEqual({ added: 1, merged: 0 });
    expect(await addLines(l.id!, [{ label: 'Itlog', source: 'typed' }])).toEqual({ added: 0, merged: 1 });
    const lines = await listLines(l.id!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label: 'itlog', quantity: 2, priority: 'must', checkedAt: null });
  });

  it('merges by barcode, adds weights, keeps both notes, and must-have wins', async () => {
    const l = await createList('L');
    await addLines(l.id!, [
      { label: 'Datu Puti Soy Sauce', barcode: '4801668400159', quantity: 1, note: 'Adobo', priority: 'extra', source: 'recipe' },
      { label: 'Garlic (bawang)', weightGrams: 40, note: 'Adobo', source: 'recipe' },
    ]);
    await addLines(l.id!, [
      { label: 'Datu Puti Soy Sauce 1L', barcode: '4801668400159', quantity: 2, note: 'Pancit', priority: 'must', source: 'recipe' },
      { label: 'garlic (bawang)', weightGrams: 15, note: 'Corned beef', source: 'recipe' },
    ]);
    const lines = await listLines(l.id!);
    expect(lines).toHaveLength(2);
    const soy = lines.find((x) => x.barcode)!;
    expect(soy).toMatchObject({ quantity: 3, priority: 'must', note: 'Adobo; Pancit' });
    expect(lines.find((x) => !x.barcode)).toMatchObject({ weightGrams: 55, quantity: 1, note: 'Adobo; Corned beef' });
  });

  it('never merges into a ticked line', async () => {
    const l = await createList('L');
    await addLines(l.id!, [{ label: 'bigas', source: 'typed' }]);
    const [first] = await listLines(l.id!);
    await toggleLine(first.id!);
    await addLines(l.id!, [{ label: 'bigas', source: 'typed' }]);
    expect(await listLines(l.id!)).toHaveLength(2);
  });

  it('sorts unticked first, then by aisle, then by when added', async () => {
    const l = await createList('L');
    await addLines(l.id!, [
      { label: 'Shampoo', category: 'personal care & hygiene', source: 'typed' },
      { label: 'Sardines', category: 'canned & preserved food', source: 'typed' },
      { label: 'Rice', category: 'pantry staples', source: 'typed' },
      { label: 'Corned beef', category: 'canned & preserved food', source: 'typed' },
    ]);
    const rice = (await listLines(l.id!)).find((x) => x.label === 'Rice')!;
    await toggleLine(rice.id!);
    expect((await listLines(l.id!)).map((x) => x.label)).toEqual(['Sardines', 'Corned beef', 'Shampoo', 'Rice']);
  });

  it('keeps quantities between 1 and 99 and clears ticked lines', async () => {
    const l = await createList('L');
    await addLines(l.id!, [{ label: 'a', source: 'typed' }, { label: 'b', source: 'typed' }]);
    const [a, b] = await listLines(l.id!);
    await updateLine(a.id!, { quantity: 0 });
    await updateLine(b.id!, { quantity: 500 });
    expect((await db.listItems.get(a.id!))?.quantity).toBe(1);
    expect((await db.listItems.get(b.id!))?.quantity).toBe(99);
    await toggleLine(a.id!);
    expect(await clearTicked(l.id!)).toBe(1);
    expect((await listLines(l.id!)).map((x) => x.label)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------------------------------------
// From a recipe

const ing = (id: number, over: Partial<Ingredient>): Ingredient => ({
  id, nameEn: `Ingredient ${id}`, nameTl: null, pricingBasis: 'pack', unitKind: 'volume', isPantryStaple: false, gramsPerCup: null, aliases: [], products: [], ...over,
});
const line = (position: number, displayText: string, qty: number | null, unit: RecipeLine['unit'], ingredientId: number | null, optional = false): RecipeLine => ({
  position, group: null, displayText, qty, unit, ingredientId, optional,
});
const SOY = ing(1, { nameEn: 'Soy sauce', nameTl: 'Toyo', products: [{ barcode: '4801668400159', name: 'Datu Puti Soy Sauce', isDefault: true, isSponsored: false }] });
const CHICKEN = ing(2, { nameEn: 'Chicken thigh', nameTl: 'Hita ng manok', pricingBasis: 'perkg', unitKind: 'mass', aliases: ['manok'] });
const OIL = ing(3, { nameEn: 'Cooking oil', isPantryStaple: true });
const VINEGAR = ing(4, { nameEn: 'Vinegar', nameTl: 'Suka' });
const INGS = { 1: SOY, 2: CHICKEN, 3: OIL, 4: VINEGAR };
const ADOBO: Recipe = {
  id: 1, slug: 'chicken-adobo', titleEn: 'Chicken Adobo', titleTl: null, summaryEn: null, category: 'chicken', mealTypes: [], diets: [],
  prepMin: 10, cookMin: 40, servings: 4, youtubeId: null, image: null, thumb: null, steps: [], tipsEn: null, nutrition: null,
  nutritionSource: null, sponsor: null, publishedAt: '2026-11-20T00:00:00Z',
  lines: [
    line(1, '1 kg chicken thighs', 1, 'kg', 2),
    line(2, '1/2 cup soy sauce (toyo)', 0.5, 'cup', 1),
    line(3, '1/3 cup vinegar (suka)', 0.333, 'cup', 4),
    line(4, '3 bay leaves (laurel)', 3, 'pc', null),
    line(5, '2 tbsp cooking oil', 2, 'tbsp', 3),
    line(6, 'Black pepper to taste', null, 'to_taste', null),
    line(7, '1 chili (siling haba)', 1, 'pc', null, true),
  ],
};
const soyBottle: CatalogItem = {
  key: '4801668400159', barcode: '4801668400159', name: 'Datu Puti Soy Sauce', size: '385ml', category: 'cooking essentials & condiments', image: null,
  prices: [{ storeKey: 'rob', storeLabel: 'Robinsons Imus', seenOn: '2026-11-18', priceType: 'each', unitPriceCentavos: 2800, bundleQty: null, bundlePriceCentavos: null, isPromo: false, source: 'shared' }],
};
const cost = (servings = 4, toggled = new Set<number>()) =>
  costRecipe(ADOBO, INGS, [soyBottle], { storeKey: 'rob', servings, toggled, today: '2026-11-20' });

describe('recipeLines', () => {
  it('turns a recipe into list lines', () => {
    const out = recipeLines(ADOBO, cost().lines, 4);
    expect(out.map((o) => o.label)).toEqual([
      'Chicken thigh (hita ng manok)', // weighed: name and grams
      'Datu Puti Soy Sauce 385ml', // priced pack: the product and its size
      'Vinegar (suka)', // no price, no default product: the ingredient
      '3 bay leaves (laurel)', // not matched: as written
      '1 chili (siling haba)', // optional: comes in as extra
    ]);
    expect(out[0]).toMatchObject({ weightGrams: 1000, note: 'Chicken Adobo: 1 kg chicken thighs', priority: 'must', source: 'recipe' });
    expect(out[1]).toMatchObject({ barcode: '4801668400159', quantity: 1, category: 'cooking essentials & condiments' });
    expect(out[4].priority).toBe('extra');
  });

  it('leaves off "already have" and to-taste lines (oil starts ticked as a pantry staple)', () => {
    const labels = recipeLines(ADOBO, cost().lines, 4).map((o) => o.label);
    expect(labels.some((l) => /oil|pepper/i.test(l))).toBe(false);
    // Unticking oil brings it back; ticking soy sauce leaves it off.
    const changed = recipeLines(ADOBO, cost(4, new Set([5, 2])).lines, 4).map((o) => o.label);
    expect(changed).toContain('Cooking oil');
    expect(changed).not.toContain('Datu Puti Soy Sauce 385ml');
  });

  it('follows the servings chosen', () => {
    const out = recipeLines(ADOBO, cost(8).lines, 8);
    expect(out[0].weightGrams).toBe(2000);
    expect(out[0].note).toBe('Chicken Adobo: 2 kg chicken thighs');
  });

  it('uses the default product when the ingredient has no price yet', () => {
    const noPrice = costRecipe(ADOBO, INGS, [], { storeKey: null, servings: 4, toggled: new Set(), today: '2026-11-20' });
    const soy = recipeLines(ADOBO, noPrice.lines, 4)[1];
    expect(soy).toMatchObject({ label: 'Datu Puti Soy Sauce', barcode: '4801668400159' });
  });

  it('adding the same recipe twice doubles the amounts instead of repeating lines', async () => {
    const l = await createList('L');
    await addLines(l.id!, recipeLines(ADOBO, cost().lines, 4));
    const second = await addLines(l.id!, recipeLines(ADOBO, cost().lines, 4));
    expect(second).toEqual({ added: 0, merged: 5 });
    const lines = await listLines(l.id!);
    expect(lines).toHaveLength(5);
    expect(lines.find((x) => x.weightGrams)?.weightGrams).toBe(2000);
    expect(lines.find((x) => x.barcode)?.quantity).toBe(2);
  });
});

it('formats grams for the list', () => {
  expect(formatGrams(40)).toBe('40 g');
  expect(formatGrams(1000)).toBe('1 kg');
  expect(formatGrams(1550)).toBe('1.6 kg');
});

describe('adding from product search', () => {
  const soy = { name: 'Datu Puti Soy Sauce', size: '385ml', barcode: '4801668100219', category: 'cooking essentials & condiments' as const };

  it('names the line with its size, once', () => {
    expect(catalogLine(soy).label).toBe('Datu Puti Soy Sauce 385ml');
    expect(catalogLine({ ...soy, name: 'Datu Puti Soy Sauce 385ml' }).label).toBe('Datu Puti Soy Sauce 385ml');
    expect(catalogLine({ ...soy, size: null }).label).toBe('Datu Puti Soy Sauce');
  });

  it('makes a Current list when there is none and adds to it', async () => {
    const r = await addToCurrent(catalogLine(soy));
    expect(r?.list.name).toBe('Shopping list');
    expect(r?.merged).toBe(false);
    const lines = await listLines(r!.list.id!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ barcode: soy.barcode, quantity: 1, source: 'search', category: 'cooking essentials & condiments' });
  });

  it('adds to the Current list, not another one', async () => {
    const a = await createList('Lingguhan');
    await createList('Noche Buena', false);
    const r = await addToCurrent(catalogLine(soy));
    expect(r?.list.id).toBe(a.id);
  });

  it('adds one more pack instead of a second line, and counts open packs', async () => {
    const a = await createList('Lingguhan');
    await addToCurrent(catalogLine(soy));
    const r = await addToCurrent(catalogLine(soy));
    expect(r).toMatchObject({ merged: true, quantity: 2 });
    expect(await listLines(a.id!)).toHaveLength(1);
    expect((await openQuantities(a.id!)).get(`b:${soy.barcode}`)).toBe(2);
  });

  it('starts a new line when the one on the list is already ticked', async () => {
    const a = await createList('Lingguhan');
    const first = await addToCurrent(catalogLine(soy));
    const line = (await listLines(a.id!))[0];
    await toggleLine(line.id!);
    expect((await openQuantities(a.id!)).has(`b:${soy.barcode}`)).toBe(false);
    const again = await addToCurrent(catalogLine(soy));
    expect(again?.merged).toBe(false);
    expect(await listLines(a.id!)).toHaveLength(2);
    expect(first?.list.id).toBe(a.id);
  });

  it('undo removes a new line and puts a merged line back to its old amount', async () => {
    const a = await createList('Lingguhan');
    const first = await addToCurrent(catalogLine(soy));
    const second = await addToCurrent(catalogLine(soy));
    await second!.undo();
    expect((await listLines(a.id!))[0].quantity).toBe(1);
    await first!.undo();
    expect(await listLines(a.id!)).toHaveLength(0);
  });
});
