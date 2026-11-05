// Adding an item by searching instead of scanning: pick it from the search list, check the price, tap Add.
//
// The pick fills in the name, barcode, category and picture. The price fills in only when one is known for
// this store (from this phone or other shoppers); a price from another store is shown as a hint and the
// shopper types this store's price from the tag. Nothing found? "Type it in" opens the typed form.
import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';
import type { CaptureMethod, Item } from '../lib/db';
import { formatPeso } from '../lib/money';
import { logEvent } from '../lib/events';
import { shrinkImage } from '../lib/thumb';
import { IMAGE_TIMEOUT_MS } from '../lib/sync';
import type { CatalogItem, PricePoint } from '../lib/search';
import { ItemEditor, type ItemSubmit } from './ItemEditor';
import { Search } from './Search';

interface Props {
  tripId: number;
  /** This trip's store, as catalog prices file it. */
  storeKey: string | null;
  recent: string[];
  fallbackName: string;
  onAdd: (v: ItemSubmit, method: CaptureMethod, msSinceOpen: number) => void;
  /** Nothing fit: type the item in, starting from what was in the search box. */
  onType: (text: string) => void;
  onClose: () => void;
}

const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

function priceLabel(p: PricePoint): string {
  if (p.priceType === 'perkg') return `${formatPeso(p.unitPriceCentavos)}/kg`;
  if (p.priceType === 'bundle' && p.bundleQty && p.bundlePriceCentavos != null) return S.item.bundleChip(p.bundleQty, formatPeso(p.bundlePriceCentavos));
  return formatPeso(p.unitPriceCentavos);
}

/** The shared image as a small square kept with the item, so the list shows it offline. Null if it's slow or missing. */
async function thumbFrom(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await shrinkImage(await res.blob()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True for the stand-in name the catalog gives a barcode nobody has named. */
const unnamed = (it: CatalogItem) => !!it.barcode && it.name === `Barcode ${it.barcode}`;

export function AddFromSearch({ tripId, storeKey, recent, fallbackName, onAdd, onType, onClose }: Props) {
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const openedAt = useRef(performance.now());
  const ms = () => Math.round(performance.now() - openedAt.current);

  useEffect(() => {
    logEvent('capture_open', tripId, { method: 'search' });
  }, [tripId]);

  const here = picked && storeKey ? (picked.prices.find((p) => p.storeKey === storeKey) ?? null) : null;
  // Prices are newest first, so this is the most recent price at any other store.
  const elsewhere = picked && !here ? (picked.prices[0] ?? null) : null;

  function choose(item: CatalogItem) {
    setPicked(item);
    const img = item.image;
    setThumb(img?.startsWith('data:') ? img : null);
    if (img?.startsWith('http')) thumbFrom(img).then((t) => setThumb((cur) => cur ?? t));
    const h = storeKey ? item.prices.find((p) => p.storeKey === storeKey) : undefined;
    logEvent('search_picked', tripId, { has_barcode: !!item.barcode, priced_here: !!h, price_source: h?.source ?? null, ms: ms() });
  }

  function add(v: ItemSubmit) {
    // A price filled in from this store and left alone keeps where it came from; anything else was typed.
    const method: CaptureMethod = here && !v.priceTouched ? (here.source === 'phone' ? 'recall' : 'shared') : 'typed';
    logEvent('price_chosen', tripId, { rank: here && !v.priceTouched ? 'search' : 'typed', edited_after: !!here && v.priceTouched });
    onAdd({ ...v, barcode: picked?.barcode ?? null, thumb: picked?.barcode ? thumb : null }, method, ms());
  }

  function cancel() {
    logEvent('capture_abandoned', tripId, { step: picked ? 'search_confirm' : 'search', had_barcode: !!picked?.barcode });
    onClose();
  }

  if (!picked) {
    return (
      <Search
        onBack={cancel}
        pick={{
          storeKey,
          onPick: choose,
          onType: (text) => {
            logEvent('search_type_instead', tripId, { had_text: !!text.trim(), ms: ms() });
            onType(text);
          },
        }}
      />
    );
  }

  const name = unnamed(picked) ? '' : picked.name;
  const initial: Item | undefined = here
    ? {
        tripId,
        barcode: picked.barcode,
        label: name,
        priceType: here.priceType,
        unitPriceCentavos: here.unitPriceCentavos,
        bundleQty: here.bundleQty,
        bundlePriceCentavos: here.bundlePriceCentavos,
        isPromo: here.isPromo,
        quantity: 1,
        weightGrams: null,
        lineTotalCentavos: 0,
        category: picked.category,
        captureMethod: here.source === 'phone' ? 'recall' : 'shared',
        removed: false,
        createdAt: `${here.seenOn}T12:00:00`,
      }
    : undefined;
  const note = here
    ? (here.source === 'phone' ? S.item.lastSeen : S.item.sharedSeen)(priceLabel(here), shortDate(here.seenOn))
    : elsewhere
      ? S.search.pricedElsewhere(priceLabel(elsewhere), elsewhere.storeLabel, shortDate(elsewhere.seenOn))
      : S.search.noPriceAnywhere;

  return (
    <ItemEditor
      key={picked.key}
      title={S.item.addTitle}
      submitLabel={S.item.add}
      initial={initial}
      knownName={name || null}
      knownCategory={picked.category}
      recallNote={note}
      barcode={picked.barcode}
      startPriceType={elsewhere?.priceType === 'perkg' ? 'perkg' : undefined}
      recent={recent}
      fallbackName={fallbackName}
      onSubmit={add}
      onCancel={() => setPicked(null)}
    />
  );
}
