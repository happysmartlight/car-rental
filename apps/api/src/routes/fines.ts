import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { idParam, notFound, parse, requireRole, zFileId, zMs, zOptText } from '../lib/http.js';
import { escapeHtml, notify } from '../lib/telegram.js';
import { lookupFine } from '../services/fines.js';
import { FINE_SOURCES, FINE_STATUSES } from '../shared/constants.js';
import { fmtVnd, formatPlate, plateKey } from '../shared/text.js';
import { fmtDateTime } from '../shared/time.js';

const zFine = z.object({
  plate: z.string().trim().min(4).max(20),
  violatedAt: zMs,
  location: zOptText,
  violation: zOptText,
  amount: z.coerce.number().int().min(0).nullable().optional(),
  source: z.enum(FINE_SOURCES).default('csgt'),
  noticeFileId: zFileId,
  rentalId: z.number().int().nullable().optional(),
  customerId: z.number().int().nullable().optional(),
  status: z.enum(FINE_STATUSES).default('new'),
  notes: zOptText,
});

export async function fineRoutes(app: FastifyInstance) {
  app.get('/api/fines/lookup', async (req) => {
    requireRole(req, 'staff');
    const q = parse(z.object({ plate: z.string().trim().min(3), at: zMs }), req.query);
    const result = lookupFine(q.plate, q.at);
    audit(req, 'fine.lookup', 'vehicle', result.vehicle?.id ?? null, { plate: q.plate, at: q.at, verdict: result.verdict });
    return result;
  });

  app.get('/api/fines', async (req) => {
    requireRole(req, 'staff');
    const q = parse(z.object({ status: z.enum(['open', 'all', ...FINE_STATUSES]).default('open') }), req.query);
    const conds: SQL[] = [];
    if (q.status === 'open') conds.push(inArray(schema.trafficFines.status, ['new', 'notified', 'we_paid']));
    else if (q.status !== 'all') conds.push(eq(schema.trafficFines.status, q.status));
    const rows = db
      .select({ f: schema.trafficFines, c: { id: schema.customers.id, fullName: schema.customers.fullName, phone: schema.customers.phone }, r: { id: schema.rentals.id, code: schema.rentals.code } })
      .from(schema.trafficFines)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.trafficFines.customerId))
      .leftJoin(schema.rentals, eq(schema.rentals.id, schema.trafficFines.rentalId))
      .where(and(...conds))
      .orderBy(desc(schema.trafficFines.violatedAt))
      .limit(500)
      .all();
    const counts = db.select({ status: schema.trafficFines.status, n: count() }).from(schema.trafficFines).groupBy(schema.trafficFines.status).all();
    return { items: rows.map(({ f, c, r }) => ({ ...f, customer: c?.id ? c : null, rental: r?.id ? r : null })), counts };
  });

  app.post('/api/fines', async (req) => {
    requireRole(req, 'staff');
    const body = parse(zFine, req.body);
    const key = plateKey(body.plate);
    const vehicle = db.select().from(schema.vehicles).where(eq(schema.vehicles.plateKey, key)).get();
    // Chưa chỉ định lượt thuê → tự khớp nếu tra ra đúng một người.
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
      .values({ ...body, amount: body.amount ?? null, plate: vehicle?.plate ?? formatPlate(body.plate), plateKey: key, vehicleId: vehicle?.id ?? null, rentalId, customerId, createdBy: req.user!.id, createdAt: now, updatedAt: now })
      .returning()
      .get();
    audit(req, 'fine.create', 'fine', f.id, { plate: f.plate, rentalId, customerId });
    const who = customerId ? db.select().from(schema.customers).where(eq(schema.customers.id, customerId)).get() : null;
    notify(
      `🚨 <b>Phạt nguội mới</b> ${escapeHtml(f.plate)} lúc ${fmtDateTime(f.violatedAt)}\n${escapeHtml(f.violation ?? '')}${f.amount ? ` · ${fmtVnd(f.amount)}` : ''}\n${who ? `Người giữ xe: ${escapeHtml(who.fullName)} · ${escapeHtml(who.phone ?? '')}` : 'Chưa xác định người giữ xe'}`,
    );
    return f;
  });

  app.patch('/api/fines/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(zFine.partial(), req.body);
    const patch: Record<string, unknown> = { ...body, updatedAt: Date.now() };
    if (body.plate) {
      patch.plateKey = plateKey(body.plate);
      patch.plate = formatPlate(body.plate);
    }
    if (body.rentalId && body.customerId === undefined) {
      patch.customerId = db.select().from(schema.rentals).where(eq(schema.rentals.id, body.rentalId)).get()?.customerId ?? null;
    }
    const f = db.update(schema.trafficFines).set(patch).where(eq(schema.trafficFines.id, id)).returning().get();
    if (!f) throw notFound();
    audit(req, 'fine.update', 'fine', id, body);
    return f;
  });

  app.delete('/api/fines/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const f = db.delete(schema.trafficFines).where(eq(schema.trafficFines.id, id)).returning().get();
    if (f) audit(req, 'fine.delete', 'fine', id, f);
    return { ok: true };
  });
}
