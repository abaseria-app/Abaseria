// Sharing prices through the shared database: uploading finished trips and looking up other shoppers' prices.
//
// What leaves the phone, per item with a real product barcode: barcode, store, price, promo flag, how the
// price was captured, and the day (never the time). Location, receipt numbers, tester ids and items without
// a barcode stay on the phone.
//
// Sharing is on in the dev app only. The live app turns it on once the consent screen exists (module 4),
// and only trips that end after this phone starts sharing are uploaded.
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, getSetting, newUuid, setSetting, type Branch, type CaptureMethod, type Item, type Recall, type Trip } from './db';
import { gtinOk, isInStoreCode } from './barcode';
import { dbConfig, getSupabase } from './supabase';
import { logEvent } from './events';
import { shrinkImage } from './thumb';
import { hasAccountSession } from './auth';

export const SHARING_ON = dbConfig?.target === 'dev';

/** The shared database refuses sightings older than this (see supabase/schema.sql). */
export const MAX_AGE_DAYS = 14;
/** How long a scan waits for other shoppers' price before carrying on without it. */
export const LOOKUP_TIMEOUT_MS = 2000;

const SINCE_KEY = 'sharingSince';

/** Public bucket holding each product's reference image (supabase/migrations/003_product_images.sql). */
export const IMAGE_BUCKET = 'product-images';
/** How long a scan waits for the product image. It never holds up the price. */
export const IMAGE_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------------------------------------
// Pure helpers (tested in sync.test.ts)

/** Calendar day on this phone, YYYY-MM-DD. The shared database stores the day only. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Item •03" and friends: names the app made up because the shopper skipped naming. */
export const isPlaceholderName = (label: string) => /^Item •/.test(label.trim()) || !label.trim();

/** True when this item can become a shared price: a real product barcode, not removed. */
export function shareable(item: Item): boolean {
  return !item.removed && !!item.barcode && gtinOk(item.barcode) && !isInStoreCode(item.barcode) && item.unitPriceCentavos > 0;
}

/** Trips that still need a look: ended, not cancelled, at a known store, ended after sharing started here. */
export function tripsToShare(trips: Trip[], since: string): Trip[] {
  return trips.filter((t) => t.endedAt && !t.cancelledAt && !t.sharedAt && t.endedAt >= since);
}

/** Too old for the shared database to accept. */
export function tooOld(trip: Trip, now: Date): boolean {
  const ended = new Date(trip.endedAt ?? trip.startedAt);
  return now.getTime() - ended.getTime() > (MAX_AGE_DAYS - 1) * 86_400_000;
}

export interface SightingRow {
  client_id: string;
  barcode: string;
  branch_id: string;
  seen_on: string;
  price_type: Item['priceType'];
  unit_price_centavos: number;
  bundle_qty: number | null;
  bundle_price_centavos: number | null;
  is_promo: boolean;
  capture_method: CaptureMethod;
}

export function sightingRow(item: Item & { shareId: string }, branchId: string): SightingRow {
  const bundle = item.priceType === 'bundle' && item.bundleQty && item.bundlePriceCentavos;
  const unit =
    item.priceType === 'bundle' && !(item.unitPriceCentavos > 0) && bundle
      ? Math.round(item.bundlePriceCentavos! / item.bundleQty!)
      : item.unitPriceCentavos;
  return {
    client_id: item.shareId,
    barcode: item.barcode!,
    branch_id: branchId,
    seen_on: localDay(item.createdAt),
    price_type: item.priceType === 'bundle' && !bundle ? 'each' : item.priceType,
    unit_price_centavos: Math.max(1, Math.round(unit)),
    bundle_qty: bundle ? item.bundleQty! : null,
    bundle_price_centavos: bundle ? item.bundlePriceCentavos! : null,
    is_promo: item.isPromo,
    capture_method: item.captureMethod,
  };
}

export function productRow(item: Item) {
  return { barcode: item.barcode!, name: item.label.trim().slice(0, 120), category: item.category ?? 'other' };
}

// ---------------------------------------------------------------------------------------------------------
// Network

/** Uploads need the shopper's Google account. Phones that haven't signed in yet keep their trips waiting. */
async function signIn(client: SupabaseClient): Promise<void> {
  if (!(await hasAccountSession(client))) throw new Error(NOT_SIGNED_IN);
}

export const NOT_SIGNED_IN = 'not signed in';

/**
 * The store's id in the shared database. Adds the store if nobody has; if another phone already added a store
 * with the same chain and name, uses theirs. Remembers the answer on this phone.
 */
