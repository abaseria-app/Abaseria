import { describe, expect, it } from 'vitest';
import { gtinOk, isInStoreCode, normalizeBarcode } from './barcode';

describe('gtinOk', () => {
  it('accepts valid EAN-13, EAN-8 and UPC-A', () => {
    expect(gtinOk('4800016644115')).toBe(true);
    expect(gtinOk('96385074')).toBe(true);
    expect(gtinOk('036000291452')).toBe(true);
  });
  it('rejects bad check digits, lengths and letters', () => {
    expect(gtinOk('4800016644116')).toBe(false);
    expect(gtinOk('48000166441')).toBe(false);
    expect(gtinOk('48000166441AB')).toBe(false);
  });
});

describe('normalizeBarcode', () => {
  it('expands UPC-E to UPC-A', () => {
    expect(normalizeBarcode('04252614', 'upc_e')).toBe('042100005264');
  });
  it('drops misreads', () => {
    expect(normalizeBarcode('4800016644116', 'ean_13')).toBeNull();
  });
  it('keeps valid codes as read', () => {
    expect(normalizeBarcode('4800016644115', 'ean_13')).toBe('4800016644115');
  });
});

describe('isInStoreCode', () => {
  it('flags scale-printed codes', () => {
    expect(isInStoreCode('2000000000008')).toBe(true);
    expect(isInStoreCode('4800016644115')).toBe(false);
  });
});
