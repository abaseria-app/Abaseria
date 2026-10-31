import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { S } from '../strings';
import { db, setSetting } from '../lib/db';
import { formatPeso, parsePesoInput } from '../lib/money';
import { logEvent } from '../lib/events';
import { coveragePct } from '../lib/export';

interface Props {
  tripId: number;
  onBack: () => void;
  onEnded: () => void;
}

export function Cashier({ tripId, onBack, onEnded }: Props) {
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const items = (useLiveQuery(() => db.items.where('tripId').equals(tripId).toArray(), [tripId]) ?? []).filter((i) => !i.removed);
  const total = items.reduce((s, i) => s + i.lineTotalCentavos, 0);
  const [matched, setMatched] = useState<boolean | null>(null);
  const [receiptTotal, setReceiptTotal] = useState('');
  const [receiptItems, setReceiptItems] = useState('');

  const receiptCentavos = parsePesoInput(receiptTotal);
  const diff = matched === false && receiptCentavos != null ? receiptCentavos - total : null;

  async function end() {
    const count = receiptItems.trim() ? Number(receiptItems) : null;
    const endedAt = new Date().toISOString();
    await db.trips.update(tripId, {
      endedAt,
      receiptMatched: matched,
      receiptTotalCentavos: matched ? total : receiptCentavos,
      receiptItemCount: count,
    });
    await logEvent('receipt_check', tripId, {
      matched,
      receipt_total: matched ? total : receiptCentavos,
      difference: matched ? 0 : diff,
      receipt_item_count: count,
      items_logged: items.length,
      coverage_pct: coveragePct(items.length, count),
    });
    await logEvent('trip_end', tripId, {
      items: items.length,
      total,
      minutes: trip ? Math.round((Date.parse(endedAt) - Date.parse(trip.startedAt)) / 6000) / 10 : null,
      trip_index: trip?.tripIndex,
    });
    await setSetting('activeTripId', '');
    onEnded();
  }

  return (
    <main className="screen cashier">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.cashier.back}</button>
        <h1>{S.cashier.title}</h1>
        <span className="spacer" />
      </header>

      <p className="label center">{S.cashier.expected}</p>
      <div className="cashier-total">{formatPeso(total)}</div>
      <p className="center">{S.shop.items(items.length)}</p>
      <p className="center hint">{S.cashier.compare}</p>

      <div className="seg big">
        <button className={matched === true ? 'on' : ''} onClick={() => setMatched(true)}>{S.cashier.matched}</button>
        <button className={matched === false ? 'on' : ''} onClick={() => setMatched(false)}>{S.cashier.notMatched}</button>
      </div>

      {matched === false && (
        <label className="field">
          <span className="label">{S.cashier.receiptTotal}</span>
          <input inputMode="decimal" value={receiptTotal} onChange={(e) => setReceiptTotal(e.target.value)} placeholder="0.00" />
          {diff != null && <span className="diff">{S.cashier.difference(formatPeso(diff))}</span>}
        </label>
      )}

      <label className="field">
        <span className="label">{S.cashier.receiptItems}</span>
        <input inputMode="numeric" value={receiptItems} onChange={(e) => setReceiptItems(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 24" />
        <span className="hint">{S.cashier.receiptItemsHint}</span>
      </label>

      <div className="bottom">
        <button className="btn primary huge" onClick={end}>{S.cashier.endTrip}</button>
      </div>
    </main>
  );
}
