// Household budget: the Budget tab on Explore (Budget Module Plan, Nov 16 2026).
//
// Everything here stays on the phone, like trips. Income, bills and rent never reach Supabase: the shopper
// profile lists income under "never collected", and this keeps it that way (plan, decision D1).
//
// The period is the calendar month (D2). Groceries fill themselves from finished trips; everything else is
// typed in. All money is integer centavos.
import type { Item, Trip } from './db';
import { storeName } from './db';
import { manilaDay } from './visits';

/** The 11 household categories (plan, decision D3). Labels live in strings.ts. */
export const BUDGET_CATEGORY_IDS = [
  'groceries',
  'rent',
  'electricity',
  'water',
  'lpg',
  'internet',
  'mobile',
  'transport',
  'school',
  'health',
  'others',
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORY_IDS)[number];

export const BUDGET_COLORS: Record<BudgetCategory, string> = {
  groceries: '#48b3b4',
  rent: '#4b1f6f',
  electricity: '#fed71d',
  water: '#238bdc',
  lpg: '#f89e2f',
  internet: '#cfa6ee',
  mobile: '#ed69b3',
  transport: '#1a3555',
  school: '#7abb39',
  health: '#bd4840',
  others: '#9ca3af',
};

/** Text color on a chip filled with the category color. */
export const BUDGET_INK: Record<BudgetCategory, string> = {
  groceries: '#1a3555',
  rent: '#ffffff',
  electricity: '#1a3555',
  water: '#ffffff',
  lpg: '#1a3555',
  internet: '#4b1f6f',
  mobile: '#1a3555',
  transport: '#ffffff',
  school: '#1a3555',
  health: '#ffffff',
  others: '#1a3555',
};

export const isBudgetCategory = (v: unknown): v is BudgetCategory => (BUDGET_CATEGORY_IDS as readonly unknown[]).includes(v);

// ---------------------------------------------------------------------------------------------------------
// Records kept on the phone (Dexie tables in db.ts)

/** Something the household paid for. Trips are not copied in here; they're read from the trips table. */
export interface BudgetExpense {
  id?: number;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  category: BudgetCategory;
  amountCentavos: number;
  /** 'bill': made by Mark paid, and removed again by Undo. */
  source: 'manual' | 'bill';
  billId?: number | null;
  /** A receipt photo kept on the phone (budgetPhotos). No text is read from it. */
  photoId?: number | null;
  createdAt: string;
}

export interface BudgetIncome {
  id?: number;
  date: string;
  /** "Salary", "Padala", "Sari-sari store". */
  source: string;
  amountCentavos: number;
  createdAt: string;
}

export interface BudgetBill {
  id?: number;
  name: string;
  category: BudgetCategory;
  /** The usual amount. Mark paid lets the shopper change it for that month (Meralco is never the same twice). */
  amountCentavos: number;
  /** YYYY-MM-DD. For a monthly bill: the first month it's due, and the day of the month. */
  firstDue: string;
  repeats: 'monthly' | 'once';
  /** Month (YYYY-MM) → the expense Mark paid created. */
  paid: Record<string, number>;
  createdAt: string;
}

export interface GoalContribution {
  date: string;
  amountCentavos: number;
}

export interface BudgetGoal {
  id?: number;
  name: string;
  targetCentavos: number;
  contributions: GoalContribution[];
  createdAt: string;
}

/** The household budget set for one month. Later months use it until they get their own. 0 = cleared. */
export interface BudgetMonth {
  month: string;
  budgetCentavos: number;
}

