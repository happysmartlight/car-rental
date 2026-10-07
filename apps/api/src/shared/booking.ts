// Gợi ý giờ nhận/trả khi bấm (hoặc kéo) vào ô ngày trống trên Lịch xe.
// Cùng luật trùng lịch với máy chủ (findConflicts): chỉ lượt đã đặt/đang thuê mới chiếm xe,
// có khoảng đệm dọn xe giữa 2 lượt; khối tạm ngưng thì không cần đệm.

import { DAY_MS, HOUR_MS, vnStartOfDay } from './time.js';

/** Giờ nhận mặc định ("HH:mm", giờ VN) khi ngày đó xe rảnh từ sáng — chỉnh trong Cài đặt → Quy tắc. */
export const DEFAULT_PICKUP_TIME = '08:30';
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" → số phút từ 0:00; sai định dạng thì lấy giờ mặc định. */
function pickupMinutes(time: string | undefined): number {
  const m = TIME_RE.exec(time ?? '') ?? TIME_RE.exec(DEFAULT_PICKUP_TIME)!;
  return Number(m[1]) * 60 + Number(m[2]);
}
/** Khe trống ngắn hơn thì không kéo giờ trả về nữa — để form báo trùng lịch. */
const MIN_SLOT_MS = 2 * HOUR_MS;
const HALF_HOUR_MS = 30 * 60_000;

export interface BusyItem {
  type: 'rental' | 'block';
  status: string;
  start: number;
  end: number;
}

export interface BookingSlot<T extends BusyItem> {
  start: number;
  end: number;
  /** Giờ nhận bị lùi lại vì lượt/khối này (xe chưa về hoặc đang dọn). */
  after?: T;
  /** Giờ trả bị kéo sớm cho kịp lượt/khối này. */
  before?: T;
}

const ceilHalfHour = (ms: number) => Math.ceil(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
const floorHalfHour = (ms: number) => Math.floor(ms / HALF_HOUR_MS) * HALF_HOUR_MS;

/**
 * Chọn giờ nhận/trả cho dải ngày [firstDay, lastDay] (tính cả 2 đầu) của một xe:
 * - Nhận vào giờ mặc định (8:30), hoặc sớm nhất có thể nếu là hôm nay (sau 1 tiếng, tròn nửa giờ).
 * - Xe còn bận lúc đó (lượt trước chưa trả + dọn xe) → lùi giờ nhận, miễn còn trong ngày đã chọn.
 * - Thuê đủ số ngày đã chọn (24h/ngày); vướng lượt kế tiếp thì trả sớm hơn cho kịp dọn xe.
 * Ngày đã kín hẳn thì giữ giờ mặc định để form báo trùng lịch.
 */
export function suggestBookingSlot<T extends BusyItem>(opts: {
  firstDay: number;
  lastDay?: number;
  items: T[];
  bufferMs: number;
  now: number;
  /** "HH:mm" giờ VN; bỏ trống = DEFAULT_PICKUP_TIME. */
  pickupTime?: string;
}): BookingSlot<T> {
  const day = vnStartOfDay(opts.firstDay);
  const days = Math.max(1, Math.round((vnStartOfDay(opts.lastDay ?? opts.firstDay) - day) / DAY_MS) + 1);
  const busy = opts.items.filter((i) => i.type === 'block' || i.status === 'booked' || i.status === 'active');
  const pad = (i: T) => (i.type === 'block' ? 0 : opts.bufferMs);

  const preferred = Math.max(day + pickupMinutes(opts.pickupTime) * 60_000, ceilHalfHour(opts.now + HOUR_MS));
  let start = preferred;
  let after: T | undefined;
  for (let moved = true; moved; ) {
    moved = false;
    for (const i of busy) {
      if (i.start < start + pad(i) && i.end + pad(i) > start) {
        start = ceilHalfHour(i.end + pad(i));
        after = i;
        moved = true;
      }
    }
  }
  if (start >= day + DAY_MS) {
    start = preferred;
    after = undefined;
  }

  let end = start + days * DAY_MS;
  let before: T | undefined;
  const next = busy.filter((i) => i.start >= start && i.start - pad(i) < end).sort((a, b) => a.start - b.start)[0];
  if (next) {
    const cap = floorHalfHour(next.start - pad(next));
    if (cap - start >= MIN_SLOT_MS) {
      end = cap;
      before = next;
    }
  }
  return { start, end, after, before };
}
