// The list of items the search screen looks through.
//
// Two sources, merged by barcode:
//   this phone      every item logged on a trip that wasn't cancelled; the latest price at each store
//   shared database products (name, size, category, image) and the latest price per store from everyone
//                   (dev app only for now, same switch as price sharing; skipped offline)
// The same barcode is the same product at every store, so one row per barcode. Items without a barcode
// (loose produce, meat by the kilo) are grouped by name and only ever come from this phone.
import type { Branch, Item, Trip } from './db';
import { db, storeName } from './db';
import { categoryOf, toCategory, type CategoryId } from './categories';
import { dbConfig, getSupabase } from './supabase';
import { IMAGE_BUCKET, SHARING_ON, isPlaceholderName, localDay } from './sync';
import { comparable, type CatalogItem, type PricePoint } from './search';

/** Shared lookups give up after this long and the screen keeps showing this phone's items. */
export const CATALOG_TIMEOUT_MS = 10_000;
/** Rows per request, and the most the screen will pull. Past this, search should move into the database. */
const PAGE = 1000;
export const MAX_SHARED_ROWS = 20_000;

/** The key a trip's prices are filed under: the store's shared id when known, otherwise a phone-only key. */
export function storeKeyOf(trip: Pick<Trip, 'chain' | 'customStore' | 'branchUuid'>, branch: Branch | undefined): string {
  return branch ? (branch.remoteId ?? branch.uuid) : `store:${storeName(trip).toLowerCase()}`;
}

const nameKey = (label: string) => `name:${label.trim().toLowerCase().replace(/\s+/g, ' ')}`;

// ---------------------------------------------------------------------------------------------------------
// Pure builders (tested in catalog.test.ts)

/** One catalog row per barcode (or per name when there's no barcode), with the latest price at each store. */
export function buildPhoneCatalog(items: Item[], trips: Trip[], branches: Branch[]): CatalogItem[] {
  const tripById = new Map(trips.filter((t) => !t.cancelledAt).map((t) => [t.id!, t]));
  const branchByUuid = new Map(branches.map((b) => [b.uuid, b]));
  const groups = new Map<string, { item: CatalogItem; seen: Map<string, string> }>();

  const sorted = items
    .filter((i) => !i.removed && tripById.has(i.tripId) && i.unitPriceCentavos >= 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const it of sorted) {
    const placeholder = isPlaceholderName(it.label);
    // An unnamed item without a barcode can't be found by anything.
    if (placeholder && !it.barcode) continue;
    const key = it.barcode ? it.barcode : nameKey(it.label);
    let g = groups.get(key);
    if (!g) {
      g = {
        item: { key, barcode: it.barcode ?? null, name: placeholder ? '' : it.label.trim(), size: it.size ?? null, category: categoryOf(it), image: it.thumb ?? null, prices: [] },
        seen: new Map(),
      };
      groups.set(key, g);
    }
    // Rows are newest first, so the first real name, picture and price per store are the latest ones.
    if (!g.item.name && !placeholder) {
      g.item.name = it.label.trim();
      g.item.category = categoryOf(it);
    }
    if (!g.item.image && it.thumb) g.item.image = it.thumb;
    if (!g.item.size && it.size) g.item.size = it.size;

    const trip = tripById.get(it.tripId)!;
    const branch = trip.branchUuid ? branchByUuid.get(trip.branchUuid) : undefined;
    const storeKey = storeKeyOf(trip, branch);
    if (g.seen.has(storeKey)) continue;
    g.seen.set(storeKey, it.createdAt);
    g.item.prices.push({
      storeKey,
      storeLabel: storeName(trip),
      seenOn: localDay(it.createdAt),
      priceType: it.priceType,
      unitPriceCentavos: it.unitPriceCentavos,
      bundleQty: it.bundleQty,
      bundlePriceCentavos: it.bundlePriceCentavos,
      isPromo: it.isPromo,
      regularPriceCentavos: it.isPromo ? (it.regularPriceCentavos ?? null) : null,
      promoNote: it.isPromo ? (it.promoNote ?? null) : null,
      source: 'phone',
    });
  }
  return [...groups.values()].map((g) => g.item);
}