export interface BudgetPhoto {
  id?: number;
  blob: Blob;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------------------
// Months

/** This month in Manila, YYYY-MM. */
export const thisMonth = (now: Date = new Date()) => manilaDay(now).slice(0, 7);
export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The month's budget: its own, or the latest earlier month's. Null when none was ever set or it was cleared. */
export function budgetFor(months: BudgetMonth[], month: string): number | null {
  let best: BudgetMonth | null = null;
  for (const m of months) if (m.month <= month && (!best || m.month > best.month)) best = m;
  return best && best.budgetCentavos > 0 ? best.budgetCentavos : null;
}

// ---------------------------------------------------------------------------------------------------------
// Bills

/** When the bill falls due in this month, or null if it doesn't. Day 31 becomes the 30th, 28th or 29th. */
export function dueDateIn(bill: Pick<BudgetBill, 'firstDue' | 'repeats'>, month: string): string | null {
  const first = monthOf(bill.firstDue);
  if (bill.repeats === 'once') return first === month ? bill.firstDue : null;
  if (month < first) return null;
  const day = Math.min(Number(bill.firstDue.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

export interface BillDue {
  bill: BudgetBill;
  due: string;
  /** The expense that paid it this month, if it still exists. */
  paidExpenseId: number | null;
  overdue: boolean;
}

/** Bills due this month: unpaid first, soonest first; paid ones after. */
export function billsForMonth(bills: BudgetBill[], month: string, today: string, expenseIds: Set<number>): BillDue[] {
  const out: BillDue[] = [];
  for (const bill of bills) {
    const due = dueDateIn(bill, month);
    if (!due) continue;
    const paidId = bill.paid?.[month];
    const paidExpenseId = paidId != null && expenseIds.has(paidId) ? paidId : null;
    out.push({ bill, due, paidExpenseId, overdue: paidExpenseId == null && due < today });
  }
  return out.sort((a, b) => Number(a.paidExpenseId != null) - Number(b.paidExpenseId != null) || a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}

// ---------------------------------------------------------------------------------------------------------
// Trips → Groceries

export interface TripSpend {
  tripId: number;
  /** The day the trip started, Manila. */
  date: string;
  store: string;
  centavos: number;
}

/**
 * Finished, not cancelled trips, counted the way the Cart tab and the trip budget hint count them:
 * the receipt total when entered, otherwise the app's tally. A trip that ended with nothing is left out.
 */
export function tripSpends(trips: Trip[], items: Item[]): TripSpend[] {
  const tally = new Map<number, number>();
  for (const i of items) if (!i.removed) tally.set(i.tripId, (tally.get(i.tripId) ?? 0) + i.lineTotalCentavos);
  return trips
    .filter((t) => t.endedAt && !t.cancelledAt)
    .map((t) => ({ tripId: t.id!, date: manilaDay(new Date(t.startedAt)), store: storeName(t), centavos: t.receiptTotalCentavos ?? tally.get(t.id!) ?? 0 }))
    .filter((t) => t.centavos > 0);
}

// ---------------------------------------------------------------------------------------------------------
// One month, ready for the screen

export type Row =
  | { key: string; kind: 'expense'; date: string; name: string; category: BudgetCategory; centavos: number; expense: BudgetExpense }
  | { key: string; kind: 'trip'; date: string; name: string; category: 'groceries'; centavos: number; tripId: number };

export interface MonthInput {
  expenses: BudgetExpense[];
  income: BudgetIncome[];
  bills: BudgetBill[];
  months: BudgetMonth[];
  trips: TripSpend[];
}

export interface MonthView {
  month: string;
  budget: number | null;
  spent: number;
  /** Budget minus spent; negative when over. Null without a budget. */
  left: number | null;
  /** Spent as a share of the budget, not capped at 100. Null without a budget. */
  pct: number | null;
  income: number;
  incomeRows: BudgetIncome[];
  /** Categories with spending, largest first. */
  byCategory: Array<{ id: BudgetCategory; centavos: number }>;
  groceriesFromTrips: number;
  /** Newest first. */
  rows: Row[];
  bills: BillDue[];
  unpaidBills: number;
}

export function monthView(input: MonthInput, month: string, today: string): MonthView {
  const rows: Row[] = [
    ...input.expenses
      .filter((e) => monthOf(e.date) === month)
      .map((e): Row => ({ key: `e${e.id}`, kind: 'expense', date: e.date, name: e.name, category: e.category, centavos: e.amountCentavos, expense: e })),
    ...input.trips
      .filter((t) => monthOf(t.date) === month)
      .map((t): Row => ({ key: `t${t.tripId}`, kind: 'trip', date: t.date, name: t.store, category: 'groceries', centavos: t.centavos, tripId: t.tripId })),
  ].sort((a, b) => b.date.localeCompare(a.date) || createdOf(b).localeCompare(createdOf(a)));

  const spent = rows.reduce((s, r) => s + r.centavos, 0);
  const totals = new Map<BudgetCategory, number>();
  for (const r of rows) totals.set(r.category, (totals.get(r.category) ?? 0) + r.centavos);
  const byCategory = BUDGET_CATEGORY_IDS.filter((id) => (totals.get(id) ?? 0) > 0)
    .map((id) => ({ id, centavos: totals.get(id)! }))
    .sort((a, b) => b.centavos - a.centavos);

  const incomeRows = input.income.filter((i) => monthOf(i.date) === month).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const budget = budgetFor(input.months, month);
  const bills = billsForMonth(input.bills, month, today, new Set(input.expenses.map((e) => e.id!)));

  return {
    month,
    budget,
    spent,
    left: budget == null ? null : budget - spent,
    pct: budget == null ? null : Math.round((spent / budget) * 100),
    income: incomeRows.reduce((s, i) => s + i.amountCentavos, 0),
    incomeRows,
    byCategory,
    groceriesFromTrips: rows.filter((r) => r.kind === 'trip').reduce((s, r) => s + r.centavos, 0),
    rows,
    bills,
    unpaidBills: bills.filter((b) => b.paidExpenseId == null).reduce((s, b) => s + b.bill.amountCentavos, 0),
  };
}

const createdOf = (r: Row) => (r.kind === 'expense' ? r.expense.createdAt : '');

/** Search across a month's rows: name, category label and amount. */
export function searchRows(rows: Row[], query: string, label: (c: BudgetCategory) => string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => `${r.name} ${label(r.category)} ${(r.centavos / 100).toFixed(2)}`.toLowerCase().includes(q));
}

/**
 * Whole-number percentages that add up to exactly 100 (largest remainder), so a chart legend never shows 99% or 101%.
 */
export function percentages(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let short = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (short <= 0) break;
    out[i] += 1;
    short -= 1;
  }
  return out;
}

/**
 * Groceries typed in on the Budget tab this month (palengke, sari-sari). The trip budget hint adds these to
 * the month's trips, so "left this month" matches the Budget tab's Groceries.
 */
export function manualGroceries(expenses: BudgetExpense[], month: string): number {
  return expenses.filter((e) => e.category === 'groceries' && monthOf(e.date) === month).reduce((s, e) => s + e.amountCentavos, 0);
}

export const goalSaved = (g: Pick<BudgetGoal, 'contributions'>) => g.contributions.reduce((s, c) => s + c.amountCentavos, 0);

// ---------------------------------------------------------------------------------------------------------
// CSV for one month

export const BUDGET_CSV_HEADERS = ['date', 'type', 'name', 'category', 'amount', 'note'];

export function budgetCsvRows(view: MonthView, label: (c: BudgetCategory) => string): Record<string, unknown>[] {
  const spend = [...view.rows].reverse().map((r) => ({
    date: r.date,
    type: 'expense',
    name: r.name,
    category: label(r.category),
    amount: r.centavos / 100,
    note: r.kind === 'trip' ? 'grocery trip' : r.expense.source === 'bill' ? 'bill paid' : '',
  }));
  const income = [...view.incomeRows].reverse().map((i) => ({ date: i.date, type: 'income', name: i.source, category: '', amount: i.amountCentavos / 100, note: '' }));
  const unpaid = view.bills
    .filter((b) => b.paidExpenseId == null)
    .map((b) => ({ date: b.due, type: 'bill due', name: b.bill.name, category: label(b.bill.category), amount: b.bill.amountCentavos / 100, note: b.overdue ? 'overdue' : 'not paid yet' }));
  return [...spend, ...income, ...unpaid];
}
