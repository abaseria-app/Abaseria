import { S } from '../strings';
import { formatPeso } from './money';
import type { PricePoint } from './search';

/** "₱115.00", "3 for ₱100.00" or "₱320.00/kg": how the store sells it. */
export function priceText(p: Pick<PricePoint, 'priceType' | 'unitPriceCentavos' | 'bundleQty' | 'bundlePriceCentavos'>): string {
  if (p.priceType === 'bundle' && p.bundleQty && p.bundlePriceCentavos != null) return S.search.bundle(p.bundleQty, formatPeso(p.bundlePriceCentavos));
  if (p.priceType === 'perkg') return `${formatPeso(p.unitPriceCentavos)}${S.search.perKg}`;
  return formatPeso(p.unitPriceCentavos);
}
