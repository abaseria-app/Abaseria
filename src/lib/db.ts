import Dexie, { type Table } from 'dexie';
import type { PriceType } from './money';

export const STORE_CHAINS = [
  '7-Eleven',
  'Alfamart',
  'Ministop',
  'Puregold',
  'SM Supermarket',
  'SM Hypermarket',
  'Savemore',
  'Robinsons Supermarket',
  'Walter Mart',
  'Shopwise',
  'S&R',
  'Landers',
  'Palengke (wet market)',
  'Sari-sari store',
  'Other',
] as const;

export interface Trip {
  id?: number;
  chain: string;
  customStore: string | null;
  budgetCentavos: number | null;
  testerId: string | null;
  /** 1 = this tester's first trip on this phone, 2 = second, and so on. */
  tripIndex: number;
  /** True when someone was there and asked the shopper to use the app this trip. */
  prompted: boolean;
  startedAt: string;
  endedAt: string | null;
  receiptMatched: boolean | null;
  receiptTotalCentavos: number | null;
  receiptItemCount: number | null;
}

export type CaptureMethod = 'tag' | 'tag+typed' | 'typed';

/**
 * One row per item on a trip. The price fields are what was seen on the shelf at that store and time,
 * which later versions turn into price history.
 */
export interface Item {
  id?: number;
  tripId: number;
  label: string;
  priceType: PriceType;
  unitPriceCentavos: number;
  bundleQty: number | null;
  bundlePriceCentavos: number | null;
  isPromo: boolean;
  quantity: number;
  lineTotalCentavos: number;
  captureMethod: CaptureMethod;
  removed: boolean;
  createdAt: string;
}

export interface AppEvent {
  id?: number;
  tripId: number | null;
  type: string;
  payload: string;
  createdAt: string;
}

export interface Setting {
  key: string;
  value: string;
}

class AbeseriaDB extends Dexie {
  trips!: Table<Trip, number>;
  items!: Table<Item, number>;
  events!: Table<AppEvent, number>;
  settings!: Table<Setting, string>;

  constructor() {
    super('abeseria');
    this.version(1).stores({
      trips: '++id, testerId, startedAt, endedAt',
      items: '++id, tripId, label, createdAt',
      events: '++id, tripId, type, createdAt',
      settings: 'key',
    });
  }
}

export const db = new AbeseriaDB();

export async function getSetting(key: string): Promise<string | null> {
  return (await db.settings.get(key))?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export function storeName(trip: Pick<Trip, 'chain' | 'customStore'>): string {
  return trip.chain === 'Other' && trip.customStore ? trip.customStore : trip.chain;
}

/** Recent item names, most recent first, for one-tap chips. */
export async function recentLabels(limit = 8): Promise<string[]> {
  const rows = await db.items.orderBy('createdAt').reverse().limit(200).toArray();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = r.label.toLowerCase();
    if (r.removed || seen.has(key) || /^item •/i.test(r.label)) continue;
    seen.add(key);
    out.push(r.label);
    if (out.length >= limit) break;
  }
  return out;
}

/** Ask the browser not to evict our data when the phone runs low on storage. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported; data still saves, it's just evictable */
  }
}
