import { describe, expect, it } from 'vitest';
import { categoryBreakdown, type BreakdownTrip } from './breakdown';

const START = new Date(2026, 9, 1);
const END = new Date(2026, 10, 1);
const at = (d: number) => new Date(2026, 9, d, 10).toISOString();
const sum = (b: ReturnType<typeof categoryBreakdown>) => b.slices.reduce((s, x) => s + x.centavos, 0);

describe('categoryBreakdown', () => {
  it('sums item totals by category, biggest first', () => {
    const trips: BreakdownTrip[] = [
      {
        startedAt: at(5),
        receiptCentavos: null,
        items: [
          { label: 'Pork Liempo', lineTotalCentavos: 32000 },
          { label: 'Kamatis', lineTotalCentavos: 4000 },
          { label: 'Jasmine Rice 5kg', lineTotalCentavos: 29000 },
          { label: 'Mystery', category: 'pantry', lineTotalCentavos: 5000 },
        ],
      },
    ];
    const b = categoryBreakdown(trips, START, END);
    expect(b.total).toBe(70000);
    expect(b.slices).toEqual([
      { id: 'meat', centavos: 32000 },
      { id: 'dry', centavos: 29000 },
      { id: 'pantry', centavos: 5000 },
      { id: 'vegetables', centavos: 4000 },
    ]);
  });

  it('shows the gap when the receipt is higher than what was logged', () => {
    const b = categoryBreakdown(
      [{ startedAt: at(5), receiptCentavos: 150000, items: [{ label: 'Chicken', lineTotalCentavos: 100000 }] }],
      START, END,
    );
    expect(b.total).toBe(150000);
    expect(b.slices).toContainEqual({ id: 'unitemized', centavos: 50000 });
    expect(sum(b)).toBe(150000);
  });

  it('scales items down when the receipt is lower, and still sums exactly', () => {
    const b = categoryBreakdown(
      [{
        startedAt: at(5),
        receiptCentavos: 10000,
        items: [
          { label: 'Chicken', lineTotalCentavos: 3333 },
          { label: 'Rice', lineTotalCentavos: 3333 },
          { label: 'Soap', lineTotalCentavos: 3334 },
          { label: 'Kamatis', lineTotalCentavos: 1000 },
        ],
      }],
      START, END,
    );
    expect(b.total).toBe(10000);
    expect(sum(b)).toBe(10000);
    expect(b.slices.find((s) => s.id === 'unitemized')).toBeUndefined();
  });

  it('skips trips outside the range', () => {
    const b = categoryBreakdown(
      [{ startedAt: new Date(2026, 8, 30, 10).toISOString(), receiptCentavos: null, items: [{ label: 'Rice', lineTotalCentavos: 500 }] }],
      START, END,
    );
    expect(b.total).toBe(0);
    expect(b.slices).toEqual([]);
  });
});
