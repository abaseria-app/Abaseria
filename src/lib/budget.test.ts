import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Item, Trip } from './db';
import { db } from './db';
import {
  billsForMonth,
  budgetCsvRows,
  budgetFor,
  daysInMonth,
  dueDateIn,
  goalSaved,
  manualGroceries,
  monthView,
  percentages,
  searchRows,
  shiftMonth,
  tripSpends,
  type BudgetBill,
  type BudgetExpense,
  type MonthInput,
} from './budget';
import {
  addToGoal,
  deleteBill,
  deleteExpense,
  fitInside,
  markBillPaid,
  saveBill,
  saveExpense,
  saveGoal,
  saveIncome,
  setMonthBudget,
  unmarkBillPaid,
} from './budgetStore';
import { formatPeso, parsePesoInput } from './money';

const label = (c: string) => c;
const empty: MonthInput = { expenses: [], income: [], bills: [], months: [], trips: [] };
const expense = (id: number, date: string, amountCentavos: number, extra: Partial<BudgetExpense> = {}): BudgetExpense => ({
  id, date, name: `e${id}`, category: 'others', amountCentavos, source: 'manual', billId: null, createdAt: `${date}T0${id % 10}:00:00Z`, ...extra,
});
const bill = (extra: Partial<BudgetBill> = {}): BudgetBill => ({
  id: 1, name: 'Meralco', category: 'electricity', amountCentavos: 500_000, firstDue: '2026-10-15', repeats: 'monthly', paid: {}, createdAt: '2026-10-01T00:00:00Z', ...extra,
});

describe('months', () => {
  it('steps across years', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-11', -23)).toBe('2024-12');
  });
  it('knows month lengths', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-11')).toBe(30);
  });
  it('carries a budget forward until a month sets its own, and 0 clears it', () => {
    const months = [{ month: '2026-09', budgetCentavos: 2_000_000 }, { month: '2026-11', budgetCentavos: 2_500_000 }, { month: '2027-02', budgetCentavos: 0 }];
    expect(budgetFor(months, '2026-08')).toBeNull();
    expect(budgetFor(months, '2026-10')).toBe(2_000_000);
    expect(budgetFor(months, '2027-01')).toBe(2_500_000);
    expect(budgetFor(months, '2027-03')).toBeNull();
  });
});

describe('month view (P1, P5)', () => {
  it('a December expense doesn’t appear in November', () => {
    const input = { ...empty, expenses: [expense(1, '2026-11-30', 10_000), expense(2, '2026-12-01', 99_900)] };
    expect(monthView(input, '2026-11', '2026-11-18').spent).toBe(10_000);
    expect(monthView(input, '2026-12', '2026-11-18').spent).toBe(99_900);
  });
  it('₱0.10 + ₱0.20 shows ₱0.30', () => {
    const input = { ...empty, expenses: [expense(1, '2026-11-02', parsePesoInput('0.10')!), expense(2, '2026-11-03', parsePesoInput('0.20')!)] };
    expect(formatPeso(monthView(input, '2026-11', '2026-11-18').spent)).toBe('₱0.30');
  });
  it('shows over-budget past 100% instead of stopping there', () => {
    const input = { ...empty, months: [{ month: '2026-11', budgetCentavos: 2_000_000 }], expenses: [expense(1, '2026-11-05', 2_800_000)] };
    const v = monthView(input, '2026-11', '2026-11-18');
    expect(v.pct).toBe(140);
    expect(v.left).toBe(-800_000);
  });
  it('adds trips to Groceries and sorts categories largest first', () => {
    const input = {
      ...empty,
      expenses: [expense(1, '2026-11-08', 1_000_000, { category: 'rent' }), expense(2, '2026-11-09', 50_000, { category: 'groceries', name: 'Palengke' })],
      trips: [{ tripId: 7, date: '2026-11-11', store: 'SM Center Imus', centavos: 124_850 }, { tripId: 8, date: '2026-10-30', store: 'Puregold', centavos: 90_000 }],
    };
    const v = monthView(input, '2026-11', '2026-11-18');
    expect(v.byCategory).toEqual([{ id: 'rent', centavos: 1_000_000 }, { id: 'groceries', centavos: 174_850 }]);
    expect(v.groceriesFromTrips).toBe(124_850);
    expect(v.rows.map((r) => r.key)).toEqual(['t7', 'e2', 'e1']);
  });
  it('totals income per month', () => {
    const income = [
      { id: 1, date: '2026-11-15', source: 'Salary', amountCentavos: 1_500_000, createdAt: '' },
      { id: 2, date: '2026-11-30', source: 'Salary', amountCentavos: 1_500_000, createdAt: '' },
      { id: 3, date: '2026-10-30', source: 'Salary', amountCentavos: 1_400_000, createdAt: '' },
    ];
    expect(monthView({ ...empty, income }, '2026-11', '2026-11-18').income).toBe(3_000_000);
    expect(monthView({ ...empty, income }, '2026-10', '2026-11-18').income).toBe(1_400_000);
  });
  it('searches name, category and amount', () => {
    const v = monthView({ ...empty, expenses: [expense(1, '2026-11-02', 250_000, { name: 'Maynilad', category: 'water' }), expense(2, '2026-11-03', 15_000, { name: 'Load' })] }, '2026-11', '2026-11-18');
    expect(searchRows(v.rows, 'mayni', label).map((r) => r.key)).toEqual(['e1']);
    expect(searchRows(v.rows, 'water', label).map((r) => r.key)).toEqual(['e1']);
    expect(searchRows(v.rows, '150', label).map((r) => r.key)).toEqual(['e2']);
    expect(searchRows(v.rows, '  ', label)).toHaveLength(2);
  });
});

