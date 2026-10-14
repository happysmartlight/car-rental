// Lịch bảo dưỡng theo hạng mục: thêm / sửa / bỏ hạng mục, ghi "đã làm" (kèm phiếu chi nếu có),
// tính hạng mục đến hạn cho Việc cần làm và cảnh báo khi giao xe.

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { MaintenanceItem, MaintenanceRecord, Vehicle } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { dueText, maintenanceStatus, type MaintenanceStatus } from '../shared/maintenance.js';
import { vnDateKey } from '../shared/time.js';

export interface NewMaintenanceItem {
  name: string;
  preset?: string | null;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  lastOdo?: number | null;
  lastDate?: string | null;
  notes?: string | null;
}

export type MaintenanceItemView = MaintenanceItem & { status: MaintenanceStatus };

function getVehicleRow(id: number): Vehicle {
  const v = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).get();
  if (!v) throw notFound('Không tìm thấy xe');
  return v;
}

function checkInterval(x: { intervalKm?: number | null; intervalMonths?: number | null }) {
  if (!x.intervalKm && !x.intervalMonths) throw badRequest('Nhập chu kỳ theo km hoặc theo tháng');
}

const withStatus = (items: MaintenanceItem[], odo: number, today = vnDateKey(Date.now())): MaintenanceItemView[] =>
  items.map((i) => ({ ...i, status: maintenanceStatus(i, odo, today) }));

export function vehicleMaintenance(vehicleId: number) {
  const v = getVehicleRow(vehicleId);
  const items = db
    .select()
    .from(schema.maintenanceItems)
    .where(and(eq(schema.maintenanceItems.vehicleId, vehicleId), isNull(schema.maintenanceItems.archivedAt)))
    .orderBy(asc(schema.maintenanceItems.sortOrder), asc(schema.maintenanceItems.id))
    .all();
  const records = db
    .select()
    .from(schema.maintenanceRecords)
    .where(eq(schema.maintenanceRecords.vehicleId, vehicleId))
    .orderBy(desc(schema.maintenanceRecords.doneDate), desc(schema.maintenanceRecords.id))
    .limit(200)
    .all();
  return { items: withStatus(items, v.odo), records };
}

export function addMaintenanceItems(vehicleId: number, list: NewMaintenanceItem[]): MaintenanceItem[] {
  getVehicleRow(vehicleId);
  list.forEach(checkInterval);
  const now = Date.now();
  const last = db.select({ n: schema.maintenanceItems.sortOrder }).from(schema.maintenanceItems).where(eq(schema.maintenanceItems.vehicleId, vehicleId)).orderBy(desc(schema.maintenanceItems.sortOrder)).get();
  let order = (last?.n ?? 0) + 1;
  return db.transaction(() =>
    list.map((x) =>
      db
        .insert(schema.maintenanceItems)
        .values({
          vehicleId,
          name: x.name,
          preset: x.preset ?? null,
          intervalKm: x.intervalKm ?? null,
          intervalMonths: x.intervalMonths ?? null,
          lastOdo: x.lastOdo ?? null,
          lastDate: x.lastDate ?? null,
          notes: x.notes ?? null,
          sortOrder: order++,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    ),
  );
}

export function getMaintenanceItem(id: number): MaintenanceItem {
  const i = db.select().from(schema.maintenanceItems).where(eq(schema.maintenanceItems.id, id)).get();
  if (!i) throw notFound('Không tìm thấy hạng mục bảo dưỡng');
  return i;
}

export function updateMaintenanceItem(id: number, patch: Partial<NewMaintenanceItem>): MaintenanceItem {
  const cur = getMaintenanceItem(id);
  checkInterval({ intervalKm: patch.intervalKm !== undefined ? patch.intervalKm : cur.intervalKm, intervalMonths: patch.intervalMonths !== undefined ? patch.intervalMonths : cur.intervalMonths });
  return db
    .update(schema.maintenanceItems)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.maintenanceItems.id, id))
    .returning()
    .get();
}

