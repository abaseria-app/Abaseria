// Saving the household budget on the phone. Every record has its own id, so editing or deleting one row
// can never touch another (the website calculator deleted by list position and removed the wrong row).
import { db } from './db';
import type { BudgetBill, BudgetCategory, BudgetGoal, BudgetIncome } from './budget';
import { dueDateIn, monthOf } from './budget';
import { manilaDay } from './visits';

const now = () => new Date().toISOString();

export interface ExpenseInput {
  date: string;
  name: string;
  category: BudgetCategory;
  amountCentavos: number;
  photoId?: number | null;
}

/** Adds an expense, or saves changes to one. Changing a bill payment keeps its link to the bill. */
export async function saveExpense(input: ExpenseInput, id?: number): Promise<number> {
  const clean = { ...input, name: input.name.trim() };
  if (id != null) {
    const old = await db.budgetExpenses.get(id);
    if (!old) throw new Error('That record is gone.');
    // A bill payment moved to another month no longer pays this month's bill.
    if (old.billId != null && monthOf(old.date) !== monthOf(clean.date)) await unlinkBill(old.billId, id);
    if (old.photoId != null && old.photoId !== clean.photoId) await db.budgetPhotos.delete(old.photoId);
    await db.budgetExpenses.update(id, clean);
    return id;
  }
  return db.budgetExpenses.add({ ...clean, source: 'manual', billId: null, createdAt: now() });
}

/** Removes exactly this expense, its receipt photo, and its "paid" mark on a bill. */
export async function deleteExpense(id: number): Promise<void> {
  await db.transaction('rw', db.budgetExpenses, db.budgetBills, db.budgetPhotos, async () => {
    const e = await db.budgetExpenses.get(id);
    if (!e) return;
    if (e.billId != null) await unlinkBill(e.billId, id);
    if (e.photoId != null) await db.budgetPhotos.delete(e.photoId);
    await db.budgetExpenses.delete(id);
  });
}

async function unlinkBill(billId: number, expenseId: number) {
  const bill = await db.budgetBills.get(billId);
  if (!bill) return;
  const paid = Object.fromEntries(Object.entries(bill.paid ?? {}).filter(([, v]) => v !== expenseId));
  await db.budgetBills.update(billId, { paid });
}

// Income ------------------------------------------------------------------------------------------------

export async function saveIncome(input: Pick<BudgetIncome, 'date' | 'source' | 'amountCentavos'>, id?: number): Promise<number> {
  const clean = { ...input, source: input.source.trim() };
  if (id != null) {
    await db.budgetIncome.update(id, clean);
    return id;
  }
  return db.budgetIncome.add({ ...clean, createdAt: now() });
}

export const deleteIncome = (id: number) => db.budgetIncome.delete(id);

// Bills -------------------------------------------------------------------------------------------------

export async function saveBill(input: Pick<BudgetBill, 'name' | 'category' | 'amountCentavos' | 'firstDue' | 'repeats'>, id?: number): Promise<number> {
  const clean = { ...input, name: input.name.trim() };
  if (id != null) {
    await db.budgetBills.update(id, clean);
    return id;
  }
  return db.budgetBills.add({ ...clean, paid: {}, createdAt: now() });
}

/** Deletes the bill. Payments already made stay as expenses: that money was really spent. */
export async function deleteBill(id: number): Promise<void> {
  await db.transaction('rw', db.budgetBills, db.budgetExpenses, async () => {
    await db.budgetExpenses.where('billId').equals(id).modify({ billId: null, source: 'manual' });
    await db.budgetBills.delete(id);
  });
}

/**
 * Records this month's payment as an expense and marks the bill paid. Dated today when paying in the bill's
 * month, otherwise on the due date, so the payment counts toward the month the bill belongs to.
 */
export async function markBillPaid(billId: number, month: string, amountCentavos: number, today: string = manilaDay()): Promise<number> {
  return db.transaction('rw', db.budgetBills, db.budgetExpenses, async () => {
    const bill = await db.budgetBills.get(billId);
    if (!bill) throw new Error('That bill is gone.');
    const due = dueDateIn(bill, month);
    if (!due) throw new Error('That bill isn’t due this month.');
    const existing = bill.paid?.[month];
    if (existing != null && (await db.budgetExpenses.get(existing))) return existing;
    const expenseId = await db.budgetExpenses.add({
      date: monthOf(today) === month ? today : due,
      name: bill.name,
      category: bill.category,
      amountCentavos,
      source: 'bill',
      billId,
      photoId: null,
      createdAt: now(),
    });
    await db.budgetBills.update(billId, { paid: { ...(bill.paid ?? {}), [month]: expenseId } });
    return expenseId;
  });
}

/** Undo Mark paid: removes the expense it made. */
export async function unmarkBillPaid(billId: number, month: string): Promise<void> {
  const bill = await db.budgetBills.get(billId);
  const expenseId = bill?.paid?.[month];
  if (expenseId != null) await deleteExpense(expenseId);
}

// Savings goals -----------------------------------------------------------------------------------------

export async function saveGoal(input: Pick<BudgetGoal, 'name' | 'targetCentavos'>, id?: number): Promise<number> {
  const clean = { ...input, name: input.name.trim() };
  if (id != null) {
    await db.budgetGoals.update(id, clean);
    return id;
  }
  return db.budgetGoals.add({ ...clean, contributions: [], createdAt: now() });
}

export async function addToGoal(id: number, amountCentavos: number, date: string = manilaDay()): Promise<void> {
  await db.transaction('rw', db.budgetGoals, async () => {
    const g = await db.budgetGoals.get(id);
    if (!g) throw new Error('That goal is gone.');
    await db.budgetGoals.update(id, { contributions: [...g.contributions, { date, amountCentavos }] });
  });
}

export const deleteGoal = (id: number) => db.budgetGoals.delete(id);

// Monthly budget ----------------------------------------------------------------------------------------

/** Sets this month's household budget; later months follow it until they get their own. Null clears it. */
export async function setMonthBudget(month: string, centavos: number | null): Promise<void> {
  await db.budgetMonths.put({ month, budgetCentavos: centavos && centavos > 0 ? centavos : 0 });
}

// Receipt photos ----------------------------------------------------------------------------------------

/** Long side of a kept receipt photo. Enough to read a printed total; about 100–250 KB as JPEG. */
export const RECEIPT_MAX_SIDE = 1400;

export function fitInside(w: number, h: number, max: number = RECEIPT_MAX_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Shrinks a camera photo and re-encodes it (which also drops the location and phone data cameras attach). */
export async function shrinkReceipt(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const { w, h } = fitInside(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that photo.'))), 'image/jpeg', 0.7));
}

export const savePhoto = (blob: Blob) => db.budgetPhotos.add({ blob, createdAt: now() });
export const deletePhoto = (id: number) => db.budgetPhotos.delete(id);
