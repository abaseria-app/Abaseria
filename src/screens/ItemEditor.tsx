import { useMemo, useState } from 'react';
import { S } from '../strings';
import { formatKg, formatPeso, lineTotal, parseKgInput, parsePesoInput, type PriceType } from '../lib/money';
import type { PriceCandidate } from '../lib/priceParser';
import type { Item } from '../lib/db';
import { CATEGORIES, guessCategory, type CategoryId } from '../lib/categories';
import { formatBarcode } from '../lib/barcode';

export interface ItemSubmit {
  label: string;
  priceType: PriceType;
  unitPriceCentavos: number;
  bundleQty: number | null;
  bundlePriceCentavos: number | null;
  quantity: number;
  weightGrams: number | null;
  isPromo: boolean;
  lineTotalCentavos: number;
  category: CategoryId;
  categoryGuessed: boolean;
  chosenRank: number | 'typed';
  editedAfterChoice: boolean;
  /** True when the shopper changed any price field by hand. */
  priceTouched: boolean;
  /** Filled in by the capture screen, not the editor. */
  barcode?: string | null;
  /** Filled in by the capture screen, not the editor. */
  thumb?: string | null;
}

interface Props {
  title: string;
  submitLabel: string;
  candidates?: PriceCandidate[];
  nameGuess?: string | null;
  promoHint?: boolean;
  initial?: Item;
  /** Name already known for this barcode; used instead of the tag's guess. */
  knownName?: string | null;
  /** Category already known for this barcode; used instead of guessing from the name. */
  knownCategory?: CategoryId | null;
  /** Shown above the form, e.g. where a recalled price came from. */
  recallNote?: string | null;
  barcode?: string | null;
  recent: string[];
  fallbackName: string;
  notice?: string | null;
  onSubmit: (v: ItemSubmit) => void;
  onCancel: () => void;
  onRemove?: () => void;
  onRetake?: () => void;
  retakeLabel?: string;
}

const plain = (c: number) => (c / 100).toFixed(2);

/** A tag price read as per kilo or per 100 g, as a per-kilo price. Null for ordinary prices. */
const perKgCentavos = (c: PriceCandidate | undefined) =>
  c?.unit === 'kg' ? c.centavos : c?.unit === '100g' ? c.centavos * 10 : null;
const priceTypeFor = (c: PriceCandidate | undefined): PriceType =>
  c?.bundleQty ? 'bundle' : perKgCentavos(c) != null ? 'perkg' : 'each';

