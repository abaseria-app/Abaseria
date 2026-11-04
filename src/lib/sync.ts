// Sharing prices through the shared database: uploading finished trips and looking up other shoppers' prices.
//
// What leaves the phone, per item with a real product barcode: barcode, store, price, promo flag, how the
// price was captured, and the day (never the time). Location, receipt numbers, tester ids and items without
// a barcode stay on the phone. Per barcode, this phone also sends one product photo (the camera frame from the
// barcode read), which other shoppers only see after someone publishes it. Shelf-tag photos stay on the phone.
//
// Sharing is on in the dev app only. The live app turns it on once the consent screen exists (module 4),
// and only trips that end after this phone starts sharing are uploaded.
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, getSetting, newUuid, setSetting, type Branch, type CaptureMethod, type Item, type Recall, type Trip } from './db';
import { gtinOk, isInStoreCode } from './barcode';
import { dbConfig, getSupabase } from './supabase';
import { logEvent } from './events';

export const SHARING_ON = dbConfig?.target === 'dev';

/** The shared database refuses sightings older than this (see supabase/schema.sql). */
export const MAX_AGE_DAYS = 14;
/** How long a scan waits for other shoppers' price before carrying on without it. */
export const LOOKUP_TIMEOUT_MS = 2000;

const SINCE_KEY = 'sharingSince';

/** Storage bucket for product photos (supabase/migrations/003_product_photos.sql). */
export const PHOTO_BUCKET = 'product-photos';
/** Most photos sent in one run, so a long-offline phone doesn't spend a shopper's data in one go. */
export const PHOTOS_PER_RUN = 20;
/** How long a scan waits for a published photo. It never holds up the price. */
export const PHOTO_TIMEOUT_MS = 3000;

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

/** Where a photo's file lives in the bucket; the database builds the same path from the row. */
export const photoPath = (barcode: string, photoId: string) => `${barcode}/${photoId}.jpg`;

/** Items whose photo should go up: own camera photo of a shareable item, from a shared trip, one per barcode. */
export function photosToSend(items: Item[], sharedTripIds: Set<number>): Item[] {
  const done = new Set(items.filter((i) => i.barcode && i.photoSentAt).map((i) => i.barcode!));
  const pick = new Map<string, Item>();
  for (const i of [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!shareable(i) || !i.thumb || i.thumbSource === 'shared' || !sharedTripIds.has(i.tripId)) continue;
    if (done.has(i.barcode!) || pick.has(i.barcode!)) continue;
    pick.set(i.barcode!, i);
  }
  return [...pick.values()];
}

export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

export function productRow(item: Item) {
  return { barcode: item.barcode!, name: item.label.trim().slice(0, 120), category: item.category ?? 'other' };
}

// ---------------------------------------------------------------------------------------------------------
// Network

/** Signs this phone in without a screen (anonymous). The session is kept on the phone for next time. */
async function signIn(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`sign-in: ${error.message}`);
}

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
  const codes = [...new Set(items.map((i) => i.barcode!))];
  const { data: known, error: knownErr } = await client.from('products').select('barcode').in('barcode', codes);
  if (knownErr) throw new Error(`products check: ${knownErr.message}`);
  const exists = new Set((known ?? []).map((r) => r.barcode as string));
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
  photos?: number;
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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;
  // Photos that failed on a bad connection go up on the next run, even with no new trip to share.
  if (!todo.length && !(await photosWaiting())) return result;

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
    result.photos = await sharePhotos(client);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await logEvent('share_failed', null, { error: result.error });
  }
  return result;
}

async function photosWaiting(): Promise<boolean> {
  const shared = new Set((await db.trips.toArray()).filter((t) => t.sharedAt && !t.cancelledAt).map((t) => t.id!));
  return photosToSend((await db.items.toArray()).filter((i) => i.barcode), shared).length > 0;
}

/** Statuses that mean the database won't take this photo, ever: retrying wouldn't help. */
const PHOTO_FINAL = new Set(['400', '403', '409', '413', '415']);

/**
 * Sends one photo per barcode from trips that are already shared. The row goes first, then the file at its
 * path; the database refuses a file with no pending row. Safe to repeat after a dropped connection.
 */
async function sharePhotos(client: SupabaseClient): Promise<number> {
  const shared = new Set((await db.trips.toArray()).filter((t) => t.sharedAt && !t.cancelledAt).map((t) => t.id!));
  const todo = photosToSend((await db.items.toArray()).filter((i) => i.barcode), shared).slice(0, PHOTOS_PER_RUN);
  if (!todo.length) return 0;

  // A photo needs its product in the database; unnamed products wait until someone names them.
  const codes = todo.map((i) => i.barcode!);
  const { data: known, error: knownErr } = await client.from('products').select('barcode').in('barcode', codes);
  if (knownErr) throw new Error(`photos check: ${knownErr.message}`);
  const exists = new Set((known ?? []).map((r) => r.barcode as string));

  let sent = 0;
  for (const it of todo.filter((i) => exists.has(i.barcode!))) {
    const blob = dataUrlToBlob(it.thumb!);
    const markSent = () => db.items.update(it.id!, { photoSentAt: new Date().toISOString() });
    if (!blob) {
      await markSent();
      continue;
    }
    if (!it.photoId) {
      it.photoId = newUuid();
      await db.items.update(it.id!, { photoId: it.photoId });
    }
    // 23505: this row is already there (a retry), or this phone already sent a photo of this barcode.
    // Either way, try the file: the database only takes it at the path of this phone's own pending row.
    const row = await client.from('product_photos').insert({ id: it.photoId, barcode: it.barcode });
    if (row.error && row.error.code !== '23505') {
      if (/^2[23]/.test(row.error.code ?? '') || row.error.code === '42501') {
        await markSent();
        continue;
      }
      throw new Error(`photos: ${row.error.message}`);
    }
    const up = await client.storage.from(PHOTO_BUCKET).upload(photoPath(it.barcode!, it.photoId), blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) {
      const e = up.error as { statusCode?: string | number; status?: string | number; message: string };
      if (!PHOTO_FINAL.has(String(e.statusCode ?? e.status ?? ''))) throw new Error(`photo file: ${e.message}`);
      await logEvent('photo_refused', it.tripId, { item_id: it.id, status: String(e.statusCode ?? e.status ?? '') });
    } else {
      sent++;
    }
    await markSent();
  }
  return sent;
}

/**
 * The first published photo of this barcode, as a data URL to keep with the item.
 * Null when there isn't one, sharing is off, the phone is offline, or it takes longer than 3 seconds.
 */
export async function sharedPhoto(barcode: string): Promise<string | null> {
  if (!SHARING_ON || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, PHOTO_TIMEOUT_MS);
  });
  const lookup = (async () => {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client
      .from('product_photos')
      .select('path')
      .eq('barcode', barcode)
      .eq('status', 'published')
      .order('created_at', { ascending: true })
      .limit(1)
      .retry(false)
      .abortSignal(ctrl.signal);
    const path = data?.[0]?.path as string | undefined;
    if (error || !path) return null;
    const file = await client.storage.from(PHOTO_BUCKET).download(path);
    if (file.error || !file.data) return null;
    return blobToDataUrl(file.data);
  })().catch(() => null);
  try {
    return await Promise.race([lookup, timeout]);
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
