import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { S } from '../strings';
import { db, recentLabels, storeName, type Item } from '../lib/db';
import { formatKg, formatPeso, lineTotal } from '../lib/money';
import { logEvent } from '../lib/events';
import { Capture } from './Capture';
import { ItemEditor, type ItemSubmit } from './ItemEditor';

interface Props {
  tripId: number;
  onFinish: () => void;
  onHome: () => void;
}

export function Shopping({ tripId, onFinish, onHome }: Props) {
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const items = useLiveQuery(() => db.items.where('tripId').equals(tripId).toArray(), [tripId]) ?? [];
  const [capture, setCapture] = useState<null | 'tag' | 'typed'>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [undo, setUndo] = useState<Item | null>(null);
  const wasOver = useRef(false);

  const live = items.filter((i) => !i.removed).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = live.reduce((s, i) => s + i.lineTotalCentavos, 0);
  const budget = trip?.budgetCentavos ?? null;
  const over = budget != null && total > budget;
  const unnamedCount = items.filter((i) => /^Item •/.test(i.label)).length;

  // Dev-only check: every line total must match its own inputs, and the header must equal the visible sum.
  const mismatch =
    import.meta.env.DEV &&
    (live.some((i) => lineTotal(i) !== i.lineTotalCentavos) ||
      total !== live.map((i) => i.lineTotalCentavos).reduce((a, b) => a + b, 0));

  useEffect(() => {
    recentLabels().then(setRecent);
  }, [items.length]);

  useEffect(() => {
    if (over && !wasOver.current) logEvent('over_budget_shown', tripId, { total, budget });
    wasOver.current = over;
  }, [over, total, budget, tripId]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  async function addItem(v: ItemSubmit, method: Item['captureMethod'], ms: number) {
    const id = await db.items.add({
      tripId,
      barcode: v.barcode ?? null,
      label: v.label,
      priceType: v.priceType,
      unitPriceCentavos: v.unitPriceCentavos,
      bundleQty: v.bundleQty,
      bundlePriceCentavos: v.bundlePriceCentavos,
      isPromo: v.isPromo,
      quantity: v.quantity,
      weightGrams: v.weightGrams,
      lineTotalCentavos: v.lineTotalCentavos,
      category: v.category,
      captureMethod: method,
      removed: false,
      createdAt: new Date().toISOString(),
    });
    navigator.vibrate?.(30);
    await logEvent('item_added', tripId, { item_id: id, has_barcode: !!v.barcode, capture_method: method, ms_since_open: ms, line_total: v.lineTotalCentavos, category: v.category, category_guessed: v.categoryGuessed });
    setCapture(null);
  }

  async function saveEdit(v: ItemSubmit) {
    if (!editing?.id) return;
    const before = { label: editing.label, price: editing.unitPriceCentavos, qty: editing.quantity, total: editing.lineTotalCentavos };
    await db.items.update(editing.id, {
      label: v.label,
      priceType: v.priceType,
      unitPriceCentavos: v.unitPriceCentavos,
      bundleQty: v.bundleQty,
      bundlePriceCentavos: v.bundlePriceCentavos,
      isPromo: v.isPromo,
      quantity: v.quantity,
      weightGrams: v.weightGrams,
      lineTotalCentavos: v.lineTotalCentavos,
      category: v.category,
    });
    await logEvent('item_edited', tripId, { item_id: editing.id, before, after: { label: v.label, price: v.unitPriceCentavos, qty: v.quantity, total: v.lineTotalCentavos } });
    setEditing(null);
  }

  async function remove(item: Item) {
    await db.items.update(item.id!, { removed: true });
    await logEvent('item_removed', tripId, { item_id: item.id, line_total: item.lineTotalCentavos });
    setEditing(null);
    setUndo(item);
  }

  async function restore() {
    if (!undo?.id) return;
    await db.items.update(undo.id, { removed: false });
    await logEvent('item_restored', tripId, { item_id: undo.id });
    setUndo(null);
  }

  if (capture) {
    return (
      <Capture
        tripId={tripId}
        branchUuid={trip?.branchUuid ?? null}
        startTyped={capture === 'typed'}
        recent={recent}
        fallbackName={S.item.unnamed(unnamedCount + 1)}
        onAdd={addItem}
        onClose={() => setCapture(null)}
      />
    );
  }

  if (editing) {
    return (
      <ItemEditor
        title={S.item.editTitle}
        submitLabel={S.item.save}
        initial={editing}
        recent={[]}
        fallbackName={editing.label}
        onSubmit={saveEdit}
        onCancel={() => setEditing(null)}
        onRemove={() => remove(editing)}
      />
    );
  }

  const pct = budget ? Math.min(100, (total / budget) * 100) : 0;

  return (
    <main className="screen shop">
      <header className={`total-card ${over ? 'over' : ''}`}>
        <div className="total-top">
          <span className="label">
            <button className="home-link" onClick={onHome} aria-label={S.shop.home}>‹ {S.shop.home}</button>
            {' · '}{trip ? storeName(trip) : ''}
          </span>
          <span className="label">{S.shop.items(live.length)}</span>
        </div>
        <div className="total-num" aria-live="polite">{formatPeso(total)}</div>
        {budget != null && (
          <>
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <div className="total-top">
              <span>{S.shop.budget} {formatPeso(budget)}</span>
              <strong>{over ? `${formatPeso(total - budget)} ${S.shop.over}` : `${formatPeso(budget - total)} ${S.shop.left}`}</strong>
            </div>
          </>
        )}
      </header>

      {mismatch && <p className="warn">{S.shop.totalMismatch}</p>}
      {over && <p className="over-banner">{S.shop.overBanner(formatPeso(total - budget!))}</p>}

      <ul className="items">
        {live.length === 0 && <li className="empty">{S.shop.empty}</li>}
        {live.map((i) => (
          <li key={i.id}>
            <button className="item-row" onClick={() => setEditing(i)}>
              <span className="item-name">
                {i.label}
                <small>
                  {i.priceType === 'perkg'
                    ? S.item.perKgLine(formatPeso(i.unitPriceCentavos), formatKg(i.weightGrams ?? 0))
                    : i.priceType === 'bundle'
                      ? S.item.bundleChip(i.bundleQty!, formatPeso(i.bundlePriceCentavos!))
                      : formatPeso(i.unitPriceCentavos)}
                  {i.priceType !== 'perkg' && i.quantity > 1 ? ` × ${i.quantity}` : ''}
                  {i.isPromo ? ' · promo' : ''}
                </small>
              </span>
              <strong>{formatPeso(i.lineTotalCentavos)}</strong>
            </button>
          </li>
        ))}
      </ul>

      {undo && (
        <div className="snackbar">
          <span>{S.shop.removed(undo.label)}</span>
          <button className="link light" onClick={restore}>{S.shop.undo}</button>
        </div>
      )}

      <footer className="action-bar">
        <button className="btn finish" onClick={onFinish}>{S.shop.finish}</button>
        <div className="row">
          <button className="btn secondary big" onClick={() => setCapture('typed')}>{S.shop.type}</button>
          <button className="btn primary big snap" onClick={() => setCapture('tag')}>{S.shop.snap}</button>
        </div>
      </footer>
    </main>
  );
}
