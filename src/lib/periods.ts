// Time frames for the home dashboard. All dates are the phone's local time.

export type Period = 'week' | 'month' | 'year' | 'ytd';
export const PERIODS: Period[] = ['week', 'month', 'year', 'ytd'];

export interface Bucket {
  label: string;
  start: Date;
  end: Date;
}

export interface Range {
  start: Date;
  /** Exclusive. */
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  buckets: Bucket[];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const day = (y: number, m: number, d: number) => new Date(y, m, d);
const addDays = (d: Date, n: number) => day(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => day(d.getFullYear(), d.getMonth() + n, 1);

/**
 * week:  this calendar week, Monday to Sunday. Compared with last week.
 * month: this calendar month. Compared with last month.
 * year:  the last 12 months including this one. Compared with the 12 before that.
 * ytd:   Jan 1 to the end of today. Compared with Jan 1 to the same date last year.
 */
export function rangeFor(period: Period, now: Date): Range {
  const today = day(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'week') {
    const start = addDays(today, -((today.getDay() + 6) % 7));
    return {
      start,
      end: addDays(start, 7),
      prevStart: addDays(start, -7),
      prevEnd: start,
      buckets: DAY_LABELS.map((label, i) => ({ label, start: addDays(start, i), end: addDays(start, i + 1) })),
    };
  }

  if (period === 'month') {
    const start = day(today.getFullYear(), today.getMonth(), 1);
    const end = addMonths(start, 1);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return {
      start,
      end,
      prevStart: addMonths(start, -1),
      prevEnd: start,
      buckets: Array.from({ length: days }, (_, i) => ({ label: String(i + 1), start: addDays(start, i), end: addDays(start, i + 1) })),
    };
  }

  if (period === 'year') {
    const end = day(today.getFullYear(), today.getMonth() + 1, 1);
    const start = addMonths(end, -12);
    return {
      start,
      end,
      prevStart: addMonths(start, -12),
      prevEnd: start,
      buckets: Array.from({ length: 12 }, (_, i) => {
        const s = addMonths(start, i);
        return { label: MONTH_LABELS[s.getMonth()], start: s, end: addMonths(s, 1) };
      }),
    };
  }

  // ytd
  const start = day(today.getFullYear(), 0, 1);
  const end = addDays(today, 1);
  return {
    start,
    end,
    prevStart: day(today.getFullYear() - 1, 0, 1),
    prevEnd: day(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1),
    buckets: Array.from({ length: today.getMonth() + 1 }, (_, i) => {
      const s = day(today.getFullYear(), i, 1);
      return { label: MONTH_LABELS[i], start: s, end: i === today.getMonth() ? end : addMonths(s, 1) };
    }),
  };
}

export interface SpendTrip {
  startedAt: string;
  /** What the trip cost: the receipt total when the shopper entered one, otherwise the app's tally. */
  spentCentavos: number;
}

export interface Summary {
  total: number;
  trips: number;
  avgPerTrip: number;
  prevTotal: number;
  prevTrips: number;
  /** Change vs the previous period, as a percentage. Null when the previous period had no spending. */
  changePct: number | null;
  buckets: Array<{ label: string; total: number }>;
}

const inRange = (iso: string, a: Date, b: Date) => {
  const t = Date.parse(iso);
  return t >= a.getTime() && t < b.getTime();
};

export function summarize(trips: SpendTrip[], period: Period, now: Date): Summary {
  const r = rangeFor(period, now);
  const cur = trips.filter((t) => inRange(t.startedAt, r.start, r.end));
  const prev = trips.filter((t) => inRange(t.startedAt, r.prevStart, r.prevEnd));
  const total = cur.reduce((s, t) => s + t.spentCentavos, 0);
  const prevTotal = prev.reduce((s, t) => s + t.spentCentavos, 0);
  return {
    total,
    trips: cur.length,
    avgPerTrip: cur.length ? Math.round(total / cur.length) : 0,
    prevTotal,
    prevTrips: prev.length,
    changePct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
    buckets: r.buckets.map((b) => ({
      label: b.label,
      total: cur.filter((t) => inRange(t.startedAt, b.start, b.end)).reduce((s, t) => s + t.spentCentavos, 0),
    })),
  };
}
