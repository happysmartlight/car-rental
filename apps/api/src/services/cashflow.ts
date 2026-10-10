// Thu chi: gộp tiền thuê (từ phiếu thu của lượt thuê) với sổ thu chi (chi phí xe, chi phí chung, thu khác).
// Quy ước tính xem đầu file shared/cashflow.ts.

import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { CashEntry, RecurringCost, Vehicle } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { CASH_CATEGORY, dueRecurringMonths, monthKeyOf, parseMonthKey, recurringDate, vnMonthStart, type CashCategory, type CashMethod, type Period } from '../shared/cashflow.js';
import { summarizeMoney, type MoneyPayment, type PaymentDirection } from '../shared/money.js';
import type { PaymentMethod, RentalStatus } from '../shared/constants.js';
import { occupiedRange } from './rentals.js';

/** null = cả đội xe + chi phí chung; 'shared' = chỉ chi phí chung; số = một xe. */
export type VehicleFilter = number | 'shared' | null;

// ── Khoản định kỳ ──────────────────────────────────────────────────────────

/** Ghi vào sổ các kỳ đã đến hạn mà chưa ghi. Chạy lại bao nhiêu lần cũng không trùng (khóa recurring_id + period). */
export function materializeRecurring(now = Date.now(), onlyId?: number): number {
  const conds = [eq(schema.recurringCosts.active, true)];
  if (onlyId) conds.push(eq(schema.recurringCosts.id, onlyId));
  const list = db.select().from(schema.recurringCosts).where(and(...conds)).all();
  let created = 0;
  db.transaction(() => {
    for (const t of list) {
      const months = dueRecurringMonths(t, now);
      if (!months.length) continue;
      const done = new Set(
        db
          .select({ period: schema.cashEntries.period })
          .from(schema.cashEntries)
          .where(eq(schema.cashEntries.recurringId, t.id))
          .all()
          .map((x) => x.period),
      );
      for (const m of months) {
        if (done.has(m)) continue;
        const res = db
          .insert(schema.cashEntries)
          .values({
            direction: CASH_CATEGORY[t.category].dir,
            category: t.category,
            amount: t.amount,
            at: recurringDate(m, t.dayOfMonth),
            vehicleId: t.vehicleId,
            method: t.method,
            description: t.description,
            vendor: t.vendor,
            receiptFileIds: [],
            recurringId: t.id,
            period: m,
            createdBy: t.createdBy,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        created += res.changes;
      }
    }
  });
  return created;
}

// ── Ghi sổ ─────────────────────────────────────────────────────────────────

export interface EntryInput {
  category: CashCategory;
  amount: number;
  at: number;
  vehicleId: number | null;
  method: CashMethod;
  description: string | null;
  vendor: string | null;
  odo: number | null;
  receiptFileIds: string[];
}

/** Gia hạn giấy tờ / mốc bảo dưỡng của xe ngay khi ghi chi phí (chỉ trường có giá trị mới được ghi). */
export interface VehicleRenewal {
  inspectionExpiry?: string | null;
  insuranceTndsExpiry?: string | null;
  insuranceBodyExpiry?: string | null;
  roadFeeExpiry?: string | null;
  nextServiceOdo?: number | null;
  nextServiceDate?: string | null;
}

function ensureVehicle(id: number | null): Vehicle | null {
  if (id == null) return null;
  const v = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).get();
  if (!v) throw notFound('Không tìm thấy xe');
  return v;
}

export function applyRenewal(vehicleId: number, r: VehicleRenewal): Partial<Vehicle> {
  const patch = Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== '')) as Partial<Vehicle>;
  if (!Object.keys(patch).length) return patch;
  db.update(schema.vehicles)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.vehicles.id, vehicleId))
    .run();
  return patch;
}