describe('bills (P4)', () => {
  it('repeats monthly from its first month, with day 31 moved to month end', () => {
    const b = bill({ firstDue: '2026-10-31' });
    expect(dueDateIn(b, '2026-09')).toBeNull();
    expect(dueDateIn(b, '2026-11')).toBe('2026-11-30');
    expect(dueDateIn(b, '2027-02')).toBe('2027-02-28');
    expect(dueDateIn(bill({ repeats: 'once', firstDue: '2026-11-20' }), '2026-12')).toBeNull();
  });
  it('lists soonest unpaid first, flags overdue, puts paid last', () => {
    const bills = [bill({ id: 1, name: 'Rent', firstDue: '2026-10-30' }), bill({ id: 2, name: 'Meralco', firstDue: '2026-10-15', paid: { '2026-11': 9 } }), bill({ id: 3, name: 'PLDT', firstDue: '2026-10-05' })];
    const list = billsForMonth(bills, '2026-11', '2026-11-18', new Set([9]));
    expect(list.map((b) => [b.bill.name, b.due, b.overdue, b.paidExpenseId])).toEqual([
      ['PLDT', '2026-11-05', true, null],
      ['Rent', '2026-11-30', false, null],
      ['Meralco', '2026-11-15', false, 9],
    ]);
  });
  it('a paid mark whose expense was deleted counts as unpaid', () => {
    const list = billsForMonth([bill({ paid: { '2026-11': 9 } })], '2026-11', '2026-11-18', new Set());
    expect(list[0].paidExpenseId).toBeNull();
  });
});

describe('manual groceries for the trip budget hint', () => {
  it('counts this month’s Groceries expenses only', () => {
    const list = [
      expense(1, '2026-11-02', 50_000, { category: 'groceries' }),
      expense(2, '2026-11-03', 99_000, { category: 'others' }),
      expense(3, '2026-10-30', 40_000, { category: 'groceries' }),
    ];
    expect(manualGroceries(list, '2026-11')).toBe(50_000);
  });
});

