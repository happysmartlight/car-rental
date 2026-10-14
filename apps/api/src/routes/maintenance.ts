// Lịch bảo dưỡng theo hạng mục của từng xe.

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { idParam, notFound, parse, requireRole, userId, zMoney, zOptText } from '../lib/http.js';
import { CASH_METHODS, dateKeyToNoon } from '../shared/cashflow.js';
import { presetsFor } from '../shared/maintenance.js';
import { vnDateKey } from '../shared/time.js';
import { createEntry } from '../services/cashflow.js';
import { addMaintenanceItems, archiveMaintenanceItem, getMaintenanceItem, markMaintenanceDone, updateMaintenanceItem, vehicleMaintenance } from '../services/maintenance.js';

const zKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ngày phải dạng YYYY-MM-DD');
const zItem = z.object({
  name: z.string().trim().min(2, 'nhập tên hạng mục').max(80),
  preset: z.string().max(40).nullable().optional(),
  intervalKm: z.coerce.number().int().min(100).max(1_000_000).nullable().optional(),
  intervalMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  lastOdo: z.coerce.number().int().min(0).nullable().optional(),
  lastDate: zKey.nullable().optional(),
  notes: zOptText,
});

export async function maintenanceRoutes(app: FastifyInstance) {
  app.get('/api/vehicles/:id/maintenance', async (req) => {
    requireRole(req, 'staff');
    const id = idParam(req);
    const v = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).get();
    if (!v) throw notFound('Không tìm thấy xe');
    return { ...vehicleMaintenance(id), presets: presetsFor(v.fuel) };
  });

  app.post('/api/vehicles/:id/maintenance', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const { items } = parse(z.object({ items: z.array(zItem).min(1).max(30) }), req.body);
    const created = addMaintenanceItems(id, items);
    audit(req, 'maintenance.add', 'vehicle', id, { names: created.map((c) => c.name) });
    return { created };
  });

  app.patch('/api/maintenance/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parse(zItem.partial(), req.body);
    const item = updateMaintenanceItem(id, body);
    audit(req, 'maintenance.update', 'vehicle', item.vehicleId, { itemId: id, ...body });
    return item;
  });

  app.post('/api/maintenance/:id/archive', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const item = archiveMaintenanceItem(id);
    audit(req, 'maintenance.archive', 'vehicle', item.vehicleId, { itemId: id, name: item.name });
    return item;
  });

  /** Ghi đã làm (nhân viên cũng ghi được): chọn các mục, ngày, ODO; có chi phí thì ghi luôn phiếu chi "Bảo dưỡng định kỳ". */
  app.post('/api/vehicles/:id/maintenance/done', async (req) => {
    requireRole(req, 'staff');
    const vehicleId = idParam(req);
    const body = parse(
      z.object({
        itemIds: z.array(z.number().int()).min(1, 'chọn hạng mục đã làm').max(50),
        date: zKey,
        odo: z.coerce.number().int().min(0).nullable().optional(),
        notes: zOptText,
        cost: z.object({ amount: zMoney, method: z.enum(CASH_METHODS), vendor: zOptText }).nullable().optional(),
      }),
      req.body,
    );
    const names = body.itemIds.map((i) => getMaintenanceItem(i).name);
    const odo = body.odo ?? null;
    if (body.cost && body.cost.amount > 0) {
      const at = body.date === vnDateKey(Date.now()) ? Date.now() : dateKeyToNoon(body.date);
      const description = `Bảo dưỡng: ${names.join(', ')}${body.notes ? ` — ${body.notes}` : ''}`.slice(0, 300);
      const r = createEntry(
        { category: 'maintenance', amount: body.cost.amount, at, vehicleId, method: body.cost.method, description, vendor: body.cost.vendor, odo, receiptFileIds: [] },
        userId(req),
        undefined,
        body.itemIds,
      );
      audit(req, 'maintenance.done', 'vehicle', vehicleId, { names, date: body.date, odo, cashEntryId: r.entry.id, amount: body.cost.amount });
      return { done: r.maintenance, entry: r.entry };
    }
    const records = db.transaction(() => markMaintenanceDone(vehicleId, { itemIds: body.itemIds, date: body.date, odo, notes: body.notes }, userId(req)));
    audit(req, 'maintenance.done', 'vehicle', vehicleId, { names, date: body.date, odo });
    return { done: records.length, entry: null };
  });
}