export function createEntry(input: EntryInput, userId: number, renewal?: VehicleRenewal): { entry: CashEntry; renewed: Partial<Vehicle> } {
  ensureVehicle(input.vehicleId);
  if (renewal && input.vehicleId == null) throw badRequest('Chọn xe để gia hạn giấy tờ / bảo dưỡng');
  const now = Date.now();
  return db.transaction(() => {
    const entry = db
      .insert(schema.cashEntries)
      .values({ ...input, direction: CASH_CATEGORY[input.category].dir, amount: Math.round(input.amount), createdBy: userId, createdAt: now, updatedAt: now })
      .returning()
      .get();
    const renewed = renewal && input.vehicleId != null ? applyRenewal(input.vehicleId, renewal) : {};
    return { entry, renewed };
  });
}

export function updateEntry(id: number, input: Partial<EntryInput>): CashEntry {
  const cur = db.select().from(schema.cashEntries).where(eq(schema.cashEntries.id, id)).get();
  if (!cur) throw notFound('Không tìm thấy khoản thu chi');
  if (cur.voidedAt) throw badRequest('Phiếu đã hủy, không sửa được');
  if (input.vehicleId !== undefined) ensureVehicle(input.vehicleId);
  const patch: Partial<CashEntry> = { ...input, updatedAt: Date.now() };
  if (input.category) patch.direction = CASH_CATEGORY[input.category].dir;
  if (input.amount != null) patch.amount = Math.round(input.amount);
  return db.update(schema.cashEntries).set(patch).where(eq(schema.cashEntries.id, id)).returning().get();
}

export function voidEntry(id: number, reason: string): CashEntry {
  const e = db
    .update(schema.cashEntries)
    .set({ voidedAt: Date.now(), voidReason: reason, updatedAt: Date.now() })
    .where(and(eq(schema.cashEntries.id, id), isNull(schema.cashEntries.voidedAt)))
    .returning()
    .get();
  if (!e) throw notFound('Không tìm thấy phiếu hoặc phiếu đã hủy');
  return e;
}

export interface RecurringInput {
  category: CashCategory;
  amount: number;
  vehicleId: number | null;
  method: CashMethod;
  description: string | null;
  vendor: string | null;
  dayOfMonth: number;
  intervalMonths: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
}

function checkRule(r: { startMonth: string; endMonth: string | null }) {
  if (!parseMonthKey(r.startMonth)) throw badRequest('Tháng bắt đầu không hợp lệ');
  if (r.endMonth && (!parseMonthKey(r.endMonth) || r.endMonth < r.startMonth)) throw badRequest('Tháng kết thúc phải từ tháng bắt đầu trở đi');
}

