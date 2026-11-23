import { describe, expect, it } from 'vitest';
import type { Branch, Item, Trip } from './db';
import { buildPhoneCatalog, buildSharedCatalog, isStale, lowestCurrent, mergeCatalogs, sortByPrice } from './catalog';
import { NO_FILTERS, searchCatalog, type PricePoint } from './search';

const branch = (uuid: string, name: string, remoteId: string | null = null): Branch => ({
  id: 1, uuid, chain: 'Puregold', name, lat: null, lng: null, createdAt: '2026-10-01T00:00:00Z', remoteId,
});

const trip = (id: number, branchUuid: string | null, extra: Partial<Trip> = {}): Trip => ({
  id, chain: 'Puregold', customStore: branchUuid ? 'Imus Anabu' : null, branchUuid, budgetCentavos: null, testerId: null,
  tripIndex: 1, prompted: false, startedAt: '2026-11-01T10:00:00', endedAt: '2026-11-01T11:00:00',
  receiptMatched: null, receiptTotalCentavos: null, receiptItemCount: null, ...extra,
});

const it_ = (tripId: number, label: string, centavos: number, createdAt: string, extra: Partial<Item> = {}): Item => ({
  tripId, barcode: null, label, priceType: 'each', unitPriceCentavos: centavos, bundleQty: null, bundlePriceCentavos: null,
  isPromo: false, quantity: 1, lineTotalCentavos: centavos, category: null, captureMethod: 'tag', removed: false, createdAt, ...extra,
});

describe('buildPhoneCatalog', () => {
  const branches = [branch('b-anabu', 'Imus Anabu', 'remote-anabu')];
  const trips = [trip(1, 'b-anabu'), trip(2, 'b-anabu'), trip(3, 'b-anabu', { cancelledAt: '2026-11-03T00:00:00' }), trip(4, null, { chain: 'Sari-sari store' })];

  it('keeps the latest price per store and skips cancelled, removed and unnamed items', () => {
    const cat = buildPhoneCatalog(
      [
        it_(1, 'Lucky Me Pancit Canton', 1500, '2026-11-01T10:10:00', { barcode: '4807770270017' }),
        it_(2, 'Lucky Me Pancit Canton', 1650, '2026-11-04T10:10:00', { barcode: '4807770270017' }),
        it_(3, 'Lucky Me Pancit Canton', 999, '2026-11-05T10:10:00', { barcode: '4807770270017' }), // cancelled trip
        it_(2, 'Kangkong', 2000, '2026-11-04T10:12:00'),
        it_(2, 'Removed thing', 100, '2026-11-04T10:13:00', { removed: true }),
        it_(2, 'Item •03', 4500, '2026-11-04T10:14:00'),
        it_(4, 'kangkong', 1800, '2026-11-02T08:00:00'),
      ],
      trips,
      branches,
    );
    expect(cat.map((c) => c.name).sort()).toEqual(['Kangkong', 'Lucky Me Pancit Canton']);
    const canton = cat.find((c) => c.barcode === '4807770270017')!;
    expect(canton.prices).toHaveLength(1);
    expect(canton.prices[0]).toMatchObject({ unitPriceCentavos: 1650, storeKey: 'remote-anabu', seenOn: '2026-11-04', source: 'phone' });
    expect(canton.category).toBe('pantry staples');
    const kangkong = cat.find((c) => c.name === 'Kangkong')!;
    expect(kangkong.prices.map((p) => p.storeLabel)).toEqual(['Puregold Imus Anabu', 'Sari-sari store']);
  });
});

describe('mergeCatalogs', () => {
  const shared = buildSharedCatalog(
    [
      { barcode: '4807770270017', name: 'Lucky Me! Pancit Canton Chilimansi', size: '80g', category: 'pantry staples', image_path: '4807770270017.jpg' },
      { barcode: '4801981116072', name: 'Coke Original 1.5L', size: '1.5L', category: null, image_path: null },
    ],
    [
      { barcode: '4807770270017', branch_id: 'remote-anabu', seen_on: '2026-11-02', price_type: 'each', unit_price_centavos: 1600, bundle_qty: null, bundle_price_centavos: null, is_promo: false },
      { barcode: '4807770270017', branch_id: 'remote-sm', seen_on: '2026-11-05', price_type: 'each', unit_price_centavos: 1700, bundle_qty: null, bundle_price_centavos: null, is_promo: false },
    ],
    [
      { id: 'remote-anabu', chain: 'Puregold', name: 'Imus Anabu' },
      { id: 'remote-sm', chain: 'SM Supermarket', name: 'Imus' },
    ],
    (path) => `https://img.example/${path}`,
  );

  it('fills names, sizes, pictures and store names from the shared database', () => {
    const coke = shared.find((s) => s.barcode === '4801981116072')!;
    expect(coke).toMatchObject({ size: '1.5L', category: 'beverages', image: null });
    const canton = shared.find((s) => s.barcode === '4807770270017')!;
    expect(canton.image).toBe('https://img.example/4807770270017.jpg');
    expect(canton.prices.map((p) => p.storeLabel)).toEqual(['SM Supermarket Imus', 'Puregold Imus Anabu']);
  });

  it('merges by barcode: shared details, newest price per store', () => {
    const phone = buildPhoneCatalog(
      [it_(1, 'Pancit canton', 1650, '2026-11-04T10:10:00', { barcode: '4807770270017', thumb: 'data:image/jpeg;base64,xx' })],
      [trip(1, 'b-anabu')],
      [branch('b-anabu', 'Imus Anabu', 'remote-anabu')],
    );
    const merged = mergeCatalogs(phone, shared);
    expect(merged).toHaveLength(2);
    const canton = merged.find((m) => m.barcode === '4807770270017')!;
    expect(canton.name).toBe('Lucky Me! Pancit Canton Chilimansi');
    expect(canton.size).toBe('80g');
    expect(canton.image).toBe('data:image/jpeg;base64,xx');
    // Anabu: this phone saw ₱16.50 on Nov 4, newer than the shared ₱16.00 from Nov 2.
    expect(canton.prices.map((p) => [p.storeKey, p.unitPriceCentavos, p.source])).toEqual([
      ['remote-sm', 1700, 'shared'],
      ['remote-anabu', 1650, 'phone'],
    ]);
  });

  it('makes shared sizes searchable alongside phone prices', () => {
    const merged = mergeCatalogs([], shared);
    const hits = searchCatalog(merged, '1.5 liter', NO_FILTERS, 'best', '2026-11-06');
    expect(hits.map((h) => h.item.barcode)).toEqual(['4801981116072']);
    expect(searchCatalog(merged, '4807', NO_FILTERS, 'best', '2026-11-06').map((h) => h.item.barcode)).toEqual(['4807770270017']);
  });
});

