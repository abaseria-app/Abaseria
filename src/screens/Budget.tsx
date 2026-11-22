// The Budget tab on Explore: the whole household's month, with groceries filled in from trips.
// Budget Module Plan steps B2–B8. Everything is read from and saved to the phone only.
import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { S } from '../strings';
import { db } from '../lib/db';
import { formatPeso, parsePesoInput } from '../lib/money';
import { parseBudget, setMonthlyBudget } from '../lib/monthlyBudget';
import { manilaDay } from '../lib/visits';
import { shareOrDownload, toCsv } from '../lib/export';
import {
  BUDGET_CATEGORY_IDS,
  BUDGET_COLORS,
  BUDGET_CSV_HEADERS,
  BUDGET_INK,
  budgetCsvRows,
  goalSaved,
  monthView,
  percentages,
  searchRows,
  shiftMonth,
  thisMonth,
  tripSpends,
  type BillDue,
  type BudgetCategory,
  type BudgetExpense,
  type BudgetGoal,
  type BudgetIncome,
  type BudgetBill,
  type MonthView,
  type Row,
} from '../lib/budget';
import {
  addToGoal,
  deleteBill,
  deleteExpense,
  deleteGoal,
  deleteIncome,
  markBillPaid,
  saveBill,
  saveExpense,
  saveGoal,
  saveIncome,
  savePhoto,
  setMonthBudget,
  shrinkReceipt,
  unmarkBillPaid,
} from '../lib/budgetStore';

type View = 'overview' | 'records' | 'bills' | 'income' | 'goals';
const VIEWS: View[] = ['overview', 'records', 'bills', 'income', 'goals'];

type Sheet =
  | { kind: 'expense'; expense?: BudgetExpense }
  | { kind: 'income'; income?: BudgetIncome }
  | { kind: 'bill'; bill?: BudgetBill }
  | { kind: 'pay'; due: BillDue }
  | { kind: 'goal'; goal?: BudgetGoal }
  | { kind: 'addToGoal'; goal: BudgetGoal }
  | { kind: 'monthBudget' }
  | { kind: 'groceryBudget' };

