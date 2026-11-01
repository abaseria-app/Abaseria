import Dexie, { type Table } from 'dexie';
import type { PriceType } from './money';
import type { CategoryId } from './categories';

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

/**
 * One physical store. `uuid` is made on the phone and becomes the row id in the shared database,
 * so a branch added in a basement with no signal keeps the same id after it uploads.
 * lat/lng are the store's position (from the phone that added it), never a shopper's.
 */
export interface Branch {
  id?: number;
  uuid: string;
  chain: string;
  /** Branch name as people say it: "Imus Anabu", "SM City Bacoor". For chain 'Other' this is the store's name. */
  name: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

export interface Trip {
  id?: number;
  chain: string;
  customStore: string | null;
  /** Missing on trips started before branches existed. */
  branchUuid?: string | null;
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
  /** Missing on items saved before categories existed; categoryOf() guesses from the name. */
  category?: CategoryId | null;
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
  branches!: Table<Branch, number>;

  constructor() {
    super('abeseria');
    this.version(1).stores({
      trips: '++id, testerId, startedAt, endedAt',
      items: '++id, tripId, label, createdAt',
      events: '++id, tripId, type, createdAt',
      settings: 'key',
    });
    // v2: branches. Existing trips, items and events are kept as they are.
    this.version(2).stores({
      trips: '++id, testerId, startedAt, endedAt, branchUuid',
      items: '++id, tripId, label, createdAt',
      events: '++id, tripId, type, createdAt',
      settings: 'key',
      branches: '++id, &uuid, chain',
    });
  }
}

/** RFC 4122 v4. crypto.randomUUID only exists on HTTPS, and the dev server runs over plain Wi-Fi HTTP. */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function branchLabel(b: Pick<Branch, 'chain' | 'name'>): string {
  return b.chain === 'Other' ? b.name : `${b.chain} ${b.name}`;
}

/** All branches, most recently shopped first; never-used ones after, newest added first. */
export async function branchesByRecent(): Promise<Branch[]> {
  const [branches, trips] = await Promise.all([db.branches.toArray(), db.trips.toArray()]);
  const lastUsed = new Map<string, string>();
  for (const t of trips) {
    if (t.branchUuid && t.startedAt > (lastUsed.get(t.branchUuid) ?? '')) lastUsed.set(t.branchUuid, t.startedAt);
  }
  const key = (b: Branch) => lastUsed.get(b.uuid) ?? '';
  return branches.sort((a, b) => key(b).localeCompare(key(a)) || b.createdAt.localeCompare(a.createdAt));
}

export const db = new AbeseriaDB();

export async function getSetting(key: string): Promise<string | null> {
  return (await db.settings.get(key))?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

/**
 * Display name for a trip's store. Trips with a branch store it in customStore too (as the branch name),
 * so this works without a branches lookup and old exports keep the same column.
 */
export function storeName(trip: Pick<Trip, 'chain' | 'customStore' | 'branchUuid'>): string {
  if (trip.branchUuid && trip.customStore) return branchLabel({ chain: trip.chain, name: trip.customStore });
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
