import { categoryOf, type CategoryId } from './categories';

export interface BreakdownTrip {
  startedAt: string;
  receiptCentavos: number | null;
  items: Array<{ label: string; category?: CategoryId | null; lineTotalCentavos: number }>;
}

export type SliceId = CategoryId | 'unitemized';

export interface Breakdown {
  /** Equals the dashboard headline: receipt totals where entered, the app's tally otherwise. */
  total: number;
  /** Biggest first, zero slices dropped. */
  slices: Array<{ id: SliceId; centavos: number }>;
}

/**
 * Splits spending by category so the pie always adds up to the headline total:
 * - Receipt higher than the items logged: the gap is its own "Not itemized" slice.
 * - Receipt lower (discounts, vouchers): that trip's items are scaled down to the receipt.
 */
export function categoryBreakdown(trips: BreakdownTrip[], start: Date, end: Date): Breakdown {
  const sums = new Map<SliceId, number>();
  const add = (id: SliceId, c: number) => sums.set(id, (sums.get(id) ?? 0) + c);
  let total = 0;

  for (const t of trips) {
    const ms = Date.parse(t.startedAt);
    if (ms < start.getTime() || ms >= end.getTime()) continue;
    const tally = t.items.reduce((s, i) => s + i.lineTotalCentavos, 0);
    const spent = t.receiptCentavos ?? tally;
    total += spent;

    if (spent >= tally) {
      for (const i of t.items) add(categoryOf(i), i.lineTotalCentavos);
      if (spent > tally) add('unitemized', spent - tally);
    } else {
      // Scale down, then put any rounding leftover on the trip's biggest item so the trip still sums exactly.
      let assigned = 0;
      let biggest: { id: CategoryId; c: number } | null = null;
      for (const i of t.items) {
        const c = Math.round((i.lineTotalCentavos * spent) / tally);
        const id = categoryOf(i);
        add(id, c);
        assigned += c;
        if (!biggest || c > biggest.c) biggest = { id, c };
      }
      if (biggest && assigned !== spent) add(biggest.id, spent - assigned);
    }
  }

  const slices = [...sums.entries()]
    .filter(([, c]) => c > 0)
    .map(([id, centavos]) => ({ id, centavos }))
    .sort((a, b) => b.centavos - a.centavos);
  return { total, slices };
}
