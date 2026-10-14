// Gửi tin nhắn / file qua Telegram Bot API. Cấu hình ở localConfig (ngoài DB).

import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { fmtDateTime } from '../shared/time.js';
import { getLocalConfig } from './localConfig.js';

export const TELEGRAM_MAX_BYTES = 49 * 1024 * 1024; // chừa lề dưới trần 50MB của Bot API

export function telegramConfigured(): boolean {
  const t = getLocalConfig().telegram;
  return Boolean(t.botToken && t.chatId);
}

async function call(method: string, body: FormData | Record<string, unknown>, token?: string, chatId?: string, timeoutMs = 120_000) {
  const t = getLocalConfig().telegram;
  const tok = token ?? t.botToken;
  const chat = chatId ?? t.chatId;
  if (!tok || !chat) throw new Error('Chưa cấu hình Telegram bot token / chat ID');
  let init: RequestInit;
  if (body instanceof FormData) {
    body.set('chat_id', chat);
    init = { method: 'POST', body };
  } else {
    init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, ...body }) };
  }
  const res = await fetch(`https://api.telegram.org/bot${tok}/${method}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) throw new Error(`Telegram trả lỗi: ${data.description ?? `HTTP ${res.status}`}`);
  return data;
}

const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
export { escapeHtml };

/** Gửi tin nhắn HTML. */
export async function sendTelegram(html: string, opts: { token?: string; chatId?: string } = {}): Promise<void> {
  await call('sendMessage', { text: html, parse_mode: 'HTML', disable_web_page_preview: true }, opts.token, opts.chatId, 20_000);
}

// ── Thông báo một lần, có hàng đợi gửi lại ────────────────────────────────

/** Phút chờ giữa các lần gửi lại (lần sau cùng lặp lại tới khi quá hạn bỏ). */
const RETRY_MINUTES = [1, 5, 15, 30, 60];
/** Quá 24 giờ vẫn không gửi được thì bỏ (tin đã quá cũ). */
const GIVE_UP_MS = 24 * 3600_000;
/** Gửi chậm hơn chừng này thì ghi kèm giờ gốc của tin. */
const LATE_MS = 5 * 60_000;

function notifyEnabled(): boolean {
  const t = getLocalConfig().telegram;
  return Boolean(t.notify && t.botToken && t.chatId);
}

async function deliver(m: { id: number; html: string; attempts: number; createdAt: number }, now: number): Promise<boolean> {
  const late = now - m.createdAt > LATE_MS ? `<i>⏳ Tin lúc ${fmtDateTime(m.createdAt)} — gửi lại do lỗi mạng</i>\n` : '';
  try {
    await sendTelegram(late + m.html);
    db.update(schema.notifyQueue).set({ sentAt: Date.now(), attempts: m.attempts + 1, lastError: null }).where(eq(schema.notifyQueue.id, m.id)).run();
    return true;
  } catch (err) {
    const n = m.attempts + 1;
    const wait = RETRY_MINUTES[Math.min(n, RETRY_MINUTES.length) - 1] * 60_000;
    db.update(schema.notifyQueue)
      .set({ attempts: n, lastError: (err as Error).message.slice(0, 300), nextAttemptAt: now + wait })
      .where(eq(schema.notifyQueue.id, m.id))
      .run();
    console.error('telegram notify failed:', (err as Error).message);
    return false;
  }
}

/**
 * Thông báo một lần (đặt xe mới, đã giao xe, phạt nguội mới…): vào hàng đợi rồi gửi ngay.
 * Mất mạng / Telegram lỗi thì vòng định kỳ gửi lại sau 1, 5, 15… phút — không mất tin. Tắt thông báo thì bỏ qua.
 */
export function notify(html: string): void {
  if (!notifyEnabled()) return;
  const now = Date.now();
  // Giữ chỗ 2 phút: vòng gửi lại định kỳ không gửi trùng khi lần gửi ngay chưa xong.
  const m = db.insert(schema.notifyQueue).values({ html, nextAttemptAt: now + 2 * 60_000, createdAt: now }).returning().get();
  void deliver(m, now);
}

/** Gửi lại các tin đến lượt (scheduler gọi mỗi phút). Telegram còn lỗi thì dừng vòng này. Trả số tin đã gửi. */
export async function flushNotifyQueue(now = Date.now()): Promise<number> {
  const q = schema.notifyQueue;
  db.delete(q)
    .where(or(lt(q.sentAt, now - 30 * 24 * 3600_000), lt(q.droppedAt, now - 30 * 24 * 3600_000)))
    .run();
  if (!notifyEnabled()) return 0;
  db.update(q)
    .set({ droppedAt: now })
    .where(and(isNull(q.sentAt), isNull(q.droppedAt), lt(q.createdAt, now - GIVE_UP_MS)))
    .run();
  const due = db
    .select()
    .from(q)
    .where(and(isNull(q.sentAt), isNull(q.droppedAt), lte(q.nextAttemptAt, now)))
    .orderBy(asc(q.id))
    .limit(20)
    .all();
  let sent = 0;
  for (const m of due) {
    if (!(await deliver(m, now))) break;
    sent++;
  }
  return sent;
}

/**
 * Gửi thông báo và chờ kết quả — dùng cho nhắc việc chỉ được đánh dấu "đã nhắc" khi gửi được.
 * off = đang tắt thông báo / chưa cấu hình (không cần thử lại).
 */
export async function notifyNow(html: string): Promise<'sent' | 'off' | 'failed'> {
  const t = getLocalConfig().telegram;
  if (!t.notify || !t.botToken || !t.chatId) return 'off';
  try {
    await sendTelegram(html);
    return 'sent';
  } catch (err) {
    console.error('telegram notify failed:', (err as Error).message);
    return 'failed';
  }
}

export async function sendTelegramDocument(data: Buffer, fileName: string, caption: string): Promise<void> {
  if (data.length > TELEGRAM_MAX_BYTES) throw new Error(`File ${fileName} vượt trần 50MB của Telegram`);
  const form = new FormData();
  form.append('caption', caption);
  form.append('document', new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }), fileName);
  await call('sendDocument', form);
}
