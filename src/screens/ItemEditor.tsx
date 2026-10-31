import { useMemo, useState } from 'react';
import { S } from '../strings';
import { formatPeso, lineTotal, parsePesoInput, type PriceType } from '../lib/money';
import type { PriceCandidate } from '../lib/priceParser';
import type { Item } from '../lib/db';
import { CATEGORIES, guessCategory, type CategoryId } from '../lib/categories';

export interface ItemSubmit {
  label: string;
  priceType: PriceType;
  unitPriceCentavos: number;
  bundleQty: number | null;
  bundlePriceCentavos: number | null;
  quantity: number;
  isPromo: boolean;
  lineTotalCentavos: number;
  category: CategoryId;
  categoryGuessed: boolean;
  chosenRank: number | 'typed';
  editedAfterChoice: boolean;
}

interface Props {
  title: string;
  submitLabel: string;
  candidates?: PriceCandidate[];
  nameGuess?: string | null;
  promoHint?: boolean;
  initial?: Item;
  recent: string[];
  fallbackName: string;
  notice?: string | null;
  onSubmit: (v: ItemSubmit) => void;
  onCancel: () => void;
  onRemove?: () => void;
  onRetake?: () => void;
}

const plain = (c: number) => (c / 100).toFixed(2);

export function ItemEditor(p: Props) {
  const top = p.candidates?.[0];
  const init = p.initial;
  const [label, setLabel] = useState(init?.label ?? p.nameGuess ?? '');
  const [chosen, setChosen] = useState<number | null>(top ? 0 : null);
  const [edited, setEdited] = useState(false);
  const [priceType, setPriceType] = useState<PriceType>(init?.priceType ?? (top?.bundleQty ? 'bundle' : 'each'));
  const [priceText, setPriceText] = useState(init ? plain(init.unitPriceCentavos) : top && !top.bundleQty ? plain(top.centavos) : '');
  const [bundleQty, setBundleQty] = useState(String(init?.bundleQty ?? top?.bundleQty ?? 3));
  const [bundlePriceText, setBundlePriceText] = useState(
    init?.bundlePriceCentavos != null ? plain(init.bundlePriceCentavos) : top?.bundleQty ? plain(top.centavos) : '',
  );
  const [qty, setQty] = useState(init?.quantity ?? 1);
  // The guess follows the name until the shopper taps a category themselves.
  const [pickedCategory, setPickedCategory] = useState<CategoryId | null>(init?.category ?? null);
  const category = pickedCategory ?? guessCategory(label || p.fallbackName);
  const [promo, setPromo] = useState(init?.isPromo ?? !!p.promoHint);
  const [showPriceInput, setShowPriceInput] = useState(!p.candidates || p.candidates.length === 0);

  const unitPrice = parsePesoInput(priceText);
  const bPrice = parsePesoInput(bundlePriceText);
  const bQty = Number(bundleQty) || 0;
  const valid = priceType === 'each' ? unitPrice != null && unitPrice > 0 : bPrice != null && bPrice > 0 && bQty >= 2;
  const total = useMemo(
    () =>
      valid
        ? lineTotal({ priceType, unitPriceCentavos: unitPrice ?? 0, quantity: qty, bundleQty: bQty, bundlePriceCentavos: bPrice })
        : null,
    [valid, priceType, unitPrice, qty, bQty, bPrice],
  );
  const chosenCandidate = chosen != null ? p.candidates?.[chosen] : undefined;

  function pick(i: number) {
    const c = p.candidates![i];
    setChosen(i);
    setEdited(false);
    if (c.bundleQty) {
      setPriceType('bundle');
      setBundleQty(String(c.bundleQty));
      setBundlePriceText(plain(c.centavos));
    } else {
      setPriceType('each');
      setPriceText(plain(c.centavos));
    }
  }

  function submit() {
    if (!valid || total == null) return;
    const unit = priceType === 'each' ? unitPrice! : Math.round(bPrice! / bQty);
    p.onSubmit({
      label: label.trim() || p.fallbackName,
      priceType,
      unitPriceCentavos: unit,
      bundleQty: priceType === 'bundle' ? bQty : null,
      bundlePriceCentavos: priceType === 'bundle' ? bPrice : null,
      quantity: qty,
      isPromo: promo,
      lineTotalCentavos: total,
      category,
      categoryGuessed: pickedCategory == null,
      chosenRank: chosen != null ? chosen + 1 : 'typed',
      editedAfterChoice: chosen != null && edited,
    });
  }

  return (
    <div className="sheet" role="dialog" aria-label={p.title}>
      <div className="sheet-head">
        <button className="link" onClick={p.onCancel}>{S.item.cancel}</button>
        <h2>{p.title}</h2>
        <span className="spacer" />
      </div>

      {p.notice && <p className="notice">{p.notice}</p>}

      {p.candidates && p.candidates.length > 0 && (
        <section>
          <p className="label">{S.item.pickPrice}</p>
          <div className="chips price-chips">
            {p.candidates.map((c, i) => (
              <button key={i} className={`chip big ${chosen === i ? 'on' : ''}`} onClick={() => pick(i)}>
                {c.bundleQty ? S.item.bundleChip(c.bundleQty, formatPeso(c.centavos)) : formatPeso(c.centavos)}
                {c.unit && c.unit !== 'pc' && <small> {S.item.unit[c.unit]}</small>}
              </button>
            ))}
            <button
              className={`chip big ghost ${showPriceInput && chosen == null ? 'on' : ''}`}
              onClick={() => {
                setChosen(null);
                setShowPriceInput(true);
                setPriceType('each');
                setPriceText('');
              }}
            >
              {S.item.typePrice}
            </button>
          </div>
          {chosenCandidate?.unit === 'kg' && <p className="warn">{S.item.perKgWarning}</p>}
          {chosenCandidate?.unit === '100g' && <p className="warn">{S.item.per100gWarning}</p>}
        </section>
      )}

      {p.onRetake && (!p.candidates || p.candidates.length === 0) && (
        <button className="btn secondary" onClick={p.onRetake}>{S.capture.retake}</button>
      )}

      <label className="field">
        <span className="label">{S.item.nameLabel}</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.fallbackName} autoComplete="off" />
      </label>
      {p.recent.length > 0 && !label && (
        <div className="chips">
          {p.recent.map((r) => (
            <button key={r} className="chip" onClick={() => setLabel(r)}>{r}</button>
          ))}
        </div>
      )}

      <div className="chips cat-chips" role="radiogroup" aria-label={S.item.category}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={category === c.id}
            className={`chip cat ${category === c.id ? 'on' : ''}`}
            style={{ ['--cat' as string]: c.color }}
            onClick={() => setPickedCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {priceType === 'each' && (showPriceInput || chosen != null || init) && (
        <label className="field">
          <span className="label">{S.item.priceLabel}</span>
          <input
            inputMode="decimal"
            value={priceText}
            placeholder="0.00"
            autoFocus={showPriceInput && chosen == null && !!p.candidates}
            onChange={(e) => {
              setPriceText(e.target.value);
              setEdited(true);
            }}
          />
        </label>
      )}

      <label className="toggle">
        <input type="checkbox" checked={priceType === 'bundle'} onChange={(e) => setPriceType(e.target.checked ? 'bundle' : 'each')} />
        <span>{S.item.bundle}</span>
      </label>
      {priceType === 'bundle' && (
        <div className="row bundle-row">
          <input aria-label={S.item.bundleQty} inputMode="numeric" value={bundleQty} onChange={(e) => { setBundleQty(e.target.value.replace(/\D/g, '')); setEdited(true); }} />
          <span>{S.item.bundlePrice}</span>
          <input aria-label={S.item.bundlePrice} inputMode="decimal" value={bundlePriceText} placeholder="100" onChange={(e) => { setBundlePriceText(e.target.value); setEdited(true); }} />
        </div>
      )}

      <div className="row qty-row">
        <span className="label">{S.item.qty}</span>
        <div className="stepper">
          <button aria-label="minus" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <output>{qty}</output>
          <button aria-label="plus" onClick={() => setQty((q) => q + 1)}>+</button>
        </div>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} />
        <span>{S.item.promo}</span>
      </label>

      <div className="sheet-foot">
        <div className="line-total">
          <span className="label">{S.item.lineTotal}</span>
          <strong>{total != null ? formatPeso(total) : '—'}</strong>
        </div>
        <button className="btn primary" disabled={!valid} onClick={submit}>
          {valid ? p.submitLabel : S.item.needPrice}
        </button>
        {p.onRemove && (
          <button className="btn danger-link" onClick={p.onRemove}>{S.item.remove}</button>
        )}
      </div>
    </div>
  );
}
