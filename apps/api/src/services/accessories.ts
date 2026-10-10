// Phụ kiện trên xe.
//
// - Danh mục dùng chung (accessory_catalog): tên chuẩn, tên gọi khác, giá trị đền bù gợi ý.
//   Gõ tên mới khi thêm cho xe → tự vào danh mục; trùng không dấu ("sac du phong") thì dùng lại.
// - Phụ kiện từng xe (vehicle_accessories): số lượng, ghi chú, giá trị riêng, có kiểm khi
//   giao/nhận không, có hiện trong ảnh chia sẻ không.
// - Gợi ý: xe cùng dòng đang có, phần lớn đội xe đang có, đồ thiết yếu, đồ riêng cho xe điện.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AccessoryCatalogItem, HandoverAccessory, Rental, Vehicle, VehicleAccessory } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { mergeAccessoryPlan } from '../shared/accessories.js';
import { DEFAULT_ACCESSORY_CATALOG, type AccessoryCategory } from '../shared/constants.js';
import { unaccent } from '../shared/text.js';
import { getVehicle } from './rentals.js';

export const accessoryKey = (name: string) => unaccent(name).replace(/[^a-z0-9]+/g, ' ').trim();

/** Nạp danh mục dựng sẵn — chỉ khi danh mục còn trống (người dùng xóa/sửa thì không đè). */
export function ensureAccessoryCatalog(): void {
  const any = db.select({ id: schema.accessoryCatalog.id }).from(schema.accessoryCatalog).limit(1).get();
  if (any) return;
  const now = Date.now();
  for (const s of DEFAULT_ACCESSORY_CATALOG) {
    db.insert(schema.accessoryCatalog)
      .values({
        name: s.name,
        nameKey: accessoryKey(s.name),
        aliases: s.aliases ?? null,
        category: s.category,
        defaultValue: s.value,
        highlight: !!s.highlight,
        essential: !!s.essential,
        evOnly: !!s.evOnly,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}

export function getCatalogItem(id: number): AccessoryCatalogItem {
  const c = db.select().from(schema.accessoryCatalog).where(eq(schema.accessoryCatalog.id, id)).get();
  if (!c) throw notFound('Không tìm thấy phụ kiện trong danh mục');
  return c;
}

/** Danh mục kèm số xe đang dùng mỗi món. */
export function listCatalog(includeArchived = false) {
  const usage = db
    .select({ catalogId: schema.vehicleAccessories.catalogId, n: sql<number>`COUNT(DISTINCT ${schema.vehicleAccessories.vehicleId})` })
    .from(schema.vehicleAccessories)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.vehicleAccessories.vehicleId))
    .where(and(isNull(schema.vehicleAccessories.removedAt), isNull(schema.vehicles.archivedAt)))
    .groupBy(schema.vehicleAccessories.catalogId)
    .all();
  const byId = new Map(usage.map((u) => [u.catalogId, u.n]));
  return db
    .select()
    .from(schema.accessoryCatalog)
    .where(includeArchived ? undefined : isNull(schema.accessoryCatalog.archivedAt))
    .orderBy(asc(schema.accessoryCatalog.category), asc(schema.accessoryCatalog.name))
    .all()
    .map((c) => ({ ...c, usage: byId.get(c.id) ?? 0 }));
}

/** Tìm hoặc tạo mục danh mục theo tên (không phân biệt dấu). */
export function findOrCreateCatalog(name: string, opts: { category?: AccessoryCategory; value?: number | null; userId?: number | null }): AccessoryCatalogItem {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) throw badRequest('Tên phụ kiện quá ngắn');
  const key = accessoryKey(clean);
  const existing = db.select().from(schema.accessoryCatalog).where(eq(schema.accessoryCatalog.nameKey, key)).get();
  if (existing) {
    if (existing.archivedAt) {
      db.update(schema.accessoryCatalog).set({ archivedAt: null, updatedAt: Date.now() }).where(eq(schema.accessoryCatalog.id, existing.id)).run();
    }
    return { ...existing, archivedAt: null };
  }
  const now = Date.now();
  return db
    .insert(schema.accessoryCatalog)
    .values({ name: clean, nameKey: key, category: opts.category ?? 'other', defaultValue: opts.value ?? 0, createdBy: opts.userId ?? null, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export type VehicleAccessoryView = VehicleAccessory & { effectiveValue: number };

export function vehicleAccessories(vehicleId: number): VehicleAccessoryView[] {
  const rows = db
    .select({ a: schema.vehicleAccessories, c: schema.accessoryCatalog })
    .from(schema.vehicleAccessories)
    .leftJoin(schema.accessoryCatalog, eq(schema.accessoryCatalog.id, schema.vehicleAccessories.catalogId))
    .where(and(eq(schema.vehicleAccessories.vehicleId, vehicleId), isNull(schema.vehicleAccessories.removedAt)))
    .orderBy(asc(schema.vehicleAccessories.sortOrder), asc(schema.vehicleAccessories.id))
    .all();
  return rows.map(({ a, c }) => ({ ...a, effectiveValue: a.value ?? c?.defaultValue ?? 0 }));
}

/** Danh sách đưa vào biên bản giao xe (chỉ món có đánh dấu kiểm khi giao nhận). */
export function handoverAccessoryTemplate(vehicleId: number): HandoverAccessory[] {
  return vehicleAccessories(vehicleId)
    .filter((a) => a.checkOnHandover)
    .map((a) => ({ id: a.id, name: a.name, quantity: a.quantity, value: a.effectiveValue, present: true, note: a.note }));
}

/** Phụ kiện kèm một lượt thuê (đã chỉnh lúc đặt xe, hoặc theo xe); present=false = lượt này không kèm. */
export function rentalAccessoryPlan(r: Pick<Rental, 'vehicleId' | 'accessories'>): HandoverAccessory[] {
  return mergeAccessoryPlan(r.accessories, handoverAccessoryTemplate(r.vehicleId));
}

export interface AddAccessoryInput {
  catalogId?: number | null;
  name?: string | null;
  category?: AccessoryCategory;
  quantity?: number;
  note?: string | null;
  value?: number | null;
}

/** Thêm nhiều phụ kiện cho một xe. Món đã có thì bỏ qua (không nhân đôi). */
export function addAccessories(vehicleId: number, items: AddAccessoryInput[], userId: number): { added: VehicleAccessory[]; skipped: string[] } {
  const vehicle = getVehicle(vehicleId);
  return db.transaction(() => {
    const current = vehicleAccessories(vehicle.id);
    const haveCatalog = new Set(current.map((a) => a.catalogId).filter((x): x is number => x != null));
    const haveKeys = new Set(current.map((a) => accessoryKey(a.name)));
    let order = current.reduce((m, a) => Math.max(m, a.sortOrder), 0);
    const added: VehicleAccessory[] = [];
    const skipped: string[] = [];
    for (const it of items) {
      const cat = it.catalogId ? getCatalogItem(it.catalogId) : findOrCreateCatalog(it.name ?? '', { category: it.category, value: it.value, userId });
      if (haveCatalog.has(cat.id) || haveKeys.has(cat.nameKey)) {
        skipped.push(cat.name);
        continue;
      }
      const now = Date.now();
      const row = db
        .insert(schema.vehicleAccessories)
        .values({
          vehicleId: vehicle.id,
          catalogId: cat.id,
          name: cat.name,
          category: cat.category,
          quantity: Math.max(1, it.quantity ?? 1),
          note: it.note ?? null,
          value: it.value ?? null,
          checkOnHandover: true,
          showInShare: cat.highlight,
          sortOrder: ++order,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      haveCatalog.add(cat.id);
      haveKeys.add(cat.nameKey);
      added.push(row);
    }
    return { added, skipped };
  });
}

export function copyAccessories(toVehicleId: number, fromVehicleId: number, userId: number) {
  if (toVehicleId === fromVehicleId) throw badRequest('Chọn một xe khác để sao chép');
  const source = vehicleAccessories(fromVehicleId);
  if (!source.length) throw badRequest('Xe nguồn chưa có phụ kiện nào');
  return addAccessories(
    toVehicleId,
    source.map((a) => ({ catalogId: a.catalogId, name: a.name, quantity: a.quantity, note: a.note, value: a.value })),
    userId,
  );
}

/** Thêm một món trong danh mục cho mọi xe đang hoạt động còn thiếu. */
export function applyToAllVehicles(catalogId: number, userId: number): number {
  const cat = getCatalogItem(catalogId);
  const vehicles = db.select().from(schema.vehicles).where(and(isNull(schema.vehicles.archivedAt), eq(schema.vehicles.active, true))).all();
  let n = 0;
  for (const v of vehicles) {
    if (cat.evOnly && v.fuel !== 'electric') continue;
    n += addAccessories(v.id, [{ catalogId }], userId).added.length;
  }
  return n;
}

// ── Gợi ý thông minh ─────────────────────────────────────────────────────────

export interface AccessorySuggestion {
  catalogId: number;
  name: string;
  category: AccessoryCategory;
  defaultValue: number;
  score: number;
  reasons: string[];
}

const modelKey = (v: Pick<Vehicle, 'make' | 'model'>) => accessoryKey(`${v.make} ${v.model}`.split(/\s+/).slice(0, 2).join(' '));

export function suggestAccessories(vehicleId: number, limit = 12): AccessorySuggestion[] {
  const vehicle = getVehicle(vehicleId);
  const isEv = vehicle.fuel === 'electric';
  const mine = new Set(vehicleAccessories(vehicle.id).map((a) => a.catalogId));
  const others = db
    .select()
    .from(schema.vehicles)
    .where(and(isNull(schema.vehicles.archivedAt), sql`${schema.vehicles.id} != ${vehicle.id}`))
    .all();
  const otherIds = others.map((o) => o.id);
  const sameModelIds = new Set(others.filter((o) => modelKey(o) === modelKey(vehicle)).map((o) => o.id));
  const used = otherIds.length
    ? db
        .select({ vehicleId: schema.vehicleAccessories.vehicleId, catalogId: schema.vehicleAccessories.catalogId })
        .from(schema.vehicleAccessories)
        .where(and(inArray(schema.vehicleAccessories.vehicleId, otherIds), isNull(schema.vehicleAccessories.removedAt)))
        .all()
    : [];
  const count = new Map<number, number>();
  const sameModel = new Map<number, number>();
  for (const u of used) {
    if (u.catalogId == null) continue;
    count.set(u.catalogId, (count.get(u.catalogId) ?? 0) + 1);
    if (sameModelIds.has(u.vehicleId)) sameModel.set(u.catalogId, (sameModel.get(u.catalogId) ?? 0) + 1);
  }

  const out: AccessorySuggestion[] = [];
  for (const c of db.select().from(schema.accessoryCatalog).where(isNull(schema.accessoryCatalog.archivedAt)).all()) {
    if (mine.has(c.id)) continue;
    if (c.evOnly && !isEv) continue;
    let score = 0;
    const reasons: string[] = [];
    const sm = sameModel.get(c.id) ?? 0;
    const n = count.get(c.id) ?? 0;
    if (sm) {
      score += 60;
      reasons.push(`Xe cùng dòng ${vehicle.model} đang có`);
    }
    if (n) {
      score += 10 * n + (others.length && n / others.length >= 0.5 ? 25 : 0);
      reasons.push(`${n}/${others.length} xe khác đang có`);
    }
    if (c.evOnly && isEv) {
      score += 45;
      reasons.push('Nên có cho xe điện');
    }
    if (c.essential) {
      score += 30;
      reasons.push('Đồ thiết yếu');
    }
    if (score > 0) out.push({ catalogId: c.id, name: c.name, category: c.category, defaultValue: c.defaultValue, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'vi')).slice(0, limit);
}
