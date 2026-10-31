import { db } from './db';

/**
 * Test instrumentation. Every event lands in IndexedDB with a timestamp and is exported to events.csv.
 *
 * trip_start        store, budget, tester_id, trip_index, prompted
 * capture_open      method: 'tag' | 'typed'
 * camera_error      reason
 * ocr_done          ms, candidates, name_guessed
 * price_chosen      rank (1-4) or 'typed', edited_after
 * item_added        capture_method, ms_since_open, line_total
 * capture_abandoned step: 'camera' | 'chips' | 'confirm' | 'type'
 * item_edited       item_id, before, after
 * item_removed      item_id, line_total
 * over_budget_shown total, budget
 * receipt_check     matched, receipt_total, difference, receipt_item_count, items_logged, coverage_pct
 * trip_end          items, total, minutes, trip_index
 */
export async function logEvent(type: string, tripId: number | null, payload: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.events.add({ tripId, type, payload: JSON.stringify(payload), createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('event log failed', type, e);
  }
}
