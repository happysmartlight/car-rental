import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, idParam, notFound, parse, requireRole, userId, zFileId, zMs, zOptText } from '../lib/http.js';
import { getLocalConfig, updateLocalConfig } from '../lib/localConfig.js';
import { checkProvider, matchViolations, parseViolationText, runFleetFineCheck } from '../services/fineCheck.js';
import { lookupFine, recordFine } from '../services/fines.js';
import { FINE_SOURCES, FINE_STATUSES } from '../shared/constants.js';
import { formatPlate, plateKey } from '../shared/text.js';

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
    const f = recordFine(body, userId(req));
    audit(req, 'fine.create', 'fine', f.id, { plate: f.plate, rentalId: f.rentalId, customerId: f.customerId });
    return f;
  });

  /** Kiểm tra theo biển số qua dịch vụ tra cứu — không cần biết giờ vi phạm. */
  app.post('/api/fines/check', async (req) => {
    requireRole(req, 'staff');
    const { plate } = parse(z.object({ plate: z.string().trim().min(4).max(20) }), req.body);
    const r = await checkProvider(plate);
    audit(req, 'fine.check', 'vehicle', null, { plate, ok: r.ok, found: r.ok ? r.violations.length : null });
    if (!r.ok) return { ok: false, error: r.error, plate, violations: [] };
    return { ok: true, plate, checkedAt: Date.now(), violations: matchViolations(plate, r.violations) };
  });

  /** Đọc kết quả người dùng chép từ trang tra cứu chính thức / VNeTraffic. */
  app.post('/api/fines/parse', async (req) => {
    requireRole(req, 'staff');
    const { plate, text } = parse(z.object({ plate: z.string().trim().min(4).max(20), text: z.string().min(5).max(50_000) }), req.body);
    const found = parseViolationText(text, plate);
    if (!found.length) throw badRequest('Không đọc được vi phạm nào. Chép cả phần có "Thời gian vi phạm" rồi dán lại.');
    return { ok: true, plate, violations: matchViolations(plate, found) };
  });

  /** Ghi nhiều vi phạm tìm được vào hồ sơ (bỏ qua cái đã có). */
  app.post('/api/fines/record', async (req) => {
    requireRole(req, 'staff');
    const body = parse(
      z.object({
        plate: z.string().trim().min(4).max(20),
        items: z
          .array(
            z.object({
              violatedAt: zMs,
              location: zOptText,
              violation: zOptText,
              statusText: zOptText,
              unit: zOptText,
            }),
          )
          .min(1)
          .max(50),
      }),
      req.body,
    );
    const already = matchViolations(
      body.plate,
      body.items.map((i) => ({ plate: body.plate, violatedAt: i.violatedAt, timeText: '', location: null, violation: null, status: 'unknown', statusText: null, unit: null, resolvePlaces: [] })),
    );
    const created = [];
    const ids: number[] = [];
    for (let i = 0; i < body.items.length; i++) {
      if (already[i].recordedFineId) {
        ids.push(already[i].recordedFineId!);
        continue;
      }
      const it = body.items[i];
      const f = recordFine(
        { plate: body.plate, violatedAt: it.violatedAt, location: it.location, violation: it.violation, source: 'csgt', notes: [it.statusText, it.unit && `Phát hiện: ${it.unit}`].filter(Boolean).join(' · ') || null },
        userId(req),
      );
      created.push(f);
      ids.push(f.id);
    }
    audit(req, 'fine.record_batch', 'vehicle', null, { plate: body.plate, created: created.length });
    return { created: created.length, skipped: body.items.length - created.length, ids };
  });

  app.get('/api/fines/auto-check', async (req) => {
    requireRole(req, 'staff');
    return getLocalConfig().fineCheck;
  });

  app.put('/api/fines/auto-check', async (req) => {
    requireRole(req, 'admin');
    const { frequency } = parse(z.object({ frequency: z.enum(['off', 'daily', 'weekly']) }), req.body);
    updateLocalConfig((c) => {
      c.fineCheck.frequency = frequency;
    });
    audit(req, 'fine.auto_check_config', 'system', null, { frequency });
    return getLocalConfig().fineCheck;
  });

  app.post('/api/fines/auto-check/run', async (req) => {
    requireRole(req, 'admin');
    return runFleetFineCheck(userId(req));
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
