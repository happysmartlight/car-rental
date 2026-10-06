// Mọi thứ hiển thị/tính theo giờ Việt Nam (UTC+7, không có giờ mùa hè), bất kể
// máy chủ hay trình duyệt đang đặt múi giờ nào. Lệch giờ ở đây = tra phạt nguội
// ra sai người, nên không dựa vào TZ của máy.

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface VnParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Chủ nhật … 6 = Thứ bảy
}

export function vnParts(ms: number): VnParts {
  const d = new Date(ms + VN_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" theo giờ VN. */
export function vnDateKey(ms: number): string {
  const p = vnParts(ms);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`;
}

/** Mốc 00:00 giờ VN của ngày chứa `ms`. */
export function vnStartOfDay(ms: number): number {
  const p = vnParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day) - VN_OFFSET_MS;
}

/** "YYYY-MM-DD" (giờ VN) → epoch ms lúc 00:00 giờ VN. */
export function vnDateKeyToMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - VN_OFFSET_MS;
}

/** "YYYY-MM-DDTHH:mm" (giờ VN, như input datetime-local) → epoch ms. */
export function vnLocalInputToMs(value: string): number {
  const [date, time = '00:00'] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - VN_OFFSET_MS;
}

/** epoch ms → "YYYY-MM-DDTHH:mm" giờ VN, dùng cho input datetime-local. */
export function msToVnLocalInput(ms: number): string {
  const p = vnParts(ms);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}T${p2(p.hour)}:${p2(p.minute)}`;
}

export function fmtDate(ms: number | null | undefined): string {
  if (ms == null) return '';
  const p = vnParts(ms);
  return `${p2(p.day)}/${p2(p.month)}/${p.year}`;
}

export function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return '';
  const p = vnParts(ms);
  return `${p2(p.hour)}:${p2(p.minute)}`;
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (ms == null) return '';
  return `${fmtTime(ms)} ${fmtDate(ms)}`;
}

/** "YYYY-MM-DD" → "dd/MM/yyyy". Chuỗi rỗng/không hợp lệ trả nguyên. */
export function fmtDateKey(key: string | null | undefined): string {
  if (!key) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : key;
}

/** "ngày 06 tháng 10 năm 2026" — kiểu ghi trên hợp đồng. */
export function vnDateLong(ms: number): string {
  const p = vnParts(ms);
  return `ngày ${p2(p.day)} tháng ${p2(p.month)} năm ${p.year}`;
}

export const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const WEEKDAY_LONG = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

/** Số ngày từ hôm nay (giờ VN) đến ngày `key`. Âm = đã qua. */
export function daysUntil(key: string, now = Date.now()): number {
  return Math.round((vnDateKeyToMs(key) - vnStartOfDay(now)) / DAY_MS);
}

/** "2 ngày 5 giờ" từ một khoảng ms. */
export function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} ngày`);
  if (h) parts.push(`${h} giờ`);
  if (m && !d) parts.push(`${m} phút`);
  return parts.join(' ') || '0 phút';
}
