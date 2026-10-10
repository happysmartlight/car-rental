// Việc chạy định kỳ trong app (không cần cron hệ thống). Mỗi phút kiểm tra một lần.

import { and, eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { buildDigest, handoversSoon } from '../services/alerts.js';
import { materializeRecurring } from '../services/cashflow.js';
import { runFleetFineCheck } from '../services/fineCheck.js';
import { startUpdate } from '../services/updateFlow.js';
import { HOUR_MS, fmtDateTime, vnDateKey, vnParts } from '../shared/time.js';
import { purgeExpiredSessions } from './auth.js';
import { runNightlyBackup } from './backup.js';
import { getLocalConfig, updateLocalConfig } from './localConfig.js';
import { escapeHtml, notify, sendTelegram, telegramConfigured } from './telegram.js';
import { checkReleases, readUpdaterState, updateAvailable } from './updater.js';

function once(key: string): boolean {
  const done = db.select().from(schema.reminderLog).where(eq(schema.reminderLog.key, key)).get();
  if (done) return false;
  db.insert(schema.reminderLog).values({ key, sentAt: Date.now() }).run();
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
    if (!once(key)) continue;
    notify(
      late
        ? `⏰ <b>Quá hạn trả xe</b> ${escapeHtml(v.plate)}\n${escapeHtml(r.code)} · ${escapeHtml(c.fullName)} · ${escapeHtml(c.phone ?? '')}\nHẹn trả ${fmtDateTime(r.scheduledEnd)}`
        : `🔔 <b>Sắp đến giờ nhận xe</b> ${escapeHtml(v.plate)} lúc ${fmtDateTime(r.scheduledEnd)}\n${escapeHtml(r.code)} · ${escapeHtml(c.fullName)} · ${escapeHtml(c.phone ?? '')}`,
    );
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

async function digest(now: number) {
  const lc = getLocalConfig();
  const today = vnDateKey(now);
  if (!lc.telegram.dailyDigest || !telegramConfigured() || lc.digest.lastDate === today) return;
  if (vnParts(now).hour < lc.telegram.digestHour) return;
  updateLocalConfig((c) => {
    c.digest.lastDate = today;
  });
  const text = buildDigest(now);
  if (text) await sendTelegram(text).catch((err) => console.error('digest failed', err));
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
    await digest(now);
    await overdueReturns(now);
    await updateCheck(now);
    await autoUpdate(now);
    await fineCheck(now);
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
