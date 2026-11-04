import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Trip } from './db';

// A stand-in for the shared database: tables in memory, the same unique rules as schema.sql.
interface Store {
  branches: { id: string; chain: string; name: string }[];
  products: { barcode: string; name: string }[];
  price_sightings: Record<string, unknown>[];
  product_photos: Record<string, unknown>[];
  failNext?: string;
}
const store: Store = { branches: [], products: [], price_sightings: [], product_photos: [] };
/** Files in the product-photos bucket, by path. */
const files = new Map<string, Blob>();
let failUploads = 0;
let signIns = 0;

function table(name: keyof Omit<Store, 'failNext'>) {
  const filters: [string, unknown][] = [];
  let inFilter: [string, unknown[]] | null = null;
  let op: { kind: 'select' } | { kind: 'insert' | 'upsert'; rows: Record<string, unknown>[]; onConflict?: string } = { kind: 'select' };
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => (filters.push([k, v]), b),
    in: (k: string, v: unknown[]) => ((inFilter = [k, v]), b),
    limit: () => b,
    order: () => b,
    retry: () => b,
    abortSignal: () => b,
    insert: (rows: unknown) => ((op = { kind: 'insert', rows: [rows].flat() as Record<string, unknown>[] }), b),
    upsert: (rows: unknown, o: { onConflict: string }) => ((op = { kind: 'upsert', rows: [rows].flat() as Record<string, unknown>[], onConflict: o.onConflict }), b),
    then(resolve: (r: unknown) => void) {
      if (store.failNext) {
        const message = store.failNext;
        store.failNext = undefined;
        return resolve({ data: null, error: { message, code: 'PGRST000' } });
      }
      const rows = store[name] as Record<string, unknown>[];
      if (op.kind === 'select') {
        let out = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
        if (inFilter) out = out.filter((r) => inFilter![1].includes(r[inFilter![0]]));
        return resolve({ data: out, error: null });
      }
      const key = name === 'price_sightings' ? 'client_id' : name === 'products' ? 'barcode' : 'id';
      for (const r of op.rows) {
        const dupKey = rows.some((x) => x[key] === r[key]);
        const dupName = name === 'branches' && rows.some((x) => String(x.chain).toLowerCase() === String(r.chain).toLowerCase() && String(x.name).toLowerCase() === String(r.name).toLowerCase());
        if (dupKey || dupName) {
          if (op.kind === 'upsert') continue;
          return resolve({ data: null, error: { message: 'duplicate', code: '23505' } });
        }
        // The database fills these in for photo rows (schema.sql).
        rows.push(name === 'product_photos' ? { status: 'pending', path: `${r.barcode}/${r.id}.jpg`, ...r } : { ...r });
      }
      return resolve({ data: null, error: null });
    },
  };
  return b;
}

// The bucket takes a file only at the path of a pending photo row, once, like the storage policies.
const bucket = {
  upload: async (path: string, blob: Blob) => {
    if (failUploads > 0) return failUploads--, { data: null, error: { message: 'connection reset', statusCode: '500' } };
    if (files.has(path)) return { data: null, error: { message: 'Duplicate', statusCode: '409' } };
    if (!store.product_photos.some((r) => r.path === path && r.status === 'pending')) return { data: null, error: { message: 'row-level security', statusCode: '403' } };
    files.set(path, blob);
    return { data: { path }, error: null };
  },
  download: async (path: string) => (files.has(path) ? { data: files.get(path)!, error: null } : { data: null, error: { message: 'not found' } }),
};

const fakeClient = {
  from: (t: keyof Omit<Store, 'failNext'>) => table(t),
  storage: { from: () => bucket },
  auth: {
    getSession: async () => ({ data: { session: signIns ? {} : null } }),
    signInAnonymously: async () => (signIns++, { data: {}, error: null }),
  },
};

vi.mock('./supabase', () => ({
  dbConfig: { url: 'https://x.supabase.co', key: 'k', target: 'dev' },
  getSupabase: async () => fakeClient,
}));

const { db } = await import('./db');
const sync = await import('./sync');

const NOW = new Date();
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function item(over: Partial<Item>): Item {
  return {
    tripId: 1, barcode: '4800016644818', label: 'Joy Lemon 250ml', priceType: 'each', unitPriceCentavos: 11500,
    bundleQty: null, bundlePriceCentavos: null, isPromo: false, quantity: 1, weightGrams: null, lineTotalCentavos: 11500,
    category: 'household', captureMethod: 'tag', removed: false, createdAt: iso(0), ...over,
  };
}

async function addTrip(over: Partial<Trip> = {}): Promise<number> {
  return db.trips.add({
    chain: 'Puregold', customStore: 'Imus', branchUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', budgetCentavos: null, testerId: null,
    tripIndex: 1, prompted: false, startedAt: iso(0), endedAt: iso(0), receiptMatched: true, receiptTotalCentavos: null,
    receiptItemCount: null, ...over,
  });
}

