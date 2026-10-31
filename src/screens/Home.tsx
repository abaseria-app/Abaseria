import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { S } from '../strings';
import { db, getSetting, setSetting, storeName } from '../lib/db';
import { formatPeso } from '../lib/money';
import { PERIODS, rangeFor, summarize, type Period } from '../lib/periods';

interface Props {
  activeTripId: number | null;
  toast: string | null;
  onStart: () => void;
  onContinue: () => void;
  onSettings: () => void;
}

const dateFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });

export function Home({ activeTripId, toast, onStart, onContinue, onSettings }: Props) {
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
    const tally = new Map<number, { total: number; count: number }>();
    for (const i of items) {
      if (i.removed) continue;
      const t = tally.get(i.tripId) ?? { total: 0, count: 0 };
      t.total += i.lineTotalCentavos;
      t.count += 1;
      tally.set(i.tripId, t);
    }
    return trips
      .filter((t) => t.endedAt)
      .map((t) => {
        const own = tally.get(t.id!) ?? { total: 0, count: 0 };
        return {
          id: t.id!,
          store: storeName(t),
          startedAt: t.startedAt,
          itemCount: own.count,
          fromReceipt: t.receiptTotalCentavos != null,
          spentCentavos: t.receiptTotalCentavos ?? own.total,
        };
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [trips, items]);

  const summary = summarize(spend, period, now);
  const range = rangeFor(period, now);
  const inPeriod = spend.filter((t) => {
    const ms = Date.parse(t.startedAt);
    return ms >= range.start.getTime() && ms < range.end.getTime();
  });
  const maxBar = Math.max(1, ...summary.buckets.map((b) => b.total));
  const diff = summary.total - summary.prevTotal;
  const prevName = S.home.prevName[period];

  const active = activeTripId ? trips.find((t) => t.id === activeTripId) : undefined;
  const activeTotal = active ? items.filter((i) => i.tripId === active.id && !i.removed).reduce((s, i) => s + i.lineTotalCentavos, 0) : 0;

  return (
    <main className="screen home">
      <header className="topbar">
        <h1>{S.appName}</h1>
        <button className="link" onClick={onSettings}>{S.home.settings}</button>
      </header>
      {toast && <p className="toast">{toast}</p>}

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

        <div className={`bars n${summary.buckets.length > 12 ? 'many' : 'few'}`} aria-hidden="true">
          {summary.buckets.map((b, i) => (
            <div key={i} className="bar-col" title={`${b.label}: ${formatPeso(b.total)}`}>
              <div className="bar-fill" style={{ height: `${(b.total / maxBar) * 100}%` }} />
              <span className="bar-label">
                {summary.buckets.length > 12 ? (i % 7 === 0 ? b.label : '') : b.label}
              </span>
            </div>
          ))}
        </div>
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

      <div className="bottom">
        <button className="btn primary huge" onClick={active ? onContinue : onStart}>
          {active ? S.home.continueTrip : S.home.startShopping}
        </button>
      </div>
    </main>
  );
}