async function ensureBranch(client: SupabaseClient, branch: Branch): Promise<string> {
  if (branch.remoteId) return branch.remoteId;
  const row = { id: branch.uuid, chain: branch.chain, name: branch.name.trim().slice(0, 80), lat: branch.lat, lng: branch.lng };
  let { error } = await client.from('branches').insert(row);
  // A position outside the Philippines box is refused; the store still gets added without it.
  if (error?.code === '23514') ({ error } = await client.from('branches').insert({ ...row, lat: null, lng: null }));
  let remoteId: string | null = error ? null : branch.uuid;
  if (error && error.code !== '23505') throw new Error(`store: ${error.message}`);
  if (!remoteId) remoteId = await findBranch(client, branch);
  if (!remoteId) throw new Error('store: added by someone else but not found');
  await db.branches.update(branch.id!, { remoteId });
  return remoteId;
}

/** Same chain, same name (any capitals). Null when nobody has added it. */
async function findBranch(client: SupabaseClient, branch: Branch, signal?: AbortSignal): Promise<string | null> {
  let q = client.from('branches').select('id, name').eq('chain', branch.chain).limit(1000).retry(false);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw new Error(`store lookup: ${error.message}`);
  const want = branch.name.trim().toLowerCase();
  return (data ?? []).find((r) => r.id === branch.uuid || String(r.name).trim().toLowerCase() === want)?.id ?? null;
}

/** Uploads one trip. Safe to repeat: products and sightings that are already there are skipped. */
async function shareTrip(client: SupabaseClient, trip: Trip, branch: Branch): Promise<number> {
  const all = await db.items.where('tripId').equals(trip.id!).toArray();
  const items = all.filter(shareable);
  if (!items.length) return 0;

  // Give each item its upload id before sending, so a retry after a dropped connection can't double-count.
  for (const it of items) {
    if (!it.shareId) {
      it.shareId = newUuid();
      await db.items.update(it.id!, { shareId: it.shareId });
    }
  }

  const branchId = await ensureBranch(client, branch);

  // Products: add the ones with a real name. Ones already there are left as they are.
  const named = new Map<string, ReturnType<typeof productRow>>();
  for (const it of items) if (!isPlaceholderName(it.label) && !named.has(it.barcode!)) named.set(it.barcode!, productRow(it));
  if (named.size) {
    const { error } = await client.from('products').upsert([...named.values()], { onConflict: 'barcode', ignoreDuplicates: true });
    if (error) throw new Error(`products: ${error.message}`);
  }

  // A price needs its product in the database. Unnamed items whose barcode nobody has named stay on the phone.
  // Asked through known_barcodes, not a products read: Pending products added by someone else are hidden
  // from reads, but their prices still belong in the database.
  const codes = [...new Set(items.map((i) => i.barcode!))];
  const exists = new Set<string>();
  for (let i = 0; i < codes.length; i += 200) {
    const { data: known, error: knownErr } = await client.rpc('known_barcodes', { codes: codes.slice(i, i + 200) });
    if (knownErr) throw new Error(`products check: ${knownErr.message}`);
    for (const code of (known ?? []) as string[]) exists.add(code);
  }
  const rows = items.filter((i) => exists.has(i.barcode!)).map((i) => sightingRow(i as Item & { shareId: string }, branchId));
  if (!rows.length) return 0;

  const { error } = await client.from('price_sightings').upsert(rows, { onConflict: 'client_id', ignoreDuplicates: true });
  if (!error) return rows.length;
  // One bad row (an odd value the database refuses) shouldn't hold back the rest: send them one at a time.
  if (!/^2[23]/.test(error.code ?? '')) throw new Error(`prices: ${error.message}`);
  let sent = 0;
  for (const r of rows) {
    const one = await client.from('price_sightings').upsert(r, { onConflict: 'client_id', ignoreDuplicates: true });
    if (!one.error) sent++;
    else if (!/^2[23]/.test(one.error.code ?? '')) throw new Error(`prices: ${one.error.message}`);
  }
  return sent;
}

export interface ShareResult {
  trips: number;
  prices: number;
  waiting: number;
  error?: string;
}

let running: Promise<ShareResult> | null = null;