beforeEach(async () => {
  store.branches = [];
  store.products = [];
  store.price_sightings = [];
  store.product_photos = [];
  files.clear();
  failUploads = 0;
  signIns = 0;
  await Promise.all([db.trips.clear(), db.items.clear(), db.branches.clear(), db.settings.clear(), db.events.clear()]);
  await db.settings.put({ key: 'sharingSince', value: iso(30) });
  await db.branches.add({ uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chain: 'Puregold', name: 'Imus', lat: 14.42, lng: 120.94, createdAt: iso(40) });
});

describe('helpers', () => {
  it('only shares items with a real product barcode', () => {
    expect(sync.shareable(item({}))).toBe(true);
    expect(sync.shareable(item({ barcode: null }))).toBe(false);
    expect(sync.shareable(item({ barcode: '4800016644819' }))).toBe(false); // bad check digit
    expect(sync.shareable(item({ barcode: '2000000000008' }))).toBe(false); // store scale sticker
    expect(sync.shareable(item({ removed: true }))).toBe(false);
  });

  it('sends the day only, never the time', () => {
    const row = sync.sightingRow({ ...item({ createdAt: '2026-11-04T09:15:00' }), shareId: 's1' }, 'b1');
    expect(row.seen_on).toBe('2026-11-04');
    expect(JSON.stringify(row)).not.toMatch(/09:15|T\d/);
  });

  it('keeps bundle prices whole', () => {
    const row = sync.sightingRow({ ...item({ priceType: 'bundle', unitPriceCentavos: 0, bundleQty: 3, bundlePriceCentavos: 10000 }), shareId: 's' }, 'b');
    expect(row).toMatchObject({ price_type: 'bundle', bundle_qty: 3, bundle_price_centavos: 10000, unit_price_centavos: 3333 });
  });

  it('spots names the app made up', () => {
    expect(sync.isPlaceholderName('Item •03')).toBe(true);
    expect(sync.isPlaceholderName('Joy Lemon')).toBe(false);
  });

  it('leaves out cancelled, unfinished and pre-sharing trips', () => {
    const base = { endedAt: iso(0), cancelledAt: null, sharedAt: null } as Trip;
    const trips = [base, { ...base, endedAt: null }, { ...base, cancelledAt: iso(0) }, { ...base, sharedAt: iso(0) }, { ...base, endedAt: iso(40) }];
    expect(sync.tripsToShare(trips, iso(30))).toHaveLength(1);
  });
});

