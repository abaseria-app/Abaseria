// Branch suggestion from one location reading taken when a trip starts.
//
// The phone's position never leaves this module's callers' memory: it is not saved to IndexedDB,
// not logged as an event and not uploaded. Only the branch the shopper confirms is stored with the trip.
import type { Branch } from './db';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Position extends GeoPoint {
  /** Radius in meters the phone is 68% sure about. Indoors this is usually 15-80 m. */
  accuracy: number;
}

export type LocationStatus = 'ok' | 'denied' | 'unavailable' | 'rough';

/** A branch within this distance (or the reading's accuracy, if larger) counts as "here". */
export const NEAR_M = 300;
/** If the second-nearest branch is less than this much farther than the nearest, the shopper has to choose. */
export const AMBIGUOUS_GAP_M = 100;
/** Readings worse than this can't tell one branch from the next, so they're ignored. */
export const MAX_USEFUL_ACCURACY_M = 1000;
/** A branch only gets saved coordinates from a reading at least this good. */
export const SAVE_ACCURACY_M = 200;
/** Adding a branch of the same chain this close to an existing one is probably a duplicate. */
export const DUPLICATE_M = 150;

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** One reading, no watching. Resolves null instead of throwing so the screen can fall back to the list. */
export function getPosition(timeoutMs = 10_000): Promise<{ pos: Position | null; status: LocationStatus }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ pos: null, status: 'unavailable' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        resolve(pos.accuracy > MAX_USEFUL_ACCURACY_M ? { pos: null, status: 'rough' } : { pos, status: 'ok' });
      },
      (e) => resolve({ pos: null, status: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 120_000 },
    );
  });
}

export interface RankedBranch {
  branch: Branch;
  /** Null when there's no reading or the branch has no saved coordinates. */
  meters: number | null;
}

export type SuggestReason =
  | 'near' // one branch is clearly closest: preselect it
  | 'ambiguous' // two or more are about equally close: make the shopper tap
  | 'none-near' // location works but no saved branch is here: offer "Add this store"
  | 'no-location'; // no reading: recent branches first

export interface Suggestion {
  ranked: RankedBranch[];
  preselect: Branch | null;
  reason: SuggestReason;
  /** How many of the top rows are "here" (within reach). The screen shows these first. */
  nearCount: number;
}

const hasCoords = (b: Branch): b is Branch & GeoPoint => b.lat != null && b.lng != null;

/**
 * Orders branches for the picker. `byRecent` must already be sorted most-recently-used first;
 * that order is kept for branches without a distance.
 */
export function suggestBranches(byRecent: Branch[], pos: Position | null): Suggestion {
  if (!pos) {
    return { ranked: byRecent.map((branch) => ({ branch, meters: null })), preselect: null, reason: 'no-location', nearCount: 0 };
  }
  const ranked = byRecent.map((branch) => ({ branch, meters: hasCoords(branch) ? distanceM(pos, branch) : null }));
  // Stable sort: located branches by distance, then the rest in recent order.
  ranked.sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity));

  const reach = Math.max(NEAR_M, pos.accuracy);
  const near = ranked.filter((r) => r.meters != null && r.meters <= reach);
  if (near.length === 0) return { ranked, preselect: null, reason: 'none-near', nearCount: 0 };
  if (near.length === 1 || near[1].meters! - near[0].meters! >= AMBIGUOUS_GAP_M) {
    return { ranked, preselect: near[0].branch, reason: 'near', nearCount: near.length };
  }
  return { ranked, preselect: null, reason: 'ambiguous', nearCount: near.length };
}

/** An existing branch of the same chain close enough that a new one is probably a duplicate. */
export function nearbySameChain(branches: Branch[], chain: string, pos: Position | null): RankedBranch | null {
  if (!pos) return null;
  let best: RankedBranch | null = null;
  for (const b of branches) {
    if (b.chain !== chain || !hasCoords(b)) continue;
    const m = distanceM(pos, b);
    if (m <= DUPLICATE_M && (!best || m < best.meters!)) best = { branch: b, meters: m };
  }
  return best;
}

/** True when the reading is good enough to become a branch's saved location. */
export const goodEnoughToSave = (pos: Position | null): pos is Position => !!pos && pos.accuracy <= SAVE_ACCURACY_M;
