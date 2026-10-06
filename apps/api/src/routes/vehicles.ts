import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { Vehicle } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, notFound, parse, requireRole, zDateKey, zFileId, zMoney, zMs, zOptText } from '../lib/http.js';
import { vehicleAccessories } from '../services/accessories.js';
import { occupiedRange } from '../services/rentals.js';
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
  inspectionExpiry: zDateKey,
  insuranceTndsExpiry: zDateKey,
  insuranceBodyExpiry: zDateKey,
  roadFeeExpiry: zDateKey,
  nextServiceOdo: z.coerce.number().int().min(0).nullable().optional(),
  nextServiceDate: zDateKey,
  photoFileId: zFileId,
  registrationFileId: zFileId,
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
    .where(and(inArray(schema.vehicleBlocks.vehicleId, ids), sql`${schema.vehicleBlocks.startAt} <= ${now}`, sql`(${schema.vehicleBlocks.endAt} IS NULL OR ${schema.vehicleBlocks.endAt} > ${now})`))
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
    const blocks = db.select().from(schema.vehicleBlocks).where(eq(schema.vehicleBlocks.vehicleId, id)).orderBy(desc(schema.vehicleBlocks.startAt)).all();
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
    const body = parse(zVehicle.partial(), req.body);
    const patch: Partial<Vehicle> = { ...body, updatedAt: Date.now() };
    if (body.plate) {
      patch.plateKey = ensureUniquePlate(body.plate, id);
      patch.plate = formatPlate(body.plate);
    }
    const v = db.update(schema.vehicles).set(patch).where(eq(schema.vehicles.id, id)).returning().get();
    if (!v) throw notFound('Không tìm thấy xe');
    audit(req, 'vehicle.update', 'vehicle', id, { fields: Object.keys(body) });
    return v;
  });

  app.post('/api/vehicles/:id/archive', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    const open = db
      .select({ id: schema.rentals.id })
      .from(schema.rentals)
      .where(and(eq(schema.rentals.vehicleId, id), inArray(schema.rentals.status, ['booked', 'active'])))
      .get();
    if (archived && open) throw badRequest('Xe còn lượt thuê đang mở, không lưu trữ được');
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
    const body = parse(zBlock, req.body);
    if (body.endAt != null && body.endAt <= body.startAt) throw badRequest('Thời điểm kết thúc phải sau bắt đầu');
    const b = db
      .insert(schema.vehicleBlocks)
      .values({ ...body, vehicleId, createdBy: req.user!.id, createdAt: Date.now() })
      .returning()
      .get();
    audit(req, 'vehicle.block', 'vehicle', vehicleId, body);
    return b;
  });

  app.patch('/api/blocks/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zBlock.partial(), req.body);
    const b = db.update(schema.vehicleBlocks).set(body).where(eq(schema.vehicleBlocks.id, id)).returning().get();
    if (!b) throw notFound();
    audit(req, 'vehicle.block_update', 'vehicle', b.vehicleId, body);
    return b;
  });

  app.delete('/api/blocks/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const b = db.delete(schema.vehicleBlocks).where(eq(schema.vehicleBlocks.id, id)).returning().get();
    if (b) audit(req, 'vehicle.block_delete', 'vehicle', b.vehicleId, b);
    return { ok: true };
  });
}
