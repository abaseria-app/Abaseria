import { describe, expect, it } from 'vitest';
import type { Branch } from './db';
import { distanceM, formatDistance, goodEnoughToSave, nearbySameChain, suggestBranches, type Position } from './location';

// Test points are offsets from an arbitrary spot in Imus, not real store locations.
const BASE = { lat: 14.4297, lng: 120.9367 };
const M_PER_DEG_LAT = 111_195;
const north = (m: number) => ({ lat: BASE.lat + m / M_PER_DEG_LAT, lng: BASE.lng });
const east = (m: number) => ({ lat: BASE.lat, lng: BASE.lng + m / (M_PER_DEG_LAT * Math.cos((BASE.lat * Math.PI) / 180)) });

let n = 0;
const branch = (chain: string, name: string, at: { lat: number; lng: number } | null): Branch => ({
  id: ++n,
  uuid: `u-${n}`,
  chain,
  name,
  lat: at?.lat ?? null,
  lng: at?.lng ?? null,
  createdAt: '2026-11-01T00:00:00Z',
});
const here = (accuracy = 30): Position => ({ ...BASE, accuracy });

describe('distanceM', () => {
  it('measures short distances within a meter', () => {
    expect(distanceM(BASE, north(250))).toBeCloseTo(250, 0);
    expect(distanceM(BASE, east(1200))).toBeCloseTo(1200, 0);
  });
});

describe('formatDistance', () => {
  it('rounds to 10 m and switches to km', () => {
    expect(formatDistance(3)).toBe('10 m');
    expect(formatDistance(146)).toBe('150 m');
    expect(formatDistance(2340)).toBe('2.3 km');
    expect(formatDistance(15400)).toBe('15 km');
  });
});

describe('suggestBranches', () => {
  it('keeps recent order and preselects nothing without a reading', () => {
    const a = branch('Puregold', 'A', north(20));
    const b = branch('Puregold', 'B', north(5000));
    const s = suggestBranches([b, a], null);
    expect(s.reason).toBe('no-location');
    expect(s.preselect).toBeNull();
    expect(s.ranked.map((r) => r.branch.name)).toEqual(['B', 'A']);
  });

  it('preselects the only branch in reach', () => {
    const far = branch('SM Supermarket', 'Far', north(4000));
    const near = branch('Puregold', 'Near', east(60));
    const s = suggestBranches([far, near], here());
    expect(s.reason).toBe('near');
    expect(s.preselect?.name).toBe('Near');
    expect(s.nearCount).toBe(1);
    expect(s.ranked[0].branch.name).toBe('Near');
  });

  it('preselects the nearest when the next one is clearly farther', () => {
    const a = branch('Alfamart', 'A', north(20));
    const b = branch('7-Eleven', 'B', north(170)); // 150 m gap
    const s = suggestBranches([b, a], here());
    expect(s.reason).toBe('near');
    expect(s.preselect?.name).toBe('A');
    expect(s.nearCount).toBe(2);
  });

  it('makes the shopper choose when two stores are about equally close', () => {
    const sm = branch('SM Supermarket', 'Mall', north(40));
    const hyper = branch('SM Hypermarket', 'Mall', east(90)); // same building, 50 m apart from here
    const s = suggestBranches([sm, hyper], here());
    expect(s.reason).toBe('ambiguous');
    expect(s.preselect).toBeNull();
    expect(s.nearCount).toBe(2);
  });

  it('says none-near when every saved branch is out of reach', () => {
    const s = suggestBranches([branch('Puregold', 'X', north(900))], here());
    expect(s.reason).toBe('none-near');
    expect(s.preselect).toBeNull();
  });

  it('widens reach to the reading’s accuracy', () => {
    const b = branch('Puregold', 'X', north(450));
    expect(suggestBranches([b], here(30)).reason).toBe('none-near');
    expect(suggestBranches([b], here(500)).reason).toBe('near');
  });

  it('puts branches without coordinates after located ones, in recent order', () => {
    const p1 = branch('Puregold', 'Unpinned 1', null);
    const p2 = branch('Puregold', 'Unpinned 2', null);
    const loc = branch('Puregold', 'Pinned', north(2000));
    const s = suggestBranches([p1, loc, p2], here());
    expect(s.ranked.map((r) => r.branch.name)).toEqual(['Pinned', 'Unpinned 1', 'Unpinned 2']);
    expect(s.ranked[1].meters).toBeNull();
  });
});

describe('nearbySameChain', () => {
  it('flags a same-chain branch within 150 m', () => {
    const existing = branch('Puregold', 'Imus', north(80));
    expect(nearbySameChain([existing], 'Puregold', here())?.branch.name).toBe('Imus');
  });

  it('ignores other chains and far branches', () => {
    const other = branch('Savemore', 'Imus', north(20));
    const far = branch('Puregold', 'Bacoor', north(600));
    expect(nearbySameChain([other, far], 'Puregold', here())).toBeNull();
    expect(nearbySameChain([other], 'Savemore', null)).toBeNull();
  });
});

describe('goodEnoughToSave', () => {
  it('only pins branches from readings within 200 m', () => {
    expect(goodEnoughToSave(here(45))).toBe(true);
    expect(goodEnoughToSave(here(350))).toBe(false);
    expect(goodEnoughToSave(null)).toBe(false);
  });
});
