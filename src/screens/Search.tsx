import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { S } from '../strings';
import { getSetting, setSetting } from '../lib/db';
import { formatPeso, parsePesoInput } from '../lib/money';
import { formatBarcode } from '../lib/barcode';
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from '../lib/categories';
import { loadPhoneCatalog, loadSharedCatalog, mergeCatalogs, type SharedState } from '../lib/catalog';
import { SHARING_ON } from '../lib/sync';
import {
  NO_FILTERS,
  SORT_KEYS,
  activeFilterCount,
  dayOf,
  parseQuery,
  searchCatalog,
  storesIn,
  type CatalogItem,
  type Filters,
  type Hit,
  comparable,
  type PricePoint,
  type Query,
  type SortKey,
} from '../lib/search';

interface Props {
  onBack: () => void;
  /** Opened from a category tile on Explore: start with that category filtered. */
  initialCategory?: CategoryId | null;
  /**
   * Picking an item to add to the trip (from the shopping list). Tapping a row picks it instead of opening it,
   * rows show this store's price first, and a button at the bottom types a new item in.
   */
  pick?: {
    /** This trip's store, as catalog prices file it. Null when unknown. */
    storeKey: string | null;
    onPick: (item: CatalogItem) => void;
    /** Type a new item; gets whatever is in the box so far. */
    onType: (text: string) => void;
  };
}

/** Rows drawn at once; "Show more" adds this many again. Keeps typing quick on low-end phones. */
const PAGE = 60;
const dayFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });

