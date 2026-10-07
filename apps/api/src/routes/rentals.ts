import { and, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { Rental } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { badRequest, idParam, notFound, parse, requireRole, userId, zFileId, zMoney, zMs, zOptText, zSignedMoney } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import { escapeHtml, notify } from '../lib/telegram.js';
import { defaultTemplate, generateDocument, getTemplate, retryPdf } from '../services/documents.js';
import {
  addCharge,
  addCollateral,
  addPayment,
  cancelRental,
  createRental,
  driverWarnings,
  findConflicts,
  getCustomer,
  getRental,
  getVehicle,
  occupiedRange,
  pickup,
  quoteFor,
  releaseHold,
  rentalDetail,
  rentalMoney,
  rentalPricing,
  returnVehicle,
  settle,
  updateRental,
} from '../services/rentals.js';
import { CHARGE_KINDS, COLLATERAL_KINDS, TEMPLATE_KINDS, type RentalStatus } from '../shared/constants.js';
import { summarizeMoney } from '../shared/money.js';
import { overKmCharge, overtimeCharge } from '../shared/pricing.js';
import { plateKey, unaccent } from '../shared/text.js';
import { fmtDateTime } from '../shared/time.js';

const zPaymentIn = z.object({
  purpose: z.enum(['rent', 'deposit']),
  method: z.enum(['cash', 'transfer']),
  amount: zMoney.refine((n) => n > 0, 'số tiền phải lớn hơn 0'),
  note: zOptText,
});

const zCollateral = z.object({
  kind: z.enum(COLLATERAL_KINDS),
  description: z.string().trim().min(1, 'mô tả tài sản').max(500),
  photoFileIds: z.array(z.string().uuid()).default([]),
  notes: zOptText,
});

const zCharge = z.object({
  kind: z.enum(CHARGE_KINDS),
  description: z.string().trim().min(1).max(300),
  amount: zSignedMoney,
});

const zHandover = z.object({
  at: zMs,
  odo: z.coerce.number().int().min(0),
  fuelLevel: z.coerce.number().int().min(0).max(100),
  checklist: z.record(z.string(), z.boolean()).default({}),
  photos: z.array(z.object({ slot: z.string().max(40), fileId: z.string().uuid() })).default([]),
  damages: z
    .array(z.object({ zone: z.string().max(60), note: z.string().max(500), fileId: zFileId, isNew: z.boolean().optional() }))
    .default([]),
  accessories: z
    .array(
      z.object({
        id: z.number().int().nullable(),
        name: z.string().trim().min(1).max(80),
        quantity: z.coerce.number().int().min(0).max(99),
        value: z.coerce.number().int().min(0).default(0),
        present: z.boolean(),
        note: zOptText,
      }),
    )
    .max(100)
    .default([]),
  notes: zOptText,
  signatureFileId: zFileId,
});

const STATUS_GROUPS: Record<string, RentalStatus[]> = {
  open: ['booked', 'active'],
  booked: ['booked'],
  active: ['active'],
  returned: ['returned', 'settled'],
  closed: ['closed'],
  cancelled: ['cancelled'],
};

export async function rentalRoutes(app: FastifyInstance) {
  app.get('/api/rentals', async (req) => {
    requireRole(req, 'staff');
    const q = parse(
      z.object({
        status: z.string().default('all'),
        q: z.string().optional(),
        vehicleId: z.coerce.number().int().optional(),
        customerId: z.coerce.number().int().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );
    const conds: (SQL | undefined)[] = [];
    if (STATUS_GROUPS[q.status]) conds.push(inArray(schema.rentals.status, STATUS_GROUPS[q.status]));
    if (q.vehicleId) conds.push(eq(schema.rentals.vehicleId, q.vehicleId));
    if (q.customerId) conds.push(eq(schema.rentals.customerId, q.customerId));
    if (q.q?.trim()) {
      const term = `%${unaccent(q.q.trim())}%`;
      const key = plateKey(q.q);
      conds.push(
        or(
          sql`unaccent(${schema.customers.fullName}) LIKE ${term}`,
          sql`lower(${schema.rentals.code}) LIKE ${term}`,
          key.length >= 3 ? sql`${schema.vehicles.plateKey} LIKE ${'%' + key + '%'}` : undefined,
          sql`${schema.customers.phone} LIKE ${term}`,
        ),
      );
    }
    const where = and(...conds);
    const base = db
      .select({ r: schema.rentals, c: { id: schema.customers.id, fullName: schema.customers.fullName, phone: schema.customers.phone }, v: { id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model } })
      .from(schema.rentals)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
      .where(where);
    const total =
      db
        .select({ n: count() })
        .from(schema.rentals)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
        .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
        .where(where)
        .get()?.n ?? 0;
    const order = q.status === 'open' || q.status === 'booked' ? sql`${schema.rentals.scheduledStart} ASC` : sql`${schema.rentals.scheduledStart} DESC`;
    const rows = base.orderBy(order).limit(q.limit).offset((q.page - 1) * q.limit).all();
    const ids = rows.map((x) => x.r.id);
    const charges = ids.length ? db.select().from(schema.charges).where(inArray(schema.charges.rentalId, ids)).all() : [];
    const payments = ids.length ? db.select().from(schema.payments).where(inArray(schema.payments.rentalId, ids)).all() : [];
    return {
      total,
      items: rows.map(({ r, c, v }) => ({
        ...r,
        customer: c,
        vehicle: v,
        money: summarizeMoney(
          charges.filter((x) => x.rentalId === r.id),
          payments.filter((x) => x.rentalId === r.id),
        ),
      })),
    };
  });

  /** Kiểm tra trước khi đặt: báo giá + trùng lịch + cảnh báo người lái. Gọi liên tục khi điền form. */
  app.post('/api/rentals/precheck', async (req) => {
    requireRole(req, 'staff');
    const body = parse(
      z.object({
        vehicleId: z.number().int(),
        customerId: z.number().int().nullable().optional(),
        driverIds: z.array(z.number().int()).default([]),
        scheduledStart: zMs,
        scheduledEnd: zMs,
        excludeRentalId: z.number().int().optional(),
      }),
      req.body,
    );
    if (body.scheduledEnd <= body.scheduledStart) throw badRequest('Giờ trả phải sau giờ nhận');
    const vehicle = getVehicle(body.vehicleId);
    let pricing = vehicle;
    if (body.excludeRentalId) {
      const r = getRental(body.excludeRentalId);
      if (r.vehicleId === vehicle.id) pricing = { ...vehicle, ...rentalPricing(r) };
    }
    const quote = quoteFor(pricing, body.scheduledStart, body.scheduledEnd);
    const conflicts = findConflicts(vehicle.id, body.scheduledStart, body.scheduledEnd, body.excludeRentalId);
    const people = [body.customerId, ...body.driverIds].filter((x): x is number => !!x);
    const warnings = people.flatMap((id, i) => driverWarnings(getCustomer(id), body.scheduledStart, i === 0 ? 'Khách' : 'Lái phụ'));
    if (!vehicle.active) warnings.unshift({ code: 'vehicle_inactive', severity: 'danger', message: 'Xe đang ngưng hoạt động' });
    return { quote, conflicts, warnings, depositSuggested: vehicle.depositAmount };
  });

  app.post('/api/rentals', async (req) => {
    requireRole(req, 'staff');
    const body = parse(
      z.object({
        customerId: z.number().int(),
        vehicleId: z.number().int(),
        scheduledStart: zMs,
        scheduledEnd: zMs,
        pickupMethod: z.enum(['at_shop', 'delivery']).default('at_shop'),
        pickupLocation: zOptText,
        returnLocation: zOptText,
        deliveryFee: zMoney.default(0),
        discount: zMoney.default(0),
        discountNote: zOptText,
        depositRequired: zMoney.default(0),
        driverIds: z.array(z.number().int()).default([]),
        notes: zOptText,
        payments: z.array(zPaymentIn).default([]),
        collaterals: z.array(zCollateral).default([]),
        allowConflict: z.boolean().default(false),
        allowBlacklisted: z.boolean().default(false),
      }),
      req.body,
    );
    if (body.allowBlacklisted) requireRole(req, 'admin');
    const r = createRental(body, userId(req));
    audit(req, 'rental.create', 'rental', r.id, { code: r.code });
    const c = getCustomer(r.customerId);
    const v = getVehicle(r.vehicleId);
    notify(`🆕 <b>Đặt xe ${escapeHtml(r.code)}</b>\n${escapeHtml(v.plate)} · ${escapeHtml(c.fullName)}\n${fmtDateTime(r.scheduledStart)} → ${fmtDateTime(r.scheduledEnd)}\nBởi ${escapeHtml(req.user!.displayName)}`);
    return r;
  });

  app.get('/api/rentals/:id', async (req) => {
    requireRole(req, 'staff');
    return rentalDetail(idParam(req));
  });

  app.patch('/api/rentals/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(
      z.object({
        vehicleId: z.number().int().optional(),
        scheduledStart: zMs.optional(),
        scheduledEnd: zMs.optional(),
        pickupMethod: z.enum(['at_shop', 'delivery']).optional(),
        pickupLocation: zOptText,
        returnLocation: zOptText,
        depositRequired: zMoney.optional(),
        notes: zOptText,
        allowConflict: z.boolean().optional(),
      }),
      req.body,
    );
    const before = getRental(id);
    const r = updateRental(id, body, userId(req));
    audit(req, 'rental.update', 'rental', id, {
      changes: Object.fromEntries(
        Object.entries(body)
          .filter(([k]) => k !== 'allowConflict')
          .map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k], to: v }]),
      ),
    });
    return r;
  });

  app.post('/api/rentals/:id/pickup', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zHandover.extend({ payments: z.array(zPaymentIn).default([]), collaterals: z.array(zCollateral).default([]) }), req.body);
    const r = pickup(id, body, userId(req));
    audit(req, 'rental.pickup', 'rental', id, { at: body.at, odo: body.odo });
    const c = getCustomer(r.customerId);
    const v = getVehicle(r.vehicleId);
    notify(`🚗 <b>Đã giao xe</b> ${escapeHtml(v.plate)} · ${escapeHtml(r.code)}\n${escapeHtml(c.fullName)} · hẹn trả ${fmtDateTime(r.scheduledEnd)}`);
    return r;
  });

  /** Gợi ý phụ phí khi nhận xe: trễ giờ, vượt km. Người dùng xem rồi sửa trước khi lưu. */
  app.post('/api/rentals/:id/return-preview', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(z.object({ at: zMs, odo: z.coerce.number().int().min(0) }), req.body);
    const r = getRental(id);
    const pricing = rentalPricing(r);
    const rules = getSetting('rules');
    const pickupHo = db
      .select()
      .from(schema.handovers)
      .where(and(eq(schema.handovers.rentalId, id), eq(schema.handovers.kind, 'pickup')))
      .orderBy(desc(schema.handovers.at))
      .get();
    const suggestions = [
      overtimeCharge(r.scheduledEnd, body.at, pricing, rules),
      pickupHo ? overKmCharge(pickupHo.odo, body.odo, r.kmLimit, pricing.overKmFee) : null,
    ].filter(Boolean);
    return { suggestions, kmDriven: pickupHo ? body.odo - pickupHo.odo : null, kmLimit: r.kmLimit, pickup: pickupHo ?? null };
  });

  app.post('/api/rentals/:id/return', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zHandover.extend({ charges: z.array(zCharge).default([]) }), req.body);
    const r = returnVehicle(id, body, userId(req));
    audit(req, 'rental.return', 'rental', id, { at: body.at, odo: body.odo, charges: body.charges });
    const c = getCustomer(r.customerId);
    const v = getVehicle(r.vehicleId);
    const newDamages = body.damages.filter((d) => d.isNew);
    notify(
      `🅿️ <b>Đã nhận lại xe</b> ${escapeHtml(v.plate)} · ${escapeHtml(r.code)}\n${escapeHtml(c.fullName)}${newDamages.length ? `\n⚠️ ${newDamages.length} hư hỏng mới` : ''}`,
    );
    return r;
  });

  app.post('/api/rentals/:id/settle', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const zMove = z.object({ amount: zMoney, method: z.enum(['cash', 'transfer']) }).nullable().default(null);
    const body = parse(
      z.object({
        collect: zMove,
        refundRent: zMove,
        offset: zMoney.default(0),
        refundDeposit: zMove,
        fineHoldDays: z.coerce.number().int().min(0).max(365).default(getSetting('rules').fineHoldDays),
        returnCollaterals: z.boolean().default(true),
        note: zOptText,
      }),
      req.body,
    );
    const r = settle(id, body, userId(req));
    audit(req, 'rental.settle', 'rental', id, body);
    return r;
  });

  app.post('/api/rentals/:id/release-hold', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(
      z.object({
        deductions: z.array(zCharge).default([]),
        refund: z.object({ method: z.enum(['cash', 'transfer']) }).nullable().default(null),
        note: zOptText,
      }),
      req.body,
    );
    const r = releaseHold(id, body, userId(req));
    audit(req, 'rental.release_hold', 'rental', id, body);
    return r;
  });

  app.post('/api/rentals/:id/cancel', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(
      z.object({
        reason: z.string().trim().min(2, 'nhập lý do hủy').max(500),
        keep: zMoney.default(0),
        refund: z.object({ method: z.enum(['cash', 'transfer']) }).nullable().default(null),
      }),
      req.body,
    );
    const { rental, removedCharges } = cancelRental(id, body, userId(req));
    audit(req, 'rental.cancel', 'rental', id, { ...body, removedCharges });
    return rental;
  });

  // ── Tiền ─────────────────────────────────────────────────────────────────

  app.post('/api/rentals/:id/payments', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(
      z.object({
        direction: z.enum(['in', 'out', 'offset']),
        purpose: z.enum(['rent', 'deposit']),
        method: z.enum(['cash', 'transfer', 'offset']),
        amount: zMoney.refine((n) => n > 0, 'số tiền phải lớn hơn 0'),
        at: zMs.optional(),
        note: zOptText,
      }),
      req.body,
    );
    const r = getRental(id);
    if (r.status === 'cancelled' && body.direction === 'in') throw badRequest('Lượt thuê đã hủy');
    const p = addPayment(id, body, userId(req));
    const money = rentalMoney(id);
    if (money.depositHeld < 0) {
      db.delete(schema.payments).where(eq(schema.payments.id, p.id)).run();
      throw badRequest('Số tiền vượt quá tiền cọc đang giữ');
    }
    audit(req, 'payment.add', 'rental', id, body);
    return p;
  });

  app.post('/api/payments/:id/void', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(2, 'nhập lý do').max(300) }), req.body);
    const p = db.update(schema.payments).set({ voidedAt: Date.now(), voidReason: reason }).where(and(eq(schema.payments.id, id), isNull(schema.payments.voidedAt))).returning().get();
    if (!p) throw notFound('Không tìm thấy phiếu');
    audit(req, 'payment.void', 'rental', p.rentalId, { paymentId: id, reason, amount: p.amount });
    return p;
  });

  app.post('/api/rentals/:id/charges', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zCharge, req.body);
    const r = getRental(id);
    if (r.status === 'closed' || r.status === 'cancelled') requireRole(req, 'admin');
    const c = addCharge(id, body, userId(req));
    audit(req, 'charge.add', 'rental', id, body);
    return c;
  });

  app.delete('/api/charges/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const c = db.select().from(schema.charges).where(eq(schema.charges.id, id)).get();
    if (!c) throw notFound();
    const r = getRental(c.rentalId);
    if (!['booked', 'active', 'returned'].includes(r.status)) requireRole(req, 'admin');
    db.delete(schema.charges).where(eq(schema.charges.id, id)).run();
    audit(req, 'charge.delete', 'rental', c.rentalId, c);
    return { ok: true };
  });

  // ── Lái phụ & tài sản thế chấp ─────────────────────────────────────────────

  app.post('/api/rentals/:id/drivers', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const { customerId } = parse(z.object({ customerId: z.number().int() }), req.body);
    const r = getRental(id);
    if (customerId === r.customerId) throw badRequest('Người thuê đã là lái chính');
    getCustomer(customerId);
    db.insert(schema.rentalDrivers).values({ rentalId: id, customerId }).onConflictDoNothing().run();
    audit(req, 'rental.driver_add', 'rental', id, { customerId });
    return { ok: true };
  });

  app.delete('/api/rentals/:id/drivers/:customerId', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const customerId = Number((req.params as { customerId: string }).customerId);
    db.delete(schema.rentalDrivers).where(and(eq(schema.rentalDrivers.rentalId, id), eq(schema.rentalDrivers.customerId, customerId))).run();
    audit(req, 'rental.driver_remove', 'rental', id, { customerId });
    return { ok: true };
  });

  app.post('/api/rentals/:id/collaterals', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zCollateral, req.body);
    getRental(id);
    const c = addCollateral(id, body, userId(req));
    audit(req, 'collateral.add', 'rental', id, body);
    return c;
  });

  app.patch('/api/collaterals/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const { returned } = parse(z.object({ returned: z.boolean() }), req.body);
    const c = db.update(schema.collaterals).set({ returnedAt: returned ? Date.now() : null }).where(eq(schema.collaterals.id, id)).returning().get();
    if (!c) throw notFound();
    audit(req, returned ? 'collateral.return' : 'collateral.unreturn', 'rental', c.rentalId, { collateralId: id });
    return c;
  });

  // ── Văn bản ──────────────────────────────────────────────────────────────

  app.post('/api/rentals/:id/documents', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(z.object({ templateId: z.number().int().optional(), kind: z.enum(TEMPLATE_KINDS).optional() }), req.body);
    getRental(id);
    const tpl = body.templateId ? getTemplate(body.templateId) : defaultTemplate(body.kind ?? 'contract');
    if (!tpl) throw badRequest('Chưa có mẫu văn bản loại này. Thêm mẫu trong Cài đặt → Mẫu hợp đồng.');
    const result = await generateDocument(id, tpl.id, userId(req));
    audit(req, 'document.generate', 'rental', id, { documentId: result.document.id, template: tpl.name });
    return result;
  });

  app.post('/api/documents/:id/pdf', async (req) => {
    requireRole(req, 'staff');
    return retryPdf(idParam(req), userId(req));
  });

  app.post('/api/documents/:id/scans', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const { fileIds } = parse(z.object({ fileIds: z.array(z.string().uuid()).min(1) }), req.body);
    const doc = db.select().from(schema.documents).where(eq(schema.documents.id, id)).get();
    if (!doc) throw notFound();
    const updated = db
      .update(schema.documents)
      .set({ scanFileIds: [...doc.scanFileIds, ...fileIds] })
      .where(eq(schema.documents.id, id))
      .returning()
      .get();
    audit(req, 'document.scan_add', 'rental', doc.rentalId, { documentId: id, count: fileIds.length });
    return updated;
  });

  // ── Lịch ────────────────────────────────────────────────────────────────

  app.get('/api/calendar', async (req) => {
    requireRole(req, 'staff');
    const { from, to } = parse(z.object({ from: zMs, to: zMs }), req.query);
    const vehicles = db
      .select({ id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model, active: schema.vehicles.active, photoFileId: schema.vehicles.photoFileId })
      .from(schema.vehicles)
      .where(isNull(schema.vehicles.archivedAt))
      .orderBy(schema.vehicles.plate)
      .all();
    const rentals = db
      .select({ r: schema.rentals, c: { fullName: schema.customers.fullName } })
      .from(schema.rentals)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
      .where(
        and(
          sql`${schema.rentals.status} != 'cancelled'`,
          lte(sql`COALESCE(${schema.rentals.actualStart}, ${schema.rentals.scheduledStart})`, to),
          or(
            gte(sql`COALESCE(${schema.rentals.actualEnd}, ${schema.rentals.scheduledEnd})`, from),
            eq(schema.rentals.status, 'active'),
          ),
        ),
      )
      .all();
    const blocks = db
      .select()
      .from(schema.vehicleBlocks)
      .where(and(lte(schema.vehicleBlocks.startAt, to), or(isNull(schema.vehicleBlocks.endAt), gte(schema.vehicleBlocks.endAt, from))))
      .all();
    const now = Date.now();
    return {
      vehicles,
      items: [
        ...rentals.map(({ r, c }) => {
          const o = occupiedRange(r as Rental, now);
          return {
            type: 'rental' as const,
            id: r.id,
            vehicleId: r.vehicleId,
            status: r.status,
            code: r.code,
            label: c.fullName,
            start: o.start,
            end: o.end,
            scheduledEnd: r.scheduledEnd,
            overdue: r.status === 'active' && r.scheduledEnd < now,
          };
        }),
        ...blocks.map((b) => ({
          type: 'block' as const,
          id: b.id,
          vehicleId: b.vehicleId,
          status: b.kind,
          code: '',
          label: b.notes || b.location || 'Tạm ngưng',
          start: b.startAt,
          end: b.endAt ?? Math.max(now, to),
          scheduledEnd: b.endAt,
          overdue: false,
        })),
      ],
    };
  });

}
