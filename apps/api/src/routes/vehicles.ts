import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { Vehicle } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, notFound, parse, parsePatch, requireRole, zDateKey, zFileId, zMoney, zMs, zOptText } from '../lib/http.js';
import { vehicleAccessories } from '../services/accessories.js';
import { findConflicts, occupiedRange } from '../services/rentals.js';
import { BLOCK_KINDS, FUEL_TYPES, TRANSMISSIONS } from '../shared/constants.js';
import { formatPlate, plateKey } from '../shared/text.js';

const zVehicle = z.object({
  plate: z.string().trim().min(4, 'nhập biển số').max(20),
  make: z.string().trim().max(50).default(''),
  model: z.string().trim().max(80).default(''),
  year: z.coerce.number().int().min(1980).max(2100).nullable().optional(),
  color: zOptText,
  seats: z.coerce.number().int().min(1).max(60).nullable().optional(),
  transmission: z.enum(TRANSMISSIONS).nullable().optional(),
  fuel: z.enum(FUEL_TYPES).nullable().optional(),
  vin: zOptText,
  engineNo: zOptText,
  odo: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
  ownerType: z.enum(['own', 'consigned']).default('own'),
  ownerName: zOptText,
  ownerPhone: zOptText,
  ownerSharePct: z.coerce.number().int().min(0).max(100).nullable().optional(),
  priceDay: zMoney,
  priceHour: zMoney.default(0),
  priceWeekendDay: zMoney.nullable().optional(),
  kmLimitDay: z.coerce.number().int().min(0).default(0),
  overKmFee: zMoney.default(0),
  overHourFee: zMoney.default(0),
  depositAmount: zMoney.default(0),
  priceMonth: zMoney.nullable().optional(),
  kmLimitMonth: z.coerce.number().int().min(0).nullable().optional(),
  freeCharges: z.coerce.number().int().min(0).max(99).nullable().optional(),
  chargeFee: zMoney.nullable().optional(),
  energyFeePct: zMoney.nullable().optional(),
  energyFeeKm: zMoney.nullable().optional(),
  energyMethod: z.enum(['pct', 'km']).nullable().optional(),
  inspectionExpiry: zDateKey,
  insuranceTndsExpiry: zDateKey,
  insuranceBodyExpiry: zDateKey,
  roadFeeExpiry: zDateKey,
  nextServiceOdo: z.coerce.number().int().min(0).nullable().optional(),
  nextServiceDate: zDateKey,
  photoFileId: zFileId,
  registrationFileId: zFileId,
  regNumber: zOptText,
  regDate: zDateKey,
  regPlace: zOptText,
  regOwner: zOptText,
  notes: zOptText,
});

/** Trạng thái hiện tại của từng xe: đang cho thuê / đã đặt sắp tới / tạm ngưng / sẵn sàng. */
export function vehicleStatuses(vehicles: Vehicle[], now = Date.now()) {
  const ids = vehicles.map((v) => v.id);
  if (!ids.length) return new Map();
  const rentals = db
    .select({ r: schema.rentals, c: { id: schema.customers.id, fullName: schema.customers.fullName, phone: schema.customers.phone } })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .where(and(inArray(schema.rentals.vehicleId, ids), inArray(schema.rentals.status, ['booked', 'active'])))
    .orderBy(asc(schema.rentals.scheduledStart))
    .all();
  const blocks = db
    .select()
    .from(schema.vehicleBlocks)
    .where(and(inArray(schema.vehicleBlocks.vehicleId, ids), isNull(schema.vehicleBlocks.voidedAt), sql`${schema.vehicleBlocks.startAt} <= ${now}`, sql`(${schema.vehicleBlocks.endAt} IS NULL OR ${schema.vehicleBlocks.endAt} > ${now})`))
    .all();
  const out = new Map<number, { state: 'rented' | 'blocked' | 'available' | 'inactive'; current?: unknown; next?: unknown; block?: unknown }>();
  for (const v of vehicles) {
    const mine = rentals.filter((x) => x.r.vehicleId === v.id);
    const active = mine.find((x) => x.r.status === 'active');
    const next = mine.find((x) => x.r.status === 'booked');
    const block = blocks.find((b) => b.vehicleId === v.id);
    const state = !v.active ? 'inactive' : active ? 'rented' : block ? 'blocked' : 'available';
    out.set(v.id, {
      state,
      current: active ? { id: active.r.id, code: active.r.code, customer: active.c, until: occupiedRange(active.r, now).end, scheduledEnd: active.r.scheduledEnd } : undefined,
      next: next ? { id: next.r.id, code: next.r.code, customer: next.c, start: next.r.scheduledStart, end: next.r.scheduledEnd } : undefined,
      block: block ?? undefined,
    });
  }
  return out;
}

