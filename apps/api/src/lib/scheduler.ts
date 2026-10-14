// Việc chạy định kỳ trong app (không cần cron hệ thống). Mỗi phút kiểm tra một lần.

import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { Customer, Rental, Vehicle } from '../db/schema.js';
import { buildDigest, handoversSoon } from '../services/alerts.js';
import { materializeRecurring } from '../services/cashflow.js';
import { checkRentalFines, runFleetFineCheck } from '../services/fineCheck.js';
import { getRental, rentalMoney } from '../services/rentals.js';
import { startUpdate } from '../services/updateFlow.js';
import { fmtVnd } from '../shared/text.js';
import { DAY_MS, HOUR_MS, fmtDate, fmtDateTime, vnDateKey, vnParts, vnStartOfDay } from '../shared/time.js';
import { purgeExpiredSessions } from './auth.js';
import { runNightlyBackup } from './backup.js';
import { getLocalConfig, updateLocalConfig } from './localConfig.js';
import { escapeHtml, flushNotifyQueue, notify, notifyNow, sendTelegram, telegramConfigured } from './telegram.js';
import { checkReleases, readUpdaterState, updateAvailable } from './updater.js';

// ── Nhắc việc qua Telegram: mỗi khóa chỉ gửi một lần, nhưng chỉ tính là đã gửi khi gửi được ──

let telegramRetryAt = 0;

/**
 * Gửi nhắc một lần theo khóa. Mất mạng / Telegram lỗi → không đánh dấu, 5 phút sau thử lại
 * (trước đây đánh dấu trước khi gửi nên lỡ lỗi là mất nhắc luôn). Thông báo đang tắt → coi như đã nhắc.
 * Trả false khi Telegram đang lỗi để vòng này dừng gửi tiếp.
 */
async function remindOnce(key: string, html: string, now: number): Promise<boolean> {
  if (db.select().from(schema.reminderLog).where(eq(schema.reminderLog.key, key)).get()) return true;
  if (now < telegramRetryAt) return false;
  const r = await notifyNow(html);
  if (r === 'failed') {
    telegramRetryAt = now + 5 * 60_000;
    return false;
  }
  db.insert(schema.reminderLog).values({ key, sentAt: Date.now() }).onConflictDoNothing().run();
  return true;
}

async function overdueReturns(now: number) {
  const rows = db
    .select({ r: schema.rentals, c: schema.customers, v: schema.vehicles })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
    .where(and(eq(schema.rentals.status, 'active'), lt(schema.rentals.scheduledEnd, now + HOUR_MS)))
    .all();
  for (const { r, c, v } of rows) {
    const late = r.scheduledEnd < now - 30 * 60_000;
    const key = `${late ? 'overdue' : 'due-soon'}:${r.id}:${r.scheduledEnd}`;
    const html = late
      ? `⏰ <b>Quá hạn trả xe</b> ${escapeHtml(v.plate)}\n${escapeHtml(r.code)} · ${escapeHtml(c.fullName)} · ${escapeHtml(c.phone ?? '')}\nHẹn trả ${fmtDateTime(r.scheduledEnd)}`
      : `🔔 <b>Sắp đến giờ nhận xe</b> ${escapeHtml(v.plate)} lúc ${fmtDateTime(r.scheduledEnd)}\n${escapeHtml(r.code)} · ${escapeHtml(c.fullName)} · ${escapeHtml(c.phone ?? '')}`;
    if (!(await remindOnce(key, html, now))) return;
  }
}

/** Nhắc trước giờ giao xe: giao tận nơi trước 2 giờ (còn đi đường), khách tới lấy trước 1 giờ. */
async function upcomingPickups(now: number) {
  const rows = db
    .select({ r: schema.rentals, c: schema.customers, v: schema.vehicles })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
    .where(and(eq(schema.rentals.status, 'booked'), lt(schema.rentals.scheduledStart, now + 2 * HOUR_MS), gt(schema.rentals.scheduledStart, now - 30 * 60_000)))
    .all();
  for (const { r, c, v } of rows) {
    const lead = r.pickupMethod === 'delivery' ? 2 * HOUR_MS : HOUR_MS;
    // Đặt sát giờ thì tin "Đặt xe mới" vừa báo rồi, không nhắc nữa.
    if (r.scheduledStart > now + lead || r.createdAt > r.scheduledStart - lead) continue;
    const m = rentalMoney(r.id);
    const collect = [m.due > 0 && `tiền thuê ${fmtVnd(m.due)}`, r.depositRequired > m.depositHeld && `cọc ${fmtVnd(r.depositRequired - m.depositHeld)}`].filter(Boolean);
    const html = [
      `🔑 <b>Sắp giao xe</b> ${escapeHtml(v.plate)} lúc ${fmtDateTime(r.scheduledStart)}`,
      `${escapeHtml(r.code)} · ${escapeHtml(c.fullName)}${c.phone ? ` · ${escapeHtml(c.phone)}` : ''}`,
      r.pickupMethod === 'delivery' ? `📍 Giao tận nơi: ${escapeHtml(r.pickupLocation || 'chưa ghi địa chỉ')}` : '🏠 Khách tới lấy xe tại cửa hàng',
      collect.length ? `💰 Cần thu: ${collect.join(' + ')}` : '💰 Khách đã trả đủ tiền thuê và cọc',
    ].join('\n');
    if (!(await remindOnce(`pickup-soon:${r.id}:${r.scheduledStart}`, html, now))) return;
  }
}

