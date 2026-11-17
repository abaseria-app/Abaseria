import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { S } from '../strings';
import { db, getSetting, setSetting, storeName } from '../lib/db';
import { formatPeso } from '../lib/money';
import { PERIODS, rangeFor, summarize, type Period } from '../lib/periods';
import { categoryBreakdown, type Breakdown, type SliceId } from '../lib/breakdown';
import { CATEGORY_BY_ID } from '../lib/categories';
import type { Item } from '../lib/db';
import { BottomNav } from '../components/BottomNav';

interface Props {
  activeTripId: number | null;
  toast: string | null;
  onStart: () => void;
  onContinue: () => void;
  onSettings: () => void;
  onSearch: () => void;
  onExplore: () => void;
  onCommunity: () => void;
  onProfile: () => void;
}

const dateFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });

export function Home({ activeTripId, toast, onStart, onContinue, onSettings, onSearch, onExplore, onCommunity, onProfile }: Props) {
  const [period, setPeriod] = useState<Period>('week');
  const trips = useLiveQuery(() => db.trips.toArray(), []) ?? [];
  const items = useLiveQuery(() => db.items.toArray(), []) ?? [];

  useEffect(() => {
    getSetting('homePeriod').then((p) => {
      if (p && (PERIODS as string[]).includes(p)) setPeriod(p as Period);
    });
  }, []);

  function choose(p: Period) {
    setPeriod(p);
    setSetting('homePeriod', p);
  }

  const now = useMemo(() => new Date(), []);

  // Finished trips only. A trip costs its receipt total when the shopper entered one, otherwise the app's tally.
  const spend = useMemo(() => {
    const tally = new Map<number, { total: number; count: number; items: Item[] }>();
    for (const i of items) {
      if (i.removed) continue;
      const t = tally.get(i.tripId) ?? { total: 0, count: 0, items: [] };
      t.total += i.lineTotalCentavos;
      t.count += 1;
      t.items.push(i);
      tally.set(i.tripId, t);
    }
    return trips
      .filter((t) => t.endedAt)
      .map((t) => {
        const own = tally.get(t.id!) ?? { total: 0, count: 0, items: [] };
        return {
          id: t.id!,
          items: own.items,
          receiptCentavos: t.receiptTotalCentavos,
          store: storeName(t),
          startedAt: t.startedAt,
          itemCount: own.count,
          fromReceipt: t.receiptTotalCentavos != null,
          spentCentavos: t.receiptTotalCentavos ?? own.total,
        };
      })
      // A trip ended with nothing logged and no receipt is a false start; counting it would drag the average down.
      .filter((t) => t.itemCount > 0 || t.spentCentavos > 0)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [trips, items]);

  const summary = summarize(spend, period, now);
  const range = rangeFor(period, now);
  const inPeriod = spend.filter((t) => {
    const ms = Date.parse(t.startedAt);
    return ms >= range.start.getTime() && ms < range.end.getTime();
  });
  const breakdown = categoryBreakdown(spend, range.start, range.end);
  const itemsInPeriod = inPeriod.reduce((n, t) => n + t.itemCount, 0);
  const diff = summary.total - summary.prevTotal;
  const prevName = S.home.prevName[period];

  const active = activeTripId ? trips.find((t) => t.id === activeTripId) : undefined;
  const activeTotal = active ? items.filter((i) => i.tripId === active.id && !i.removed).reduce((s, i) => s + i.lineTotalCentavos, 0) : 0;

  return (
    <main className="screen home with-nav">
      <header className="topbar">
        <h1>{S.appName}</h1>
        <button className="link" onClick={onSettings}>{S.home.settings}</button>
      </header>
      {toast && <p className="toast">{toast}</p>}

      <button className="search-open" onClick={onSearch} aria-label={S.search.open}>
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span>{S.search.openHint}</span>
      </button>

      {active && (
        <button className="active-trip" onClick={onContinue}>
          <span>
            <strong>{S.home.inProgress(storeName(active))}</strong>
            <small>{formatPeso(activeTotal)}</small>
          </span>
          <span className="go">{S.home.continueTrip} ›</span>
        </button>
      )}

      <div className="seg period-tabs" role="tablist">
        {PERIODS.map((p) => (
          <button key={p} role="tab" aria-selected={period === p} className={period === p ? 'on' : ''} onClick={() => choose(p)}>
            {S.home.periods[p]}
          </button>
        ))}
      </div>

      <section className="spend-card">
        <span className="label">{S.home.spentLabel[period]}</span>
        <div className="spend-num">{formatPeso(summary.total)}</div>
        <p className="spend-sub">{S.home.tripsLine(summary.trips, formatPeso(summary.avgPerTrip))}</p>
        <p className={`spend-change ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>
          {summary.prevTotal === 0
            ? S.home.noPrev(prevName)
            : diff > 0
              ? S.home.more(formatPeso(diff), summary.changePct, prevName)
              : diff < 0
                ? S.home.less(formatPeso(-diff), summary.changePct, prevName)
                : S.home.same(prevName)}
        </p>

      </section>

      <section className="pie-card">
        <h2>{S.home.byCategory}</h2>
        <Donut breakdown={breakdown} center={breakdown.total ? S.home.itemsCenter(itemsInPeriod) : S.home.nothingYet} />
        {breakdown.slices.length > 0 && (
          <ul className="legend">
            {breakdown.slices.map((sl) => (
              <li key={sl.id}>
                <span className="dot" style={{ background: sliceColor(sl.id) }} />
                <span className="legend-name">
                  {sliceLabel(sl.id)}
                  {sl.id === 'unitemized' && <small>{S.home.unitemizedHint}</small>}
                </span>
                <span className="legend-amt">{formatPeso(sl.centavos)}</span>
                <span className="legend-pct">{Math.round((sl.centavos / breakdown.total) * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2>{S.home.tripsTitle}</h2>
      {inPeriod.length === 0 ? (
        <p className="hint">{S.home.noTrips}</p>
      ) : (
        <ul className="trip-list">
          {inPeriod.slice(0, 20).map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.store}</strong>
                <small>
                  {dateFmt.format(new Date(t.startedAt))} · {S.shop.items(t.itemCount)}
                  {t.fromReceipt ? ` · ${S.home.receipt}` : ''}
                </small>
              </span>
              <strong>{formatPeso(t.spentCentavos)}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="hint small">{S.home.sourceNote}</p>

      <div className="bottom above-nav">
        <button className="btn primary huge" onClick={active ? onContinue : onStart}>
          {active ? S.home.continueTrip : S.home.startShopping}
        </button>
      </div>
      <BottomNav current="cart" onExplore={onExplore} onCart={() => window.scrollTo({ top: 0 })} onScan={active ? onContinue : onStart} onCommunity={onCommunity} onProfile={onProfile} />
    </main>
  );
}

const UNITEMIZED_COLOR = '#d6d3d1';
const sliceColor = (id: SliceId) => (id === 'unitemized' ? UNITEMIZED_COLOR : CATEGORY_BY_ID[id].color);
const sliceLabel = (id: SliceId) => (id === 'unitemized' ? S.home.unitemized : CATEGORY_BY_ID[id].label);

/** Donut chart drawn as stroked circle arcs, starting at 12 o'clock and going clockwise. */
function Donut({ breakdown, center }: { breakdown: Breakdown; center: string }) {
  const r = 60;
  const c = 2 * Math.PI * r;
  const gap = breakdown.slices.length > 1 ? 1.5 : 0;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={breakdown.slices.map((s) => `${sliceLabel(s.id)} ${formatPeso(s.centavos)}`).join(', ') || center}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="#ebe9e2" strokeWidth="22" />
        {breakdown.slices.map((s) => {
          const len = (s.centavos / breakdown.total) * c;
          const el = (
            <circle
              key={s.id}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={sliceColor(s.id)}
              strokeWidth="22"
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="donut-center">
        {breakdown.total > 0 && <strong>{formatPeso(breakdown.total)}</strong>}
        <span>{center}</span>
      </div>
    </div>
  );
}
