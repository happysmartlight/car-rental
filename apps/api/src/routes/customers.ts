import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { Customer } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { conflict, idParam, notFound, parse, requireRole, zDateKey, zFileId, zOptText } from '../lib/http.js';
import { driverWarnings } from '../services/rentals.js';
import { unaccent } from '../shared/text.js';

const zCustomer = z.object({
  fullName: z.string().trim().min(2, 'nhập họ tên').max(120),
  idNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{6,20}$/, 'số giấy tờ chỉ gồm chữ/số')
    .nullable()
    .optional()
    .transform((v) => v || null),
  oldIdNumber: zOptText,
  idCardType: z.enum(['cccd_chip', 'can_cuoc', 'cccd', 'cmnd', 'passport', 'other']).nullable().optional(),
  dob: zDateKey,
  gender: zOptText,
  idIssueDate: zDateKey,
  idIssuePlace: zOptText,
  permanentAddress: zOptText,
  currentAddress: zOptText,
  phone: zOptText,
  phone2: zOptText,
  zalo: zOptText,
  email: zOptText,
  occupation: zOptText,
  licenseNumber: zOptText,
  licenseClass: zOptText,
  licenseExpiry: zDateKey,
  emergencyName: zOptText,
  emergencyPhone: zOptText,
  emergencyRelation: zOptText,
  notes: zOptText,
  blacklisted: z.boolean().optional(),
  blacklistReason: zOptText,
  idFrontFileId: zFileId,
  idBackFileId: zFileId,
  licenseFrontFileId: zFileId,
  licenseBackFileId: zFileId,
  portraitFileId: zFileId,
});

export function customerSearchCondition(q: string) {
  const term = `%${unaccent(q.trim())}%`;
  const digits = q.replace(/\D/g, '');
  return or(
    sql`unaccent(${schema.customers.fullName}) LIKE ${term}`,
    digits.length >= 3 ? sql`${schema.customers.phone} LIKE ${'%' + digits + '%'}` : undefined,
    digits.length >= 3 ? sql`${schema.customers.idNumber} LIKE ${'%' + digits + '%'}` : undefined,
    sql`unaccent(${schema.customers.licenseNumber}) LIKE ${term}`,
  );
}

function findByIdNumber(idNumber: string, excludeId?: number): Customer | undefined {
  const c = db.select().from(schema.customers).where(eq(schema.customers.idNumber, idNumber)).get();
  return c && c.id !== excludeId ? c : undefined;
}

