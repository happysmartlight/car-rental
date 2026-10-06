// Gửi tin nhắn / file qua Telegram Bot API. Cấu hình ở localConfig (ngoài DB).

import { getLocalConfig } from './localConfig.js';

export const TELEGRAM_MAX_BYTES = 49 * 1024 * 1024; // chừa lề dưới trần 50MB của Bot API

export function telegramConfigured(): boolean {
  const t = getLocalConfig().telegram;
  return Boolean(t.botToken && t.chatId);
}

async function call(method: string, body: FormData | Record<string, unknown>, token?: string, chatId?: string) {
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
  const res = await fetch(`https://api.telegram.org/bot${tok}/${method}`, { ...init, signal: AbortSignal.timeout(120_000) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) throw new Error(`Telegram trả lỗi: ${data.description ?? `HTTP ${res.status}`}`);
  return data;
}

const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
export { escapeHtml };

/** Gửi tin nhắn HTML. */
export async function sendTelegram(html: string, opts: { token?: string; chatId?: string } = {}): Promise<void> {
  await call('sendMessage', { text: html, parse_mode: 'HTML', disable_web_page_preview: true }, opts.token, opts.chatId);
}

/** Gửi tin nhắn nhưng không bao giờ ném lỗi (thông báo phụ). Bỏ qua nếu tắt thông báo. */
export function notify(html: string): void {
  const t = getLocalConfig().telegram;
  if (!t.notify || !t.botToken || !t.chatId) return;
  sendTelegram(html).catch((err) => console.error('telegram notify failed:', (err as Error).message));
}

export async function sendTelegramDocument(data: Buffer, fileName: string, caption: string): Promise<void> {
  if (data.length > TELEGRAM_MAX_BYTES) throw new Error(`File ${fileName} vượt trần 50MB của Telegram`);
  const form = new FormData();
  form.append('caption', caption);
  form.append('document', new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }), fileName);
  await call('sendDocument', form);
}