export function ItemEditor(p: Props) {
  const top = p.candidates?.[0];
  const init = p.initial;
  const [label, setLabel] = useState(init?.label ?? p.knownName ?? p.nameGuess ?? '');
  const [chosen, setChosen] = useState<number | null>(top ? 0 : null);
  const [edited, setEdited] = useState(false);
  const [priceType, setPriceType] = useState<PriceType>(init?.priceType ?? priceTypeFor(top));
  const [priceText, setPriceText] = useState(
    init ? plain(init.unitPriceCentavos) : top && !top.bundleQty ? plain(perKgCentavos(top) ?? top.centavos) : '',
  );
  const [weightText, setWeightText] = useState(init?.weightGrams ? String(init.weightGrams / 1000) : '');
  const [bundleQty, setBundleQty] = useState(String(init?.bundleQty ?? top?.bundleQty ?? 3));
  const [bundlePriceText, setBundlePriceText] = useState(
    init?.bundlePriceCentavos != null ? plain(init.bundlePriceCentavos) : top?.bundleQty ? plain(top.centavos) : '',
  );
  const [qty, setQty] = useState(init?.quantity ?? 1);
  // The guess follows the name until the shopper taps a category themselves.
  const [pickedCategory, setPickedCategory] = useState<CategoryId | null>(init?.category ?? p.knownCategory ?? null);
  const category = pickedCategory ?? guessCategory(label || p.fallbackName);
  const [promo, setPromo] = useState(init?.isPromo ?? !!p.promoHint);
  const [showPriceInput, setShowPriceInput] = useState(!p.candidates || p.candidates.length === 0);

  const unitPrice = parsePesoInput(priceText);
  const bPrice = parsePesoInput(bundlePriceText);
  const bQty = Number(bundleQty) || 0;
  const grams = parseKgInput(weightText);
  const priceOk = unitPrice != null && unitPrice > 0;
  const valid =
    priceType === 'each'
      ? priceOk
      : priceType === 'perkg'
        ? priceOk && grams != null
        : bPrice != null && bPrice > 0 && bQty >= 2;
  const total = useMemo(
    () =>
      valid
        ? lineTotal({ priceType, unitPriceCentavos: unitPrice ?? 0, quantity: qty, bundleQty: bQty, bundlePriceCentavos: bPrice, weightGrams: grams })
        : null,
    [valid, priceType, unitPrice, qty, bQty, bPrice, grams],
  );
  const chosenCandidate = chosen != null ? p.candidates?.[chosen] : undefined;

  function pick(i: number) {
    const c = p.candidates![i];
    setChosen(i);
    setEdited(false);
    const kg = perKgCentavos(c);
    if (c.bundleQty) {
      setPriceType('bundle');
      setBundleQty(String(c.bundleQty));
      setBundlePriceText(plain(c.centavos));
    } else if (kg != null) {
      setPriceType('perkg');
      setPriceText(plain(kg));
    } else {
      setPriceType('each');
      setPriceText(plain(c.centavos));
    }
  }

  function submit() {
    if (!valid || total == null) return;
    const unit = priceType === 'bundle' ? Math.round(bPrice! / bQty) : unitPrice!;
    p.onSubmit({
      label: label.trim() || p.fallbackName,
      priceType,
      unitPriceCentavos: unit,
      bundleQty: priceType === 'bundle' ? bQty : null,
      bundlePriceCentavos: priceType === 'bundle' ? bPrice : null,
      quantity: priceType === 'perkg' ? 1 : qty,
      weightGrams: priceType === 'perkg' ? grams : null,
      isPromo: promo,
      lineTotalCentavos: total,
      category,
      categoryGuessed: pickedCategory == null,
      chosenRank: chosen != null ? chosen + 1 : 'typed',
      editedAfterChoice: chosen != null && edited,
      priceTouched: edited,
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
      {p.recallNote && <p className="notice">{p.recallNote}</p>}
      {p.barcode && <p className="hint small">{S.item.barcodeLine(formatBarcode(p.barcode))}</p>}

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
                setPriceType((t) => (t === 'bundle' ? 'each' : t));
                setPriceText('');
              }}
            >
              {S.item.typePrice}
            </button>
          </div>
          {chosenCandidate?.unit === '100g' && <p className="notice">{S.item.fromPer100g(formatPeso(chosenCandidate.centavos))}</p>}
        </section>
      )}

      {p.onRetake && (!p.candidates || p.candidates.length === 0) && (
        <button className="btn secondary" onClick={p.onRetake}>{p.retakeLabel ?? S.capture.retake}</button>
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
            style={{ ['--cat' as string]: c.color, ['--cat-ink' as string]: c.ink }}
            onClick={() => setPickedCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className="label">{S.item.soldAs}</p>
      <div className="seg" role="radiogroup" aria-label={S.item.soldAs}>
        {(
          [
            ['each', S.item.soldEach],
            ['bundle', S.item.soldBundle],
            ['perkg', S.item.soldPerKg],
          ] as Array<[PriceType, string]>
        ).map(([t, text]) => (
          <button key={t} role="radio" aria-checked={priceType === t} className={priceType === t ? 'on' : ''} onClick={() => { setPriceType(t); setEdited(true); }}>
            {text}
          </button>
        ))}
      </div>

      {(priceType === 'perkg' || (priceType === 'each' && (showPriceInput || chosen != null || init))) && (
        <label className="field">
          <span className="label">{priceType === 'perkg' ? S.item.pricePerKgLabel : S.item.priceLabel}</span>
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

      {priceType === 'perkg' && (
        <>
          <label className="field">
            <span className="label">{S.item.weightLabel}</span>
            <input
              inputMode="decimal"
              value={weightText}
              placeholder={S.item.weightPlaceholder}
              onChange={(e) => {
                setWeightText(e.target.value);
                setEdited(true);
              }}
            />
            <span className="hint">{grams != null ? formatKg(grams) : S.item.weightHint}</span>
          </label>
          <div className="chips">
            {S.item.quickWeights.map(([text, g]) => (
              <button key={g} className={`chip ${grams === g ? 'on' : ''}`} onClick={() => setWeightText(String(g / 1000))}>
                {text}
              </button>
            ))}
          </div>
        </>
      )}

      {priceType === 'bundle' && (
        <div className="row bundle-row">
          <input aria-label={S.item.bundleQty} inputMode="numeric" value={bundleQty} onChange={(e) => { setBundleQty(e.target.value.replace(/\D/g, '')); setEdited(true); }} />
          <span>{S.item.bundlePrice}</span>
          <input aria-label={S.item.bundlePrice} inputMode="decimal" value={bundlePriceText} placeholder="100" onChange={(e) => { setBundlePriceText(e.target.value); setEdited(true); }} />
        </div>
      )}

      {priceType !== 'perkg' && (
      <div className="row qty-row">
        <span className="label">{S.item.qty}</span>
        <div className="stepper">
          <button aria-label="minus" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <output>{qty}</output>
          <button aria-label="plus" onClick={() => setQty((q) => q + 1)}>+</button>
        </div>
      </div>
      )}

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
          {valid ? p.submitLabel : priceType === 'perkg' && priceOk ? S.item.needWeight : S.item.needPrice}
        </button>
        {p.onRemove && (
          <button className="btn danger-link" onClick={p.onRemove}>{S.item.remove}</button>
        )}
      </div>
    </div>
  );
}