const T = S.budget;
const catLabel = (c: BudgetCategory) => T.categories[c] ?? c;
/** ₱3,450 rather than ₱3,450.00 when there are no centavos. */
const peso = (c: number) => formatPeso(c).replace(/\.00$/, '');
/** What goes in an amount box when editing: 1234.5 → "1,234.50" without the peso sign. */
const pesoInput = (c: number) => formatPeso(c).replace('₱', '');
const dayFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
const fmtMonth = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`));

export function Budget() {
  const today = manilaDay();
  const current = thisMonth();
  const [month, setMonth] = useState(current);
  const [view, setView] = useState<View>('overview');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const [expenses, income, bills, goals, months, trips, items, grocery] = await Promise.all([
      db.budgetExpenses.toArray(),
      db.budgetIncome.toArray(),
      db.budgetBills.toArray(),
      db.budgetGoals.toArray(),
      db.budgetMonths.toArray(),
      db.trips.toArray(),
      db.items.toArray(),
      db.settings.get('monthlyBudget'),
    ]);
    return { expenses, income, bills, goals, months, trips: tripSpends(trips, items), grocery: parseBudget(grocery?.value ?? null) };
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);

  if (!data) return <section className="budget" aria-busy="true" />;

  const v = monthView(data, month, today);
  const expenseById = new Map(data.expenses.map((e) => [e.id!, e]));
  const close = () => setSheet(null);

  async function exportMonth() {
    const csv = toCsv(budgetCsvRows(v, catLabel), BUDGET_CSV_HEADERS);
    await shareOrDownload([new File([csv], `abaseria-budget-${month}.csv`, { type: 'text/csv' })], `Abaseria budget, ${fmtMonth(month)}`);
    setNote(T.exported);
  }

  return (
    <section className="budget">
      <div className="month-switch">
        <button className="month-arrow" aria-label={T.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <h2>{fmtMonth(month)}</h2>
        <button className="month-arrow" aria-label={T.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      {month !== current && (
        <button className="link month-today" onClick={() => setMonth(current)}>
          {T.thisMonth}
        </button>
      )}

      <nav className="chips budget-views" aria-label={T.viewsLabel}>
        {VIEWS.map((id) => (
          <button key={id} className={`chip ${view === id ? 'on' : ''}`} aria-pressed={view === id} onClick={() => setView(id)}>
            {T.views[id]}
          </button>
        ))}
      </nav>

      {note && <p className="toast">{note}</p>}

      {view === 'overview' && (
        <Overview v={v} month={month} data={data} expenseById={expenseById} setSheet={setSheet} setView={setView} onExport={() => void exportMonth()} />
      )}
      {view === 'records' && <Records v={v} query={query} setQuery={setQuery} setSheet={setSheet} />}
      {view === 'bills' && <Bills v={v} expenseById={expenseById} month={month} setSheet={setSheet} />}
      {view === 'income' && <Income v={v} setSheet={setSheet} />}
      {view === 'goals' && <Goals goals={data.goals} setSheet={setSheet} />}

      {sheet && <SheetFor sheet={sheet} month={month} today={today} v={v} grocery={data.grocery?.centavos ?? null} onClose={close} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Views

interface OverviewProps {
  v: MonthView;
  month: string;
  data: { grocery: { centavos: number } | null };
  expenseById: Map<number, BudgetExpense>;
  setSheet: (s: Sheet) => void;
  setView: (v: View) => void;
  onExport: () => void;
}

function Overview({ v, month, data, expenseById, setSheet, setView, onExport }: OverviewProps) {
  const over = v.left != null && v.left < 0;
  const groceries = v.byCategory.find((c) => c.id === 'groceries')?.centavos ?? 0;
  const groceryBudget = data.grocery?.centavos ?? null;
  return (
    <>
      <section className={`spend-card budget-card ${over ? 'over' : ''}`}>
        <span className="label">{T.spentIn(fmtMonth(month))}</span>
        <div className="spend-num">{formatPeso(v.spent)}</div>
        {v.budget != null ? (
          <>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, v.pct!)} aria-label={T.used(v.pct!)}>
              <div style={{ width: `${Math.min(100, v.pct!)}%` }} />
            </div>
            <p className="spend-sub strong">
              {over ? T.overBy(peso(-v.left!), peso(v.budget)) : v.left === 0 ? T.exactly(peso(v.budget)) : T.leftOf(peso(v.left!), peso(v.budget))}
            </p>
            <p className="spend-sub">
              {T.used(v.pct!)} ·{' '}
              <button className="link inline" onClick={() => setSheet({ kind: 'monthBudget' })}>
                {T.editBudget}
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="spend-sub">{T.noBudget}</p>
            <div className="budget-card-actions">
              <button className="btn secondary" onClick={() => setSheet({ kind: 'monthBudget' })}>
                {T.setBudget}
              </button>
            </div>
          </>
        )}
        {v.income > 0 && <p className="spend-sub">{T.incomeLine(peso(v.income))}</p>}
      </section>

      <div className="budget-actions">
        <button className="btn primary" onClick={() => setSheet({ kind: 'expense' })}>
          {T.addExpense}
        </button>
        <button className="btn secondary" onClick={() => setSheet({ kind: 'income' })}>
          {T.recordIncome}
        </button>
      </div>

      <section className="pie-card">
        <div className="section-head">
          <h2>{T.billsTitle}</h2>
          <button className="link" onClick={() => setView('bills')}>{T.allBills}</button>
        </div>
        {v.bills.length === 0 ? (
          <p className="hint">{T.noBills}</p>
        ) : (
          <>
            <BillList bills={v.bills.slice(0, 3)} expenseById={expenseById} month={month} setSheet={setSheet} />
            {v.unpaidBills > 0 && <p className="hint small">{T.unpaidTotal(peso(v.unpaidBills))}</p>}
          </>
        )}
      </section>

      <section className="pie-card">
        <h2>{T.byCategory}</h2>
        <CategoryChart v={v} />
        {v.groceriesFromTrips > 0 && <p className="hint small">{T.fromTrips(peso(v.groceriesFromTrips))}</p>}
        <p className="hint small">
          {groceryBudget != null && (groceries > groceryBudget ? T.groceryOver(peso(groceries - groceryBudget), peso(groceryBudget)) : T.groceryBudget(peso(groceryBudget - groceries), peso(groceryBudget)))}{' '}
          <button className="link inline" onClick={() => setSheet({ kind: 'groceryBudget' })}>
            {groceryBudget != null ? T.changeGroceryBudget : T.setGroceryBudget}
          </button>
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>{T.recent}</h2>
          <button className="link" onClick={() => setView('records')}>{T.allRecords}</button>
        </div>
        {v.rows.length === 0 ? <p className="hint">{T.noRecords}</p> : <RowList rows={v.rows.slice(0, 3)} setSheet={setSheet} />}
      </section>

      <details className="budget-tips">
        <summary>{T.tipsTitle}</summary>
        <ol>
          {T.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </details>

      <p className="hint small">{T.onPhone}</p>
      <button className="link" onClick={onExport}>{T.exportCsv}</button>
    </>
  );
}

function CategoryChart({ v }: { v: MonthView }) {
  const pct = percentages(v.byCategory.map((c) => c.centavos));
  const r = 60;
  const c = 2 * Math.PI * r;
  const gap = v.byCategory.length > 1 ? 1.5 : 0;
  let offset = 0;
  return (
    <>
      <div className="donut">
        <svg viewBox="0 0 160 160" role="img" aria-label={v.byCategory.map((s) => `${catLabel(s.id)} ${formatPeso(s.centavos)}`).join(', ') || T.nothingYet}>
          <circle cx="80" cy="80" r={r} fill="none" stroke="#ebe9e2" strokeWidth="22" />
          {v.byCategory.map((s) => {
            const len = (s.centavos / v.spent) * c;
            const el = (
              <circle key={s.id} cx="80" cy="80" r={r} fill="none" stroke={BUDGET_COLORS[s.id]} strokeWidth="22"
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut-center">
          {v.spent > 0 && <strong>{formatPeso(v.spent)}</strong>}
          {v.spent === 0 && <span>{T.nothingYet}</span>}
        </div>
      </div>
      {v.byCategory.length > 0 && (
        <ul className="legend">
          {v.byCategory.map((s, i) => (
            <li key={s.id}>
              <span className="dot" style={{ background: BUDGET_COLORS[s.id] }} />
              <span className="legend-name">{catLabel(s.id)}</span>
              <span className="legend-amt">{formatPeso(s.centavos)}</span>
              <span className="legend-pct">{pct[i]}%</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RowList({ rows, setSheet }: { rows: Row[]; setSheet: (s: Sheet) => void }) {
  return (
    <ul className="trip-list budget-rows">
      {rows.map((r) => {
        const body = (
          <>
            <span className="budget-dot" style={{ background: BUDGET_COLORS[r.category] }} aria-hidden="true" />
            <span className="budget-row-text">
              <strong>{r.name}</strong>
              <small>
                {fmtDay(r.date)} · {catLabel(r.category)}
                {r.kind === 'trip' && ` · ${T.tripTag}`}
                {r.kind === 'expense' && r.expense.source === 'bill' && ` · ${T.billTag}`}
                {r.kind === 'expense' && r.expense.photoId != null && ` · ${T.photoTag}`}
              </small>
            </span>
            <strong>{formatPeso(r.centavos)}</strong>
          </>
        );
        return (
          <li key={r.key}>
            {r.kind === 'expense' ? (
              <button className="budget-row" onClick={() => setSheet({ kind: 'expense', expense: r.expense })}>
                {body}
              </button>
            ) : (
              <div className="budget-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Records({ v, query, setQuery, setSheet }: { v: MonthView; query: string; setQuery: (q: string) => void; setSheet: (s: Sheet) => void }) {
  const rows = searchRows(v.rows, query, catLabel);
  return (
    <>
      <button className="btn primary wide-top" onClick={() => setSheet({ kind: 'expense' })}>
        {T.addExpense}
      </button>
      <label className="field">
        <span className="label">{T.search}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="hint">{T.monthTotal(rows.length, formatPeso(rows.reduce((s, r) => s + r.centavos, 0)))}</p>
      {v.rows.length === 0 ? <p className="hint">{T.noRecords}</p> : rows.length === 0 ? <p className="hint">{T.noMatch}</p> : <RowList rows={rows} setSheet={setSheet} />}
      {v.groceriesFromTrips > 0 && <p className="hint small">{T.tripNote}</p>}
    </>
  );
}

function BillList({ bills, expenseById, month, setSheet }: { bills: BillDue[]; expenseById: Map<number, BudgetExpense>; month: string; setSheet: (s: Sheet) => void }) {
  return (
    <ul className="bill-list">
      {bills.map((b) => {
        const paid = b.paidExpenseId != null ? expenseById.get(b.paidExpenseId) : undefined;
        return (
          <li key={b.bill.id} className={b.overdue ? 'overdue' : paid ? 'paid' : ''}>
            <button className="bill-main" onClick={() => setSheet({ kind: 'bill', bill: b.bill })}>
              <strong>{b.bill.name}</strong>
              <small>{paid ? `${T.paid} ${fmtDay(paid.date)}` : b.overdue ? T.overdue(fmtDay(b.due)) : T.due(fmtDay(b.due))}</small>
            </button>
            <span className="bill-amt">{formatPeso(paid?.amountCentavos ?? b.bill.amountCentavos)}</span>
            {paid ? (
              <button className="link" onClick={() => void unmarkBillPaid(b.bill.id!, month)}>
                {T.undoPaid}
              </button>
            ) : (
              <button className="btn primary small" onClick={() => setSheet({ kind: 'pay', due: b })}>
                {T.markPaid}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Bills({ v, expenseById, month, setSheet }: { v: MonthView; expenseById: Map<number, BudgetExpense>; month: string; setSheet: (s: Sheet) => void }) {
  return (
    <>
      <button className="btn primary wide-top" onClick={() => setSheet({ kind: 'bill' })}>
        {T.addBill}
      </button>
      {v.bills.length === 0 ? <p className="hint">{T.noBills}</p> : <BillList bills={v.bills} expenseById={expenseById} month={month} setSheet={setSheet} />}
      {v.unpaidBills > 0 && <p className="hint">{T.unpaidTotal(peso(v.unpaidBills))}</p>}
    </>
  );
}

function Income({ v, setSheet }: { v: MonthView; setSheet: (s: Sheet) => void }) {
  return (
    <>
      <button className="btn primary wide-top" onClick={() => setSheet({ kind: 'income' })}>
        {T.recordIncome}
      </button>
      {v.incomeRows.length === 0 ? (
        <p className="hint">{T.noIncome}</p>
      ) : (
        <>
          <p className="hint">{T.incomeTotal(formatPeso(v.income))}</p>
          <ul className="trip-list budget-rows">
            {v.incomeRows.map((i) => (
              <li key={i.id}>
                <button className="budget-row" onClick={() => setSheet({ kind: 'income', income: i })}>
                  <span className="budget-row-text">
                    <strong>{i.source}</strong>
                    <small>{fmtDay(i.date)}</small>
                  </span>
                  <strong>{formatPeso(i.amountCentavos)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Goals({ goals, setSheet }: { goals: BudgetGoal[]; setSheet: (s: Sheet) => void }) {
  return (
    <>
      <h2>{T.goalsTitle}</h2>
      <button className="btn primary wide-top" onClick={() => setSheet({ kind: 'goal' })}>
        {T.addGoal}
      </button>
      {goals.length === 0 ? (
        <p className="hint">{T.noGoals}</p>
      ) : (
        <ul className="goal-list">
          {goals.map((g) => {
            const saved = goalSaved(g);
            const pct = g.targetCentavos > 0 ? Math.min(100, Math.round((saved / g.targetCentavos) * 100)) : 0;
            return (
              <li key={g.id} className="pie-card">
                <button className="goal-name" onClick={() => setSheet({ kind: 'goal', goal: g })}>
                  <strong>{g.name}</strong>
                  <small>{saved >= g.targetCentavos ? T.goalDone : T.goalProgress(peso(saved), peso(g.targetCentavos))}</small>
                </button>
                <div className="bar goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div style={{ width: `${pct}%` }} />
                </div>
                <button className="btn secondary small" onClick={() => setSheet({ kind: 'addToGoal', goal: g })}>
                  {T.addMoney}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Sheets (full-screen forms over the tab)

function SheetFrame({ title, onClose, onSave, canSave, onDelete, deleteLabel = T.sheet.delete, children }: {
  title: string;
  onClose: () => void;
  onSave: () => Promise<unknown>;
  canSave: boolean;
  onDelete?: () => Promise<unknown>;
  deleteLabel?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="budget-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose}>{T.sheet.close}</button>
        </div>
        {children}
        {error && <p className="warn">{error}</p>}
        {onDelete && (
          <button className="btn danger-link" disabled={busy} onClick={() => (sure ? void run(onDelete) : setSure(true))}>
            {sure ? T.sheet.deleteSure : deleteLabel}
          </button>
        )}
      </div>
      <div className="sheet-foot">
        <button className="btn primary" disabled={busy || !canSave} onClick={() => void run(onSave)}>
          {T.sheet.save}
        </button>
      </div>
    </div>
  );
}

function MoneyField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input inputMode="decimal" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} maxLength={80} />
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}

function CategoryPicker({ value, onChange }: { value: BudgetCategory; onChange: (c: BudgetCategory) => void }) {
  return (
    <>
      <p className="label">{T.sheet.category}</p>
      <div className="chips cat-chips" role="radiogroup" aria-label={T.sheet.category}>
        {BUDGET_CATEGORY_IDS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={value === c}
            className={`chip cat ${value === c ? 'on' : ''}`}
            style={{ ['--cat' as string]: BUDGET_COLORS[c], ['--cat-ink' as string]: BUDGET_INK[c] }}
            onClick={() => onChange(c)}
          >
            {catLabel(c)}
          </button>
        ))}
      </div>
    </>
  );
}

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function SheetFor({ sheet, month, today, v, grocery, onClose }: { sheet: Sheet; month: string; today: string; v: MonthView; grocery: number | null; onClose: () => void }) {
  // New records in another month start on its 1st, so they land in the month on screen.
  const defaultDate = month === today.slice(0, 7) ? today : `${month}-01`;
  switch (sheet.kind) {
    case 'expense':
      return <ExpenseSheet expense={sheet.expense} defaultDate={defaultDate} onClose={onClose} />;
    case 'income':
      return <IncomeSheet income={sheet.income} defaultDate={defaultDate} onClose={onClose} />;
    case 'bill':
      return <BillSheet bill={sheet.bill} defaultDate={defaultDate} onClose={onClose} />;
    case 'pay':
      return <PaySheet due={sheet.due} month={month} today={today} onClose={onClose} />;
    case 'goal':
      return <GoalSheet goal={sheet.goal} onClose={onClose} />;
    case 'addToGoal':
      return <AddToGoalSheet goal={sheet.goal} today={today} onClose={onClose} />;
    case 'monthBudget':
      return <MonthBudgetSheet month={month} current={v.budget} income={v.income} onClose={onClose} />;
    case 'groceryBudget':
      return <GroceryBudgetSheet current={grocery} onClose={onClose} />;
  }
}

function ExpenseSheet({ expense, defaultDate, onClose }: { expense?: BudgetExpense; defaultDate: string; onClose: () => void }) {
  const [name, setName] = useState(expense?.name ?? '');
  const [category, setCategory] = useState<BudgetCategory>(expense?.category ?? 'groceries');
  const [amount, setAmount] = useState(expense ? pesoInput(expense.amountCentavos) : '');
  const [date, setDate] = useState(expense?.date ?? defaultDate);
  const [photoId, setPhotoId] = useState<number | null>(expense?.photoId ?? null);
  const [newPhoto, setNewPhoto] = useState<Blob | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const centavos = parsePesoInput(amount);

  async function pick(file: File | undefined) {
    if (!file) return;
    setPhotoError(false);
    try {
      setNewPhoto(await shrinkReceipt(file));
    } catch {
      setPhotoError(true);
    }
  }

  const preview = usePhotoUrl(newPhoto, newPhoto ? null : photoId);

  return (
    <SheetFrame
      title={expense ? T.sheet.editExpense : T.sheet.newExpense}
      onClose={onClose}
      canSave={!!name.trim() && !!centavos && validDate(date)}
      onSave={async () => {
        // The photo is saved only now, so a cancelled sheet leaves nothing behind.
        const finalPhoto = newPhoto ? await savePhoto(newPhoto) : photoId;
        await saveExpense({ name, category, amountCentavos: centavos!, date, photoId: finalPhoto }, expense?.id);
      }}
      onDelete={expense ? () => deleteExpense(expense.id!) : undefined}
    >
      <TextField label={T.sheet.name} value={name} onChange={setName} placeholder={T.sheet.namePlaceholder} autoFocus={!expense} />
      <MoneyField label={T.sheet.amount} value={amount} onChange={setAmount} />
      <DateField label={T.sheet.date} value={date} onChange={setDate} />
      <CategoryPicker value={category} onChange={setCategory} />

      <p className="label">{T.sheet.photo}</p>
      {preview ? (
        <div className="receipt-preview">
          <img src={preview} alt="" />
          <button
            className="link"
            onClick={() => {
              setNewPhoto(null);
              setPhotoId(null);
            }}
          >
            {T.sheet.removePhoto}
          </button>
        </div>
      ) : (
        <label className="btn secondary receipt-pick">
          {T.sheet.addPhoto}
          <input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      )}
      {photoError && <p className="warn">{T.sheet.photoFailed}</p>}
      <p className="hint small">{T.sheet.photoNote}</p>
    </SheetFrame>
  );
}

/** An object URL for a picked photo, or for a photo already kept on the phone. */
function usePhotoUrl(blob: Blob | null, photoId: number | null): string | null {
  const stored = useLiveQuery(() => (photoId != null ? db.budgetPhotos.get(photoId) : undefined), [photoId]);
  const source = blob ?? stored?.blob ?? null;
  const [made, setMade] = useState<{ source: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!source) return;
    const url = URL.createObjectURL(source);
    // An object URL is made and freed outside React; keeping it in state ties its life to the blob.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMade({ source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return source && made?.source === source ? made.url : null;
}

function IncomeSheet({ income, defaultDate, onClose }: { income?: BudgetIncome; defaultDate: string; onClose: () => void }) {
  const [source, setSource] = useState(income?.source ?? '');
  const [amount, setAmount] = useState(income ? pesoInput(income.amountCentavos) : '');
  const [date, setDate] = useState(income?.date ?? defaultDate);
  const centavos = parsePesoInput(amount);
  return (
    <SheetFrame
      title={income ? T.sheet.editIncome : T.sheet.newIncome}
      onClose={onClose}
      canSave={!!source.trim() && !!centavos && validDate(date)}
      onSave={() => saveIncome({ source, amountCentavos: centavos!, date }, income?.id)}
      onDelete={income ? () => deleteIncome(income.id!) : undefined}
    >
      <TextField label={T.sheet.source} value={source} onChange={setSource} placeholder={T.sheet.sourcePlaceholder} autoFocus={!income} />
      <MoneyField label={T.sheet.amount} value={amount} onChange={setAmount} />
      <DateField label={T.sheet.date} value={date} onChange={setDate} />
    </SheetFrame>
  );
}

function BillSheet({ bill, defaultDate, onClose }: { bill?: BudgetBill; defaultDate: string; onClose: () => void }) {
  const [name, setName] = useState(bill?.name ?? '');
  const [category, setCategory] = useState<BudgetCategory>(bill?.category ?? 'electricity');
  const [amount, setAmount] = useState(bill ? pesoInput(bill.amountCentavos) : '');
  const [firstDue, setFirstDue] = useState(bill?.firstDue ?? defaultDate);
  const [repeats, setRepeats] = useState<BudgetBill['repeats']>(bill?.repeats ?? 'monthly');
  const centavos = parsePesoInput(amount);
  return (
    <SheetFrame
      title={bill ? T.sheet.editBill : T.sheet.newBill}
      onClose={onClose}
      canSave={!!name.trim() && !!centavos && validDate(firstDue)}
      onSave={() => saveBill({ name, category, amountCentavos: centavos!, firstDue, repeats }, bill?.id)}
      onDelete={bill ? () => deleteBill(bill.id!) : undefined}
    >
      <TextField label={T.sheet.billName} value={name} onChange={setName} placeholder={T.sheet.billPlaceholder} autoFocus={!bill} />
      <MoneyField label={T.sheet.usualAmount} value={amount} onChange={setAmount} />
      <DateField label={T.sheet.firstDue} value={firstDue} onChange={setFirstDue} />
      <p className="label">{T.sheet.repeats}</p>
      <div className="seg" role="radiogroup" aria-label={T.sheet.repeats}>
        {(['monthly', 'once'] as const).map((r) => (
          <button key={r} role="radio" aria-checked={repeats === r} className={repeats === r ? 'on' : ''} onClick={() => setRepeats(r)}>
            {r === 'monthly' ? T.monthly : T.once}
          </button>
        ))}
      </div>
      <CategoryPicker value={category} onChange={setCategory} />
    </SheetFrame>
  );
}

function PaySheet({ due, month, today, onClose }: { due: BillDue; month: string; today: string; onClose: () => void }) {
  const [amount, setAmount] = useState(pesoInput(due.bill.amountCentavos));
  const centavos = parsePesoInput(amount);
  return (
    <SheetFrame
      title={T.sheet.payBill(due.bill.name)}
      onClose={onClose}
      canSave={!!centavos}
      onSave={() => markBillPaid(due.bill.id!, month, centavos!, today)}
    >
      <p className="hint">{due.overdue ? T.overdue(fmtDay(due.due)) : T.due(fmtDay(due.due))}</p>
      <MoneyField label={T.sheet.paidAmount} value={amount} onChange={setAmount} autoFocus />
    </SheetFrame>
  );
}

function GoalSheet({ goal, onClose }: { goal?: BudgetGoal; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? pesoInput(goal.targetCentavos) : '');
  const centavos = parsePesoInput(target);
  return (
    <SheetFrame
      title={goal ? T.sheet.editGoal : T.sheet.newGoal}
      onClose={onClose}
      canSave={!!name.trim() && !!centavos}
      onSave={() => saveGoal({ name, targetCentavos: centavos! }, goal?.id)}
      onDelete={goal ? () => deleteGoal(goal.id!) : undefined}
    >
      <TextField label={T.sheet.goalName} value={name} onChange={setName} placeholder={T.sheet.goalPlaceholder} autoFocus={!goal} />
      <MoneyField label={T.sheet.target} value={target} onChange={setTarget} />
    </SheetFrame>
  );
}

function AddToGoalSheet({ goal, today, onClose }: { goal: BudgetGoal; today: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const centavos = parsePesoInput(amount);
  return (
    <SheetFrame title={T.sheet.addToGoal(goal.name)} onClose={onClose} canSave={!!centavos} onSave={() => addToGoal(goal.id!, centavos!, today)}>
      <p className="hint">{T.goalProgress(peso(goalSaved(goal)), peso(goal.targetCentavos))}</p>
      <MoneyField label={T.sheet.amount} value={amount} onChange={setAmount} autoFocus />
    </SheetFrame>
  );
}

function MonthBudgetSheet({ month, current, income, onClose }: { month: string; current: number | null; income: number; onClose: () => void }) {
  const [amount, setAmount] = useState(current ? pesoInput(current) : '');
  const centavos = parsePesoInput(amount);
  return (
    <SheetFrame
      title={T.sheet.monthBudget(fmtMonth(month))}
      onClose={onClose}
      canSave={!!centavos}
      onSave={() => setMonthBudget(month, centavos)}
      onDelete={current != null ? () => setMonthBudget(month, null) : undefined}
      deleteLabel={T.sheet.clearBudget}
    >
      <MoneyField label={T.sheet.amount} value={amount} onChange={setAmount} autoFocus />
      {income > 0 && (
        <button className="chip" onClick={() => setAmount(pesoInput(income))}>
          {T.incomeAsBudget(peso(income))}
        </button>
      )}
      <p className="hint small">{T.sheet.monthBudgetHint}</p>
    </SheetFrame>
  );
}

function GroceryBudgetSheet({ current, onClose }: { current: number | null; onClose: () => void }) {
  const [amount, setAmount] = useState(current ? pesoInput(current) : '');
  const centavos = parsePesoInput(amount);
  return (
    <SheetFrame
      title={T.sheet.groceryBudget}
      onClose={onClose}
      canSave={!!centavos}
      onSave={() => setMonthlyBudget(centavos)}
      onDelete={current != null ? () => setMonthlyBudget(null) : undefined}
      deleteLabel={T.sheet.clearBudget}
    >
      <MoneyField label={T.sheet.amount} value={amount} onChange={setAmount} autoFocus />
      <p className="hint small">{T.sheet.groceryBudgetHint}</p>
    </SheetFrame>
  );
}