export interface ProductRow {
  barcode: string;
  name: string;
  size: string | null;
  category: string | null;
  image_path: string | null;
}
export interface LatestPriceRow {
  barcode: string;
  branch_id: string;
  seen_on: string;
  price_type: PricePoint['priceType'];
  unit_price_centavos: number;
  bundle_qty: number | null;
  bundle_price_centavos: number | null;
  is_promo: boolean;
  /** Present once migration 022 is in the project. */
  regular_price_centavos?: number | null;
  promo_note?: string | null;
}
/** Columns read from latest_prices. */
export const LATEST_PRICE_COLS =
  'barcode, branch_id, seen_on, price_type, unit_price_centavos, bundle_qty, bundle_price_centavos, is_promo, regular_price_centavos, promo_note';

export interface BranchRow {
  id: string;
  chain: string;
  name: string;
}

const asCategory = (c: string | null, name: string): CategoryId => toCategory(c, name);

/** `imageUrl` turns an image file name into a web address. */
export function buildSharedCatalog(
  products: ProductRow[],
  prices: LatestPriceRow[],
  branches: BranchRow[],
  imageUrl: (path: string) => string,
): CatalogItem[] {
  const label = new Map(branches.map((b) => [b.id, b.chain === 'Other' ? b.name : `${b.chain} ${b.name}`]));
  const out = new Map<string, CatalogItem>();
  for (const p of products) {
    out.set(p.barcode, {
      key: p.barcode,
      barcode: p.barcode,
      name: p.name,
      size: p.size?.trim() || null,
      category: asCategory(p.category, p.name),
      image: p.image_path ? imageUrl(p.image_path) : null,
      prices: [],
    });
  }
  for (const r of prices) {
    const it = out.get(r.barcode);
    if (!it) continue;
    it.prices.push({
      storeKey: r.branch_id,
      storeLabel: label.get(r.branch_id) ?? 'Unknown store',
      seenOn: r.seen_on,
      priceType: r.price_type,
      unitPriceCentavos: r.unit_price_centavos,
      bundleQty: r.bundle_qty,
      bundlePriceCentavos: r.bundle_price_centavos,
      isPromo: r.is_promo,
      regularPriceCentavos: r.regular_price_centavos ?? null,
      promoNote: r.promo_note ?? null,
      source: 'shared',
    });
  }
  for (const it of out.values()) it.prices.sort((a, b) => b.seenOn.localeCompare(a.seenOn));
  return [...out.values()];
}

/**
 * One list from both sources. For a barcode in both: the shared name, size and category (they're the
 * reference), this phone's picture if it has one, and per store whichever price is newer (this phone's on a tie).
 */
export function mergeCatalogs(phone: CatalogItem[], shared: CatalogItem[]): CatalogItem[] {
  const out = new Map<string, CatalogItem>();
  for (const s of shared) out.set(s.key, { ...s, prices: [...s.prices] });
  for (const p of phone) {
    const s = out.get(p.key);
    if (!s) {
      out.set(p.key, p);
      continue;
    }
    if (!s.name) s.name = p.name;
    if (s.category === 'other' && p.category !== 'other') s.category = p.category;
    if (p.image && (!s.image || !p.image.startsWith('http'))) s.image = p.image;
    for (const pp of p.prices) {
      const i = s.prices.findIndex((x) => x.storeKey === pp.storeKey);
      if (i < 0) s.prices.push(pp);
      else if (pp.seenOn >= s.prices[i].seenOn) s.prices[i] = pp;
    }
    s.prices.sort((a, b) => b.seenOn.localeCompare(a.seenOn));
  }
  // A barcode nobody has named yet still shows, under its number.
  return [...out.values()].map((it) => (it.name ? it : { ...it, name: it.barcode ? `Barcode ${it.barcode}` : 'Unnamed item' }));
}

// ---------------------------------------------------------------------------------------------------------
// Loading

export async function loadPhoneCatalog(): Promise<CatalogItem[]> {
  const [items, trips, branches] = await Promise.all([db.items.toArray(), db.trips.toArray(), db.branches.toArray()]);
  return buildPhoneCatalog(items, trips, branches);
}

export type SharedState = 'off' | 'offline' | 'ok' | 'error';

/**
 * Products and latest prices from the shared database. Read-only, no sign-in needed.
 * `state` says why the list is empty when it is.
 */