describe('chart percentages', () => {
  it('always add to 100', () => {
    for (const vals of [[1, 1, 1], [124_850, 500_000, 250_000, 1_000_000, 250_000, 200_000, 150_000, 350_000], [7, 0, 3], [1]]) {
      expect(percentages(vals).reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([0, 0])).toEqual([0, 0]);
  });
});

describe('trips as groceries (P9)', () => {
  const trip = (id: number, startedAt: string, extra: Partial<Trip> = {}): Trip =>
    ({ id, chain: 'SM Supermarket', customStore: null, budgetCentavos: null, testerId: null, tripIndex: 1, prompted: false, startedAt,
      endedAt: startedAt, receiptMatched: null, receiptTotalCentavos: null, receiptItemCount: null, ...extra }) as Trip;
  const item = (tripId: number, c: number, removed = false) => ({ tripId, lineTotalCentavos: c, removed }) as unknown as Item;
  it('counts finished trips only, receipt total first, by Manila day', () => {
    const trips = [
      trip(1, '2026-10-31T16:30:00Z'), // Nov 1 Manila
      trip(2, '2026-11-10T03:00:00Z', { receiptTotalCentavos: 150_000 }),
      trip(3, '2026-11-05T03:00:00Z', { cancelledAt: '2026-11-05T04:00:00Z' }),
      trip(4, '2026-11-18T01:00:00Z', { endedAt: null }),
      trip(5, '2026-11-12T01:00:00Z'),
    ];
    const items = [item(1, 50_000), item(1, 1_000, true), item(2, 140_000), item(3, 80_000), item(4, 90_000)];
    expect(tripSpends(trips, items)).toEqual([
      { tripId: 1, date: '2026-11-01', store: 'SM Supermarket', centavos: 50_000 },
      { tripId: 2, date: '2026-11-10', store: 'SM Supermarket', centavos: 150_000 },
    ]);
  });
});

describe('csv', () => {
  it('lists expenses oldest first, then income, then unpaid bills', () => {
    const input = {
      ...empty,
      expenses: [expense(1, '2026-11-03', 15_000, { name: 'Load, Globe', category: 'mobile' })],
      income: [{ id: 1, date: '2026-11-15', source: 'Salary', amountCentavos: 1_500_000, createdAt: '' }],
      bills: [bill()],
      trips: [{ tripId: 2, date: '2026-11-11', store: 'SM Center Imus', centavos: 124_850 }],
    };
    const rows = budgetCsvRows(monthView(input, '2026-11', '2026-11-18'), label);
    expect(rows.map((r) => [r.date, r.type, r.amount, r.note])).toEqual([
      ['2026-11-03', 'expense', 150, ''],
      ['2026-11-11', 'expense', 1248.5, 'grocery trip'],
      ['2026-11-15', 'income', 15000, ''],
      ['2026-11-15', 'bill due', 5000, 'overdue'],
    ]);
  });
});

describe('saved on the phone (P2, P3, P4, P6)', () => {
  beforeEach(async () => {
    await Promise.all([db.budgetExpenses.clear(), db.budgetIncome.clear(), db.budgetBills.clear(), db.budgetGoals.clear(), db.budgetMonths.clear(), db.budgetPhotos.clear()]);
  });

  it('deleting a row removes that row and only that row', async () => {
    const a = await saveExpense({ date: '2026-11-11', name: 'SM', category: 'groceries', amountCentavos: 124_850 });
    const b = await saveExpense({ date: '2026-11-03', name: 'Household items', category: 'others', amountCentavos: 350_000 });
    const c = await saveExpense({ date: '2026-11-08', name: 'Rent', category: 'rent', amountCentavos: 1_000_000 });
    await deleteExpense(c);
    expect((await db.budgetExpenses.toArray()).map((e) => e.id).sort()).toEqual([a, b].sort());
  });

  it('edits keep the id and trim the name', async () => {
    const id = await saveExpense({ date: '2026-11-11', name: 'SM', category: 'groceries', amountCentavos: 100 });
    await saveExpense({ date: '2026-11-12', name: '  Puregold  ', category: 'groceries', amountCentavos: 200 }, id);
    expect(await db.budgetExpenses.get(id)).toMatchObject({ name: 'Puregold', amountCentavos: 200, date: '2026-11-12' });
  });

  it('two income entries are two rows', async () => {
    await saveIncome({ date: '2026-11-15', source: 'Salary', amountCentavos: 1_500_000 });
    await saveIncome({ date: '2026-11-30', source: 'Salary', amountCentavos: 1_500_000 });
    expect(await db.budgetIncome.count()).toBe(2);
  });

  it('marking Meralco paid adds an Electricity expense; it shows again next month; undo removes it', async () => {
    const id = await saveBill({ name: 'Meralco', category: 'electricity', amountCentavos: 500_000, firstDue: '2026-11-15', repeats: 'monthly' });
    const expenseId = await markBillPaid(id, '2026-11', 512_340, '2026-11-18');
    expect(await db.budgetExpenses.get(expenseId)).toMatchObject({ category: 'electricity', amountCentavos: 512_340, date: '2026-11-18', source: 'bill', billId: id });
    // A second tap doesn't pay twice.
    expect(await markBillPaid(id, '2026-11', 512_340, '2026-11-18')).toBe(expenseId);
    expect(await db.budgetExpenses.count()).toBe(1);

    const bills = await db.budgetBills.toArray();
    const ids = new Set((await db.budgetExpenses.toArray()).map((e) => e.id!));
    expect(billsForMonth(bills, '2026-11', '2026-11-18', ids)[0].paidExpenseId).toBe(expenseId);
    expect(billsForMonth(bills, '2026-12', '2026-11-18', ids)[0]).toMatchObject({ due: '2026-12-15', paidExpenseId: null });

    await unmarkBillPaid(id, '2026-11');
    expect(await db.budgetExpenses.count()).toBe(0);
    expect((await db.budgetBills.get(id))!.paid).toEqual({});
  });

  it('paying next month’s bill early dates it on its due date', async () => {
    const id = await saveBill({ name: 'Rent', category: 'rent', amountCentavos: 1_000_000, firstDue: '2026-11-30', repeats: 'monthly' });
    const e = await markBillPaid(id, '2026-12', 1_000_000, '2026-11-28');
    expect((await db.budgetExpenses.get(e))!.date).toBe('2026-12-30');
  });

  it('deleting the payment from Records clears the paid mark', async () => {
    const id = await saveBill({ name: 'PLDT', category: 'internet', amountCentavos: 169_900, firstDue: '2026-11-05', repeats: 'monthly' });
    const e = await markBillPaid(id, '2026-11', 169_900, '2026-11-06');
    await deleteExpense(e);
    expect((await db.budgetBills.get(id))!.paid).toEqual({});
  });

  it('deleting a bill keeps the payments already made', async () => {
    const id = await saveBill({ name: 'PLDT', category: 'internet', amountCentavos: 169_900, firstDue: '2026-11-05', repeats: 'monthly' });
    const e = await markBillPaid(id, '2026-11', 169_900, '2026-11-06');
    await deleteBill(id);
    expect(await db.budgetExpenses.get(e)).toMatchObject({ billId: null, source: 'manual', amountCentavos: 169_900 });
  });

  it('adding ₱500 twice moves a goal to ₱1,000', async () => {
    const id = await saveGoal({ name: 'Emergency fund', targetCentavos: 1_000_000 });
    await addToGoal(id, 50_000, '2026-11-15');
    await addToGoal(id, 50_000, '2026-11-30');
    expect(goalSaved((await db.budgetGoals.get(id))!)).toBe(100_000);
  });

  it('a month budget carries forward', async () => {
    await setMonthBudget('2026-11', 2_500_000);
    expect(budgetFor(await db.budgetMonths.toArray(), '2027-01')).toBe(2_500_000);
    await setMonthBudget('2027-01', null);
    expect(budgetFor(await db.budgetMonths.toArray(), '2027-01')).toBeNull();
    expect(budgetFor(await db.budgetMonths.toArray(), '2026-12')).toBe(2_500_000);
  });
});

describe('receipt photo size', () => {
  it('fits the long side to 1400 and never enlarges', () => {
    expect(fitInside(3000, 4000)).toEqual({ w: 1050, h: 1400 });
    expect(fitInside(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