export function createRecurring(input: RecurringInput, userId: number): { recurring: RecurringCost; created: number } {
  ensureVehicle(input.vehicleId);
  checkRule(input);
  const now = Date.now();
  const recurring = db
    .insert(schema.recurringCosts)
    .values({ ...input, amount: Math.round(input.amount), createdBy: userId, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return { recurring, created: materializeRecurring(now, recurring.id) };
}

export function updateRecurring(id: number, input: Partial<RecurringInput>): { recurring: RecurringCost; created: number } {
  const cur = db.select().from(schema.recurringCosts).where(eq(schema.recurringCosts.id, id)).get();
  if (!cur) throw notFound('Không tìm thấy khoản định kỳ');
  if (input.vehicleId !== undefined) ensureVehicle(input.vehicleId);
  checkRule({ startMonth: input.startMonth ?? cur.startMonth, endMonth: input.endMonth !== undefined ? input.endMonth : cur.endMonth });
  const recurring = db
    .update(schema.recurringCosts)
    .set({ ...input, ...(input.amount != null && { amount: Math.round(input.amount) }), updatedAt: Date.now() })
    .where(eq(schema.recurringCosts.id, id))
    .returning()
    .get();
  return { recurring, created: materializeRecurring(Date.now(), id) };
}

// ── Tiền thuê thực nhận ────────────────────────────────────────────────────

export interface RentFlow {
  paymentId: number;
  at: number;
  /** Có dấu: + tiền vào, − hoàn lại khách. */
  amount: number;
  direction: PaymentDirection;
  method: PaymentMethod;
  note: string | null;
  rentalId: number;
  code: string;
  vehicleId: number;
  customerName: string;
}

/** Phiếu tiền thuê trong [from, to): khách trả (+), hoàn tiền thuê (−), cọc cấn trừ sang tiền thuê (+). */
export function rentFlows(from: number, to: number, vehicleId?: number): RentFlow[] {
  const p = schema.payments;
  const conds = [isNull(p.voidedAt), gte(p.at, from), lt(p.at, to), or(eq(p.purpose, 'rent'), eq(p.direction, 'offset'))];
  if (vehicleId != null) conds.push(eq(schema.rentals.vehicleId, vehicleId));
  return db
    .select({ p, r: { id: schema.rentals.id, code: schema.rentals.code, vehicleId: schema.rentals.vehicleId }, c: { fullName: schema.customers.fullName } })
    .from(p)
    .innerJoin(schema.rentals, eq(schema.rentals.id, p.rentalId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .where(and(...conds))
    .orderBy(asc(p.at))
    .all()
    .map(({ p: x, r, c }) => ({
      paymentId: x.id,
      at: x.at,
      amount: x.direction === 'out' ? -x.amount : x.amount,
      direction: x.direction,
      method: x.method,
      note: x.note,
      rentalId: r.id,
      code: r.code,
      vehicleId: r.vehicleId,
      customerName: c.fullName,
    }));
}

function entriesIn(from: number, to: number, filter: VehicleFilter): CashEntry[] {
  const e = schema.cashEntries;
  const conds = [gte(e.at, from), lt(e.at, to)];
  if (filter === 'shared') conds.push(isNull(e.vehicleId));
  else if (filter != null) conds.push(eq(e.vehicleId, filter));
  return db.select().from(e).where(and(...conds)).orderBy(asc(e.at)).all();
}

// ── Cộng dồn ───────────────────────────────────────────────────────────────

export interface CashTotals {
  /** Tiền thuê thực nhận. */
  rent: number;
  /** Thu khác (bảo hiểm bồi thường…), không gồm bán xe. */
  otherIncome: number;
  /** rent + otherIncome. */
  income: number;
  /** Chi vận hành (không gồm mua xe, trả góp). */
  expense: number;
  /** Lãi vận hành = income − expense. */
  profit: number;
  /** Bán xe, thanh lý. */
  capitalIn: number;
  /** Mua xe, trả góp. */
  capitalOut: number;
  /** Dòng tiền ròng = profit + capitalIn − capitalOut. */
  net: number;
}

function emptyTotals(): CashTotals {
  return { rent: 0, otherIncome: 0, income: 0, expense: 0, profit: 0, capitalIn: 0, capitalOut: 0, net: 0 };
}

function addFlow(t: CashTotals, f: { amount: number }) {
  t.rent += f.amount;
}

function addEntry(t: CashTotals, e: Pick<CashEntry, 'category' | 'amount' | 'voidedAt'>) {
  if (e.voidedAt) return;
  const c = CASH_CATEGORY[e.category];
  if (!c) return;
  if (c.capital) {
    if (c.dir === 'in') t.capitalIn += e.amount;
    else t.capitalOut += e.amount;
  } else if (c.dir === 'in') t.otherIncome += e.amount;
  else t.expense += e.amount;
}

function finish(t: CashTotals): CashTotals {
  t.income = t.rent + t.otherIncome;
  t.profit = t.income - t.expense;
  t.net = t.profit + t.capitalIn - t.capitalOut;
  return t;
}

/** Tổng thu chi một khoảng thời gian (cả đội xe + chi phí chung) — dùng cho trang Tổng quan. */
export function cashTotals(from: number, to: number): CashTotals {
  const t = emptyTotals();
  for (const f of rentFlows(from, to)) addFlow(t, f);
  for (const e of entriesIn(from, to, null)) addEntry(t, e);
  return finish(t);
}

// ── Công nợ & cọc (thời điểm hiện tại) ─────────────────────────────────────

export interface Receivables {
  /** Khách còn nợ ở các lượt đã trả xe. */
  owed: number;
  owedCount: number;
  /** Còn phải thu ở các lượt đang thuê / đã đặt. */
  upcoming: number;
  upcomingCount: number;
  /** Cọc đang giữ (tiền của khách). */
  depositsHeld: number;
}

const OWED_STATUSES: RentalStatus[] = ['returned', 'settled', 'closed'];
const UPCOMING_STATUSES: RentalStatus[] = ['booked', 'active'];

export function receivables(filter: VehicleFilter): Receivables {
  const out: Receivables = { owed: 0, owedCount: 0, upcoming: 0, upcomingCount: 0, depositsHeld: 0 };
  if (filter === 'shared') return out;
  const rentals = db
    .select({ id: schema.rentals.id, status: schema.rentals.status })
    .from(schema.rentals)
    .where(filter != null ? eq(schema.rentals.vehicleId, filter) : undefined)
    .all();
  if (!rentals.length) return out;
  const charges = new Map<number, number>();
  for (const c of db.select({ rentalId: schema.charges.rentalId, amount: schema.charges.amount }).from(schema.charges).all()) {
    charges.set(c.rentalId, (charges.get(c.rentalId) ?? 0) + c.amount);
  }
  const pays = new Map<number, MoneyPayment[]>();
  for (const p of db
    .select({ rentalId: schema.payments.rentalId, direction: schema.payments.direction, purpose: schema.payments.purpose, amount: schema.payments.amount })
    .from(schema.payments)
    .where(isNull(schema.payments.voidedAt))
    .all()) {
    const list = pays.get(p.rentalId) ?? [];
    list.push(p);
    pays.set(p.rentalId, list);
  }
  for (const r of rentals) {
    const m = summarizeMoney([{ amount: charges.get(r.id) ?? 0 }], pays.get(r.id) ?? []);
    out.depositsHeld += m.depositHeld;
    if (m.due <= 0) continue;
    if (OWED_STATUSES.includes(r.status)) {
      out.owed += m.due;
      out.owedCount++;
    } else if (UPCOMING_STATUSES.includes(r.status)) {
      out.upcoming += m.due;
      out.upcomingCount++;
    }
  }
  return out;
}

// ── Báo cáo theo kỳ ────────────────────────────────────────────────────────

export interface VehicleCashRow extends CashTotals {
  vehicleId: number;
  plate: string;
  make: string;
  model: string;
  archived: boolean;
  /** Số lượt thuê nhận xe trong kỳ. */
  rentals: number;
  /** % thời gian xe có khách trong kỳ (tính tới hiện tại); null nếu kỳ chưa bắt đầu. */
  utilization: number | null;
}

export type LedgerRow =
  | { kind: 'rent'; key: string; at: number; direction: 'in' | 'out'; amount: number; flow: RentFlow; plate: string | null }
  | { kind: 'entry'; key: string; at: number; direction: 'in' | 'out'; amount: number; entry: CashEntry; plate: string | null; recurring: { id: number; description: string | null } | null };

export interface RentalCashRow {
  id: number;
  code: string;
  status: RentalStatus;
  customerName: string;
  start: number;
  end: number;
  total: number;
  paid: number;
  due: number;
}

export function cashflowReport(period: Period, filter: VehicleFilter, now = Date.now()) {
  const first = parseMonthKey(period.trend[0])!;
  const from = Math.min(period.start, vnMonthStart(first.year, first.month));
  const to = period.end;
  const inPeriod = (at: number) => at >= period.start && at < period.end;

  const flows = filter === 'shared' ? [] : rentFlows(from, to, typeof filter === 'number' ? filter : undefined);
  const entries = entriesIn(from, to, filter);

  // Biểu đồ 12 tháng
  const trendMap = new Map(period.trend.map((k) => [k, emptyTotals()]));
  for (const f of flows) {
    const t = trendMap.get(monthKeyOf(f.at));
    if (t) addFlow(t, f);
  }
  for (const e of entries) {
    const t = trendMap.get(monthKeyOf(e.at));
    if (t) addEntry(t, e);
  }
  const trend = period.trend.map((key) => ({ key, ...finish(trendMap.get(key)!) }));

  // Tổng kỳ
  const pFlows = flows.filter((f) => inPeriod(f.at));
  const pEntries = entries.filter((e) => inPeriod(e.at));
  const totals = emptyTotals();
  for (const f of pFlows) addFlow(totals, f);
  for (const e of pEntries) addEntry(totals, e);
  finish(totals);

  // Theo hạng mục
  const catMap = new Map<CashCategory, { category: CashCategory; amount: number; count: number }>();
  for (const e of pEntries) {
    if (e.voidedAt) continue;
    const c = catMap.get(e.category) ?? { category: e.category, amount: 0, count: 0 };
    c.amount += e.amount;
    c.count++;
    catMap.set(e.category, c);
  }
  const categories = [...catMap.values()].sort((a, b) => b.amount - a.amount);

  // Xe
  const allVehicles = db.select().from(schema.vehicles).orderBy(asc(schema.vehicles.plate)).all();
  const plateOf = new Map(allVehicles.map((v) => [v.id, v.plate]));
  const rentalsInPeriod = db
    .select()
    .from(schema.rentals)
    .where(and(gte(schema.rentals.scheduledStart, period.start), lt(schema.rentals.scheduledStart, period.end)))
    .all()
    .filter((r) => r.status !== 'cancelled');

  let vehicles: VehicleCashRow[] = [];
  let shared: CashTotals | null = null;
  if (filter == null) {
    const span = Math.min(now, period.end) - period.start;
    // Như trang Tổng quan: lượt đã giao xe, có khoảng giữ xe chạm vào kỳ.
    const overlapping = db
      .select()
      .from(schema.rentals)
      .where(
        and(
          isNotNull(schema.rentals.actualStart),
          lt(schema.rentals.actualStart, period.end),
          or(gte(sql`COALESCE(${schema.rentals.actualEnd}, ${schema.rentals.scheduledEnd})`, period.start), eq(schema.rentals.status, 'active')),
        ),
      )
      .all();
    vehicles = allVehicles
      .map((v) => {
        const t = emptyTotals();
        for (const f of pFlows) if (f.vehicleId === v.id) addFlow(t, f);
        for (const e of pEntries) if (e.vehicleId === v.id) addEntry(t, e);
        finish(t);
        const used = overlapping
          .filter((r) => r.vehicleId === v.id)
          .reduce((s, r) => {
            const o = occupiedRange(r, now);
            return s + Math.max(0, Math.min(o.end, now, period.end) - Math.max(o.start, period.start));
          }, 0);
        return {
          ...t,
          vehicleId: v.id,
          plate: v.plate,
          make: v.make,
          model: v.model,
          archived: v.archivedAt != null,
          rentals: rentalsInPeriod.filter((r) => r.vehicleId === v.id).length,
          utilization: span > 0 ? Math.min(100, Math.round((used / span) * 100)) : null,
        };
      })
      .filter((r) => !r.archived || r.income || r.expense || r.capitalIn || r.capitalOut || r.rentals);
    shared = emptyTotals();
    for (const e of pEntries) if (e.vehicleId == null) addEntry(shared, e);
    finish(shared);
  }

  // Lượt thuê của một xe trong kỳ
  let rentals: RentalCashRow[] = [];
  if (typeof filter === 'number') {
    rentals = db
      .select({ r: schema.rentals, fullName: schema.customers.fullName })
      .from(schema.rentals)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
      .where(and(eq(schema.rentals.vehicleId, filter), gte(schema.rentals.scheduledStart, period.start), lt(schema.rentals.scheduledStart, period.end)))
      .orderBy(asc(schema.rentals.scheduledStart))
      .all()
      .map(({ r, fullName }) => {
        const charges = db.select({ amount: schema.charges.amount }).from(schema.charges).where(eq(schema.charges.rentalId, r.id)).all();
        const payments = db.select().from(schema.payments).where(eq(schema.payments.rentalId, r.id)).all();
        const m = summarizeMoney(charges, payments);
        const o = occupiedRange(r, now);
        return { id: r.id, code: r.code, status: r.status, customerName: fullName, start: o.start, end: o.end, total: m.totalCharges, paid: m.rentPaid, due: m.due };
      })
      // Lượt hủy chỉ hiện khi khách mất cọc (có phí hủy).
      .filter((r) => r.status !== 'cancelled' || r.total !== 0);
  }

  // Sổ: phiếu tiền thuê + khoản thu chi trong kỳ, mới nhất trước
  const recurringIds = [...new Set(pEntries.map((e) => e.recurringId).filter((x): x is number => x != null))];
  const recurringMap = new Map(
    recurringIds.length
      ? db
          .select({ id: schema.recurringCosts.id, description: schema.recurringCosts.description })
          .from(schema.recurringCosts)
          .where(inArray(schema.recurringCosts.id, recurringIds))
          .all()
          .map((r) => [r.id, r])
      : [],
  );
  const ledger: LedgerRow[] = [
    ...pFlows.map(
      (f): LedgerRow => ({ kind: 'rent', key: `p${f.paymentId}`, at: f.at, direction: f.amount < 0 ? 'out' : 'in', amount: Math.abs(f.amount), flow: f, plate: plateOf.get(f.vehicleId) ?? null }),
    ),
    ...pEntries.map(
      (e): LedgerRow => ({
        kind: 'entry',
        key: `e${e.id}`,
        at: e.at,
        direction: e.direction,
        amount: e.amount,
        entry: e,
        plate: e.vehicleId != null ? (plateOf.get(e.vehicleId) ?? null) : null,
        recurring: e.recurringId != null ? (recurringMap.get(e.recurringId) ?? null) : null,
      }),
    ),
  ].sort((a, b) => b.at - a.at || b.key.localeCompare(a.key));

  const activeFleet = allVehicles.filter((v) => v.archivedAt == null).length;
  const sharedExpense = filter == null ? shared!.expense : typeof filter === 'number' ? sharedExpenseIn(period) : totals.expense;

  return {
    period,
    filter: filter ?? 'all',
    totals,
    receivables: receivables(filter),
    trend,
    categories,
    vehicles,
    shared,
    rentals,
    ledger,
    /** Chi phí chung trong kỳ và số xe đang chạy — để ước phần chia mỗi xe. */
    allocation: { sharedExpense, fleet: activeFleet },
    vehicleOptions: allVehicles.map((v) => ({ id: v.id, plate: v.plate, make: v.make, model: v.model, archived: v.archivedAt != null })),
  };
}

function sharedExpenseIn(period: Period): number {
  const t = emptyTotals();
  for (const e of entriesIn(period.start, period.end, 'shared')) addEntry(t, e);
  return t.expense;
}

export type CashflowReport = ReturnType<typeof cashflowReport>;

export function listRecurring() {
  const rows = db.select().from(schema.recurringCosts).orderBy(asc(schema.recurringCosts.id)).all();
  const plates = new Map(db.select({ id: schema.vehicles.id, plate: schema.vehicles.plate }).from(schema.vehicles).all().map((v) => [v.id, v.plate]));
  return rows.map((r) => ({ ...r, plate: r.vehicleId != null ? (plates.get(r.vehicleId) ?? null) : null }));
}
