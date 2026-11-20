import { useState } from 'react';
import { S } from '../strings';
import { formatPeso } from '../lib/money';
import { comparable, type PricePoint } from '../lib/search';
import { isStale, lowestCurrent, sortByPrice } from '../lib/catalog';
import { priceText } from '../lib/priceText';

const dayFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });
const dayText = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00`));


interface Props {
  prices: PricePoint[];
  /** The store being shopped now, marked "This store". */
  hereKey?: string | null;
  /** YYYY-MM-DD on this phone. */
  today: string;
  /** Rows shown before "Show all". Omit to show every row. */
  limit?: number;
  className?: string;
}

/**
 * Every store's latest price for one product, cheapest first. The cheapest current price is marked Lowest;
 * prices older than 30 days are greyed and never marked, since the store may have changed them.
 */
export function StorePrices({ prices, hereKey, today, limit, className }: Props) {
  const [all, setAll] = useState(false);
  const sorted = sortByPrice(prices);
  const lowest = lowestCurrent(sorted, today);
  const shown = limit && !all ? sorted.slice(0, limit) : sorted;
  return (
    <>
      <ul className={`store-prices ${className ?? ''}`}>
        {shown.map((p) => {
          const stale = isStale(p, today);
          const isLowest = lowest === p && sorted.length > 1;
          const regular = p.regularPriceCentavos != null && p.regularPriceCentavos > p.unitPriceCentavos ? p.regularPriceCentavos : null;
          return (
            <li key={p.storeKey} className={`${stale ? 'stale' : ''} ${isLowest ? 'lowest' : ''}`}>
              <span>
                <strong>
                  {p.storeLabel}
                  {p.storeKey === hereKey && <em className="here-tag">{S.prices.here}</em>}
                  {isLowest && <em className="lowest-tag">{S.prices.lowest}</em>}
                </strong>
                <small>
                  {dayText(p.seenOn)} · {p.source === 'phone' ? S.search.mine : S.search.shared}
                  {stale ? ` · ${S.prices.mayHaveChanged}` : ''}
                  {p.isPromo ? ` · ${S.search.promo}` : ''}
                  {p.promoNote ? `: ${p.promoNote}` : ''}
                  {p.priceType === 'bundle' && p.bundleQty ? ` · ${S.search.each(formatPeso(comparable(p)))}` : ''}
                </small>
              </span>
              <span className="store-price">
                <strong>{priceText(p)}</strong>
                {regular != null && <s>{S.prices.was(p.priceType === 'perkg' ? `${formatPeso(regular)}${S.search.perKg}` : formatPeso(regular))}</s>}
              </span>
            </li>
          );
        })}
      </ul>
      {limit && !all && sorted.length > limit && (
        <button className="link small show-all-prices" onClick={() => setAll(true)}>{S.prices.showAll(sorted.length)}</button>
      )}
    </>
  );
}