async function updateCheck(now: number) {
  const lc = getLocalConfig();
  if (lc.update.lastCheckAt && now - lc.update.lastCheckAt < 6 * HOUR_MS) return;
  try {
    await checkReleases();
  } catch {
    return;
  }
  const avail = updateAvailable();
  if (avail && getLocalConfig().update.notifiedVersion !== avail.version) {
    updateLocalConfig((c) => {
      c.update.notifiedVersion = avail.version;
    });
    notify(`✨ <b>Có bản mới v${escapeHtml(avail.version)}</b> (đang chạy v${escapeHtml(config.version)})\nVào Cài đặt → Cập nhật để xem thay đổi và cài.`);
  }
}

async function autoUpdate(now: number) {
  const lc = getLocalConfig();
  const p = vnParts(now);
  const today = vnDateKey(now);
  if (!lc.update.autoUpdate || p.hour !== lc.update.autoUpdateHour || lc.update.lastAutoUpdateDate === today) return;
  const avail = updateAvailable();
  if (!avail || !readUpdaterState().alive) return;
  updateLocalConfig((c) => {
    c.update.lastAutoUpdateDate = today;
  });
  const soon = handoversSoon(2 * HOUR_MS, now);
  if (soon > 0) {
    notify(`⏸ Bỏ qua tự cập nhật v${escapeHtml(avail.version)} đêm nay: có ${soon} lượt giao/nhận xe trong 2 giờ tới.`);
    return;
  }
  try {
    await startUpdate(avail.version, { reason: 'auto' });
  } catch (err) {
    notify(`⚠️ Tự cập nhật thất bại: ${escapeHtml((err as Error).message)}`);
  }
}

let digestRetryAt = 0;

async function digest(now: number) {
  const lc = getLocalConfig();
  const today = vnDateKey(now);
  if (!lc.telegram.dailyDigest || !telegramConfigured() || lc.digest.lastDate === today) return;
  if (vnParts(now).hour < lc.telegram.digestHour || now < digestRetryAt) return;
  const text = buildDigest(now);
  if (text) {
    try {
      await sendTelegram(text);
    } catch (err) {
      // Chưa gửi được thì chưa tính là xong hôm nay — 10 phút sau gửi lại.
      console.error('digest failed', err);
      digestRetryAt = now + 10 * 60_000;
      return;
    }
  }
  updateLocalConfig((c) => {
    c.digest.lastDate = today;
  });
}

/** Kiểm tra phạt nguội cả đội theo lịch (sau 9h sáng, để thông báo đến lúc đang làm việc). */
async function fineCheck(now: number) {
  const fc = getLocalConfig().fineCheck;
  if (fc.frequency === 'off' || vnParts(now).hour < 9) return;
  const every = fc.frequency === 'daily' ? 24 * HOUR_MS : 7 * 24 * HOUR_MS;
  // Lỗi lần trước thì thử lại sau 6 giờ, không đợi hết chu kỳ.
  const wait = fc.lastError ? 6 * HOUR_MS : every - HOUR_MS;
  if (fc.lastRunAt && now - fc.lastRunAt < wait) return;
  await runFleetFineCheck(null);
}

let holdCheckRetryAt = 0;