describe('sharePending', () => {
  it('uploads the store, product and price once, then marks the trip shared', async () => {
    const tripId = await addTrip();
    await db.items.bulkAdd([item({ tripId }), item({ tripId, barcode: null, label: 'Kangkong' })]);
    const r = await sync.sharePending();
    expect(r).toMatchObject({ trips: 1, prices: 1, waiting: 0 });
    expect(r.error).toBeUndefined();
    expect(store.branches).toHaveLength(1);
    expect(store.products).toEqual([expect.objectContaining({ barcode: '4800016644818', name: 'Joy Lemon 250ml' })]);
    expect(store.price_sightings).toHaveLength(1);
    expect(Object.keys(store.price_sightings[0])).not.toContain('created_at');
    expect((await db.trips.get(tripId))?.sharedAt).toBeTruthy();
    expect(signIns).toBe(1);
    // Nothing left: a second run sends nothing.
    expect(await sync.sharePending()).toMatchObject({ trips: 0, prices: 0 });
    expect(store.price_sightings).toHaveLength(1);
  });

  it('uses the other phone’s store when it added the same one first', async () => {
    store.branches.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', chain: 'Puregold', name: 'IMUS' });
    const tripId = await addTrip();
    await db.items.add(item({ tripId }));
    await sync.sharePending();
    expect(store.branches).toHaveLength(1);
    expect(store.price_sightings[0].branch_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect((await db.branches.where('uuid').equals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').first())?.remoteId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('keeps the trip waiting when the connection drops, and never double-counts on retry', async () => {
    const tripId = await addTrip();
    await db.items.add(item({ tripId }));
    store.failNext = 'network down';
    const first = await sync.sharePending();
    expect(first.error).toMatch(/network down/);
    expect(first.waiting).toBe(1);
    expect((await db.trips.get(tripId))?.sharedAt).toBeFalsy();
    const second = await sync.sharePending();
    expect(second).toMatchObject({ trips: 1, prices: 1 });
    await db.trips.update(tripId, { sharedAt: null });
    await sync.sharePending(); // pretend it ran again anyway
    expect(store.price_sightings).toHaveLength(1);
  });

  it('keeps unnamed items on the phone unless someone already named the barcode', async () => {
    const tripId = await addTrip();
    await db.items.bulkAdd([
      item({ tripId, label: 'Item •01', barcode: '4800016644818' }),
      item({ tripId, label: 'Item •02', barcode: '4806502162316' }),
    ]);
    store.products.push({ barcode: '4800016644818', name: 'Joy Lemon' });
    const r = await sync.sharePending();
    expect(r.prices).toBe(1);
    expect(store.products.map((p) => p.name)).toEqual(['Joy Lemon']);
  });

  it('skips trips too old for the shared database', async () => {
    const tripId = await addTrip({ startedAt: iso(20), endedAt: iso(20) });
    await db.items.add(item({ tripId, createdAt: iso(20) }));
    const r = await sync.sharePending();
    expect(r).toMatchObject({ trips: 1, prices: 0 });
    expect(store.price_sightings).toHaveLength(0);
  });
});

describe('sharedPrice', () => {
  it('returns other shoppers’ latest price and name at this store', async () => {
    store.branches.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chain: 'Puregold', name: 'Imus' });
    store.products.push({ barcode: '4800016644818', name: 'Joy Lemon' });
    // latest_prices is a view; the fake reads it as a table.
    (store as unknown as Record<string, unknown[]>).latest_prices = [
      { barcode: '4800016644818', branch_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', seen_on: '2026-11-02', price_type: 'each', unit_price_centavos: 11500, bundle_qty: null, bundle_price_centavos: null, is_promo: false },
    ];
    const r = await sync.sharedPrice('4800016644818', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(r).toMatchObject({ shared: true, sameBranch: true, item: { label: 'Joy Lemon', unitPriceCentavos: 11500, captureMethod: 'shared' } });
  });

  it('returns nothing for a store nobody has shared yet', async () => {
    expect(await sync.sharedPrice('4800016644818', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeNull();
  });
});

// A real 1×1 JPEG is not needed: the bytes only have to survive the round trip.
const PHOTO = `data:image/jpeg;base64,${btoa('fake jpeg bytes')}`;

describe('product photos', () => {
  it('picks one camera photo per barcode, newest first, from shared trips only', () => {
    const shared = new Set([1]);
    const a = item({ id: 1, thumb: PHOTO, thumbSource: 'camera', createdAt: iso(1) });
    const b = item({ id: 2, thumb: PHOTO, thumbSource: 'camera', createdAt: iso(0) });
    const fromDb = item({ id: 3, barcode: '4806502162316', thumb: PHOTO, thumbSource: 'shared' });
    const notShared = item({ id: 4, tripId: 2, barcode: '4800016644115', thumb: PHOTO, thumbSource: 'camera' });
    const noPhoto = item({ id: 5, barcode: '4800016644115' });
    expect(sync.photosToSend([a, b, fromDb, notShared, noPhoto], shared).map((i) => i.id)).toEqual([2]);
    expect(sync.photosToSend([{ ...a, photoSentAt: iso(0) }, b], shared)).toEqual([]);
  });

  it('sends the row, then the file, once per barcode', async () => {
    const tripId = await addTrip();
    await db.items.bulkAdd([
      item({ tripId, thumb: PHOTO, thumbSource: 'camera' }),
      item({ tripId, thumb: PHOTO, thumbSource: 'camera', quantity: 2 }),
    ]);
    const r = await sync.sharePending();
    expect(r).toMatchObject({ trips: 1, photos: 1 });
    expect(store.product_photos).toHaveLength(1);
    expect(store.product_photos[0]).toMatchObject({ barcode: '4800016644818', status: 'pending' });
    expect(Object.keys(store.product_photos[0])).not.toContain('created_by');
    const path = store.product_photos[0].path as string;
    expect(await files.get(path)!.text()).toBe('fake jpeg bytes');
    const again = await sync.sharePending();
    expect(again.trips).toBe(0);
    expect(again.photos ?? 0).toBe(0);
    expect(files.size).toBe(1);
  });

  it('retries a dropped file upload into the same path, with no new trip', async () => {
    const tripId = await addTrip();
    await db.items.add(item({ tripId, thumb: PHOTO, thumbSource: 'camera' }));
    failUploads = 1;
    const first = await sync.sharePending();
    expect(first.error).toMatch(/connection reset/);
    expect(store.product_photos).toHaveLength(1);
    expect(files.size).toBe(0);
    const second = await sync.sharePending();
    expect(second.error).toBeUndefined();
    expect(second.photos).toBe(1);
    expect(store.product_photos).toHaveLength(1);
    expect([...files.keys()]).toEqual([store.product_photos[0].path]);
  });

  it("doesn't send a photo that came from the database", async () => {
    const tripId = await addTrip();
    await db.items.add(item({ tripId, thumb: PHOTO, thumbSource: 'shared' }));
    expect((await sync.sharePending()).photos).toBe(0);
    expect(store.product_photos).toHaveLength(0);
  });

  it('shows other shoppers a photo only once it is published', async () => {
    const tripId = await addTrip();
    await db.items.add(item({ tripId, thumb: PHOTO, thumbSource: 'camera' }));
    await sync.sharePending();
    expect(await sync.sharedPhoto('4800016644818')).toBeNull();
    store.product_photos[0].status = 'published';
    expect(await sync.sharedPhoto('4800016644818')).toBe(PHOTO);
  });
});