/** Uploads every finished trip that hasn't been shared. One run at a time; quiet when off or offline. */
export function sharePending(): Promise<ShareResult> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<ShareResult> {
  if (!SHARING_ON) return { trips: 0, prices: 0, waiting: 0 };
  const since = await sharingSince();
  const todo = tripsToShare(await db.trips.toArray(), since);
  const result: ShareResult = { trips: 0, prices: 0, waiting: todo.length };
  if (!todo.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return result;

  const client = await getSupabase();
  if (!client) return result;
  const now = new Date();
  try {
    await signIn(client);
    for (const trip of todo) {
      const branch = trip.branchUuid ? await db.branches.where('uuid').equals(trip.branchUuid).first() : undefined;
      let sent = 0;
      if (branch && !tooOld(trip, now)) sent = await shareTrip(client, trip, branch);
      await db.trips.update(trip.id!, { sharedAt: new Date().toISOString() });
      await logEvent('trip_shared', trip.id!, { prices: sent, skipped: !branch ? 'no_store' : tooOld(trip, now) ? 'too_old' : null });
      result.trips++;
      result.prices += sent;
      result.waiting--;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    // Not signed in yet isn't a failure worth logging: the trips upload after sign-in.
    if (result.error !== NOT_SIGNED_IN) await logEvent('share_failed', null, { error: result.error });
  }
  return result;
}

export interface SharedProduct {
  label: string;
  category: Item['category'];
  imagePath: string | null;
}

/**
 * What the shared database knows about a barcode at any store: its name, category and image file.
 * This is how a phone recognizes a product it has never seen. Null when nobody has named it, sharing is off,
 * the phone is offline, or the answer takes longer than 2 seconds.
 */
export async function sharedProduct(barcode: string): Promise<SharedProduct | null> {
  if (!SHARING_ON || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client
      .from('products')
      .select('name, category, image_path')
      .eq('barcode', barcode)
      .limit(1)
      .retry(false)
      .abortSignal(ctrl.signal);
    const row = data?.[0];
    if (error || !row?.name) return null;
    return { label: row.name as string, category: (row.category as Item['category']) ?? null, imagePath: (row.image_path as string | null) ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A product image file from the public bucket, shrunk for the list, as a data URL to keep with the item.
 * Null when the file is missing, sharing is off, the phone is offline, or it takes longer than 3 seconds.
 */
export async function productImage(path: string): Promise<string | null> {
  if (!SHARING_ON || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const client = await getSupabase();
    if (!client) return null;
    const url = client.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await shrinkImage(await res.blob());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Trips ended before this phone started sharing stay on the phone. */
async function sharingSince(): Promise<string> {
  let since = await getSetting(SINCE_KEY);
  if (!since) {
    since = new Date().toISOString();
    await setSetting(SINCE_KEY, since);
  }
  return since;
}

/** Finished trips not yet shared, for the Settings screen. */
export async function waitingToShare(): Promise<number> {
  if (!SHARING_ON) return 0;
  return tripsToShare(await db.trips.toArray(), await sharingSince()).length;
}

/** Call once at app start: shares anything left over, and again whenever the phone comes back online. */
export function startSharing(): void {
  if (!SHARING_ON || typeof window === 'undefined') return;
  sharePending();
  window.addEventListener('online', () => sharePending());
}

/**
 * Other shoppers' latest price for this barcode at this store, as a recall the capture screen can show.
 * Null when there isn't one, sharing is off, the phone is offline, or the answer takes longer than 2 seconds.
 */
export async function sharedPrice(barcode: string, branchUuid: string | null | undefined): Promise<Recall | null> {
  if (!SHARING_ON || !branchUuid || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const branch = await db.branches.where('uuid').equals(branchUuid).first();
  if (!branch) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const client = await getSupabase();
    if (!client) return null;
    let branchId = branch.remoteId ?? null;
    if (!branchId) {
      branchId = await findBranch(client, branch, ctrl.signal);
      if (!branchId) return null;
      await db.branches.update(branch.id!, { remoteId: branchId });
    }
    const [price, product] = await Promise.all([
      client
        .from('latest_prices')
        .select('seen_on, price_type, unit_price_centavos, bundle_qty, bundle_price_centavos, is_promo')
        .eq('barcode', barcode)
        .eq('branch_id', branchId)
        .limit(1)
        .retry(false)
        .abortSignal(ctrl.signal),
      client.from('products').select('name, category').eq('barcode', barcode).limit(1).retry(false).abortSignal(ctrl.signal),
    ]);
    const p = price.data?.[0];
    if (price.error || !p) return null;
    const name = product.data?.[0]?.name as string | undefined;
    const item: Item = {
      tripId: 0,
      barcode,
      label: name ?? '',
      priceType: p.price_type,
      unitPriceCentavos: p.unit_price_centavos,
      bundleQty: p.bundle_qty,
      bundlePriceCentavos: p.bundle_price_centavos,
      isPromo: p.is_promo,
      quantity: 1,
      weightGrams: null,
      lineTotalCentavos: 0,
      category: (product.data?.[0]?.category as Item['category']) ?? null,
      captureMethod: 'shared',
      removed: false,
      // Noon on the day it was seen, so the date shows the same in any time zone.
      createdAt: `${p.seen_on}T12:00:00`,
    };
    return { item, sameBranch: true, shared: true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
