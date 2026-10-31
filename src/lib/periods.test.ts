import { describe, expect, it } from 'vitest';
import { rangeFor, summarize, type SpendTrip } from './periods';

// Sat 31 Oct 2026, 8:30 pm local
const NOW = new Date(2026, 9, 31, 20, 30);
const d = (y: number, m: number, dd: number, h = 10) => new Date(y, m - 1, dd, h).toISOString();
const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;

describe('rangeFor', () => {
  it('week runs Monday to Sunday', () => {
    const r = rangeFor('week', NOW);
    expect(ymd(r.start)).toBe('2026-10-26');
    expect(ymd(r.end)).toBe('2026-11-2');
    expect(ymd(r.prevStart)).toBe('2026-10-19');
    expect(r.buckets.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('week starting on a Sunday still belongs to the week that began Monday', () => {
    const r = rangeFor('week', new Date(2026, 10, 1, 9)); // Sun 1 Nov
    expect(ymd(r.start)).toBe('2026-10-26');
  });

  it('month is the calendar month with a bar per day', () => {
    const r = rangeFor('month', NOW);
    expect(ymd(r.start)).toBe('2026-10-1');
    expect(ymd(r.end)).toBe('2026-11-1');
    expect(ymd(r.prevStart)).toBe('2026-9-1');
    expect(r.buckets).toHaveLength(31);
  });

  it('year is the last 12 months, ending with this month', () => {
    const r = rangeFor('year', NOW);
    expect(ymd(r.start)).toBe('2025-11-1');
    expect(ymd(r.end)).toBe('2026-11-1');
    expect(r.buckets[0].label).toBe('Nov');
    expect(r.buckets[11].label).toBe('Oct');
  });

  it('ytd runs Jan 1 through today and compares with the same span last year', () => {
    const r = rangeFor('ytd', NOW);
    expect(ymd(r.start)).toBe('2026-1-1');
    expect(ymd(r.end)).toBe('2026-11-1');
    expect(ymd(r.prevStart)).toBe('2025-1-1');
    expect(ymd(r.prevEnd)).toBe('2025-11-1');
    expect(r.buckets).toHaveLength(10);
  });
});

describe('summarize', () => {
  const trips: SpendTrip[] = [
    { startedAt: d(2026, 10, 31), spentCentavos: 150000 }, // this week, Sat
    { startedAt: d(2026, 10, 27), spentCentavos: 50000 }, // this week, Tue
    { startedAt: d(2026, 10, 20), spentCentavos: 100000 }, // last week
    { startedAt: d(2026, 9, 15), spentCentavos: 80000 }, // last month
    { startedAt: d(2025, 10, 10), spentCentavos: 30000 }, // last year, same YTD window
  ];

  it('totals the week and compares with last week', () => {
    const s = summarize(trips, 'week', NOW);
    expect(s.total).toBe(200000);
    expect(s.trips).toBe(2);
    expect(s.avgPerTrip).toBe(100000);
    expect(s.prevTotal).toBe(100000);
    expect(s.changePct).toBe(100);
    expect(s.buckets.find((b) => b.label === 'Sat')?.total).toBe(150000);
    expect(s.buckets.find((b) => b.label === 'Tue')?.total).toBe(50000);
  });

  it('totals the month', () => {
    const s = summarize(trips, 'month', NOW);
    expect(s.total).toBe(300000);
    expect(s.prevTotal).toBe(80000);
  });

  it('ytd vs same span last year', () => {
    const s = summarize(trips, 'ytd', NOW);
    expect(s.total).toBe(380000);
    expect(s.prevTotal).toBe(30000);
  });

  it('no previous spending means no percentage', () => {
    const s = summarize([{ startedAt: d(2026, 10, 31), spentCentavos: 100 }], 'week', NOW);
    expect(s.changePct).toBeNull();
  });
});
