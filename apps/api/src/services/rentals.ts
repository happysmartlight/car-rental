// Nghiệp vụ lượt thuê: kiểm trùng lịch, tạo, giao xe, nhận xe, quyết toán, hoàn cọc.
// Mọi thay đổi trạng thái đi qua đây để luật được áp dụng một chỗ.

import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Customer, HandoverAccessory, HandoverDamage, HandoverPhoto, Rental, Vehicle } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import { ageAt } from '../shared/cccd.js';
import type { ChargeKind, CollateralKind, PaymentMethod, RentalStatus } from '../shared/constants.js';
import { RENTAL_STATUS } from '../shared/constants.js';
import { defaultFineHold, monthPeriods, planCancellation, summarizeMoney, type MonthPeriod, type MoneySummary, type PaymentPurpose } from '../shared/money.js';
import { quoteRental, vehicleChargingPolicy, type Quote, type VehiclePricing } from '../shared/pricing.js';
import { maintenanceWarnings } from './maintenance.js';
import { fmtNumber } from '../shared/text.js';
import { DAY_MS, fmtDateTime, vnDateKey, vnParts } from '../shared/time.js';

export const OPEN_STATUSES: RentalStatus[] = ['booked', 'active'];

export function vehiclePricing(v: Vehicle): VehiclePricing {
  const charging = vehicleChargingPolicy(v);
  return {
    priceDay: v.priceDay,
    priceHour: v.priceHour,
    priceWeekendDay: v.priceWeekendDay,
    kmLimitDay: v.kmLimitDay,
    overKmFee: v.overKmFee,
    overHourFee: v.overHourFee,
    priceMonth: v.priceMonth,
    kmLimitMonth: v.kmLimitMonth,
    freeCharges: charging?.baseFree ?? null,
    chargeFee: charging?.fee ?? null,
  };
}

export function rentalPricing(r: Rental): VehiclePricing {
  return JSON.parse(r.pricing) as VehiclePricing;
}

export function getVehicle(id: number): Vehicle {
  const v = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).get();
  if (!v) throw notFound('Không tìm thấy xe');
  return v;
}

export function getCustomer(id: number): Customer {
  const c = db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
  if (!c) throw notFound('Không tìm thấy khách hàng');
  return c;
}

export function getRental(id: number): Rental {
  const r = db.select().from(schema.rentals).where(eq(schema.rentals.id, id)).get();
  if (!r) throw notFound('Không tìm thấy lượt thuê');
  return r;
}

function nextRentalCode(year: number): string {
  const name = `rental-${year}`;
  const row = db.select().from(schema.sequences).where(eq(schema.sequences.name, name)).get();
  const value = (row?.value ?? 0) + 1;
  db.insert(schema.sequences)
    .values({ name, value })
    .onConflictDoUpdate({ target: schema.sequences.name, set: { value } })
    .run();
  return `HD-${year}-${String(value).padStart(4, '0')}`;
}

/** Khoảng thời gian một lượt thuê đang chiếm xe (dùng cho lịch & kiểm trùng). */
export function occupiedRange(r: Rental, now = Date.now()): { start: number; end: number } {
  const start = r.actualStart ?? r.scheduledStart;
  if (r.actualEnd) return { start, end: r.actualEnd };
  if (r.status === 'active') return { start, end: Math.max(r.scheduledEnd, now) };
  return { start, end: r.scheduledEnd };
}

export interface Conflict {
  type: 'rental' | 'block';
  id: number;
  label: string;
  start: number;
  end: number | null;
}

export function findConflicts(vehicleId: number, start: number, end: number, excludeRentalId?: number): Conflict[] {
  const buffer = getSetting('rules').bufferMinutes * 60_000;
  const out: Conflict[] = [];
  const rentals = db
    .select({ r: schema.rentals, c: schema.customers })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .where(and(eq(schema.rentals.vehicleId, vehicleId), inArray(schema.rentals.status, OPEN_STATUSES)))
    .all();
  for (const { r, c } of rentals) {
    if (r.id === excludeRentalId) continue;
    const o = occupiedRange(r);
    if (o.start < end + buffer && o.end + buffer > start) {
      out.push({
        type: 'rental',
        id: r.id,
        label: `${r.code} · ${c.fullName} (${RENTAL_STATUS[r.status].label.toLowerCase()})`,
        start: o.start,
        end: o.end,
      });
    }
  }
  const blocks = db.select().from(schema.vehicleBlocks).where(eq(schema.vehicleBlocks.vehicleId, vehicleId)).all();
  for (const b of blocks) {
    if (b.startAt < end && (b.endAt == null || b.endAt > start)) {
      out.push({ type: 'block', id: b.id, label: b.notes || b.location || 'Xe tạm ngưng', start: b.startAt, end: b.endAt });
    }
  }
  return out;
}

export interface Warning {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'danger';
}

