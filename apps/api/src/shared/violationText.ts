// Đọc thông tin vi phạm giao thông từ kết quả tra cứu (JSON của dịch vụ tra cứu,
// hoặc văn bản người dùng chép từ trang chính thức / app VNeTraffic). Hàm thuần.

import { unaccent } from './text.js';
import { VN_OFFSET_MS } from './time.js';

export interface FoundViolation {
  plate: string;
  violatedAt: number | null;
  timeText: string;
  location: string | null;
  violation: string | null;
  /** unpaid = chưa xử phạt, paid = đã xử phạt. */
  status: 'unpaid' | 'paid' | 'unknown';
  statusText: string | null;
  unit: string | null;
  resolvePlaces: string[];
}

/** "14:30, 28/09/2026" | "28/09/2026 14:30" | "14h30 ngày 28/09/2026" → epoch ms (giờ VN). */
export function parseVnDateTime(s: string): number | null {
  const date = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!date) return null;
  const time = /(\d{1,2})\s*[:hH]\s*(\d{2})/.exec(s.replace(date[0], ' '));
  const [d, m, y] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const [hh, mm] = time ? [Number(time[1]), Number(time[2])] : [0, 0];
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  return Date.UTC(y, m - 1, d, hh, mm) - VN_OFFSET_MS;
}

/** Bỏ mã điều khoản đầu chuỗi: "12321.5.a.01.Điều khiển xe…" → "Điều khiển xe…". */
export const cleanBehavior = (s: string) => s.replace(/^\s*[\d.]+[a-zđ]?\.[\d.]*\s*/i, '').trim();

type Raw = Record<string, unknown>;

/** Lấy giá trị theo tên trường tiếng Việt, không phân biệt dấu/hoa thường. */
function pick(raw: Raw, ...names: string[]): unknown {
  const keys = Object.keys(raw);
  for (const n of names) {
    const want = unaccent(n);
    const k = keys.find((x) => unaccent(x).includes(want));
    if (k) return raw[k];
  }
  return undefined;
}

const str = (v: unknown) => (v == null ? null : Array.isArray(v) ? v.join('\n') : String(v).trim() || null);

export function normalizeViolation(raw: Raw, fallbackPlate: string): FoundViolation {
  const timeText = str(pick(raw, 'thoi gian vi pham', 'thoi gian')) ?? '';
  const statusText = str(pick(raw, 'trang thai'));
  const st = statusText ? unaccent(statusText) : '';
  const places = pick(raw, 'noi giai quyet');
  return {
    plate: str(pick(raw, 'bien kiem soat', 'bien so')) ?? fallbackPlate,
    violatedAt: timeText ? parseVnDateTime(timeText) : null,
    timeText,
    location: str(pick(raw, 'dia diem')),
    violation: (() => {
      const v = str(pick(raw, 'hanh vi', 'loi vi pham'));
      return v ? cleanBehavior(v) : null;
    })(),
    status: st.includes('chua') ? 'unpaid' : st.includes('da xu') ? 'paid' : 'unknown',
    statusText,
    unit: str(pick(raw, 'don vi phat hien', 'don vi')),
    resolvePlaces: Array.isArray(places) ? places.map(String) : places ? [String(places)] : [],
  };
}

/**
 * Đọc văn bản người dùng dán vào (kết quả trang tra cứu / thông báo VNeTraffic).
 * Mỗi dòng "Tên trường: giá trị"; mỗi lần gặp lại "Biển kiểm soát" hoặc "Thời gian vi phạm"
 * đã có thì coi như sang vi phạm mới. Không có nhãn thì vẫn cố tìm ngày giờ.
 */
export function parseViolationText(text: string, fallbackPlate: string): FoundViolation[] {
  const blocks: Raw[] = [];
  let cur: Raw = {};
  let lastKey: string | null = null;
  const flush = () => {
    if (Object.keys(cur).length) blocks.push(cur);
    cur = {};
    lastKey = null;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t+/g, ': ').trim();
    if (!line) continue;
    const m = /^([^:]{3,40}):\s*(.*)$/.exec(line);
    if (m && !/^\d{1,2}$/.test(m[1].trim())) {
      const key = m[1].trim();
      const k = unaccent(key);
      const startsNew = (k.includes('bien kiem soat') || k.includes('thoi gian vi pham')) && Object.keys(cur).some((x) => unaccent(x) === k);
      if (startsNew) flush();
      cur[key] = m[2].trim();
      lastKey = key;
    } else if (lastKey) {
      cur[lastKey] = `${String(cur[lastKey])} ${line}`.trim();
    }
  }
  flush();
  let found = blocks.map((b) => normalizeViolation(b, fallbackPlate)).filter((v) => v.violatedAt != null || v.violation);
  if (!found.length) {
    // Không có nhãn: lấy mọi cụm ngày giờ trong văn bản.
    const times = text.match(/\d{1,2}\s*[:hH]\s*\d{2}[^\d\n]{0,12}\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4}[^\d\n]{0,6}\d{1,2}\s*[:hH]\s*\d{2}/g) ?? [];
    found = times.map((t) => ({ plate: fallbackPlate, violatedAt: parseVnDateTime(t), timeText: t, location: null, violation: null, status: 'unknown', statusText: null, unit: null, resolvePlaces: [] }));
  }
  return found;
}