describe('store price comparison', () => {
  const pp = (storeKey: string, centavos: number, seenOn: string, extra: Partial<PricePoint> = {}): PricePoint => ({
    storeKey, storeLabel: storeKey, seenOn, priceType: 'each', unitPriceCentavos: centavos, bundleQty: null, bundlePriceCentavos: null,
    isPromo: false, source: 'shared', ...extra,
  });
  const today = '2026-11-20';

  it('sorts cheapest first, comparing bundles per piece and newest first on a tie', () => {
    const list = sortByPrice([
      pp('a', 12000, '2026-11-18'),
      pp('b', 0, '2026-11-18', { priceType: 'bundle', bundleQty: 3, bundlePriceCentavos: 30000 }),
      pp('c', 11500, '2026-11-01'),
      pp('d', 11500, '2026-11-19'),
    ]);
    expect(list.map((p) => p.storeKey)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('never calls a price older than 30 days the lowest', () => {
    const list = [pp('old', 9000, '2026-10-01'), pp('now', 11500, '2026-11-19'), pp('dear', 13000, '2026-11-15')];
    expect(isStale(list[0], today)).toBe(true);
    expect(isStale(pp('edge', 1, '2026-10-21'), today)).toBe(false);
    expect(lowestCurrent(list, today)?.storeKey).toBe('now');
    expect(lowestCurrent([pp('old', 9000, '2026-09-01')], today)).toBeNull();
  });
});

describe('SRP (reference price)', () => {
  const products = [
    { barcode: '4807770270017', name: 'Lucky Me! Pancit Canton Chilimansi', size: '60g', category: 'pantry staples', image_path: null },
    { barcode: '4801981116072', name: 'Coke Original 1.5L', size: '1.5L', category: null, image_path: null },
  ];
  const one = [{ barcode: '4807770270017', branch_id: 'b1', seen_on: '2026-11-05', price_type: 'each' as const, unit_price_centavos: 1700, bundle_qty: null, bundle_price_centavos: null, is_promo: false }];
  const branches = [{ id: 'b1', chain: 'SM Supermarket', name: 'Imus' }];

  it('attaches the SRP to its product and never adds it to the store prices', () => {
    const cat = buildSharedCatalog(products, one, branches, (p) => p, [{ barcode: '4807770270017', srp_centavos: 1800 }]);
    const canton = cat.find((c) => c.barcode === '4807770270017')!;
    expect(canton.srpCentavos).toBe(1800);
    expect(canton.prices).toHaveLength(1);
    expect(canton.prices[0].unitPriceCentavos).toBe(1700);
  });

  it('leaves products without an SRP alone, and ignores SRPs for unknown barcodes or non-positive values', () => {
    const cat = buildSharedCatalog(products, [], branches, (p) => p, [
      { barcode: '9999999999999', srp_centavos: 500 },
      { barcode: '4801981116072', srp_centavos: 0 },
    ]);
    expect(cat.every((c) => c.srpCentavos == null)).toBe(true);
  });

  it('works with no SRP list at all (a project without migration 025)', () => {
    const cat = buildSharedCatalog(products, one, branches, (p) => p);
    expect(cat).toHaveLength(2);
    expect(cat[0].srpCentavos).toBeUndefined();
  });

  it('keeps the SRP when merging with this phone’s list', () => {
    const shared = buildSharedCatalog(products, [], branches, (p) => p, [{ barcode: '4801981116072', srp_centavos: 6500 }]);
    const merged = mergeCatalogs([], shared);
    expect(merged.find((c) => c.barcode === '4801981116072')!.srpCentavos).toBe(6500);
  });
});
