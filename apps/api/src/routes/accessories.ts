import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, notFound, parse, requireRole, userId, zFileId, zOptText } from '../lib/http.js';
import {
  accessoryKey,
  addAccessories,
  applyToAllVehicles,
  copyAccessories,
  getCatalogItem,
  listCatalog,
  suggestAccessories,
  vehicleAccessories,
} from '../services/accessories.js';
import { getVehicle } from '../services/rentals.js';
import { ACCESSORY_CATEGORIES } from '../shared/constants.js';

const zValue = z.coerce.number().int().min(0).max(1_000_000_000);

export async function accessoryRoutes(app: FastifyInstance) {
  // ── Danh mục ─────────────────────────────────────────────────────────────

  app.get('/api/accessories/catalog', async (req) => {
    requireRole(req, 'staff');
    const { archived } = parse(z.object({ archived: z.enum(['0', '1']).default('0') }), req.query);
    return listCatalog(archived === '1');
  });

  const zCatalog = z.object({
    name: z.string().trim().min(2, 'tên tối thiểu 2 ký tự').max(80),
    aliases: zOptText,
    category: z.enum(ACCESSORY_CATEGORIES),
    defaultValue: zValue.default(0),
    highlight: z.boolean().default(false),
    essential: z.boolean().default(false),
    evOnly: z.boolean().default(false),
  });

  app.post('/api/accessories/catalog', async (req) => {
    requireRole(req, 'staff');
    const body = parse(zCatalog, req.body);
    const key = accessoryKey(body.name);
    const dup = db.select().from(schema.accessoryCatalog).where(eq(schema.accessoryCatalog.nameKey, key)).get();
    if (dup) throw conflict(`Danh mục đã có "${dup.name}"`, 'duplicate', { existingId: dup.id });
    const now = Date.now();
    const c = db
      .insert(schema.accessoryCatalog)
      .values({ ...body, nameKey: key, createdBy: userId(req), createdAt: now, updatedAt: now })
      .returning()
      .get();
    audit(req, 'accessory.catalog_create', 'accessory', c.id, { name: c.name });
    return c;
  });

  app.patch('/api/accessories/catalog/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parse(zCatalog.partial().extend({ archived: z.boolean().optional() }), req.body);
    const before = getCatalogItem(id);
    const patch: Partial<typeof before> = { updatedAt: Date.now() };
    for (const k of ['aliases', 'category', 'defaultValue', 'highlight', 'essential', 'evOnly'] as const) {
      if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
    }
    if (body.archived !== undefined) patch.archivedAt = body.archived ? Date.now() : null;
    if (body.name && body.name !== before.name) {
      const key = accessoryKey(body.name);
      const dup = db.select().from(schema.accessoryCatalog).where(eq(schema.accessoryCatalog.nameKey, key)).get();
      if (dup && dup.id !== id) throw conflict(`Danh mục đã có "${dup.name}"`, 'duplicate');
      patch.name = body.name;
      patch.nameKey = key;
    }
    const c = db.transaction(() => {
      const updated = db.update(schema.accessoryCatalog).set(patch).where(eq(schema.accessoryCatalog.id, id)).returning().get();
      // Đổi tên/nhóm trong danh mục → cập nhật luôn các xe đang dùng (biên bản cũ giữ tên cũ).
      if (patch.name || patch.category) {
        db.update(schema.vehicleAccessories)
          .set({ ...(patch.name ? { name: patch.name } : {}), ...(patch.category ? { category: patch.category } : {}), updatedAt: Date.now() })
          .where(and(eq(schema.vehicleAccessories.catalogId, id), isNull(schema.vehicleAccessories.removedAt)))
          .run();
      }
      return updated;
    });
    audit(req, 'accessory.catalog_update', 'accessory', id, body);
    return c;
  });

  app.post('/api/accessories/catalog/:id/apply-all', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const added = applyToAllVehicles(id, userId(req));
    audit(req, 'accessory.apply_all', 'accessory', id, { added });
    return { added };
  });

  // ── Phụ kiện từng xe ─────────────────────────────────────────────────────

  app.get('/api/vehicles/:id/accessories', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    getVehicle(id);
    const others = db
      .select({ id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model, n: sql<number>`COUNT(${schema.vehicleAccessories.id})` })
      .from(schema.vehicles)
      .innerJoin(schema.vehicleAccessories, and(eq(schema.vehicleAccessories.vehicleId, schema.vehicles.id), isNull(schema.vehicleAccessories.removedAt)))
      .where(and(isNull(schema.vehicles.archivedAt), sql`${schema.vehicles.id} != ${id}`))
      .groupBy(schema.vehicles.id)
      .all();
    return { items: vehicleAccessories(id), suggestions: suggestAccessories(id), catalog: listCatalog(), copySources: others };
  });

  app.post('/api/vehicles/:id/accessories', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(
      z.object({
        items: z
          .array(
            z.object({
              catalogId: z.number().int().nullable().optional(),
              name: z.string().trim().max(80).nullable().optional(),
              category: z.enum(ACCESSORY_CATEGORIES).optional(),
              quantity: z.coerce.number().int().min(1).max(99).optional(),
              note: zOptText,
              value: zValue.nullable().optional(),
            }),
          )
          .min(1)
          .max(60),
      }),
      req.body,
    );
    for (const it of body.items) if (!it.catalogId && !it.name) throw badRequest('Thiếu tên phụ kiện');
    const r = addAccessories(id, body.items, userId(req));
    audit(req, 'vehicle.accessory_add', 'vehicle', id, { added: r.added.map((a) => a.name), skipped: r.skipped });
    return r;
  });

  app.post('/api/vehicles/:id/accessories/copy', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const { fromVehicleId } = parse(z.object({ fromVehicleId: z.number().int() }), req.body);
    const r = copyAccessories(id, fromVehicleId, userId(req));
    audit(req, 'vehicle.accessory_copy', 'vehicle', id, { fromVehicleId, added: r.added.length });
    return r;
  });

  app.patch('/api/vehicle-accessories/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const body = parse(
      z.object({
        quantity: z.coerce.number().int().min(1).max(99).optional(),
        note: zOptText,
        value: zValue.nullable().optional(),
        checkOnHandover: z.boolean().optional(),
        showInShare: z.boolean().optional(),
        photoFileId: zFileId,
        sortOrder: z.number().int().optional(),
      }),
      req.body,
    );
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const a = db
      .update(schema.vehicleAccessories)
      .set({ ...patch, updatedAt: Date.now() })
      .where(and(eq(schema.vehicleAccessories.id, id), isNull(schema.vehicleAccessories.removedAt)))
      .returning()
      .get();
    if (!a) throw notFound('Không tìm thấy phụ kiện');
    audit(req, 'vehicle.accessory_update', 'vehicle', a.vehicleId, { accessory: a.name, ...body });
    return a;
  });

  app.delete('/api/vehicle-accessories/:id', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const a = db
      .update(schema.vehicleAccessories)
      .set({ removedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(schema.vehicleAccessories.id, id), isNull(schema.vehicleAccessories.removedAt)))
      .returning()
      .get();
    if (!a) throw notFound('Không tìm thấy phụ kiện');
    audit(req, 'vehicle.accessory_remove', 'vehicle', a.vehicleId, { accessory: a.name });
    return { ok: true };
  });
}