/** Cảnh báo về người thuê/người lái: danh sách đen, GPLX, tuổi, phạt nguội còn nợ. */
export function driverWarnings(c: Customer, atMs: number, role = 'Khách'): Warning[] {
  const w: Warning[] = [];
  const atKey = vnDateKey(atMs);
  if (c.blacklisted) {
    w.push({ code: 'blacklisted', severity: 'danger', message: `${role} ${c.fullName} nằm trong danh sách đen${c.blacklistReason ? `: ${c.blacklistReason}` : ''}` });
  }
  if (!c.licenseNumber) w.push({ code: 'no_license', severity: 'warn', message: `${role} ${c.fullName} chưa có thông tin GPLX` });
  else if (c.licenseExpiry && c.licenseExpiry < atKey) w.push({ code: 'license_expired', severity: 'danger', message: `GPLX của ${c.fullName} đã hết hạn` });
  if (!c.idNumber) w.push({ code: 'no_id', severity: 'warn', message: `${role} ${c.fullName} chưa có số CCCD` });
  if (!c.idFrontFileId) w.push({ code: 'no_id_photo', severity: 'info', message: `Chưa chụp ảnh CCCD của ${c.fullName}` });
  const minAge = getSetting('rules').minDriverAge;
  if (c.dob && minAge && ageAt(c.dob, atKey) < minAge) {
    w.push({ code: 'too_young', severity: 'warn', message: `${c.fullName} chưa đủ ${minAge} tuổi` });
  }
  const openFines = db
    .select({ id: schema.trafficFines.id })
    .from(schema.trafficFines)
    .where(and(eq(schema.trafficFines.customerId, c.id), inArray(schema.trafficFines.status, ['new', 'notified', 'we_paid']), isNull(schema.trafficFines.voidedAt)))
    .all();
  if (openFines.length) w.push({ code: 'open_fines', severity: 'danger', message: `${c.fullName} còn ${openFines.length} phạt nguội chưa xử lý xong` });
  return w;
}

export function quoteFor(vehicle: Vehicle | VehiclePricing, start: number, end: number): Quote {
  const p = 'plateKey' in vehicle ? vehiclePricing(vehicle) : vehicle;
  return quoteRental(start, end, p, getSetting('rules'));
}

// ── Tạo lượt thuê ───────────────────────────────────────────────────────────

export interface NewPayment {
  purpose: PaymentPurpose;
  method: Exclude<PaymentMethod, 'offset'>;
  amount: number;
  note?: string | null;
}

export interface NewCollateral {
  kind: CollateralKind;
  description: string;
  photoFileIds: string[];
  notes?: string | null;
}

export interface CreateRentalInput {
  customerId: number;
  vehicleId: number;
  scheduledStart: number;
  scheduledEnd: number;
  pickupMethod: 'at_shop' | 'delivery';
  pickupLocation: string | null;
  returnLocation: string | null;
  deliveryFee: number;
  discount: number;
  discountNote: string | null;
  depositRequired: number;
  /** Cọc giữ chờ phạt nguội; bỏ trống = theo cài đặt (không vượt tiền cọc). */
  fineHoldRequired?: number | null;
  fineHoldDays?: number | null;
  /** Phụ kiện kèm lượt này đã chỉnh; null = theo danh sách của xe. */
  accessories?: HandoverAccessory[] | null;
  driverIds: number[];
  notes: string | null;
  payments: NewPayment[];
  collaterals: NewCollateral[];
  allowConflict: boolean;
  allowBlacklisted: boolean;
}