function ensureUniquePlate(plate: string, excludeId?: number): string {
  const key = plateKey(plate);
  if (key.length < 4) throw badRequest('Biển số không hợp lệ');
  const dup = db.select().from(schema.vehicles).where(eq(schema.vehicles.plateKey, key)).get();
  if (dup && dup.id !== excludeId) throw conflict(`Biển số ${dup.plate} đã có trong danh sách xe`, 'duplicate', { existingId: dup.id });
  return key;
}

/** Xe ký gửi phải có tên chủ và tỷ lệ chia: hợp đồng in tên chủ xe, đối soát cần tỷ lệ. */
function ensureOwnerInfo(v: { ownerType?: 'own' | 'consigned'; ownerName?: string | null; ownerSharePct?: number | null }) {
  if (v.ownerType !== 'consigned') return;
  if (!v.ownerName) throw badRequest('Xe ký gửi cần có tên chủ xe');
  if (v.ownerSharePct == null) throw badRequest('Xe ký gửi cần có tỷ lệ chủ xe hưởng (%)');
}

/** Lượt thuê đang mở trùng khoảng tạm ngưng. Không có ngày kết thúc thì coi như kéo dài mãi. */
function rentalClashes(vehicleId: number, start: number, end: number | null) {
  return findConflicts(vehicleId, start, end ?? Number.MAX_SAFE_INTEGER).filter((c) => c.type === 'rental');
}

/** Tạm ngưng đè lên lượt khách đã đặt: chặn lại, chỉ quản trị mới được xác nhận ghi. */
function assertNoRentalClash(req: FastifyRequest, clashes: ReturnType<typeof rentalClashes>, force?: boolean) {
  if (!clashes.length) return;
  const canForce = req.user!.role === 'admin';
  if (force && canForce) return;
  throw conflict(`Trùng lượt thuê ${clashes.map((c) => c.label).join(', ')}.${canForce ? '' : ' Nhờ quản trị xử lý.'}`, 'block_overlaps_rental', { rentals: clashes, canForce });
}