function holdCheckMessage(r: Rental, c: Customer, v: Vehicle): string {
  const held = rentalMoney(r.id).depositHeld;
  const head = `${escapeHtml(v.plate)} · ${escapeHtml(r.code)}\n${escapeHtml(c.fullName)}${c.phone ? ` · ${escapeHtml(c.phone)}` : ''}\nĐang giữ ${fmtVnd(held)}, hạn hoàn ${fmtDate(r.fineHoldUntil)}.`;
  if (!r.fineCheckFound) {
    return `✅ <b>Đến hạn hoàn cọc</b> ${head}\nĐã tra phạt nguội lúc ${fmtDateTime(r.fineCheckedAt)}: không có vi phạm trong thời gian thuê → có thể hoàn cọc.`;
  }
  const fines = db
    .select()
    .from(schema.trafficFines)
    .where(and(eq(schema.trafficFines.rentalId, r.id), inArray(schema.trafficFines.status, ['new', 'notified', 'we_paid']), isNull(schema.trafficFines.voidedAt)))
    .all();
  const list = fines.map((f) => `• ${fmtDateTime(f.violatedAt)} ${escapeHtml(f.violation ?? 'Vi phạm')}${f.location ? ` (${escapeHtml(f.location)})` : ''}`);
  return [`🚨 <b>Đến hạn hoàn cọc — có ${r.fineCheckFound} phạt nguội</b> ${head}`, ...list, 'Đã ghi hồ sơ. Nhập mức phạt rồi trừ vào cọc khi hoàn.'].join('\n');
}

/**
 * Ngày đến hạn hoàn cọc (sau 9h): tự tra phạt nguội riêng cho lượt đó rồi báo kết quả —
 * "biển sạch, hoàn được" hoặc "có vi phạm, trừ cọc". Dịch vụ tra cứu lỗi → báo tra tay, 6 giờ sau thử lại.
 * Tắt "Tự kiểm tra cả đội" thì cũng không tự tra (bản tin buổi sáng vẫn nhắc đến hạn hoàn cọc).
 */
async function holdChecks(now: number) {
  if (getLocalConfig().fineCheck.frequency === 'off') return;
  if (vnParts(now).hour < 9 || now < holdCheckRetryAt) return;
  const rows = db
    .select({ r: schema.rentals, c: schema.customers, v: schema.vehicles })
    .from(schema.rentals)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
    .where(and(eq(schema.rentals.status, 'settled'), lt(schema.rentals.fineHoldUntil, vnStartOfDay(now) + DAY_MS)))
    .all();
  for (const { r: row, c, v } of rows) {
    let r = row;
    // Tra lại vào ngày đến hạn dù đã tra trước đó: phạt nguội thường lên hệ thống chậm vài tuần.
    if (!r.fineCheckedAt || r.fineCheckedAt < vnStartOfDay(r.fineHoldUntil!)) {
      const res = await checkRentalFines(r.id, null);
      if (!res.ok) {
        holdCheckRetryAt = now + 6 * HOUR_MS;
        await remindOnce(
          `hold-check-failed:${r.id}:${r.fineHoldUntil}`,
          `⚠️ <b>Đến hạn hoàn cọc</b> ${escapeHtml(v.plate)} · ${escapeHtml(r.code)} · ${escapeHtml(c.fullName)}\nChưa tự tra được phạt nguội: ${escapeHtml(res.error ?? '')}.\nTra tay (Phạt nguội → dán kết quả trang CSGT) trước khi hoàn cọc.`,
          now,
        );
        return;
      }
      r = getRental(r.id);
    }
    if (!(await remindOnce(`hold-check:${r.id}:${r.fineHoldUntil}`, holdCheckMessage(r, c, v), now))) return;
  }
}

/** Ghi các khoản thu chi định kỳ đến hạn (khoản định kỳ ghi theo ngày, mỗi giờ kiểm tra một lần là đủ). */
let recurringCheckedAt = 0;
function recurringCosts(now: number) {
  if (now - recurringCheckedAt < HOUR_MS) return;
  recurringCheckedAt = now;
  materializeRecurring(now);
}

let running = false;

export async function tick(now = Date.now()) {
  if (running) return;
  running = true;
  try {
    const lc = getLocalConfig();
    const today = vnDateKey(now);
    if (vnParts(now).hour >= lc.backup.nightlyHour && lc.backup.lastLocalDate !== today) {
      await runNightlyBackup();
      purgeExpiredSessions();
    }
    recurringCosts(now);
    // Hàng đợi thông báo theo giờ thật (tin được xếp hàng bằng Date.now()).
    await flushNotifyQueue();
    await digest(now);
    await overdueReturns(now);
    await upcomingPickups(now);
    await updateCheck(now);
    await autoUpdate(now);
    await fineCheck(now);
    await holdChecks(now);
  } catch (err) {
    console.error('scheduler tick failed', err);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), 60_000).unref();
}