export function createRental(input: CreateRentalInput, userId: number): Rental {
  if (input.scheduledEnd <= input.scheduledStart) throw badRequest('Giờ trả phải sau giờ nhận');
  const vehicle = getVehicle(input.vehicleId);
  if (!vehicle.active || vehicle.archivedAt) throw badRequest('Xe này đang ngưng hoạt động');
  const customer = getCustomer(input.customerId);
  if (customer.blacklisted && !input.allowBlacklisted) {
    throw conflict(`Khách ${customer.fullName} nằm trong danh sách đen`, 'blacklisted');
  }
  const conflicts = findConflicts(vehicle.id, input.scheduledStart, input.scheduledEnd);
  if (conflicts.length && !input.allowConflict) {
    throw conflict('Xe đã có lịch trùng thời gian này', 'conflict', { conflicts });
  }
  const rules = getSetting('rules');
  const fineHold = input.fineHoldRequired ?? defaultFineHold(input.depositRequired, rules);
  if (fineHold > input.depositRequired) throw badRequest('Tiền giữ chờ phạt nguội không được lớn hơn tiền cọc');
  const pricing = vehiclePricing(vehicle);
  const quote = quoteRental(input.scheduledStart, input.scheduledEnd, pricing, rules);
  const now = Date.now();

  return db.transaction(() => {
    const code = nextRentalCode(vnParts(input.scheduledStart).year);
    const rental = db
      .insert(schema.rentals)
      .values({
        code,
        type: 'self_drive',
        status: 'booked',
        customerId: customer.id,
        vehicleId: vehicle.id,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        pickupMethod: input.pickupMethod,
        pickupLocation: input.pickupLocation,
        returnLocation: input.returnLocation,
        pricing: JSON.stringify(pricing),
        kmLimit: quote.kmLimit,
        depositRequired: input.depositRequired,
        fineHoldAmount: 0,
        fineHoldRequired: fineHold,
        fineHoldDays: input.fineHoldDays ?? rules.fineHoldDays,
        accessories: input.accessories ?? null,
        notes: input.notes,
        createdBy: userId,
        handledBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    for (const line of quote.lines) {
      db.insert(schema.charges).values({ rentalId: rental.id, kind: line.kind, description: line.description, amount: line.amount, auto: true, createdBy: userId, createdAt: now }).run();
    }
    if (input.deliveryFee > 0) {
      db.insert(schema.charges).values({ rentalId: rental.id, kind: 'delivery', description: 'Phí giao/nhận xe tận nơi', amount: input.deliveryFee, auto: false, createdBy: userId, createdAt: now }).run();
    }
    if (input.discount > 0) {
      db.insert(schema.charges)
        .values({ rentalId: rental.id, kind: 'discount', description: input.discountNote || 'Giảm giá', amount: -input.discount, auto: false, createdBy: userId, createdAt: now })
        .run();
    }
    for (const driverId of new Set(input.driverIds)) {
      if (driverId === customer.id) continue;
      getCustomer(driverId);
      db.insert(schema.rentalDrivers).values({ rentalId: rental.id, customerId: driverId }).run();
    }
    for (const p of input.payments) addPayment(rental.id, { direction: 'in', ...p }, userId);
    for (const c of input.collaterals) addCollateral(rental.id, c, userId);
    return rental;
  });
}

/** Tính lại các dòng tiền thuê tự sinh khi đổi lịch/đổi xe. Phụ phí nhập tay giữ nguyên. */
function recomputeAutoCharges(rental: Rental, pricing: VehiclePricing, userId: number): Quote {
  const quote = quoteRental(rental.scheduledStart, rental.scheduledEnd, pricing, getSetting('rules'));
  const now = Date.now();
  db.delete(schema.charges).where(and(eq(schema.charges.rentalId, rental.id), eq(schema.charges.auto, true))).run();
  for (const line of quote.lines) {
    db.insert(schema.charges).values({ rentalId: rental.id, kind: line.kind, description: line.description, amount: line.amount, auto: true, createdBy: userId, createdAt: now }).run();
  }
  return quote;
}

export interface UpdateRentalInput {
  vehicleId?: number;
  scheduledStart?: number;
  scheduledEnd?: number;
  pickupMethod?: 'at_shop' | 'delivery';
  pickupLocation?: string | null;
  returnLocation?: string | null;
  depositRequired?: number;
  fineHoldRequired?: number;
  fineHoldDays?: number;
  /** null = bỏ chỉnh, theo lại danh sách của xe. */
  accessories?: HandoverAccessory[] | null;
  notes?: string | null;
  /** Sửa ODO đã ghi lúc giao xe (nhập nhầm) — chỉ khi xe đang trong tay khách. */
  pickupOdo?: number;
  allowConflict?: boolean;
}

export function updateRental(id: number, input: UpdateRentalInput, userId: number): Rental {
  const r = getRental(id);
  if (!OPEN_STATUSES.includes(r.status)) {
    if (input.vehicleId || input.scheduledStart || input.scheduledEnd) throw badRequest('Lượt thuê đã kết thúc, không đổi lịch được nữa');
  }
  if (r.status === 'active' && (input.vehicleId && input.vehicleId !== r.vehicleId)) {
    throw badRequest('Xe đang trong tay khách. Đổi xe giữa chừng chưa hỗ trợ ở bản này.');
  }
  if (r.status === 'active' && input.scheduledStart && input.scheduledStart !== r.scheduledStart) {
    throw badRequest('Đã giao xe, không đổi giờ nhận được. Chỉ gia hạn giờ trả.');
  }
  const next = {
    vehicleId: input.vehicleId ?? r.vehicleId,
    scheduledStart: input.scheduledStart ?? r.scheduledStart,
    scheduledEnd: input.scheduledEnd ?? r.scheduledEnd,
  };
  if (next.scheduledEnd <= next.scheduledStart) throw badRequest('Giờ trả phải sau giờ nhận');
  if (input.accessories !== undefined && r.status !== 'booked') throw badRequest('Đã giao xe — phụ kiện ghi theo biên bản giao xe');
  const deposit = input.depositRequired ?? r.depositRequired;
  // Hạ tiền cọc mà không sửa mức giữ → tự hạ theo; nhập mức giữ lớn hơn cọc thì báo lỗi.
  const fineHold = input.fineHoldRequired ?? (r.fineHoldRequired == null ? null : Math.min(r.fineHoldRequired, deposit));
  if (fineHold != null && fineHold > deposit) throw badRequest('Tiền giữ chờ phạt nguội không được lớn hơn tiền cọc');
  const pickupHo = input.pickupOdo !== undefined ? pickupHandover(r.id) : undefined;
  if (input.pickupOdo !== undefined) {
    if (r.status !== 'active' || !pickupHo) throw badRequest('Chỉ sửa ODO lúc giao khi xe đang trong tay khách');
    const prev = db
      .select({ odo: schema.handovers.odo })
      .from(schema.handovers)
      .where(and(eq(schema.handovers.vehicleId, r.vehicleId), ne(schema.handovers.rentalId, r.id), lt(schema.handovers.at, pickupHo.at)))
      .orderBy(desc(schema.handovers.at))
      .get();
    if (prev && input.pickupOdo < prev.odo - 5) throw badRequest(`ODO ${input.pickupOdo} nhỏ hơn ODO lần trước (${prev.odo}). Kiểm tra lại số trên táp-lô.`);
  }
  const scheduleChanged = next.vehicleId !== r.vehicleId || next.scheduledStart !== r.scheduledStart || next.scheduledEnd !== r.scheduledEnd;
  if (scheduleChanged && OPEN_STATUSES.includes(r.status)) {
    const conflicts = findConflicts(next.vehicleId, next.scheduledStart, next.scheduledEnd, r.id);
    if (conflicts.length && !input.allowConflict) throw conflict('Xe đã có lịch trùng thời gian này', 'conflict', { conflicts });
  }
  return db.transaction(() => {
    // Khách đang giữ xe mà đổi giờ trả = gia hạn (hoặc trả sớm) → ghi lại để in phụ lục hợp đồng.
    const extending = r.status === 'active' && next.scheduledEnd !== r.scheduledEnd;
    const oldTotal = extending ? rentalMoney(r.id).totalCharges : 0;
    let pricing = rentalPricing(r);
    if (next.vehicleId !== r.vehicleId) pricing = vehiclePricing(getVehicle(next.vehicleId));
    const patch: Partial<Rental> = {
      ...next,
      pickupMethod: input.pickupMethod ?? r.pickupMethod,
      pickupLocation: input.pickupLocation !== undefined ? input.pickupLocation : r.pickupLocation,
      returnLocation: input.returnLocation !== undefined ? input.returnLocation : r.returnLocation,
      depositRequired: deposit,
      fineHoldRequired: fineHold,
      fineHoldDays: input.fineHoldDays ?? r.fineHoldDays,
      // Đổi xe: danh sách phụ kiện đã chỉnh là của xe cũ → bỏ, trừ khi gửi kèm danh sách mới.
      accessories: input.accessories !== undefined ? input.accessories : next.vehicleId !== r.vehicleId ? null : r.accessories,
      notes: input.notes !== undefined ? input.notes : r.notes,
      pricing: JSON.stringify(pricing),
      updatedAt: Date.now(),
    };
    if (scheduleChanged) {
      const quote = recomputeAutoCharges({ ...r, ...patch } as Rental, pricing, userId);
      patch.kmLimit = quote.kmLimit;
    }
    const updated = db.update(schema.rentals).set(patch).where(eq(schema.rentals.id, id)).returning().get();
    if (pickupHo && input.pickupOdo !== undefined && input.pickupOdo !== pickupHo.odo) {
      db.update(schema.handovers).set({ odo: input.pickupOdo }).where(eq(schema.handovers.id, pickupHo.id)).run();
      // Xe chưa ghi ODO nào mới hơn số lúc giao → sửa theo, để lịch bảo dưỡng tính đúng.
      db.update(schema.vehicles)
        .set({ odo: input.pickupOdo, updatedAt: Date.now() })
        .where(and(eq(schema.vehicles.id, r.vehicleId), eq(schema.vehicles.odo, pickupHo.odo)))
        .run();
    }
    if (extending) {
      const seq = db.select({ id: schema.rentalExtensions.id }).from(schema.rentalExtensions).where(eq(schema.rentalExtensions.rentalId, r.id)).all().length + 1;
      db.insert(schema.rentalExtensions)
        .values({
          rentalId: r.id,
          seq,
          oldEnd: r.scheduledEnd,
          newEnd: updated.scheduledEnd,
          oldTotal,
          newTotal: rentalMoney(r.id).totalCharges,
          oldKmLimit: r.kmLimit,
          newKmLimit: updated.kmLimit,
          createdBy: userId,
          createdAt: Date.now(),
        })
        .run();
    }
    return updated;
  });
}

// ── Sổ tiền ────────────────────────────────────────────────────────────────

export function addPayment(
  rentalId: number,
  p: { direction: 'in' | 'out' | 'offset'; purpose: PaymentPurpose; method: PaymentMethod; amount: number; note?: string | null; at?: number },
  userId: number,
) {
  if (!(p.amount > 0)) throw badRequest('Số tiền phải lớn hơn 0');
  const now = Date.now();
  return db
    .insert(schema.payments)
    .values({
      rentalId,
      direction: p.direction,
      purpose: p.direction === 'offset' ? 'deposit' : p.purpose,
      method: p.direction === 'offset' ? 'offset' : p.method,
      amount: Math.round(p.amount),
      at: p.at ?? now,
      note: p.note ?? null,
      createdBy: userId,
      createdAt: now,
    })
    .returning()
    .get();
}

export function addCharge(rentalId: number, c: { kind: ChargeKind; description: string; amount: number }, userId: number) {
  return db
    .insert(schema.charges)
    .values({ rentalId, kind: c.kind, description: c.description, amount: Math.round(c.amount), auto: false, createdBy: userId, createdAt: Date.now() })
    .returning()
    .get();
}

export function addCollateral(rentalId: number, c: NewCollateral, userId: number) {
  const now = Date.now();
  return db
    .insert(schema.collaterals)
    .values({ rentalId, kind: c.kind, description: c.description, photoFileIds: c.photoFileIds, notes: c.notes ?? null, receivedAt: now, createdBy: userId, createdAt: now })
    .returning()
    .get();
}

export function rentalMoney(rentalId: number) {
  const charges = db.select().from(schema.charges).where(eq(schema.charges.rentalId, rentalId)).all();
  const payments = db.select().from(schema.payments).where(eq(schema.payments.rentalId, rentalId)).all();
  return summarizeMoney(charges, payments);
}

/** Sổ tiền của mọi lượt ở các trạng thái này — 2 truy vấn cho cả danh sách (nhắc công nợ, hoàn tiền). */
export function moneyByRental(statuses: RentalStatus[]): Map<number, MoneySummary> {
  // Cộng sẵn trong SQL (mỗi lượt vài dòng) — Việc cần làm gọi mỗi phút, dữ liệu nhiều năm vẫn nhẹ.
  const charges = db
    .select({ rentalId: schema.charges.rentalId, amount: sql<number>`SUM(${schema.charges.amount})` })
    .from(schema.charges)
    .innerJoin(schema.rentals, eq(schema.rentals.id, schema.charges.rentalId))
    .where(inArray(schema.rentals.status, statuses))
    .groupBy(schema.charges.rentalId)
    .all();
  const payments = db
    .select({ rentalId: schema.payments.rentalId, direction: schema.payments.direction, purpose: schema.payments.purpose, amount: sql<number>`SUM(${schema.payments.amount})` })
    .from(schema.payments)
    .innerJoin(schema.rentals, eq(schema.rentals.id, schema.payments.rentalId))
    .where(and(inArray(schema.rentals.status, statuses), isNull(schema.payments.voidedAt)))
    .groupBy(schema.payments.rentalId, schema.payments.direction, schema.payments.purpose)
    .all();
  const group = <T extends { rentalId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const x of rows) {
      const list = m.get(x.rentalId);
      if (list) list.push(x);
      else m.set(x.rentalId, [x]);
    }
    return m;
  };
  const byCharges = group(charges);
  const byPayments = group(payments);
  const out = new Map<number, MoneySummary>();
  for (const id of new Set([...byCharges.keys(), ...byPayments.keys()])) {
    out.set(id, summarizeMoney(byCharges.get(id) ?? [], byPayments.get(id) ?? []));
  }
  return out;
}

// ── Giao xe / nhận xe ─────────────────────────────────────────────────────

export interface HandoverInput {
  at: number;
  odo: number;
  fuelLevel: number;
  checklist: Record<string, boolean>;
  photos: HandoverPhoto[];
  damages: HandoverDamage[];
  accessories: HandoverAccessory[];
  notes: string | null;
  signatureFileId: string | null;
}

/** Biên bản giao xe của lượt thuê. */
export function pickupHandover(rentalId: number) {
  return db
    .select()
    .from(schema.handovers)
    .where(and(eq(schema.handovers.rentalId, rentalId), eq(schema.handovers.kind, 'pickup')))
    .orderBy(desc(schema.handovers.at))
    .get();
}

export function pickup(id: number, input: HandoverInput & { payments: NewPayment[]; collaterals: NewCollateral[] }, userId: number): Rental {
  const r = getRental(id);
  if (r.status !== 'booked') throw badRequest(`Lượt thuê đang ở trạng thái "${RENTAL_STATUS[r.status].label}", không giao xe được`);
  const vehicle = getVehicle(r.vehicleId);
  if (input.odo < vehicle.odo - 5) {
    // Cho lệch nhẹ do làm tròn; lệch nhiều là nhập sai.
    throw badRequest(`ODO ${input.odo} nhỏ hơn ODO lần trước (${vehicle.odo}). Kiểm tra lại số trên táp-lô.`);
  }
  const busy = db
    .select({ id: schema.rentals.id, code: schema.rentals.code })
    .from(schema.rentals)
    .where(and(eq(schema.rentals.vehicleId, r.vehicleId), eq(schema.rentals.status, 'active'), ne(schema.rentals.id, r.id)))
    .get();
  if (busy) throw conflict(`Xe đang được giao cho lượt ${busy.code}, chưa nhận lại`, 'vehicle_busy');

  return db.transaction(() => {
    const now = Date.now();
    db.insert(schema.handovers)
      .values({ rentalId: r.id, kind: 'pickup', vehicleId: r.vehicleId, ...input, staffUserId: userId, createdAt: now })
      .run();
    db.insert(schema.rentalSegments).values({ rentalId: r.id, vehicleId: r.vehicleId, startAt: input.at, endAt: null }).run();
    db.update(schema.vehicles).set({ odo: input.odo, updatedAt: now }).where(eq(schema.vehicles.id, r.vehicleId)).run();
    for (const p of input.payments) addPayment(r.id, { direction: 'in', ...p }, userId);
    for (const c of input.collaterals) addCollateral(r.id, c, userId);
    return db
      .update(schema.rentals)
      .set({ status: 'active', actualStart: input.at, handledBy: userId, updatedAt: now })
      .where(eq(schema.rentals.id, r.id))
      .returning()
      .get();
  });
}

export function returnVehicle(
  id: number,
  input: HandoverInput & { charges: { kind: ChargeKind; description: string; amount: number }[] },
  userId: number,
): Rental {
  const r = getRental(id);
  if (r.status !== 'active') throw badRequest('Chỉ nhận lại xe của lượt đang thuê');
  if (r.actualStart && input.at < r.actualStart) throw badRequest('Giờ nhận lại xe không thể trước giờ giao xe');
  const pickupHo = pickupHandover(r.id);
  if (pickupHo && input.odo < pickupHo.odo) throw badRequest(`ODO lúc trả (${input.odo}) nhỏ hơn lúc giao (${pickupHo.odo})`);

  return db.transaction(() => {
    const now = Date.now();
    db.insert(schema.handovers)
      .values({ rentalId: r.id, kind: 'return', vehicleId: r.vehicleId, ...input, staffUserId: userId, createdAt: now })
      .run();
    db.update(schema.rentalSegments)
      .set({ endAt: input.at })
      .where(and(eq(schema.rentalSegments.rentalId, r.id), isNull(schema.rentalSegments.endAt)))
      .run();
    db.update(schema.vehicles).set({ odo: input.odo, updatedAt: now }).where(eq(schema.vehicles.id, r.vehicleId)).run();
    for (const c of input.charges) if (c.amount !== 0) addCharge(r.id, c, userId);
    return db
      .update(schema.rentals)
      .set({ status: 'returned', actualEnd: input.at, handledBy: userId, updatedAt: now })
      .where(eq(schema.rentals.id, r.id))
      .returning()
      .get();
  });
}

// ── Quyết toán & hoàn cọc ──────────────────────────────────────────────────

export interface SettleInput {
  collect: { amount: number; method: 'cash' | 'transfer' } | null;
  refundRent: { amount: number; method: 'cash' | 'transfer' } | null;
  offset: number;
  refundDeposit: { amount: number; method: 'cash' | 'transfer' } | null;
  fineHoldDays: number;
  returnCollaterals: boolean;
  note: string | null;
}

export function settle(id: number, input: SettleInput, userId: number): Rental {
  const r = getRental(id);
  if (r.status !== 'returned') throw badRequest('Chỉ quyết toán lượt đã trả xe');
  return db.transaction(() => {
    const note = input.note ?? 'Quyết toán khi trả xe';
    if (input.offset > 0) addPayment(r.id, { direction: 'offset', purpose: 'deposit', method: 'offset', amount: input.offset, note: 'Cấn trừ cọc vào tiền thuê' }, userId);
    if (input.collect && input.collect.amount > 0) addPayment(r.id, { direction: 'in', purpose: 'rent', ...input.collect, note }, userId);
    if (input.refundRent && input.refundRent.amount > 0) addPayment(r.id, { direction: 'out', purpose: 'rent', ...input.refundRent, note: 'Hoàn tiền thuê thu thừa' }, userId);
    if (input.refundDeposit && input.refundDeposit.amount > 0) addPayment(r.id, { direction: 'out', purpose: 'deposit', ...input.refundDeposit, note: 'Hoàn cọc khi trả xe' }, userId);

    const money = rentalMoney(r.id);
    if (money.depositHeld < 0) throw badRequest('Số tiền hoàn cọc vượt quá tiền cọc đang giữ');
    const now = Date.now();
    if (input.returnCollaterals) {
      db.update(schema.collaterals)
        .set({ returnedAt: now })
        .where(and(eq(schema.collaterals.rentalId, r.id), isNull(schema.collaterals.returnedAt)))
        .run();
    }
    const holding = money.depositHeld > 0;
    return db
      .update(schema.rentals)
      .set({
        status: holding ? 'settled' : 'closed',
        fineHoldAmount: holding ? money.depositHeld : 0,
        fineHoldUntil: holding ? (r.actualEnd ?? now) + input.fineHoldDays * DAY_MS : null,
        updatedAt: now,
      })
      .where(eq(schema.rentals.id, r.id))
      .returning()
      .get();
  });
}

export interface ReleaseHoldInput {
  /** `fineId`: khoản trừ cho một hồ sơ phạt nguội → hồ sơ chuyển "Đã thu lại / trừ cọc". */
  deductions: { kind: ChargeKind; description: string; amount: number; fineId?: number | null }[];
  refund: { method: 'cash' | 'transfer' } | null;
  note: string | null;
}

/** Ghi khoản phải trả rồi lấy cọc đang giữ bù vào — cọc không đủ thì phần thiếu thành công nợ của khách. */
export function chargeFromDeposit(rentalId: number, c: { kind: ChargeKind; description: string; amount: number }, userId: number): { fromDeposit: number; owed: number } {
  addCharge(rentalId, c, userId);
  const take = Math.min(c.amount, Math.max(0, rentalMoney(rentalId).depositHeld));
  if (take > 0) addPayment(rentalId, { direction: 'offset', purpose: 'deposit', method: 'offset', amount: take, note: `Trừ cọc: ${c.description}`.slice(0, 300) }, userId);
  return { fromDeposit: take, owed: c.amount - take };
}

/** Hết hạn giữ cọc: trừ phạt nguội (nếu có) rồi hoàn phần còn lại. Phạt vượt cọc → phần vượt khách còn nợ (Việc cần làm nhắc thu). */
export function releaseHold(id: number, input: ReleaseHoldInput, userId: number): Rental {
  const r = getRental(id);
  if (r.status !== 'settled') throw badRequest('Lượt thuê không ở trạng thái chờ hoàn cọc');
  return db.transaction(() => {
    for (const d of input.deductions) {
      if (d.amount <= 0) continue;
      chargeFromDeposit(r.id, { kind: d.kind, description: d.description, amount: d.amount }, userId);
      if (d.fineId) {
        const f = db.select().from(schema.trafficFines).where(and(eq(schema.trafficFines.id, d.fineId), eq(schema.trafficFines.rentalId, r.id))).get();
        if (!f) throw badRequest('Hồ sơ phạt nguội không thuộc lượt thuê này');
        if (f.voidedAt) throw badRequest('Hồ sơ phạt nguội đã hủy');
        db.update(schema.trafficFines)
          .set({ status: 'recovered', amount: f.amount ?? d.amount, updatedAt: Date.now() })
          .where(eq(schema.trafficFines.id, f.id))
          .run();
      }
    }
    const money = rentalMoney(r.id);
    if (money.depositHeld > 0) {
      if (!input.refund) throw badRequest('Chọn hình thức hoàn cọc');
      addPayment(r.id, { direction: 'out', purpose: 'deposit', method: input.refund.method, amount: money.depositHeld, note: input.note ?? 'Hoàn cọc phạt nguội' }, userId);
    }
    return db
      .update(schema.rentals)
      .set({ status: 'closed', fineHoldAmount: 0, updatedAt: Date.now() })
      .where(eq(schema.rentals.id, r.id))
      .returning()
      .get();
  });
}

export interface CancelInput {
  reason: string;
  /** Số tiền giữ lại (khách mất) — lấy từ cọc trước, thiếu thì từ tiền thuê trả trước. */
  keep: number;
  /** Hoàn phần còn lại ngay; null = hoàn sau (nút Hoàn cọc / Hoàn tiền thuê). */
  refund: { method: 'cash' | 'transfer' } | null;
}

/**
 * Hủy lượt chưa giao xe. Các khoản báo giá (tiền thuê, giao xe…) bỏ đi vì chuyến không diễn ra;
 * tiền giữ lại thành khoản "Phí hủy (mất cọc)" được cấn từ cọc, nên sổ tiền của lượt về 0.
 */
export function cancelRental(id: number, input: CancelInput, userId: number): { rental: Rental; removedCharges: { kind: ChargeKind; description: string; amount: number }[] } {
  const r = getRental(id);
  if (r.status !== 'booked') throw badRequest('Chỉ hủy được lượt chưa giao xe');
  const before = rentalMoney(id);
  const plan = planCancellation(before, input.keep);
  if (input.keep > plan.keep) throw badRequest(`Số tiền giữ lại vượt quá tiền khách đã trả (${fmtNumber(plan.keep)} đ)`);
  return db.transaction(() => {
    const removedCharges = db.delete(schema.charges).where(eq(schema.charges.rentalId, id)).returning({ kind: schema.charges.kind, description: schema.charges.description, amount: schema.charges.amount }).all();
    if (plan.keep > 0) addCharge(id, { kind: 'cancel_fee', description: `Khách hủy chuyến lúc ${fmtDateTime(Date.now())} (hẹn nhận xe ${fmtDateTime(r.scheduledStart)})`, amount: plan.keep }, userId);
    if (plan.offset > 0) addPayment(id, { direction: 'offset', purpose: 'deposit', method: 'offset', amount: plan.offset, note: 'Giữ cọc do khách hủy chuyến' }, userId);
    if (input.refund && plan.refundDeposit > 0) addPayment(id, { direction: 'out', purpose: 'deposit', method: input.refund.method, amount: plan.refundDeposit, note: 'Hoàn cọc khi hủy chuyến' }, userId);
    if (input.refund && plan.refundRent > 0) addPayment(id, { direction: 'out', purpose: 'rent', method: input.refund.method, amount: plan.refundRent, note: 'Hoàn tiền thuê trả trước khi hủy chuyến' }, userId);
    const rental = db
      .update(schema.rentals)
      .set({ status: 'cancelled', cancelReason: input.reason, updatedAt: Date.now() })
      .where(eq(schema.rentals.id, id))
      .returning()
      .get();
    return { rental, removedCharges };
  });
}

// ── Đọc chi tiết ───────────────────────────────────────────────────────────

export function rentalDetail(id: number) {
  const rental = getRental(id);
  const customer = getCustomer(rental.customerId);
  const vehicle = getVehicle(rental.vehicleId);
  const drivers = db
    .select({ link: schema.rentalDrivers, c: schema.customers })
    .from(schema.rentalDrivers)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentalDrivers.customerId))
    .where(eq(schema.rentalDrivers.rentalId, id))
    .all()
    .map((x) => x.c);
  const segments = db.select().from(schema.rentalSegments).where(eq(schema.rentalSegments.rentalId, id)).orderBy(asc(schema.rentalSegments.startAt)).all();
  const handovers = db.select().from(schema.handovers).where(eq(schema.handovers.rentalId, id)).orderBy(asc(schema.handovers.at)).all();
  const charges = db.select().from(schema.charges).where(eq(schema.charges.rentalId, id)).orderBy(asc(schema.charges.id)).all();
  const payments = db.select().from(schema.payments).where(eq(schema.payments.rentalId, id)).orderBy(asc(schema.payments.at)).all();
  const collaterals = db.select().from(schema.collaterals).where(eq(schema.collaterals.rentalId, id)).all();
  const documents = db.select().from(schema.documents).where(eq(schema.documents.rentalId, id)).orderBy(desc(schema.documents.createdAt)).all();
  const fines = db.select().from(schema.trafficFines).where(eq(schema.trafficFines.rentalId, id)).all();
  const extensions = db.select().from(schema.rentalExtensions).where(eq(schema.rentalExtensions.rentalId, id)).orderBy(asc(schema.rentalExtensions.seq)).all();
  const userIds = [rental.createdBy, rental.handledBy, ...handovers.map((h) => h.staffUserId)].filter((x): x is number => x != null);
  const users = userIds.length
    ? db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, userIds)).all()
    : [];
  const money = summarizeMoney(charges, payments);
  const warnings: Warning[] =
    rental.status === 'booked' ? [...[customer, ...drivers].flatMap((c, i) => driverWarnings(c, rental.scheduledStart, i === 0 ? 'Khách' : 'Lái phụ')), ...maintenanceWarnings(vehicle)] : [];
  return {
    rental,
    customer,
    vehicle,
    drivers,
    segments,
    handovers,
    charges,
    payments,
    collaterals,
    documents,
    fines,
    extensions,
    users,
    warnings,
    money,
    monthly: monthlyPlan(rental, charges, money),
  };
}

