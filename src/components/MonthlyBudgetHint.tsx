import { useEffect, useState } from 'react';
import { S } from '../strings';
import { db } from '../lib/db';
import { formatPeso, parsePesoInput } from '../lib/money';
import { loadMonthlyBudget, setMonthlyBudget, spentThisMonth, type MonthlyBudget } from '../lib/monthlyBudget';
import { manualGroceries, thisMonth } from '../lib/budget';

/** ₱3,450 rather than ₱3,450.00 when there are no centavos. */
const peso = (c: number) => formatPeso(c).replace(/\.00$/, '');

interface Props {
  /** Fills the trip's budget field. */
  onUse: (pesos: string) => void;
}

/** Under the trip budget field: "Use ₱3,450 left this month", and the monthly budget it comes from. */
export function MonthlyBudgetHint({ onUse }: Props) {
  const [monthly, setMonthly] = useState<MonthlyBudget | null>(null);
  const [spent, setSpent] = useState(0);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    (async () => {
      const [m, trips, items, expenses] = await Promise.all([loadMonthlyBudget(), db.trips.toArray(), db.items.toArray(), db.budgetExpenses.toArray()]);
      setMonthly(m);
      // Trips plus groceries typed in on the Budget tab, so both screens agree on what's left.
      setSpent(spentThisMonth(trips, items) + manualGroceries(expenses, thisMonth()));
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  if (!ready) return null;
  const T = S.start.monthly;

  async function save() {
    const c = parsePesoInput(draft);
    if (!c) return;
    await setMonthlyBudget(c);
    setMonthly({ centavos: c, source: 'shopper' });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="monthly-budget">
        <label className="field">
          <span className="label">{T.label}</span>
          <input inputMode="decimal" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={T.placeholder} />
        </label>
        <div className="row-actions">
          <button className="btn secondary" onClick={() => setEditing(false)}>{T.cancel}</button>
          <button className="btn primary" disabled={!parsePesoInput(draft)} onClick={() => void save()}>{T.save}</button>
        </div>
      </div>
    );
  }

  const change = (
    <button
      className="link"
      onClick={() => {
        setDraft(monthly ? peso(monthly.centavos).replace('₱', '') : '');
        setEditing(true);
      }}
    >
      {monthly ? T.change : T.set}
    </button>
  );

  if (!monthly) return <div className="monthly-budget">{change}</div>;

  const left = monthly.centavos - spent;
  return (
    <div className="monthly-budget">
      {left > 0 ? (
        <button className="chip" onClick={() => onUse(peso(left).replace('₱', ''))}>
          {T.useLeft(peso(left))}
        </button>
      ) : (
        <p className="hint">{T.usedUp(peso(monthly.centavos))}</p>
      )}
      <p className="hint small">
        {T.summary(peso(monthly.centavos), peso(spent))} {change}
      </p>
      {monthly.source === 'profile' && <p className="hint small">{T.fromProfile}</p>}
    </div>
  );
}
