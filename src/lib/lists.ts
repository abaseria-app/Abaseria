// Shopping lists (Nov 20, 2026). Plan: project doc Abaseria_Shopping_List_Plan.md, steps L1, L2 and L9.
//
// Decided Nov 18: lists stay on this phone only (D1); several named lists, one of them Current (D2);
// each line is Kailangan (must have) or Kung may sobra (if there's extra) (D4); lines are ticked by hand.
// Not in this build: estimates (L4), ticking by scanning on a trip (L5), share and paste (L6).
// Nov 22: any product search result can go straight onto the Current list (addToCurrent).
//
// A recipe's ingredients land on the Current list (L9). The same product or name already on the list and not yet
// ticked gets the amounts added together, so adobo and ginisang corned beef make one garlic line, not two.

import { db, newUuid } from './db';
import { CATEGORY_IDS, guessCategory, type CategoryId } from './categories';
import { lineAmount, type LineCost, type Recipe } from './recipes';
import type { CatalogItem } from './search';

export type Priority = 'must' | 'extra';
export type ListSource = 'typed' | 'search' | 'recipe';

export interface ShoppingList {
  id?: number;
  uuid: string;
  name: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListItem {
  id?: number;
  listId: number;
  /** Order lines were added in; the screen groups by category first. */
  position: number;
  label: string;
  barcode: string | null;
  category: CategoryId;
  /** Packs or pieces. 1 for weighed lines. */
  quantity: number;
  /** Weighed lines only (meat, produce): grams to buy. */
  weightGrams: number | null;
  priority: Priority;
  /** Where the line came from, e.g. "Chicken Adobo: 1/2 cup soy sauce (toyo)". */
  note: string | null;
  source: ListSource;
  checkedAt: string | null;
  createdAt: string;
}

/** What's needed to add a line; the rest is filled in. */
export interface NewLine {
  label: string;
  barcode?: string | null;
  category?: CategoryId | null;
  quantity?: number;
  weightGrams?: number | null;
  priority?: Priority;
  note?: string | null;
  source: ListSource;
}

export const DEFAULT_LIST_NAME = 'Shopping list';
export const MAX_NAME = 40;
export const MAX_LABEL = 80;
export const MAX_QUANTITY = 99;

const now = () => new Date().toISOString();
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Same product (barcode) or, without one, same name. */
export const lineKey = (l: { barcode?: string | null; label: string }) => (l.barcode ? `b:${l.barcode}` : `n:${l.label.toLowerCase()}`);

// ---------------------------------------------------------------------------------------------------------
// Lists

export async function allLists(): Promise<ShoppingList[]> {
  const lists = await db.shoppingLists.toArray();
  return lists.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function currentList(): Promise<ShoppingList | null> {
  const lists = await db.shoppingLists.toArray();
  return lists.find((l) => l.isCurrent) ?? null;
}

/** A new list. The first list on the phone is always Current. */
export async function createList(name: string, makeCurrent = true): Promise<ShoppingList> {
  const n = clean(name, MAX_NAME) || DEFAULT_LIST_NAME;
  return db.transaction('rw', db.shoppingLists, async () => {
    const lists = await db.shoppingLists.toArray();
    const current = makeCurrent || !lists.length;
    if (current) for (const l of lists) if (l.isCurrent) await db.shoppingLists.update(l.id!, { isCurrent: false });
    const list: ShoppingList = { uuid: newUuid(), name: n, isCurrent: current, createdAt: now(), updatedAt: now() };
    list.id = await db.shoppingLists.add(list);
    return list;
  });
}

/** The Current list, made ("Shopping list") if the phone has none. */
export async function ensureCurrentList(): Promise<ShoppingList> {
  return (await currentList()) ?? (await createList(DEFAULT_LIST_NAME));
}

export async function renameList(id: number, name: string): Promise<void> {
  const n = clean(name, MAX_NAME);
  if (n) await db.shoppingLists.update(id, { name: n, updatedAt: now() });
}

export async function setCurrent(id: number): Promise<void> {
  await db.transaction('rw', db.shoppingLists, async () => {
    for (const l of await db.shoppingLists.toArray()) {
      if (l.isCurrent !== (l.id === id)) await db.shoppingLists.update(l.id!, { isCurrent: l.id === id });
    }
  });
}

/** Deletes a list and its lines. If it was Current, the most recently changed other list becomes Current. */
export async function deleteList(id: number): Promise<void> {
  await db.transaction('rw', db.shoppingLists, db.listItems, async () => {
    const list = await db.shoppingLists.get(id);
    await db.listItems.where('listId').equals(id).delete();
    await db.shoppingLists.delete(id);
    if (list?.isCurrent) {
      const next = (await db.shoppingLists.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (next) await db.shoppingLists.update(next.id!, { isCurrent: true });
    }
  });
}

const touch = (listId: number) => db.shoppingLists.update(listId, { updatedAt: now() });

// ---------------------------------------------------------------------------------------------------------
// Lines

/** A list's lines: unticked first, then in category (aisle) order, then in the order they were added. */
export async function listLines(listId: number): Promise<ListItem[]> {
  return sortLines(await db.listItems.where('listId').equals(listId).toArray());
}

export function sortLines(lines: ListItem[]): ListItem[] {
  const order = (c: CategoryId) => {
    const i = (CATEGORY_IDS as readonly string[]).indexOf(c);
    return i < 0 ? CATEGORY_IDS.length : i;
  };
  return [...lines].sort(
    (a, b) => Number(!!a.checkedAt) - Number(!!b.checkedAt) || order(a.category) - order(b.category) || a.position - b.position,
  );
}

function merged(into: ListItem, add: ListItem): Partial<ListItem> {
  const notes = [into.note, add.note].filter(Boolean) as string[];
  const note = [...new Set(notes)].join('; ') || null;
  const weighed = into.weightGrams != null && add.weightGrams != null;
  return {
    quantity: weighed ? 1 : Math.min(MAX_QUANTITY, into.quantity + add.quantity),
    weightGrams: weighed ? into.weightGrams! + add.weightGrams! : into.weightGrams,
    priority: into.priority === 'must' || add.priority === 'must' ? 'must' : 'extra',
    note,
  };
}

function toItem(listId: number, n: NewLine, position: number): ListItem | null {
  const label = clean(n.label, MAX_LABEL);
  if (!label) return null;
  const weight = n.weightGrams != null && n.weightGrams > 0 ? Math.round(n.weightGrams) : null;
  return {
    listId,
    position,
    label,
    barcode: n.barcode ?? null,
    category: n.category ?? guessCategory(label),
    quantity: weight ? 1 : Math.max(1, Math.min(MAX_QUANTITY, Math.round(n.quantity ?? 1))),
    weightGrams: weight,
    priority: n.priority ?? 'must',
    note: n.note ? clean(n.note, 200) : null,
    source: n.source,
    checkedAt: null,
    createdAt: now(),
  };
}

/**
 * Adds lines to a list. A line matching one already there and not ticked is merged into it (amounts added).
 * Returns how many lines are new and how many were merged.
 */
export async function addLines(listId: number, lines: NewLine[]): Promise<{ added: number; merged: number }> {
  return db.transaction('rw', db.shoppingLists, db.listItems, async () => {
    const existing = await db.listItems.where('listId').equals(listId).toArray();
    const open = new Map(existing.filter((l) => !l.checkedAt).map((l) => [lineKey(l), l]));
    let position = existing.reduce((m, l) => Math.max(m, l.position), 0);
    let added = 0;
    let mergedCount = 0;
    for (const n of lines) {
      const item = toItem(listId, n, ++position);
      if (!item) continue;
      const same = open.get(lineKey(item));
      if (same) {
        const changes = merged(same, item);
        await db.listItems.update(same.id!, changes);
        Object.assign(same, changes);
        mergedCount++;
      } else {
        item.id = await db.listItems.add(item);
        open.set(lineKey(item), item);
        added++;
      }
    }
    if (added || mergedCount) await touch(listId);
    return { added, merged: mergedCount };
  });
}

export async function updateLine(id: number, changes: Partial<Pick<ListItem, 'quantity' | 'weightGrams' | 'priority' | 'label'>>): Promise<void> {
  const c = { ...changes };
  if (c.quantity != null) c.quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.round(c.quantity)));
  if (c.label != null) {
    c.label = clean(c.label, MAX_LABEL);
    if (!c.label) delete c.label;
  }
  await db.listItems.update(id, c);
}

export async function toggleLine(id: number): Promise<void> {
  const line = await db.listItems.get(id);
  if (line) await db.listItems.update(id, { checkedAt: line.checkedAt ? null : now() });
}

export async function removeLine(id: number): Promise<void> {
  await db.listItems.delete(id);
}

/** Removes every ticked line (after the trip). */
export async function clearTicked(listId: number): Promise<number> {
  const ticked = (await db.listItems.where('listId').equals(listId).toArray()).filter((l) => l.checkedAt);
  await db.listItems.bulkDelete(ticked.map((l) => l.id!));
  return ticked.length;
}

// ---------------------------------------------------------------------------------------------------------
// From product search (Nov 22, 2026)

/** A search result as a list line: name with its size ("Datu Puti Soy Sauce 385ml"), barcode and category. */
export function catalogLine(item: Pick<CatalogItem, 'name' | 'size' | 'barcode' | 'category'>): NewLine {
  const label = item.size && !item.name.includes(item.size) ? `${item.name} ${item.size}` : item.name;
  return { label, barcode: item.barcode, category: item.category, source: 'search' };
}

/** Packs of each product or name on a list that aren't ticked yet, by lineKey. Weighed lines count as 1. */
export async function openQuantities(listId: number): Promise<Map<string, number>> {
  const lines = (await db.listItems.where('listId').equals(listId).toArray()).filter((l) => !l.checkedAt);
  return new Map(lines.map((l) => [lineKey(l), l.quantity]));
}

export interface AddedToList {
  list: ShoppingList;
  /** True when the product was already on the list (one more pack was added to that line). */
  merged: boolean;
  /** Packs on that line now. */
  quantity: number;
  /** Puts the list back the way it was before this add. */
  undo: () => Promise<void>;
}

/**
 * Adds one line to the Current list (made as "Shopping list" if the phone has none). Adding a product that's
 * already there and not ticked adds one more pack to that line instead of a second line.
 */
export async function addToCurrent(n: NewLine): Promise<AddedToList | null> {
  const list = await ensureCurrentList();
  const probe = toItem(list.id!, n, 0);
  if (!probe) return null;
  const before = (await db.listItems.where('listId').equals(list.id!).toArray()).find((l) => !l.checkedAt && lineKey(l) === lineKey(probe));
  const snapshot = before ? { quantity: before.quantity, weightGrams: before.weightGrams, priority: before.priority, note: before.note } : null;
  await addLines(list.id!, [n]);
  const after = (await db.listItems.where('listId').equals(list.id!).toArray()).find((l) => !l.checkedAt && lineKey(l) === lineKey(probe));
  if (!after) return null;
  return {
    list,
    merged: !!before,
    quantity: after.quantity,
    undo: async () => {
      if (snapshot) await db.listItems.update(after.id!, snapshot);
      else await db.listItems.delete(after.id!);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// From a recipe (L9)

/**
 * The lines a recipe puts on the list, from its costed lines (so amounts follow the servings chosen).
 * Skipped: lines ticked "already have" and to-taste lines. Optional lines come in as Kung may sobra.
 *   - priced by the pack: that product and the number of packs ("Datu Puti Soy Sauce 385ml", 1)
 *   - priced by the kilo, or a weighed ingredient: the ingredient's name and the grams the recipe needs
 *   - no price yet: the ingredient's default product if it has one, otherwise the ingredient's name
 *   - not matched to an ingredient (bay leaves): the line as written
 * Every line's note says which recipe it's for and the recipe's amount.
 */
export function recipeLines(recipe: Pick<Recipe, 'titleEn' | 'servings'>, lines: LineCost[], servings: number): NewLine[] {
  const factor = servings / recipe.servings;
  const out: NewLine[] = [];
  for (const l of lines) {
    if (l.have || l.status === 'toTaste') continue;
    const note = `${recipe.titleEn}: ${l.text}`;
    const priority: Priority = l.line.optional ? 'extra' : 'must';
    const ing = l.ingredient;
    const c = l.chosen;
    if (!ing) {
      out.push({ label: l.text, note, priority, source: 'recipe' });
      continue;
    }
    const name = ing.nameTl ? `${ing.nameEn} (${ing.nameTl.toLowerCase()})` : ing.nameEn;
    const need = lineAmount(l.line, ing, factor);
    if ((c && c.perKg) || (!c && ing.pricingBasis === 'perkg')) {
      out.push({
        label: name,
        category: c?.category ?? null,
        weightGrams: need?.kind === 'mass' ? need.amount : null,
        note,
        priority,
        source: 'recipe',
      });
    } else if (c) {
      const label = c.size && !c.productName.includes(c.size) ? `${c.productName} ${c.size}` : c.productName;
      out.push({ label, barcode: c.barcode, category: c.category, quantity: c.packs || 1, note, priority, source: 'recipe' });
    } else {
      const def = ing.products.find((p) => p.isDefault);
      out.push(def ? { label: def.name, barcode: def.barcode, note, priority, source: 'recipe' } : { label: name, note, priority, source: 'recipe' });
    }
  }
  return out;
}

/** "1 kg", "350 g", "1.5 kg". */
export function formatGrams(g: number): string {
  if (g >= 1000) return `${Math.round(g / 100) / 10} kg`;
  return `${Math.round(g)} g`;
}
