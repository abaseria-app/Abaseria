import { describe, expect, it } from 'vitest';
import { buildTripRows, computeResults, coveragePct, parseCsv, toCsv, TRIP_HEADERS } from './export';
import type { AppEvent, Item, Trip } from './db';

const trip = (id: number, tester: string, idx: number, start: string, receiptItems: number | null, prompted = true): Trip => ({
  id, chain: 'Puregold', customStore: null, budgetCentavos: 200000, testerId: tester, tripIndex: idx, prompted,
  startedAt: start, endedAt: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  receiptMatched: true, receiptTotalCentavos: 150000, receiptItemCount: receiptItems,
});
const item = (tripId: number, n: number, removed = false): Item => ({
  tripId, label: `Item ${n}`, priceType: 'each', unitPriceCentavos: 5000, bundleQty: null, bundlePriceCentavos: null,
  isPromo: false, quantity: 1, lineTotalCentavos: 5000, captureMethod: n % 2 ? 'tag' : 'typed', removed, createdAt: '2026-11-01T00:00:00Z',
});

describe('coveragePct', () => {
  it('caps at 100 and handles missing receipt counts', () => {
    expect(coveragePct(18, 24)).toBe(75);
    expect(coveragePct(30, 24)).toBe(100);
    expect(coveragePct(5, null)).toBe('');
  });
});

describe('buildTripRows', () => {
  it('counts live items, coverage, minutes and gap between a tester’s trips', () => {
    const trips = [trip(1, 'T01', 1, '2026-11-01T02:00:00Z', 24), trip(2, 'T01', 2, '2026-11-08T02:00:00Z', 20, false)];
    const items = [...Array.from({ length: 20 }, (_, i) => item(1, i)), item(1, 99, true)];
    const events: AppEvent[] = [
      { tripId: 1, type: 'item_added', payload: JSON.stringify({ capture_method: 'tag', ms_since_open: 7000 }), createdAt: '' },
      { tripId: 1, type: 'item_added', payload: JSON.stringify({ capture_method: 'tag', ms_since_open: 9000 }), createdAt: '' },
      { tripId: 1, type: 'capture_abandoned', payload: '{}', createdAt: '' },
    ];
    const [a, b] = buildTripRows(trips, items, events);
    expect(a.items_logged).toBe(20);
    expect(a.coverage_pct).toBe(83);
    expect(a.minutes).toBe(30);
    expect(a.median_sec_per_tag_item).toBe(8);
    expect(a.abandons).toBe(1);
    expect(a.app_total).toBe(1000);
    expect(b.days_since_prev_trip).toBe(7);
  });
});

describe('CSV round trip and pass line', () => {
  it('survives commas and quotes', () => {
    const csv = toCsv([{ a: 'x, "y"', b: 2 }]);
    expect(parseCsv(csv)).toEqual([{ a: 'x, "y"', b: '2' }]);
  });

  it('passes only when 6+ big-basket testers reach 80% on their first trip', () => {
    const rows: Record<string, string>[] = [];
    const mk = (t: string, idx: number, basket: number, cov: number, prompted: boolean) =>
      rows.push(Object.fromEntries(TRIP_HEADERS.map((h) => [h, ''])) as Record<string, string>) &&
      Object.assign(rows[rows.length - 1], {
        tester_id: t, trip_index: String(idx), receipt_item_count: String(basket), coverage_pct: String(cov),
        prompted: String(prompted), median_sec_per_tag_item: '9',
      });
    for (let i = 1; i <= 6; i++) mk(`T0${i}`, 1, 25, 85, true);
    mk('T07', 1, 25, 40, true);
    mk('T08', 1, 12, 100, true); // small basket, doesn't count either way
    mk('T01', 2, 22, 90, false);
    const r = computeResults(rows);
    expect(r.testers).toBe(8);
    expect(r.bigBasketTesters).toBe(7);
    expect(r.passedCoverage).toBe(6);
    expect(r.pass).toBe(true);
    expect(r.secondTripUnprompted).toBe(1);

    rows.splice(0, 1); // drop T01's first trip: now only 5 pass
    expect(computeResults(rows).pass).toBe(false);
  });
});
