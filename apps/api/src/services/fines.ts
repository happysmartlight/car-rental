// Tra ngược phạt nguội: biển số + thời điểm vi phạm → ai đang giữ xe.
//
// Nguồn sự thật là rental_segments (giờ giao/nhận THỰC TẾ). Lịch đặt chỉ dùng
// để cảnh báo trường hợp quên ghi nhận giao xe.

import { and, eq, inArray, isNull, lte, or, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Customer, Rental, RentalSegment, TrafficFine, Vehicle, VehicleBlock } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { escapeHtml, notify } from '../lib/telegram.js';
import { FINE_DONE_STATUSES, type FineSource, type FineStatus } from '../shared/constants.js';
import { HOUR_MS, fmtDateTime } from '../shared/time.js';
import { fmtVnd, formatPlate, plateKey } from '../shared/text.js';
import { addCharge, addPayment, chargeFromDeposit, getRental, rentalMoney } from './rentals.js';

export interface FineMatch {
  segment: RentalSegment;
  rental: Rental;
  customer: Customer;
  drivers: Customer[];
  /** Vi phạm cách giờ giao/nhận ít hơn 2 giờ → nên kiểm tra kỹ. */
  nearBoundary: boolean;
}

export interface FineLookupResult {
  plateKey: string;
  at: number;
  vehicle: Vehicle | null;
  verdict: 'rented' | 'blocked' | 'idle' | 'unknown_vehicle';
  matches: FineMatch[];
  blocks: VehicleBlock[];
  /** Lượt thuê THEO LỊCH trùng thời điểm nhưng chưa ghi nhận giao xe — dữ liệu thiếu. */
  scheduledOnly: { rental: Rental; customer: Customer }[];
  /** Các lượt thuê kề trước/sau trong vòng 6 giờ (để đối chiếu khi sát giờ). */
  nearby: { rental: Rental; customer: Customer; segment: RentalSegment }[];
}

const NEAR = 2 * HOUR_MS;
const AROUND = 6 * HOUR_MS;

function driversOf(rentalId: number): Customer[] {
  return db
    .select({ c: schema.customers })
    .from(schema.rentalDrivers)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentalDrivers.customerId))
    .where(eq(schema.rentalDrivers.rentalId, rentalId))
    .all()
    .map((x) => x.c);
}