/** Bỏ hạng mục khỏi lịch (lịch sử các lần làm vẫn giữ). */
export function archiveMaintenanceItem(id: number): MaintenanceItem {
  getMaintenanceItem(id);
  return db.update(schema.maintenanceItems).set({ archivedAt: Date.now(), updatedAt: Date.now() }).where(eq(schema.maintenanceItems.id, id)).returning().get();
}

export interface MaintenanceDoneInput {
  itemIds: number[];
  /** "YYYY-MM-DD". */
  date: string;
  /** null = lấy ODO hiện tại của xe. */
  odo: number | null;
  notes?: string | null;
  cashEntryId?: number | null;
}

/**
 * Ghi đã làm các hạng mục: thêm một dòng lịch sử mỗi mục, dời mốc "lần làm gần nhất" (ghi bù lần cũ hơn thì không dời),
 * ODO lớn hơn số đang lưu thì cập nhật luôn ODO của xe. Gọi trong transaction của người gọi nếu có.
 */
export function markMaintenanceDone(vehicleId: number, input: MaintenanceDoneInput, userId: number | null): MaintenanceRecord[] {
  const v = getVehicleRow(vehicleId);
  const ids = [...new Set(input.itemIds)];
  if (!ids.length) return [];
  const items = db.select().from(schema.maintenanceItems).where(and(inArray(schema.maintenanceItems.id, ids), eq(schema.maintenanceItems.vehicleId, vehicleId))).all();
  if (items.length !== ids.length) throw badRequest('Hạng mục bảo dưỡng không thuộc xe này');
  const odo = input.odo ?? v.odo;
  const now = Date.now();
  const records = items.map((item) => {
    const rec = db
      .insert(schema.maintenanceRecords)
      .values({ itemId: item.id, vehicleId, doneDate: input.date, odo, cashEntryId: input.cashEntryId ?? null, notes: input.notes ?? null, createdBy: userId, createdAt: now })
      .returning()
      .get();
    if (!item.lastDate || input.date >= item.lastDate) {
      db.update(schema.maintenanceItems).set({ lastDate: input.date, lastOdo: odo, updatedAt: now }).where(eq(schema.maintenanceItems.id, item.id)).run();
    }
    return rec;
  });
  if (odo > v.odo) db.update(schema.vehicles).set({ odo, updatedAt: now }).where(eq(schema.vehicles.id, vehicleId)).run();
  return records;
}

/** Hạng mục quá hạn / sắp đến hạn của mọi xe đang hoạt động (Việc cần làm, bản tin sáng). */
export function maintenanceDue(now = Date.now()): { vehicle: Vehicle; items: MaintenanceItemView[] }[] {
  const vehicles = db.select().from(schema.vehicles).where(and(eq(schema.vehicles.active, true), isNull(schema.vehicles.archivedAt))).all();
  if (!vehicles.length) return [];
  const items = db
    .select()
    .from(schema.maintenanceItems)
    .where(and(inArray(schema.maintenanceItems.vehicleId, vehicles.map((v) => v.id)), isNull(schema.maintenanceItems.archivedAt)))
    .orderBy(asc(schema.maintenanceItems.sortOrder))
    .all();
  const today = vnDateKey(now);
  return vehicles
    .map((v) => ({ vehicle: v, items: withStatus(items.filter((i) => i.vehicleId === v.id), v.odo, today).filter((i) => i.status.state === 'overdue' || i.status.state === 'soon') }))
    .filter((x) => x.items.length);
}

/** Cảnh báo khi đặt / giao xe đang quá hạn bảo dưỡng. */
export function maintenanceWarnings(vehicle: Vehicle, now = Date.now()): { code: string; message: string; severity: 'warn' }[] {
  const items = db
    .select()
    .from(schema.maintenanceItems)
    .where(and(eq(schema.maintenanceItems.vehicleId, vehicle.id), isNull(schema.maintenanceItems.archivedAt)))
    .all();
  const overdue = withStatus(items, vehicle.odo, vnDateKey(now)).filter((i) => i.status.state === 'overdue');
  if (!overdue.length) return [];
  return [
    {
      code: 'maintenance_overdue',
      severity: 'warn',
      message: `Xe ${vehicle.plate} quá hạn bảo dưỡng: ${overdue.map((i) => `${i.name} (${dueText(i.status)})`).join('; ')}.`,
    },
  ];
}