export function Search({ onBack, pick, initialCategory }: Props) {
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<Filters>(initialCategory ? { ...NO_FILTERS, categories: [initialCategory] } : NO_FILTERS);
  const [sort, setSort] = useState<SortKey>('best');
  const [panel, setPanel] = useState(false);
  const [phone, setPhone] = useState<CatalogItem[] | null>(null);
  const [shared, setShared] = useState<{ state: SharedState; items: CatalogItem[]; error?: string } | null>(null);
  // Which row is open and how many rows show, for the current list only: a new search starts closed at the top.
  const [view, setView] = useState<{ list: unknown; open: string | null; shown: number }>({ list: null, open: null, shown: PAGE });
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  function retryShared() {
    setShared(null);
    loadSharedCatalog().then(setShared);
  }

  useEffect(() => {
    loadPhoneCatalog().then(setPhone);
    loadSharedCatalog().then(setShared);
    getSetting('searchSort').then((s) => {
      if (s && (SORT_KEYS as string[]).includes(s)) setSort(s as SortKey);
    });
  }, []);

  const catalog = useMemo(() => mergeCatalogs(phone ?? [], shared?.items ?? []), [phone, shared]);
  const stores = useMemo(() => storesIn(catalog), [catalog]);
  const typed = useDeferredValue(text);
  const query = useMemo(() => parseQuery(typed), [typed]);
  const [today] = useState(() => dayOf(new Date()));
  const hits = useMemo(() => searchCatalog(catalog, query, filters, sort, today), [catalog, query, filters, sort, today]);
  const nFilters = activeFilterCount(filters);

  const current = view.list === hits;
  const open = current ? view.open : null;
  const shown = current ? view.shown : PAGE;
  const setOpen = (key: string | null) => setView({ list: hits, open: key, shown });
  const setShown = (n: number) => setView({ list: hits, open, shown: n });

  function chooseSort(s: SortKey) {
    setSort(s);
    setSetting('searchSort', s);
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  function toggleCategory(id: CategoryId) {
    set({ categories: filters.categories.includes(id) ? filters.categories.filter((c) => c !== id) : [...filters.categories, id] });
  }
  function setPrice(which: 'min' | 'max', value: string) {
    (which === 'min' ? setMinText : setMaxText)(value);
    const c = value.trim() ? parsePesoInput(value) : null;
    set(which === 'min' ? { minCentavos: c } : { maxCentavos: c });
  }
  function clearFilters() {
    setFilters(NO_FILTERS);
    setMinText('');
    setMaxText('');
  }

  const loading = phone == null;
  const looking = describe(query);

  return (
    <main className="screen search">
      <header className="topbar">
        <button className="link" onClick={onBack}>{pick ? S.search.cancel : S.search.back}</button>
        <h1>{pick ? S.search.pickTitle : S.search.title}</h1>
        <span className="spacer" />
      </header>

      <div className="search-box">
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={S.search.placeholder}
          aria-label={S.search.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        {text && (
          <button
            className="search-clear"
            aria-label={S.search.clear}
            onClick={() => {
              setText('');
              input.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      {looking.length > 0 ? (
        <p className="search-looking">
          {S.search.looking}: {looking.join(' · ')}
        </p>
      ) : (
        !text && <p className="hint small">{S.search.examples}</p>
      )}

      <div className="search-tools">
        <button className={`chip filter-btn ${nFilters ? 'on' : ''}`} aria-expanded={panel} onClick={() => setPanel((p) => !p)}>
          {nFilters ? S.search.filtersOn(nFilters) : S.search.filters} {panel ? '▴' : '▾'}
        </button>
        <label className="sort">
          <span>{S.search.sortLabel}</span>
          <select value={sort} onChange={(e) => chooseSort(e.target.value as SortKey)}>
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>{S.search.sorts[k]}</option>
            ))}
          </select>
        </label>
      </div>

      {panel && (
        <section className="filter-panel">
          <h3>{S.search.category}</h3>
          <div className="chips">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`chip cat ${filters.categories.includes(c.id) ? 'on' : ''}`}
                style={{ '--cat': c.color, '--cat-ink': c.ink } as React.CSSProperties}
                aria-pressed={filters.categories.includes(c.id)}
                onClick={() => toggleCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <h3>{S.search.store}</h3>
          <select className="filter-select" value={filters.store ?? ''} onChange={(e) => set({ store: e.target.value || null })}>
            <option value="">{S.search.anyStore}</option>
            {stores.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          <h3>{S.search.price}</h3>
          <div className="row price-range">
            <input inputMode="decimal" placeholder={S.search.min} aria-label={S.search.min} value={minText} onChange={(e) => setPrice('min', e.target.value)} />
            <span>–</span>
            <input inputMode="decimal" placeholder={S.search.max} aria-label={S.search.max} value={maxText} onChange={(e) => setPrice('max', e.target.value)} />
          </div>

          <h3>{S.search.seen}</h3>
          <div className="seg">
            {([null, 7, 30] as const).map((d) => (
              <button key={String(d)} className={filters.withinDays === d ? 'on' : ''} onClick={() => set({ withinDays: d })}>
                {d == null ? S.search.seenAny : d === 7 ? S.search.seenWeek : S.search.seenMonth}
              </button>
            ))}
          </div>

          <label className="toggle">
            <input type="checkbox" checked={filters.promoOnly} onChange={(e) => set({ promoOnly: e.target.checked })} />
            <span>{S.search.promoOnly}</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={filters.withPrice} onChange={(e) => set({ withPrice: e.target.checked })} />
            <span>{S.search.withPrice}</span>
          </label>

          <div className="row filter-actions">
            <button className="btn secondary" disabled={!nFilters} onClick={clearFilters}>{S.search.clearFilters}</button>
            <button className="btn primary" onClick={() => setPanel(false)}>{S.search.done}</button>
          </div>
        </section>
      )}

      <p className="search-source">
        <SourceLine state={shared} onRetry={retryShared} />
      </p>

      {loading ? (
        <div className="center"><span className="spinner dark" /></div>
      ) : (
        <>
          <p className="search-count">{S.search.count(hits.length)}</p>
          <ul className="items">
            {hits.length === 0 && <li className="empty">{catalog.length ? S.search.none : S.search.empty}</li>}
            {hits.slice(0, shown).map((h) => (
              <ResultRow
                key={h.item.key}
                hit={h}
                hereKey={pick?.storeKey ?? null}
                open={!pick && open === h.item.key}
                onToggle={() => (pick ? pick.onPick(h.item) : setOpen(open === h.item.key ? null : h.item.key))}
              />
            ))}
          </ul>
          {hits.length > shown && (
            <button className="btn secondary wide" onClick={() => setShown(shown + PAGE)}>
              {S.search.more(Math.min(PAGE, hits.length - shown))}
            </button>
          )}
        </>
      )}

      {pick && (
        <footer className="action-bar">
          <div className="row">
            <button className="btn secondary big" onClick={() => pick.onType(text)}>
              {text.trim() && !query.barcodes.length && !query.price ? S.search.typeNamed(text.trim()) : S.search.typeIt}
            </button>
          </div>
        </footer>
      )}
    </main>
  );
}

/** What the box understood beyond plain words, so "50" or "1.5L" doing something surprising is visible. */
function describe(q: Query): string[] {
  const out: string[] = [];
  for (const b of q.barcodes) out.push(S.search.lookBarcode(b));
  if (q.price) out.push(S.search.lookPrice(q.price.min != null ? formatPeso(q.price.min) : null, q.price.max != null ? formatPeso(q.price.max) : null));
  for (const s of q.sizes) out.push(S.search.lookSize(s.kind === 'mass' ? fmtAmount(s.amount, 'g', 'kg') : s.kind === 'volume' ? fmtAmount(s.amount, 'ml', 'L') : `${s.amount} pcs`));
  for (const n of q.numbers) out.push(S.search.lookNumber(String(n)));
  return out;
}

const fmtAmount = (n: number, small: string, big: string) => (n >= 1000 ? `${Number((n / 1000).toFixed(3))} ${big}` : `${Number(n.toFixed(1))} ${small}`);

function priceText(p: PricePoint): string {
  if (p.priceType === 'perkg') return `${formatPeso(p.unitPriceCentavos)}${S.search.perKg}`;
  if (p.priceType === 'bundle' && p.bundleQty && p.bundlePriceCentavos != null) return S.search.bundle(p.bundleQty, formatPeso(p.bundlePriceCentavos));
  return formatPeso(p.unitPriceCentavos);
}

const dayText = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00`));

function ResultRow({ hit, hereKey, open, onToggle }: { hit: Hit; hereKey: string | null; open: boolean; onToggle: () => void }) {
  const { item, prices } = hit;
  // Adding to a trip: this store's price is the one that matters; the cheapest elsewhere is only a hint.
  const here = hereKey ? (prices.find((p) => p.storeKey === hereKey) ?? null) : null;
  const best = here ?? hit.best;
  const cat = CATEGORY_BY_ID[item.category];
  const meta = [item.size, cat.label].filter(Boolean).join(' · ');
  const where = !best
    ? S.search.noPrice
    : here
      ? `${S.search.here} · ${dayText(here.seenOn)}`
      : hereKey
        ? `${S.search.elsewhere(best.storeLabel)} · ${dayText(best.seenOn)}`
        : prices.length > 1
      ? S.search.range(prices.length, formatPeso(comparable(prices[0])), formatPeso(comparable(prices[prices.length - 1])))
      : `${best.storeLabel} · ${dayText(best.seenOn)}`;
  return (
    <li>
      <button className={`item-row result-row ${open ? 'open' : ''}`} aria-expanded={open} onClick={onToggle}>
        {item.image ? (
          <img className="item-thumb" src={item.image} alt="" loading="lazy" />
        ) : (
          <span className="item-thumb blank" style={{ background: cat.color, color: cat.ink }} aria-hidden="true">
            {item.name.trim().charAt(0).toUpperCase() || '•'}
          </span>
        )}
        <span className="item-name">
          {item.name}
          <small>{meta}</small>
          <small className="result-where">{where}</small>
          {item.barcode && <small className="item-code">{formatBarcode(item.barcode)}</small>}
        </span>
        {best && (
          <span className="result-price">
            {/* Bundles show the per-piece price big (it's what the list sorts by) and the deal underneath. */}
            <strong>{best.priceType === 'bundle' ? formatPeso(comparable(best)) : priceText(best)}</strong>
            {best.priceType === 'bundle' && <small>{priceText(best)}</small>}
            {best.isPromo && <small className="promo-tag">{S.search.promo}</small>}
          </span>
        )}
      </button>
      {open && prices.length > 0 && (
        <ul className="store-prices">
          {prices.map((p) => (
            <li key={p.storeKey}>
              <span>
                <strong>{p.storeLabel}</strong>
                <small>
                  {dayText(p.seenOn)} · {p.source === 'phone' ? S.search.mine : S.search.shared}
                  {p.isPromo ? ` · ${S.search.promo}` : ''}
                  {p.priceType === 'bundle' && p.bundleQty ? ` · ${S.search.each(formatPeso(Math.round((p.bundlePriceCentavos ?? 0) / p.bundleQty)))}` : ''}
                </small>
              </span>
              <strong>{priceText(p)}</strong>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SourceLine({ state, onRetry }: { state: { state: SharedState; error?: string } | null; onRetry: () => void }) {
  if (!SHARING_ON || state?.state === 'off') return <>{S.search.sourcePhone}</>;
  if (!state) return <>{S.search.loading}</>;
  if (state.state === 'ok') return <>{S.search.sourceShared}</>;
  return (
    <>
      {state.state === 'offline' ? S.search.sourceOffline : S.search.sourceError(state.error ?? '')}{' '}
      <button className="link inline" onClick={onRetry}>{S.search.retry}</button>
    </>
  );
}
