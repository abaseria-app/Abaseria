import { describe, expect, it } from 'vitest';
import type { Item, Trip } from './db';
import { nextFromProfile, parseBudget, spentThisMonth } from './monthlyBudget';

describe('nextFromProfile', () => {
  it('fills an empty budget from the answer', () => {
    expect(nextFromProfile(null, 6000)).toEqual({ centavos: 600_000, source: 'profile' });
  });
  it('follows a changed answer', () => {
    expect(nextFromProfile({ centavos: 600_000, source: 'profile' }, 9000)).toEqual({ centavos: 900_000, source: 'profile' });
    expect(nextFromProfile({ centavos: 600_000, source: 'profile' }, 6000)).toBeUndefined();
  });
  it('drops the amount when the answer is removed or turned off', () => {
    expect(nextFromProfile({ centavos: 600_000, source: 'profile' }, null)).toBeNull();
    expect(nextFromProfile(null, null)).toBeUndefined();
  });
  it('never overwrites an amount the shopper typed', () => {
    expect(nextFromProfile({ centavos: 720_000, source: 'shopper' }, 15000)).toBeUndefined();
    expect(nextFromProfile({ centavos: 720_000, source: 'shopper' }, null)).toBeUndefined();
  });
});

describe('parseBudget', () => {
  it('survives junk', () => {
    expect(parseBudget(null)).toBeNull();
    expect(parseBudget('')).toBeNull();
    expect(parseBudget('{"centavos":-5,"source":"shopper"}')).toBeNull();
    expect(parseBudget('{"centavos":600000,"source":"profile"}')).toEqual({ centavos: 600_000, source: 'profile' });
  });
});

describe('spentThisMonth', () => {
  const trip = (id: number, startedAt: string, extra: Partial<Trip> = {}): Trip =>
    ({ id, chain: 'SM', customStore: null, budgetCentavos: null, testerId: null, tripIndex: 1, prompted: false, startedAt,
      endedAt: startedAt, receiptMatched: null, receiptTotalCentavos: null, receiptItemCount: null, ...extra }) as Trip;
  const item = (tripId: number, c: number, removed = false) => ({ tripId, lineTotalCentavos: c, removed }) as unknown as Item;
  const now = new Date('2026-11-18T02:00:00Z');

  it('adds this month’s finished trips, receipt total first', () => {
    const trips = [trip(1, '2026-11-02T03:00:00Z'), trip(2, '2026-11-10T03:00:00Z', { receiptTotalCentavos: 150_000 })];
    const items = [item(1, 100_000), item(1, 25_050), item(1, 9_999, true), item(2, 140_000)];
    expect(spentThisMonth(trips, items, now)).toBe(125_050 + 150_000);
  });
  it('skips last month, cancelled trips and the trip in progress', () => {
    const trips = [
      trip(1, '2026-10-31T16:30:00Z'), // Nov 1, 12:30 AM Manila: counts
      trip(5, '2026-10-31T15:30:00Z'), // Oct 31, 11:30 PM Manila: doesn't
      trip(2, '2026-10-31T10:00:00Z'), // Oct 31 Manila: doesn't
      trip(3, '2026-11-05T03:00:00Z', { cancelledAt: '2026-11-05T04:00:00Z' }),
      trip(4, '2026-11-18T01:00:00Z', { endedAt: null }),
    ];
    const items = [item(1, 50_000), item(2, 70_000), item(3, 80_000), item(4, 90_000), item(5, 60_000)];
    expect(spentThisMonth(trips, items, now)).toBe(50_000);
  });
});
