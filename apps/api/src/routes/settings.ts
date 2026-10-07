import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { DOCX_MIME, saveBinary } from '../lib/files.js';
import { badRequest, idParam, notFound, parse, requireRole, zMoney } from '../lib/http.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { builtinTemplatePath, TEMPLATE_FIELDS, validateTemplate } from '../services/documents.js';
import { DEFAULT_PICKUP_TIME } from '../shared/booking.js';
import { TEMPLATE_KINDS } from '../shared/constants.js';
import { BANKS } from '../shared/vietqr.js';
import fs from 'node:fs';

const zStr = (max = 300) => z.string().trim().max(max).default('');

const zBusiness = z.object({
  name: zStr(200),
  representative: zStr(120),
  position: zStr(80),
  idNumber: zStr(20),
  idIssueDate: zStr(10),
  idIssuePlace: zStr(200),
  phone: zStr(40),
  email: zStr(120),
  address: zStr(300),
  taxCode: zStr(20),
  bankBin: zStr(10),
  bankName: zStr(80),
  bankAccount: zStr(30),
  bankAccountName: zStr(120),
  signCity: zStr(80),
  shareNote: zStr(500),
});

const zRules = z.object({
  weekendDays: z.array(z.number().int().min(0).max(6)).max(7),
  hourlyMaxHours: z.coerce.number().int().min(0).max(23),
  graceMinutes: z.coerce.number().int().min(0).max(600),
  holidays: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        surchargePct: z.coerce.number().int().min(0).max(500),
      }),
    )
    .max(100),
  bufferMinutes: z.coerce.number().int().min(0).max(24 * 60),
  defaultPickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ nhận mặc định phải dạng HH:mm').default(DEFAULT_PICKUP_TIME),
  fineHoldAmount: zMoney,
  fineHoldDays: z.coerce.number().int().min(0).max(365),
  minDriverAge: z.coerce.number().int().min(0).max(99),
  checklist: z.array(z.string().trim().min(1).max(120)).max(40),
  deliveryFeeDefault: zMoney,
  cancelNoticeHours: z.coerce.number().int().min(0).max(24 * 60).default(72),
  cancelForfeitPct: z.coerce.number().int().min(0).max(100).default(100),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (req) => {
    requireRole(req, 'staff');
    return { business: getSetting('business'), rules: getSetting('rules'), banks: BANKS };
  });

  app.put('/api/settings/business', async (req) => {
    requireRole(req, 'admin');
    const body = parse(zBusiness, req.body);
    setSetting('business', body);
    audit(req, 'settings.business', 'settings', 'business');
    return body;
  });

  app.put('/api/settings/rules', async (req) => {
    requireRole(req, 'admin');
    const body = parse(zRules, req.body);
    for (const h of body.holidays) if (h.to < h.from) throw badRequest(`Kỳ lễ "${h.name}": ngày kết thúc trước ngày bắt đầu`);
    setSetting('rules', body);
    audit(req, 'settings.rules', 'settings', 'rules', body);
    return body;
  });

  // ── Mẫu hợp đồng ──────────────────────────────────────────────────────────

  app.get('/api/templates', async (req) => {
    requireRole(req, 'staff');
    return db.select().from(schema.contractTemplates).orderBy(asc(schema.contractTemplates.kind), asc(schema.contractTemplates.id)).all();
  });

  app.get('/api/templates/fields', async (req) => {
    requireRole(req, 'staff');
    return TEMPLATE_FIELDS;
  });

  /** Tải mẫu dựng sẵn gốc (để mở bằng Word, sửa rồi tải lên lại). */
  app.get('/api/templates/builtin/:file', async (req, reply) => {
    requireRole(req, 'staff');
    const { file } = req.params as { file: string };
    if (!/^[a-z0-9-]+\.docx$/.test(file)) throw badRequest('Tên file không hợp lệ');
    const p = builtinTemplatePath(file);
    if (!fs.existsSync(p)) throw notFound();
    reply.header('content-type', DOCX_MIME);
    reply.header('content-disposition', `attachment; filename="${file}"`);
    return reply.send(fs.createReadStream(p));
  });

  /** Tải mẫu mới (multipart: file .docx, name, kind) hoặc thay file cho mẫu có sẵn (templateId). */
  app.post('/api/templates', async (req) => {
    requireRole(req, 'admin');
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!part) throw badRequest('Chưa chọn file .docx');
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    if (!part.filename.toLowerCase().endsWith('.docx')) throw badRequest('Chỉ nhận file Word .docx (không nhận .doc cũ)');
    const buf = await part.toBuffer();
    validateTemplate(buf);
    const file = saveBinary(buf, DOCX_MIME, { kind: 'template', originalName: part.filename, userId: req.user!.id });
    const now = Date.now();
    const templateId = Number(fields.templateId?.value);
    if (templateId) {
      const t = db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, templateId)).get();
      if (!t) throw notFound('Không tìm thấy mẫu');
      const updated = db
        .update(schema.contractTemplates)
        .set({ fileId: file.id, version: t.version + 1, builtin: t.builtin ? t.builtin.replace(/-v\d+$/, '-user') : null, updatedAt: now })
        .where(eq(schema.contractTemplates.id, templateId))
        .returning()
        .get();
      audit(req, 'template.new_version', 'template', templateId, { version: updated.version });
      return updated;
    }
    const kind = parse(z.enum(TEMPLATE_KINDS), fields.kind?.value ?? 'contract');
    const name = (fields.name?.value ?? part.filename.replace(/\.docx$/i, '')).trim().slice(0, 120) || 'Mẫu mới';
    const t = db
      .insert(schema.contractTemplates)
      .values({ name, kind, fileId: file.id, version: 1, isDefault: false, active: true, createdAt: now, updatedAt: now })
      .returning()
      .get();
    audit(req, 'template.create', 'template', t.id, { name, kind });
    return t;
  });

  app.patch('/api/templates/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), isDefault: z.boolean().optional(), active: z.boolean().optional(), notes: z.string().max(500).optional() }), req.body);
    const t = db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, id)).get();
    if (!t) throw notFound('Không tìm thấy mẫu');
    db.transaction(() => {
      if (body.isDefault) {
        db.update(schema.contractTemplates).set({ isDefault: false }).where(eq(schema.contractTemplates.kind, t.kind)).run();
      }
      db.update(schema.contractTemplates).set({ ...body, updatedAt: Date.now() }).where(eq(schema.contractTemplates.id, id)).run();
    });
    audit(req, 'template.update', 'template', id, body);
    return db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, id)).get();
  });
}