export function lookupFine(plate: string, at: number): FineLookupResult {
  const key = plateKey(plate);
  const vehicle = db.select().from(schema.vehicles).where(eq(schema.vehicles.plateKey, key)).get() ?? null;
  const base = { plateKey: key, at, vehicle, matches: [], blocks: [], scheduledOnly: [], nearby: [] };
  if (!vehicle) return { ...base, verdict: 'unknown_vehicle' };

  const segRows = db
    .select({ s: schema.rentalSegments, r: schema.rentals, c: schema.customers })
    .from(schema.rentalSegments)
    .innerJoin(schema.rentals, eq(schema.rentals.id, schema.rentalSegments.rentalId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .where(
      and(
        eq(schema.rentalSegments.vehicleId, vehicle.id),
        lte(schema.rentalSegments.startAt, at + AROUND),
        or(isNull(schema.rentalSegments.endAt), gte(schema.rentalSegments.endAt, at - AROUND)),
      ),
    )
    .all();

  const matches: FineMatch[] = [];
  const nearby: FineLookupResult['nearby'] = [];
  for (const { s, r, c } of segRows) {
    const inside = s.startAt <= at && (s.endAt == null || s.endAt >= at);
    if (inside) {
      const nearBoundary = at - s.startAt < NEAR || (s.endAt != null && s.endAt - at < NEAR);
      matches.push({ segment: s, rental: r, customer: c, drivers: driversOf(r.id), nearBoundary });
    } else {
      nearby.push({ rental: r, customer: c, segment: s });
    }
  }

  const blocks = db
    .select()
    .from(schema.vehicleBlocks)
    .where(
      and(
        eq(schema.vehicleBlocks.vehicleId, vehicle.id),
        lte(schema.vehicleBlocks.startAt, at),
        or(isNull(schema.vehicleBlocks.endAt), gte(schema.vehicleBlocks.endAt, at)),
      ),
    )
    .all();

  const scheduledOnly = db
    .select({ r: schema.rentals, c: schema.customers })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .where(
      and(
        eq(schema.rentals.vehicleId, vehicle.id),
        inArray(schema.rentals.status, ['booked']),
        lte(schema.rentals.scheduledStart, at),
        gte(schema.rentals.scheduledEnd, at),
      ),
    )
    .all()
    .map(({ r, c }) => ({ rental: r, customer: c }));

  const verdict = matches.length ? 'rented' : blocks.length ? 'blocked' : 'idle';
  return { ...base, verdict, matches, blocks, scheduledOnly, nearby };
}

export interface NewFine {
  plate: string;
  violatedAt: number;
  location?: string | null;
  violation?: string | null;
  amount?: number | null;
  source?: FineSource;
  noticeFileId?: string | null;
  rentalId?: number | null;
  customerId?: number | null;
  status?: FineStatus;
  notes?: string | null;
}

/** Ghi một vi phạm vào hồ sơ. Chưa chỉ định lượt thuê → tự khớp người đang giữ xe lúc đó. */
export function recordFine(body: NewFine, userId: number | null) {
  const key = plateKey(body.plate);
  const vehicle = db.select().from(schema.vehicles).where(eq(schema.vehicles.plateKey, key)).get();
  let rentalId = body.rentalId ?? null;
  let customerId = body.customerId ?? null;
  if (!rentalId) {
    const found = lookupFine(body.plate, body.violatedAt);
    if (found.matches.length === 1) {
      rentalId = found.matches[0].rental.id;
      customerId = found.matches[0].customer.id;
    }
  } else if (!customerId) {
    customerId = db.select().from(schema.rentals).where(eq(schema.rentals.id, rentalId)).get()?.customerId ?? null;
  }
  const now = Date.now();
  const f = db
    .insert(schema.trafficFines)
    .values({
      plate: vehicle?.plate ?? formatPlate(body.plate),
      plateKey: key,
      vehicleId: vehicle?.id ?? null,
      violatedAt: body.violatedAt,
      location: body.location ?? null,
      violation: body.violation ?? null,
      amount: body.amount ?? null,
      source: body.source ?? 'csgt',
      noticeFileId: body.noticeFileId ?? null,
      rentalId,
      customerId,
      status: body.status ?? 'new',
      notes: body.notes ?? null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const who = customerId ? db.select().from(schema.customers).where(eq(schema.customers.id, customerId)).get() : null;
  notify(
    `🚨 <b>Phạt nguội mới</b> ${escapeHtml(f.plate)} lúc ${fmtDateTime(f.violatedAt)}\n${escapeHtml(f.violation ?? '')}${f.amount ? ` · ${fmtVnd(f.amount)}` : ''}\n${who ? `Người giữ xe: ${escapeHtml(who.fullName)} · ${escapeHtml(who.phone ?? '')}` : 'Chưa xác định người giữ xe'}`,
  );
  return f;
}

export interface RecoverFineInput {
  amount: number;
  /** deposit = trừ vào cọc đang giữ chờ phạt nguội. */
  method: 'cash' | 'transfer' | 'deposit';
  at?: number;
}

/**
 * Khách trả lại tiền phạt nguội (mình nộp thay, hoặc phát hiện sau khi đã hoàn cọc):
 * ghi khoản "Phạt nguội" vào lượt thuê + phiếu thu (hoặc cấn từ cọc đang giữ) → sổ tiền và Thu chi khớp nhau.
 */
export function recoverFine(id: number, input: RecoverFineInput, userId: number): TrafficFine {
  const f = db.select().from(schema.trafficFines).where(eq(schema.trafficFines.id, id)).get();
  if (!f) throw notFound('Không tìm thấy hồ sơ vi phạm');
  if (f.voidedAt) throw badRequest('Hồ sơ đã hủy');
  if (!f.rentalId) throw badRequest('Vi phạm chưa gắn với lượt thuê nào — chọn người giữ xe trước');
  if (FINE_DONE_STATUSES.includes(f.status)) throw badRequest('Vi phạm này đã thu tiền / xử lý xong');
  if (!(input.amount > 0)) throw badRequest('Nhập số tiền phạt');
  const r = getRental(f.rentalId);
  if (r.status === 'cancelled') throw badRequest('Lượt thuê đã hủy');
  if (input.method === 'deposit' && r.status !== 'settled') throw badRequest('Chỉ trừ cọc khi lượt thuê đang giữ cọc chờ phạt nguội');
  const description = `Phạt nguội ${fmtDateTime(f.violatedAt)}${f.violation ? `: ${f.violation}` : ''}`.slice(0, 300);
  return db.transaction(() => {
    if (input.method === 'deposit') {
      // Cọc không đủ thì trừ hết cọc, phần thiếu thành khoản khách còn nợ (Việc cần làm nhắc thu).
      chargeFromDeposit(r.id, { kind: 'fine', description, amount: input.amount }, userId);
      const held = rentalMoney(r.id).depositHeld;
      // Hết cọc giữ lại thì lượt thuê xong luôn, không còn gì để hoàn.
      db.update(schema.rentals)
        .set(held > 0 ? { fineHoldAmount: held, updatedAt: Date.now() } : { status: 'closed', fineHoldAmount: 0, updatedAt: Date.now() })
        .where(eq(schema.rentals.id, r.id))
        .run();
    } else {
      addCharge(r.id, { kind: 'fine', description, amount: input.amount }, userId);
      addPayment(r.id, { direction: 'in', purpose: 'rent', method: input.method, amount: input.amount, at: input.at, note: 'Khách trả lại tiền phạt nguội' }, userId);
    }
    return db
      .update(schema.trafficFines)
      .set({ status: 'recovered', amount: f.amount ?? input.amount, updatedAt: Date.now() })
      .where(eq(schema.trafficFines.id, id))
      .returning()
      .get();
  });
}
