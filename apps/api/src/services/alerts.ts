// Việc cần làm & cảnh báo — dùng cho trang Tổng quan và bản tin Telegram buổi sáng.

import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { escapeHtml } from '../lib/telegram.js';
import { DAY_MS, HOUR_MS, daysUntil, fmtDate, fmtDateKey, fmtDateTime, fmtTime, vnStartOfDay } from '../shared/time.js';
import { fmtVnd } from '../shared/text.js';
import { fmtNumber } from '../shared/text.js';
import { maintenanceDue } from './maintenance.js';
import { moneyByRental } from './rentals.js';

export type AlertKind =
  | 'pickup_today'
  | 'pickup_overdue'
  | 'return_today'
  | 'return_overdue'
  | 'settle_pending'
  | 'hold_due'
  | 'customer_debt'
  | 'refund_pending'
  | 'vehicle_doc'
  | 'service_due'
  | 'open_fines';

export interface Alert {
  kind: AlertKind;
  severity: 'info' | 'warn' | 'danger';
  title: string;
  detail: string;
  link: string;
  at?: number;
}

const DOC_FIELDS = [
  ['inspectionExpiry', 'Đăng kiểm'],
  ['insuranceTndsExpiry', 'Bảo hiểm TNDS'],
  ['insuranceBodyExpiry', 'Bảo hiểm thân vỏ'],
  ['roadFeeExpiry', 'Phí đường bộ'],
] as const;

