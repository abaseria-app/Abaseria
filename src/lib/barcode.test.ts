import { describe, expect, it } from 'vitest';
import { canonicalBarcode, formatBarcode, gtinOk, isInStoreCode, normalizeBarcode } from './barcode';

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
    expect(normalizeBarcode('024000010623', 'upc_a')).toBe('024000010623');
  });
  it('reads UPC-A reported as 13 digits with a leading 0 as the 12-digit code', () => {
    expect(normalizeBarcode('0024000010623', 'ean_13')).toBe('024000010623');
    expect(normalizeBarcode('0036000291452', 'ean_13')).toBe('036000291452');
  });
});

describe('canonicalBarcode', () => {
  it('drops the leading 0 from 13-digit codes only', () => {
    expect(canonicalBarcode('0024000163022')).toBe('024000163022');
    expect(canonicalBarcode('024000163022')).toBe('024000163022');
    expect(canonicalBarcode('4800016644115')).toBe('4800016644115');
    expect(canonicalBarcode('96385074')).toBe('96385074');
  });
});

describe('isInStoreCode', () => {
  it('flags scale-printed codes', () => {
    expect(isInStoreCode('2000000000008')).toBe(true);
    expect(isInStoreCode('4800016644115')).toBe(false);
  });
});

describe('formatBarcode', () => {
  it('groups digits like the print under the bars', () => {
    expect(formatBarcode('4800016644115')).toBe('4 800016 644115');
    expect(formatBarcode('036000291452')).toBe('0 36000 29145 2');
    expect(formatBarcode('96385074')).toBe('9638 5074');
  });
  it('leaves other lengths alone', () => {
    expect(formatBarcode('12345678901234')).toBe('12345678901234');
  });
});
