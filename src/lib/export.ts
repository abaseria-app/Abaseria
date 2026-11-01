import { db, storeName, type AppEvent, type Item, type Trip } from './db';
import { categoryOf } from './categories';

// Written down before any data comes in, so a result can't be reinterpreted after the fact.
export const PASS_LINE = {
  minBasket: 20, // receipt items; smaller baskets don't test persistence
  minCoveragePct: 80,
  testersNeeded: 6,
};

export interface TripRow {
  trip_id: number;
  tester_id: string;
  trip_index: number;
  prompted: boolean;
  days_since_prev_trip: number | '';
  store: string;
  branch_id: string;
  cancelled: boolean;
  started_at: string;
  ended_at: string;
  minutes: number | '';
  budget: number | '';
  items_logged: number;
  items_by_tag: number;
  items_typed: number;
  app_total: number;
  receipt_total: number | '';
  receipt_item_count: number | '';
  coverage_pct: number | '';
  matched: string;
  median_sec_per_tag_item: number | '';
  abandons: number;
}

const pesos = (c: number | null) => (c == null ? '' : c / 100);

function median(xs: number[]): number | '' {
  if (!xs.length) return '';
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function coveragePct(itemsLogged: number, receiptItems: number | null): number | '' {
  if (!receiptItems) return '';
  return Math.round((Math.min(itemsLogged, receiptItems) / receiptItems) * 100);
}

export function buildTripRows(trips: Trip[], items: Item[], events: AppEvent[]): TripRow[] {
  const sorted = [...trips].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const lastStartByTester = new Map<string, string>();
  return sorted.map((t) => {
    const its = items.filter((i) => i.tripId === t.id && !i.removed);
    const evs = events.filter((e) => e.tripId === t.id);
    const tagSecs = evs
      .filter((e) => e.type === 'item_added')
      .map((e) => JSON.parse(e.payload))
      .filter((p) => String(p.capture_method).startsWith('tag'))
      .map((p) => Math.round(p.ms_since_open / 100) / 10);
    const tester = t.testerId ?? '';
    const prev = tester ? lastStartByTester.get(tester) : undefined;
    if (tester) lastStartByTester.set(tester, t.startedAt);
    return {
      trip_id: t.id!,
      tester_id: tester,
      trip_index: t.tripIndex,
      prompted: t.prompted,
      days_since_prev_trip: prev ? Math.round(((Date.parse(t.startedAt) - Date.parse(prev)) / 86_400_000) * 10) / 10 : '',
      store: storeName(t),
      branch_id: t.branchUuid ?? '',
      cancelled: !!t.cancelledAt,
      started_at: t.startedAt,
      ended_at: t.endedAt ?? '',
      minutes: t.endedAt ? Math.round((Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 6000) / 10 : '',
      budget: pesos(t.budgetCentavos),
      items_logged: its.length,
      items_by_tag: its.filter((i) => i.captureMethod.startsWith('tag')).length,
      items_typed: its.filter((i) => i.captureMethod === 'typed').length,
      app_total: its.reduce((s, i) => s + i.lineTotalCentavos, 0) / 100,
      receipt_total: pesos(t.receiptTotalCentavos),
      receipt_item_count: t.receiptItemCount ?? '',
      coverage_pct: coveragePct(its.length, t.receiptItemCount),
      matched: t.receiptMatched == null ? '' : t.receiptMatched ? 'yes' : 'no',
      median_sec_per_tag_item: median(tagSecs),
      abandons: evs.filter((e) => e.type === 'capture_abandoned').length,
    };
  });
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export interface TestResults {
  testers: number;
  bigBasketTesters: number;
  passedCoverage: number;
  pass: boolean;
  secondTripUnprompted: number;
  medianSecPerTagItem: number | '';
  perTester: Array<{ tester: string; firstTripCoverage: number | ''; basket: number | ''; trips: number; unpromptedRepeat: boolean }>;
}

/** Combines trips.csv rows from every tester's phone and checks them against PASS_LINE. */
export function computeResults(rows: Record<string, string>[]): TestResults {
  const byTester = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const t = r.tester_id?.trim();
    if (!t || r.cancelled === 'true') continue;
    byTester.set(t, [...(byTester.get(t) ?? []), r]);
  }
  const perTester: TestResults['perTester'] = [];
  const secs: number[] = [];
  for (const [tester, trs] of byTester) {
    const sorted = trs.sort((a, b) => Number(a.trip_index) - Number(b.trip_index));
    // The pass line is judged on trip 1 only. Later trips measure whether they came back.
    const first = sorted.find((r) => r.trip_index === '1');
    const cov = !first || first.coverage_pct === '' ? '' : Number(first.coverage_pct);
    const basket = !first || first.receipt_item_count === '' ? '' : Number(first.receipt_item_count);
    if (first && first.median_sec_per_tag_item !== '') secs.push(Number(first.median_sec_per_tag_item));
    perTester.push({
      tester,
      firstTripCoverage: cov,
      basket,
      trips: sorted.length,
      unpromptedRepeat: sorted.some((r) => Number(r.trip_index) >= 2 && r.prompted === 'false'),
    });
  }
  const big = perTester.filter((p) => p.basket !== '' && p.basket >= PASS_LINE.minBasket);
  const passed = big.filter((p) => p.firstTripCoverage !== '' && p.firstTripCoverage >= PASS_LINE.minCoveragePct).length;
  return {
    testers: perTester.length,
    bigBasketTesters: big.length,
    passedCoverage: passed,
    pass: passed >= PASS_LINE.testersNeeded,
    secondTripUnprompted: perTester.filter((p) => p.unpromptedRepeat).length,
    medianSecPerTagItem: median(secs),
    perTester: perTester.sort((a, b) => a.tester.localeCompare(b.tester)),
  };
}

export async function exportCsvFiles(): Promise<'shared' | 'downloaded'> {
  const [trips, items, events] = await Promise.all([db.trips.toArray(), db.items.toArray(), db.events.toArray()]);
  const tripCsv = toCsv(buildTripRows(trips, items, events) as unknown as Record<string, unknown>[], TRIP_HEADERS);
  const eventCsv = toCsv(
    events.map((e) => ({ event_id: e.id, trip_id: e.tripId ?? '', type: e.type, created_at: e.createdAt, payload: e.payload })),
    ['event_id', 'trip_id', 'type', 'created_at', 'payload'],
  );
  const itemCsv = toCsv(
    items.map((i) => ({
      item_id: i.id, trip_id: i.tripId, barcode: i.barcode ?? '', label: i.label, price_type: i.priceType, unit_price: i.unitPriceCentavos / 100,
      bundle_qty: i.bundleQty ?? '', bundle_price: pesos(i.bundlePriceCentavos), promo: i.isPromo, quantity: i.quantity,
      weight_kg: i.weightGrams != null ? i.weightGrams / 1000 : '',
      line_total: i.lineTotalCentavos / 100, category: categoryOf(i), capture_method: i.captureMethod, removed: i.removed, created_at: i.createdAt,
    })),
  );
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const files = [
    new File([tripCsv], `trips-${stamp}.csv`, { type: 'text/csv' }),
    new File([eventCsv], `events-${stamp}.csv`, { type: 'text/csv' }),
    new File([itemCsv], `items-${stamp}.csv`, { type: 'text/csv' }),
  ];
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: 'Abeseria test data' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return 'downloaded';
}

export const TRIP_HEADERS: string[] = [
  'trip_id', 'tester_id', 'trip_index', 'prompted', 'days_since_prev_trip', 'store', 'started_at', 'ended_at', 'minutes',
  'budget', 'items_logged', 'items_by_tag', 'items_typed', 'app_total', 'receipt_total', 'receipt_item_count',
  'coverage_pct', 'matched', 'median_sec_per_tag_item', 'abandons',
  // Added with branches; last so older combine sheets keep their column positions.
  'branch_id', 'cancelled',
];