export function computeAlerts(now = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  const endOfToday = vnStartOfDay(now) + DAY_MS;

  const open = db
    .select({ r: schema.rentals, c: schema.customers, v: schema.vehicles })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
    .where(inArray(schema.rentals.status, ['booked', 'active', 'returned', 'settled']))
    .all();
  const returnedMoney = moneyByRental(['returned']);

  for (const { r, c, v } of open) {
    const who = `${v.plate} · ${c.fullName}`;
    const link = `/rentals/${r.id}`;
    if (r.status === 'booked') {
      if (r.scheduledStart < now - 30 * 60_000) {
        alerts.push({ kind: 'pickup_overdue', severity: 'warn', title: `Quá giờ giao xe ${r.code}`, detail: `${who} · hẹn ${fmtDateTime(r.scheduledStart)}`, link, at: r.scheduledStart });
      } else if (r.scheduledStart < endOfToday) {
        alerts.push({ kind: 'pickup_today', severity: 'info', title: `Giao xe ${fmtTime(r.scheduledStart)}`, detail: `${r.code} · ${who}`, link, at: r.scheduledStart });
      }
    } else if (r.status === 'active') {
      if (r.scheduledEnd < now) {
        alerts.push({ kind: 'return_overdue', severity: 'danger', title: `Quá hạn trả xe ${r.code}`, detail: `${who} · hẹn ${fmtDateTime(r.scheduledEnd)} · SĐT ${c.phone ?? '—'}`, link, at: r.scheduledEnd });
      } else if (r.scheduledEnd < endOfToday) {
        alerts.push({ kind: 'return_today', severity: 'info', title: `Nhận xe ${fmtTime(r.scheduledEnd)}`, detail: `${r.code} · ${who}`, link, at: r.scheduledEnd });
      }
    } else if (r.status === 'returned') {
      // Đã nhận xe nhưng chưa quyết toán (vd khách hẹn chuyển khoản sau) — dễ quên nhất.
      const since = r.actualEnd ?? r.scheduledEnd;
      const due = returnedMoney.get(r.id)?.due ?? 0;
      alerts.push({
        kind: 'settle_pending',
        severity: now - since > 12 * HOUR_MS ? 'warn' : 'info',
        title: `Chờ quyết toán ${r.code}`,
        detail: `${who} · trả xe ${fmtDateTime(since)}${due > 0 ? ` · khách còn phải trả ${fmtVnd(due)}` : ''}`,
        link,
        at: since,
      });
    } else if (r.status === 'settled' && r.fineHoldUntil && r.fineHoldUntil < endOfToday) {
      const checked =
        r.fineCheckedAt && r.fineCheckFound != null
          ? r.fineCheckFound > 0
            ? `đã tra ${fmtDate(r.fineCheckedAt)}: có ${r.fineCheckFound} vi phạm — trừ vào cọc`
            : `đã tra ${fmtDate(r.fineCheckedAt)}: không có vi phạm`
          : `tra phạt nguội ${v.plate} trước khi hoàn`;
      alerts.push({
        kind: 'hold_due',
        severity: r.fineCheckFound ? 'danger' : 'warn',
        title: `Đến hạn hoàn cọc ${fmtVnd(r.fineHoldAmount)}`,
        detail: `${r.code} · ${c.fullName} · ${checked}`,
        link,
        at: r.fineHoldUntil,
      });
    }
  }

  // Tiền còn treo ở lượt đã xong: khách còn nợ (vd phạt nguội ghi sau), hoặc mình chưa hoàn cho khách.
  const doneMoney = moneyByRental(['settled', 'closed', 'cancelled']);
  if (doneMoney.size) {
    const owing = [...doneMoney].filter(([, m]) => m.due > 0 || m.due < 0 || m.depositHeld > 0).map(([id]) => id);
    const rows = owing.length
      ? db
          .select({ r: schema.rentals, c: schema.customers, v: schema.vehicles })
          .from(schema.rentals)
          .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
          .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
          .where(inArray(schema.rentals.id, owing))
          .all()
      : [];
    for (const { r, c, v } of rows) {
      const m = doneMoney.get(r.id)!;
      const link = `/rentals/${r.id}`;
      if (m.due > 0 && r.status !== 'cancelled') {
        alerts.push({ kind: 'customer_debt', severity: 'warn', title: `Khách còn nợ ${fmtVnd(m.due)}`, detail: `${r.code} · ${v.plate} · ${c.fullName}${c.phone ? ` · ${c.phone}` : ''}`, link });
      }
      // Lượt đang giữ cọc chờ phạt nguội thì cọc là đúng — chỉ nhắc lượt đã xong / đã hủy.
      const owe = Math.max(0, -m.due) + (r.status === 'settled' ? 0 : Math.max(0, m.depositHeld));
      if (owe > 0) {
        alerts.push({ kind: 'refund_pending', severity: 'warn', title: `Chưa hoàn cho khách ${fmtVnd(owe)}`, detail: `${r.code} · ${v.plate} · ${c.fullName}${r.status === 'cancelled' ? ' · lượt đã hủy' : ''}`, link });
      }
    }
  }

  const vehicles = db.select().from(schema.vehicles).where(and(eq(schema.vehicles.active, true), isNull(schema.vehicles.archivedAt))).all();
  for (const v of vehicles) {
    for (const [field, label] of DOC_FIELDS) {
      const key = v[field];
      if (!key) continue;
      const d = daysUntil(key, now);
      if (d <= 30) {
        alerts.push({
          kind: 'vehicle_doc',
          severity: d < 0 ? 'danger' : d <= 7 ? 'warn' : 'info',
          title: d < 0 ? `${label} ${v.plate} đã hết hạn` : `${label} ${v.plate} còn ${d} ngày`,
          detail: `Hạn ${fmtDateKey(key)}`,
          link: `/vehicles/${v.id}`,
        });
      }
    }
  }

  // Bảo dưỡng: gộp mỗi xe một dòng — mốc chung của xe (Sửa xe) + các hạng mục trong lịch bảo dưỡng đến hạn.
  const due = new Map(maintenanceDue(now).map((x) => [x.vehicle.id, x.items]));
  for (const v of vehicles) {
    const parts: string[] = [];
    let overdue = false;
    const serviceByDate = v.nextServiceDate && daysUntil(v.nextServiceDate, now) <= 7;
    const serviceByOdo = v.nextServiceOdo && v.odo >= v.nextServiceOdo - 500;
    if (serviceByDate || serviceByOdo) {
      parts.push(`Bảo dưỡng định kỳ (${[v.nextServiceOdo && `mốc ${fmtNumber(v.nextServiceOdo)} km`, v.nextServiceDate && `hạn ${fmtDateKey(v.nextServiceDate)}`].filter(Boolean).join(' · ')})`);
      overdue ||= !!((v.nextServiceDate && daysUntil(v.nextServiceDate, now) < 0) || (v.nextServiceOdo && v.odo >= v.nextServiceOdo));
    }
    for (const i of due.get(v.id) ?? []) {
      parts.push(`${i.name} (${[i.status.nextOdo != null && `mốc ${fmtNumber(i.status.nextOdo)} km`, i.status.nextDate && `hạn ${fmtDateKey(i.status.nextDate)}`].filter(Boolean).join(' · ')})`);
      overdue ||= i.status.state === 'overdue';
    }
    if (!parts.length) continue;
    alerts.push({
      kind: 'service_due',
      severity: overdue ? 'danger' : 'warn',
      title: `${overdue ? 'Quá hạn' : 'Sắp đến hạn'} bảo dưỡng ${v.plate}`,
      detail: `${parts.join('; ')} · ODO hiện ${fmtNumber(v.odo)} km`,
      link: `/vehicles/${v.id}`,
    });
  }

  const openFines = db
    .select({ id: schema.trafficFines.id })
    .from(schema.trafficFines)
    .where(and(inArray(schema.trafficFines.status, ['new', 'notified', 'we_paid']), isNull(schema.trafficFines.voidedAt)))
    .all();
  if (openFines.length) {
    alerts.push({ kind: 'open_fines', severity: 'warn', title: `${openFines.length} phạt nguội chưa xử lý xong`, detail: 'Báo khách / thu lại tiền', link: '/fines' });
  }

  const rank = { danger: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.at ?? 0) - (b.at ?? 0));
}

const ICON: Record<Alert['severity'], string> = { danger: '🔴', warn: '🟠', info: '🔹' };

export function buildDigest(now = Date.now()): string | null {
  const alerts = computeAlerts(now);
  if (!alerts.length) return null;
  const lines = [`📋 <b>Việc hôm nay ${fmtDate(now)}</b>`, ''];
  for (const a of alerts) lines.push(`${ICON[a.severity]} <b>${escapeHtml(a.title)}</b>\n    ${escapeHtml(a.detail)}`);
  return lines.join('\n');
}

/** Lượt thuê có giao/nhận xe trong `withinMs` tới — dùng để hoãn tự cập nhật. */
export function handoversSoon(withinMs: number, now = Date.now()): number {
  const limit = now + withinMs;
  const booked = db
    .select({ id: schema.rentals.id })
    .from(schema.rentals)
    .where(and(eq(schema.rentals.status, 'booked'), lte(schema.rentals.scheduledStart, limit)))
    .all();
  const active = db
    .select({ id: schema.rentals.id })
    .from(schema.rentals)
    .where(and(eq(schema.rentals.status, 'active'), lte(schema.rentals.scheduledEnd, limit)))
    .all();
  return booked.length + active.length;
}
