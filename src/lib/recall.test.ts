import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, recallBarcode, type Item } from './db';

const item = (tripId: number, price: number, createdAt: string, extra: Partial<Item> = {}): Item => ({
  tripId,
  barcode: '4800016644115',
  label: 'Lucky Me Pancit Canton',
  priceType: 'each',
  unitPriceCentavos: price,
  bundleQty: null,
  bundlePriceCentavos: null,
  isPromo: false,
  quantity: 1,
  lineTotalCentavos: price,
  category: 'dry',
  captureMethod: 'tag',
  removed: false,
  createdAt,
  ...extra,
});

const trip = (branchUuid: string, startedAt: string) => ({
  chain: 'Puregold', customStore: 'Test', branchUuid, budgetCentavos: null, testerId: null, tripIndex: 1, prompted: false,
  startedAt, endedAt: null, receiptMatched: null, receiptTotalCentavos: null, receiptItemCount: null,
});

describe('recallBarcode', () => {
  beforeEach(async () => {
    await Promise.all([db.items.clear(), db.trips.clear()]);
  });

  it('returns null for a barcode never logged', async () => {
    expect(await recallBarcode('4800016644115', 'imus')).toBeNull();
  });

  it('prefers the latest price at this branch over a newer one elsewhere', async () => {
    const imus = await db.trips.add(trip('imus', '2026-10-20T08:00:00Z'));
    const bacoor = await db.trips.add(trip('bacoor', '2026-10-28T08:00:00Z'));
    await db.items.bulkAdd([
      item(imus, 1500, '2026-10-20T08:10:00Z'),
      item(imus, 1550, '2026-10-21T08:10:00Z'),
      item(bacoor, 1400, '2026-10-28T08:10:00Z'),
    ]);
    const r = await recallBarcode('4800016644115', 'imus');
    expect(r?.sameBranch).toBe(true);
    expect(r?.item.unitPriceCentavos).toBe(1550);
  });

  it('falls back to the newest item anywhere, flagged as another branch', async () => {
    const bacoor = await db.trips.add(trip('bacoor', '2026-10-28T08:00:00Z'));
    await db.items.add(item(bacoor, 1400, '2026-10-28T08:10:00Z'));
    const r = await recallBarcode('4800016644115', 'imus');
    expect(r?.sameBranch).toBe(false);
    expect(r?.item.label).toBe('Lucky Me Pancit Canton');
  });

  it('ignores removed items', async () => {
    const imus = await db.trips.add(trip('imus', '2026-10-20T08:00:00Z'));
    await db.items.add(item(imus, 1500, '2026-10-20T08:10:00Z', { removed: true }));
    expect(await recallBarcode('4800016644115', 'imus')).toBeNull();
  });
});