export async function loadSharedCatalog(): Promise<{ state: SharedState; items: CatalogItem[]; error?: string }> {
  if (!SHARING_ON || !dbConfig) return { state: 'off', items: [] };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { state: 'offline', items: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CATALOG_TIMEOUT_MS);
  try {
    const client = await getSupabase();
    if (!client) return { state: 'off', items: [] };
    const all = async <T>(table: string, cols: string, order: string[]): Promise<T[]> => {
      const rows: T[] = [];
      for (let from = 0; from < MAX_SHARED_ROWS; from += PAGE) {
        let q = client.from(table).select(cols);
        for (const o of order) q = q.order(o);
        const { data, error } = await q.range(from, from + PAGE - 1).retry(false).abortSignal(ctrl.signal);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...((data ?? []) as T[]));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    };
    const [products, prices, branches] = await Promise.all([
      all<ProductRow>('products', 'barcode, name, size, category, image_path', ['barcode']),
      all<LatestPriceRow>('latest_prices', LATEST_PRICE_COLS, ['barcode', 'branch_id']),
      all<BranchRow>('branches', 'id, chain, name', ['id']),
    ]);
    const imageUrl = (path: string) => client.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    return { state: 'ok', items: buildSharedCatalog(products, prices, branches, imageUrl) };
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    const msg = e instanceof Error ? e.message : String(e);
    // A dropped connection shows up as "Failed to fetch"; say it plainly.
    return { state: 'error', items: [], error: aborted ? 'it took too long' : /failed to fetch|network/i.test(msg) ? 'no connection' : msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------------------
// One product's prices at every store (scan screen comparison)

/** Prices older than this are shown greyed out with "may have changed", and never marked lowest. */
export const STALE_DAYS = 30;

/** Cheapest first (per piece or per kilo), newest first on a tie. */
export function sortByPrice(prices: PricePoint[]): PricePoint[] {
  return [...prices].sort((a, b) => comparable(a) - comparable(b) || b.seenOn.localeCompare(a.seenOn));
}

/** True when the price was seen more than STALE_DAYS before `today` (YYYY-MM-DD). */
export function isStale(p: Pick<PricePoint, 'seenOn'>, today: string): boolean {
  const days = (Date.parse(`${today}T12:00:00`) - Date.parse(`${p.seenOn}T12:00:00`)) / 86_400_000;
  return days > STALE_DAYS;
}

/** The price to mark "lowest": the cheapest that isn't stale. Null when there's nothing current to compare. */
export function lowestCurrent(prices: PricePoint[], today: string): PricePoint | null {
  return sortByPrice(prices.filter((p) => !isStale(p, today)))[0] ?? null;
}

/**
 * Every store's latest price for one barcode: this phone's own and, when sharing is on and the phone is
 * online, other shoppers'. The shared part gives up after `timeoutMs` so a scan is never held up by it.
 */
export async function loadStorePrices(barcode: string, timeoutMs = 2500): Promise<PricePoint[]> {
  const [items, trips, branches] = await Promise.all([
    db.items.where('barcode').equals(barcode).toArray(),
    db.trips.toArray(),
    db.branches.toArray(),
  ]);
  const phone = buildPhoneCatalog(items, trips, branches);
  let shared: CatalogItem[] = [];
  if (SHARING_ON && dbConfig && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const client = await getSupabase();
      if (client) {
        const { data: prices, error } = await client
          .from('latest_prices')
          .select(LATEST_PRICE_COLS)
          .eq('barcode', barcode)
          .limit(100)
          .retry(false)
          .abortSignal(ctrl.signal);
        if (!error && prices?.length) {
          const ids = [...new Set((prices as unknown as LatestPriceRow[]).map((p) => p.branch_id))];
          const { data: rows } = await client.from('branches').select('id, chain, name').in('id', ids).retry(false).abortSignal(ctrl.signal);
          const stub: ProductRow = { barcode, name: '', size: null, category: null, image_path: null };
          shared = buildSharedCatalog([stub], prices as unknown as LatestPriceRow[], (rows ?? []) as BranchRow[], () => '');
        }
      }
    } catch {
      /* offline or slow: this phone's prices still show */
    } finally {
      clearTimeout(timer);
    }
  }
  const merged = mergeCatalogs(phone.filter((c) => c.barcode === barcode), shared);
  return sortByPrice(merged.find((c) => c.barcode === barcode)?.prices ?? []);
}
