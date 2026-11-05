import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  activeFilterCount,
  comparable,
  parseQuery,
  parseSize,
  sameSize,
  searchCatalog,
  storesIn,
  type CatalogItem,
  type PricePoint,
} from './search';

const TODAY = '2026-11-06';

const price = (centavos: number, extra: Partial<PricePoint> = {}): PricePoint => ({
  storeKey: 'pg-anabu',
  storeLabel: 'Puregold Imus Anabu',
  seenOn: '2026-11-04',
  priceType: 'each',
  unitPriceCentavos: centavos,
  bundleQty: null,
  bundlePriceCentavos: null,
  isPromo: false,
  source: 'phone',
  ...extra,
});

const item = (name: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  key: extra.barcode ?? `name:${name.toLowerCase()}`,
  barcode: null,
  name,
  size: null,
  category: 'pantry',
  image: null,
  prices: [],
  ...extra,
});

const CATALOG: CatalogItem[] = [
  item('Coca-Cola Original', { barcode: '4801981116072', size: '1.5L', prices: [price(7500), price(7200, { storeKey: 'sm-imus', storeLabel: 'SM Supermarket Imus' })] }),
  item('Coca-Cola Zero', { barcode: '4801981118120', size: '330ml', prices: [price(3000, { isPromo: true })] }),
  item('Lucky Me Pancit Canton Chilimansi', { barcode: '4807770270017', size: '80g', category: 'dry', prices: [price(1650)] }),
  item('555 Sardines in Tomato Sauce', { barcode: '4800249000016', size: '155g', prices: [price(2475, { seenOn: '2026-10-01' })] }),
  item('Liempo', { category: 'meat', prices: [price(32000, { priceType: 'perkg' })] }),
  item('Piattos Cheese', { barcode: '4800016644115', size: '85g', prices: [price(10000, { priceType: 'bundle', bundleQty: 3, bundlePriceCentavos: 10000 })] }),
  item('Jasmine Rice', { barcode: '4806511010019', size: '5kg', category: 'dry' }),
  item('Señorita Bread', { prices: [price(5000)] }),
];

const names = (hits: { item: CatalogItem }[]) => hits.map((h) => h.item.name);
const find = (q: string, f = NO_FILTERS, sort: Parameters<typeof searchCatalog>[3] = 'best') => names(searchCatalog(CATALOG, q, f, sort, TODAY));

describe('parseSize', () => {
  it('reads common pack sizes', () => {
    expect(parseSize('1.5L')).toEqual({ kind: 'volume', amount: 1500 });
    expect(parseSize('Coke 330 ml can')).toEqual({ kind: 'volume', amount: 330 });
    expect(parseSize('5kg')).toEqual({ kind: 'mass', amount: 5000 });
    expect(parseSize('6 x 330ml')).toEqual({ kind: 'volume', amount: 330 });
    expect(parseSize('10 pcs')).toEqual({ kind: 'count', amount: 10 });
    expect(parseSize('Lucky Me')).toBeNull();
  });
  it('compares across units', () => {
    expect(sameSize(parseSize('1L')!, parseSize('1000ml')!)).toBe(true);
    expect(sameSize(parseSize('1kg')!, parseSize('1000 g')!)).toBe(true);
    expect(sameSize(parseSize('1L')!, parseSize('1kg')!)).toBe(false);
  });
});

describe('parseQuery', () => {
  it('splits words, barcode digits, sizes and prices', () => {
    const q = parseQuery('coke 1.5 L under ₱80');
    expect(q.words).toEqual(['coke']);
    expect(q.sizes).toEqual([{ kind: 'volume', amount: 1500 }]);
    expect(q.price).toEqual({ min: null, max: 8000 });
  });
  it('reads a printed barcode with spaces as one barcode', () => {
    expect(parseQuery('4 800016 644115').barcodes).toEqual(['4800016644115']);
  });
  it('reads peso amounts and ranges', () => {
    expect(parseQuery('₱50').price).toEqual({ min: 5000, max: 5099 });
    expect(parseQuery('p45.50').price).toEqual({ min: 4550, max: 4550 });
    expect(parseQuery('php 20-50').price).toEqual({ min: 2000, max: 5099 });
    expect(parseQuery('over 100').price).toEqual({ min: 10000, max: null });
  });
  it('keeps the p in words that end in p', () => {
    expect(parseQuery('soap 20-50').words).toEqual(['soap']);
    expect(parseQuery('pack').words).toEqual(['pack']);
  });
  it('treats a short plain number as a number to try every way', () => {
    expect(parseQuery('555').numbers).toEqual([555]);
  });
});