/** Lượt thuê tháng (từ 2 kỳ trở lên): lịch từng tháng để thu tiền dần. null = không phải thuê tháng. */
function monthlyPlan(r: Rental, charges: { kind: ChargeKind; amount: number }[], money: MoneySummary): MonthPeriod[] | null {
  if (r.status === 'cancelled') return null;
  const pricing = rentalPricing(r);
  if (!pricing.priceMonth) return null;
  const quote = quoteRental(r.scheduledStart, r.scheduledEnd, pricing, getSetting('rules'));
  if (quote.mode !== 'month') return null;
  const rentTotal = charges.filter((c) => c.kind === 'rental').reduce((s, c) => s + c.amount, 0);
  const periods = monthPeriods(r.scheduledStart, r.scheduledEnd, quote.months, pricing.priceMonth, rentTotal, money.rentPaid);
  return periods.length >= 2 ? periods : null;
}

export type RentalDetail = ReturnType<typeof rentalDetail>;

/** Mô tả ngắn để dùng trong thông báo. */
export function rentalLine(r: Rental, c: Customer, v: Vehicle): string {
  return `${r.code} · ${v.plate} · ${c.fullName} · ${fmtDateTime(r.scheduledStart)} → ${fmtDateTime(r.scheduledEnd)}`;
}