export async function customerRoutes(app: FastifyInstance) {
  app.get('/api/customers', async (req) => {
    requireRole(req, 'staff');
    const q = parse(
      z.object({
        q: z.string().optional(),
        filter: z.enum(['all', 'blacklisted', 'archived']).default('all'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );
    const conds = [
      q.q?.trim() ? customerSearchCondition(q.q) : undefined,
      q.filter === 'archived' ? isNotNull(schema.customers.archivedAt) : isNull(schema.customers.archivedAt),
      q.filter === 'blacklisted' ? eq(schema.customers.blacklisted, true) : undefined,
    ];
    const where = and(...conds);
    const total = db.select({ n: count() }).from(schema.customers).where(where).get()?.n ?? 0;
    const rows = db
      .select()
      .from(schema.customers)
      .where(where)
      .orderBy(desc(schema.customers.updatedAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .all();
    const ids = rows.map((r) => r.id);
    const stats = ids.length
      ? db
          .select({ customerId: schema.rentals.customerId, n: count(), last: sql<number>`MAX(${schema.rentals.scheduledStart})` })
          .from(schema.rentals)
          .where(and(inArray(schema.rentals.customerId, ids), sql`${schema.rentals.status} != 'cancelled'`))
          .groupBy(schema.rentals.customerId)
          .all()
      : [];
    const byId = new Map(stats.map((s) => [s.customerId, s]));
    return {
      total,
      items: rows.map((c) => ({ ...c, rentalCount: byId.get(c.id)?.n ?? 0, lastRentalAt: byId.get(c.id)?.last ?? null })),
    };
  });

  /** Tra theo số CCCD vừa quét QR — đã có thì mở hồ sơ cũ. */
  app.get('/api/customers/lookup', async (req) => {
    requireRole(req, 'staff');
    const { idNumber } = parse(z.object({ idNumber: z.string().trim().min(6) }), req.query);
    const c = findByIdNumber(idNumber);
    return { customer: c ?? null, warnings: c ? driverWarnings(c, Date.now()) : [] };
  });

  app.get('/api/customers/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const customer = db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
    if (!customer) throw notFound('Không tìm thấy khách hàng');
    const asRenter = db
      .select({ r: schema.rentals, v: { id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model } })
      .from(schema.rentals)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
      .where(eq(schema.rentals.customerId, id))
      .orderBy(desc(schema.rentals.scheduledStart))
      .all();
    const asDriver = db
      .select({ r: schema.rentals, v: { id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model } })
      .from(schema.rentalDrivers)
      .innerJoin(schema.rentals, eq(schema.rentals.id, schema.rentalDrivers.rentalId))
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
      .where(eq(schema.rentalDrivers.customerId, id))
      .orderBy(desc(schema.rentals.scheduledStart))
      .all();
    const fines = db.select().from(schema.trafficFines).where(eq(schema.trafficFines.customerId, id)).orderBy(desc(schema.trafficFines.violatedAt)).all();
    const totals = db
      .select({ total: sql<number>`COALESCE(SUM(${schema.charges.amount}), 0)` })
      .from(schema.charges)
      .innerJoin(schema.rentals, eq(schema.rentals.id, schema.charges.rentalId))
      .where(and(eq(schema.rentals.customerId, id), sql`${schema.rentals.status} != 'cancelled'`))
      .get();
    return {
      customer,
      rentals: asRenter.map((x) => ({ ...x.r, vehicle: x.v, role: 'renter' as const })),
      asDriver: asDriver.map((x) => ({ ...x.r, vehicle: x.v, role: 'driver' as const })),
      fines,
      totalSpent: totals?.total ?? 0,
      warnings: driverWarnings(customer, Date.now()),
    };
  });

  app.post('/api/customers', async (req) => {
    requireRole(req, 'staff');
    const body = parse(zCustomer, req.body);
    if (body.idNumber) {
      const dup = findByIdNumber(body.idNumber);
      if (dup) throw conflict(`Số giấy tờ ${body.idNumber} đã có trong hồ sơ của ${dup.fullName}`, 'duplicate', { existingId: dup.id });
    }
    const now = Date.now();
    const c = db
      .insert(schema.customers)
      .values({ ...body, blacklisted: body.blacklisted ?? false, idCardType: body.idCardType ?? null, createdAt: now, updatedAt: now })
      .returning()
      .get();
    audit(req, 'customer.create', 'customer', c.id, { fullName: c.fullName });
    return c;
  });

  app.patch('/api/customers/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zCustomer.partial(), req.body);
    const before = db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
    if (!before) throw notFound('Không tìm thấy khách hàng');
    if (body.idNumber) {
      const dup = findByIdNumber(body.idNumber, id);
      if (dup) throw conflict(`Số giấy tờ ${body.idNumber} đã có trong hồ sơ của ${dup.fullName}`, 'duplicate', { existingId: dup.id });
    }
    if ((body.blacklisted !== undefined && body.blacklisted !== before.blacklisted) && req.user!.role !== 'admin') {
      requireRole(req, 'admin');
    }
    const c = db
      .update(schema.customers)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(schema.customers.id, id))
      .returning()
      .get();
    const changed = Object.keys(body).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((body as Record<string, unknown>)[k]));
    audit(req, 'customer.update', 'customer', id, { fields: changed });
    return c;
  });

  app.post('/api/customers/:id/archive', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    const c = db
      .update(schema.customers)
      .set({ archivedAt: archived ? Date.now() : null, updatedAt: Date.now() })
      .where(eq(schema.customers.id, id))
      .returning()
      .get();
    if (!c) throw notFound();
    audit(req, archived ? 'customer.archive' : 'customer.unarchive', 'customer', id);
    return c;
  });
}