describe('searchCatalog', () => {
  it('finds by any word of the name, ignoring capitals and accents', () => {
    expect(find('canton')).toEqual(['Lucky Me Pancit Canton Chilimansi']);
    expect(find('coca cola')).toEqual(['Coca-Cola Original', 'Coca-Cola Zero']);
    expect(find('senorita')).toEqual(['Señorita Bread']);
  });
  it('finds by whole or partial barcode', () => {
    expect(find('4800016644115')).toEqual(['Piattos Cheese']);
    expect(find('4801981')).toEqual(['Coca-Cola Original', 'Coca-Cola Zero']);
  });
  it('finds by size in any unit', () => {
    expect(find('1500ml')).toEqual(['Coca-Cola Original']);
    expect(find('5 kilos')).toEqual(['Jasmine Rice']);
    expect(find('coca cola 330ml')).toEqual(['Coca-Cola Zero']);
  });
  it('finds by price, comparing bundles per piece', () => {
    expect(find('₱30')).toEqual(['Coca-Cola Zero']);
    // Piattos is 3 for ₱100, so ₱33.33 each.
    expect(find('₱33')).toEqual(['Piattos Cheese']);
    expect(find('under 20')).toEqual(['Lucky Me Pancit Canton Chilimansi']);
  });
  it('lets a plain number match a name, a size or a price', () => {
    expect(find('555')).toEqual(['555 Sardines in Tomato Sauce']);
    expect(find('80')).toEqual(['Lucky Me Pancit Canton Chilimansi']); // 80g
    expect(find('72')).toEqual(['Coca-Cola Original']); // ₱72 at SM
  });
  it('shows the cheapest matching price first', () => {
    const [hit] = searchCatalog(CATALOG, 'coca cola original', NO_FILTERS, 'best', TODAY);
    expect(hit.best?.storeLabel).toBe('SM Supermarket Imus');
    expect(hit.prices.map(comparable)).toEqual([7200, 7500]);
  });
  it('filters by category, store, price range, promo, date and having a price', () => {
    expect(find('', { ...NO_FILTERS, categories: ['dry'] }, 'name')).toEqual(['Jasmine Rice', 'Lucky Me Pancit Canton Chilimansi']);
    expect(find('', { ...NO_FILTERS, store: 'sm-imus' })).toEqual(['Coca-Cola Original']);
    expect(find('', { ...NO_FILTERS, minCentavos: 5000, maxCentavos: 8000 }, 'priceLow')).toEqual(['Señorita Bread', 'Coca-Cola Original']);
    expect(find('', { ...NO_FILTERS, promoOnly: true })).toEqual(['Coca-Cola Zero']);
    expect(find('sardines', { ...NO_FILTERS, withinDays: 7 })).toEqual([]);
    expect(find('rice', { ...NO_FILTERS, withPrice: true })).toEqual([]);
    expect(find('rice')).toEqual(['Jasmine Rice']);
  });
  it('uses the chosen store’s price when a store is picked', () => {
    const [hit] = searchCatalog(CATALOG, 'coca cola original', { ...NO_FILTERS, store: 'pg-anabu' }, 'best', TODAY);
    expect(comparable(hit.best!)).toBe(7500);
  });
  it('sorts by price with unpriced items last', () => {
    expect(find('', NO_FILTERS, 'priceLow').at(-1)).toBe('Jasmine Rice');
    expect(find('', NO_FILTERS, 'priceHigh')[0]).toBe('Liempo');
    expect(find('', NO_FILTERS, 'priceHigh').at(-1)).toBe('Jasmine Rice');
  });
  it('sorts by most recently seen', () => {
    expect(find('', NO_FILTERS, 'newest').slice(-2)).toEqual(['555 Sardines in Tomato Sauce', 'Jasmine Rice']);
  });
});

describe('helpers', () => {
  it('counts active filters', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, categories: ['dry', 'meat'], minCentavos: 100, maxCentavos: 200, promoOnly: true })).toBe(3);
  });
  it('lists stores A to Z', () => {
    expect(storesIn(CATALOG)).toEqual([
      { key: 'pg-anabu', label: 'Puregold Imus Anabu' },
      { key: 'sm-imus', label: 'SM Supermarket Imus' },
    ]);
  });
});