export async function vehicleRoutes(app: FastifyInstance) {
  app.get('/api/vehicles', async (req) => {
    requireRole(req, 'staff');
    const { archived } = parse(z.object({ archived: z.enum(['0', '1']).default('0') }), req.query);
    const rows = db
      .select()
      .from(schema.vehicles)
      .where(archived === '1' ? isNotNull(schema.vehicles.archivedAt) : isNull(schema.vehicles.archivedAt))
      .orderBy(asc(schema.vehicles.plate))
      .all();
    const statuses = vehicleStatuses(rows);
    const acc = rows.length
      ? db
          .select({ vehicleId: schema.vehicleAccessories.vehicleId, name: schema.vehicleAccessories.name, showInShare: schema.vehicleAccessories.showInShare })
          .from(schema.vehicleAccessories)
          .where(and(inArray(schema.vehicleAccessories.vehicleId, rows.map((r) => r.id)), isNull(schema.vehicleAccessories.removedAt)))
          .orderBy(asc(schema.vehicleAccessories.sortOrder))
          .all()
      : [];
    return rows.map((v) => ({
      ...v,
      status: statuses.get(v.id),
      accessoryCount: acc.filter((a) => a.vehicleId === v.id).length,
      highlights: acc.filter((a) => a.vehicleId === v.id && a.showInShare).map((a) => a.name),
    }));
  });

  app.get('/api/vehicles/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const v = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).get();
    if (!v) throw notFound('Không tìm thấy xe');
    const rentals = db
      .select({ r: schema.rentals, c: { id: schema.customers.id, fullName: schema.customers.fullName, phone: schema.customers.phone } })
      .from(schema.rentals)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
      .where(eq(schema.rentals.vehicleId, id))
      .orderBy(desc(schema.rentals.scheduledStart))
      .limit(200)
      .all();
    const blocks = db.select().from(schema.vehicleBlocks).where(and(eq(schema.vehicleBlocks.vehicleId, id), isNull(schema.vehicleBlocks.voidedAt))).orderBy(desc(schema.vehicleBlocks.startAt)).all();
    const fines = db.select().from(schema.trafficFines).where(eq(schema.trafficFines.vehicleId, id)).orderBy(desc(schema.trafficFines.violatedAt)).all();
    const revenue = db
      .select({ total: sql<number>`COALESCE(SUM(${schema.charges.amount}), 0)` })
      .from(schema.charges)
      .innerJoin(schema.rentals, eq(schema.rentals.id, schema.charges.rentalId))
      .where(and(eq(schema.rentals.vehicleId, id), sql`${schema.rentals.status} != 'cancelled'`))
      .get();
    const lastReturn = db
      .select()
      .from(schema.handovers)
      .where(eq(schema.handovers.vehicleId, id))
      .orderBy(desc(schema.handovers.at))
      .get();
    return {
      vehicle: v,
      status: vehicleStatuses([v]).get(v.id),
      rentals: rentals.map((x) => ({ ...x.r, customer: x.c })),
      blocks,
      fines,
      accessories: vehicleAccessories(id),
      revenue: req.user!.role === 'admin' ? (revenue?.total ?? 0) : null,
      lastHandover: lastReturn ?? null,
    };
  });

  app.post('/api/vehicles', async (req) => {
    requireRole(req, 'admin');
    const body = parse(zVehicle, req.body);
    ensureOwnerInfo(body);
    const key = ensureUniquePlate(body.plate);
    const now = Date.now();
    const v = db
      .insert(schema.vehicles)
      .values({ ...body, plate: formatPlate(body.plate), plateKey: key, createdAt: now, updatedAt: now })
      .returning()
      .get();
    audit(req, 'vehicle.create', 'vehicle', v.id, { plate: v.plate });
    return v;
  });

  app.patch('/api/vehicles/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parsePatch(zVehicle, req.body);
    const before = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).get();
    if (!before) throw notFound('Không tìm thấy xe');
    ensureOwnerInfo({ ...before, ...body });
    if (body.ownerType === 'consigned' && before.ownerType !== 'consigned') {
      const viaApp = db
        .select({ code: schema.rentals.code })
        .from(schema.rentals)
        .where(and(eq(schema.rentals.vehicleId, id), inArray(schema.rentals.status, ['booked', 'active']), ne(schema.rentals.channel, 'direct')))
        .get();
      if (viaApp) throw badRequest(`Xe còn lượt ${viaApp.code} đặt qua Mioto, mà Mioto không cho phép xe ký gửi. Xong lượt đó mới chuyển xe sang ký gửi được`);
    }
    const patch: Partial<Vehicle> = { ...body, updatedAt: Date.now() };
    if (body.plate) {
      patch.plateKey = ensureUniquePlate(body.plate, id);
      patch.plate = formatPlate(body.plate);
    }
    const v = db.update(schema.vehicles).set(patch).where(eq(schema.vehicles.id, id)).returning().get();
    if (!v) throw notFound('Không tìm thấy xe');
    // Giao diện gửi cả form, nên chỉ ghi trường thực sự đổi kèm giá trị cũ và mới (đối chứng khi đổi tỷ lệ chia).
    const changes = (Object.keys(body) as (keyof Vehicle)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(v[k])).map((k) => ({ field: k, from: before[k], to: v[k] }));
    audit(req, 'vehicle.update', 'vehicle', id, { changes });
    return v;
  });

  app.post('/api/vehicles/:id/archive', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    // Gồm cả lượt chờ quyết toán, đang giữ cọc: trả xe cho chủ ký gửi rồi thì tiền và phạt nguội của lượt đó vẫn còn dở.
    const open = db
      .select({ code: schema.rentals.code })
      .from(schema.rentals)
      .where(and(eq(schema.rentals.vehicleId, id), inArray(schema.rentals.status, ['booked', 'active', 'returned', 'settled'])))
      .get();
    if (archived && open) throw badRequest(`Xe còn lượt ${open.code} chưa xong (đã đặt, đang thuê, chờ quyết toán hoặc đang giữ cọc), xử lý xong mới lưu trữ được`);
    const v = db
      .update(schema.vehicles)
      .set({ archivedAt: archived ? Date.now() : null, active: !archived, updatedAt: Date.now() })
      .where(eq(schema.vehicles.id, id))
      .returning()
      .get();
    audit(req, archived ? 'vehicle.archive' : 'vehicle.unarchive', 'vehicle', id);
    return v;
  });

  // ── Khoảng tạm ngưng (gara, chủ xe dùng) ────────────────────────────────

  const zBlock = z.object({
    kind: z.enum(BLOCK_KINDS),
    startAt: zMs,
    endAt: zMs.nullable().optional().transform((v) => v ?? null),
    location: zOptText,
    notes: zOptText,
  });

  app.post('/api/vehicles/:id/blocks', async (req) => {
    requireRole(req, 'staff');
    const vehicleId = idParam(req);
    const { force, ...body } = parse(zBlock.extend({ force: z.boolean().optional() }), req.body);
    if (body.endAt != null && body.endAt <= body.startAt) throw badRequest('Thời điểm kết thúc phải sau bắt đầu');
    const clashes = rentalClashes(vehicleId, body.startAt, body.endAt);
    assertNoRentalClash(req, clashes, force);
    const b = db
      .insert(schema.vehicleBlocks)
      .values({ ...body, vehicleId, createdBy: req.user!.id, createdAt: Date.now() })
      .returning()
      .get();
    audit(req, 'vehicle.block', 'vehicle', vehicleId, { ...body, overlapsRentals: clashes.map((c) => c.label) });
    return b;
  });

  app.patch('/api/blocks/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const { force, ...body } = parsePatch(zBlock.extend({ force: z.boolean().optional() }), req.body);
    const before = db.select().from(schema.vehicleBlocks).where(and(eq(schema.vehicleBlocks.id, id), isNull(schema.vehicleBlocks.voidedAt))).get();
    if (!before) throw notFound();
    // Chỉ xét lượt mới bị đè: kết thúc sớm một khoảng đã trùng từ trước vẫn phải làm được.
    const known = rentalClashes(before.vehicleId, before.startAt, before.endAt).map((c) => c.id);
    const clashes = rentalClashes(before.vehicleId, body.startAt ?? before.startAt, body.endAt !== undefined ? body.endAt : before.endAt).filter((c) => !known.includes(c.id));
    assertNoRentalClash(req, clashes, force);
    const b = db.update(schema.vehicleBlocks).set(body).where(eq(schema.vehicleBlocks.id, id)).returning().get();
    if (!b) throw notFound();
    audit(req, 'vehicle.block_update', 'vehicle', b.vehicleId, { before, after: body, overlapsRentals: clashes.map((c) => c.label) });
    return b;
  });

  app.delete('/api/blocks/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    // Không xóa: khoảng này là bằng chứng ai giữ xe khi có phạt nguội.
    const { reason } = parse(z.object({ reason: zOptText }), req.body ?? {});
    const b = db
      .update(schema.vehicleBlocks)
      .set({ voidedAt: Date.now(), voidReason: reason })
      .where(and(eq(schema.vehicleBlocks.id, id), isNull(schema.vehicleBlocks.voidedAt)))
      .returning()
      .get();
    if (b) audit(req, 'vehicle.block_void', 'vehicle', b.vehicleId, b);
    return { ok: true };
  });
}
