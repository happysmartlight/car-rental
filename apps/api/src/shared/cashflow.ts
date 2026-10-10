// Sổ thu chi: hạng mục, kỳ báo cáo (tháng/năm theo giờ VN), khoản định kỳ, chia chi phí chung.
//
// Thu chi tính theo TIỀN THẬT đi vào/ra (ngày nhận/chi tiền):
//   thu tiền thuê = khách trả tiền thuê − hoàn tiền thuê + phần cọc cấn trừ sang tiền thuê
//   (tiền cọc đang giữ là tiền của khách, không tính là thu).
//   chi = các khoản ghi trong sổ (cash_entries).
// Nhóm "Vốn & tài chính" (mua xe, trả góp, bán xe) tách riêng: không làm sai lãi vận hành
// của tháng, nhưng vẫn có trong dòng tiền ròng.

import { HOUR_MS, VN_OFFSET_MS, vnParts } from './time.js';

export type CashDirection = 'in' | 'out';

export const CASH_METHODS = ['cash', 'transfer'] as const;
export type CashMethod = (typeof CASH_METHODS)[number];

export const CASH_GROUPS = ['operate', 'repair', 'legal', 'overhead', 'income', 'capital'] as const;
export type CashGroup = (typeof CASH_GROUPS)[number];
export const CASH_GROUP_LABEL: Record<CashGroup, string> = {
  operate: 'Vận hành xe',
  repair: 'Bảo dưỡng & sửa chữa',
  legal: 'Giấy tờ, bảo hiểm, phạt',
  overhead: 'Chi phí chung',
  capital: 'Vốn & tài chính',
  income: 'Thu khác',
};

export const CASH_CATEGORIES = [
  'fuel',
  'cleaning',
  'parking',
  'toll',
  'delivery',
  'maintenance',
  'repair',
  'parts',
  'accessory',
  'inspection',
  'insurance',
  'road_fee',
  'fine',
  'premises',
  'salary',
  'marketing',
  'tax',
  'other',
  'owner_payout',
  'loan',
  'purchase',
  'insurance_claim',
  'other_income',
  'asset_sale',
] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

/** Ghi chi phí xong có thể gia hạn luôn giấy tờ / mốc bảo dưỡng của xe. */
export type RenewKind = 'inspection' | 'insurance' | 'road_fee' | 'service';

export interface CashCategoryInfo {
  label: string;
  dir: CashDirection;
  group: CashGroup;
  /** Vốn & tài chính: không tính vào lãi vận hành, chỉ vào dòng tiền ròng. */
  capital?: boolean;
  /** Thường là chi phí chung của cả cửa hàng (không gắn xe). */
  shared?: boolean;
  /** Gợi ý ô nội dung. */
  placeholder?: string;
  renew?: RenewKind;
  /** Có ô ODO lúc làm. */
  odo?: boolean;
}

export const CASH_CATEGORY: Record<CashCategory, CashCategoryInfo> = {
  fuel: { label: 'Xăng, sạc điện', dir: 'out', group: 'operate', placeholder: 'Đổ đầy bình trước khi giao xe' },
  cleaning: { label: 'Rửa xe, vệ sinh', dir: 'out', group: 'operate', placeholder: 'Rửa xe, hút bụi, khử mùi' },
  parking: { label: 'Bến bãi, gửi xe', dir: 'out', group: 'operate', shared: true, placeholder: 'Tiền bãi đậu xe tháng' },
  toll: { label: 'Phí cầu đường, nạp ETC', dir: 'out', group: 'operate', placeholder: 'Nạp tiền thẻ ETC' },
  delivery: { label: 'Đi lại giao nhận xe', dir: 'out', group: 'operate', placeholder: 'Grab / xe ôm về sau khi giao xe' },
  maintenance: { label: 'Bảo dưỡng định kỳ', dir: 'out', group: 'repair', renew: 'service', odo: true, placeholder: 'Thay dầu, lọc nhớt, lọc gió' },
  repair: { label: 'Sửa chữa, đồng sơn', dir: 'out', group: 'repair', odo: true, placeholder: 'Sơn lại cản sau, gò móp cửa' },
  parts: { label: 'Lốp, ắc quy, phụ tùng', dir: 'out', group: 'repair', odo: true, placeholder: 'Thay 2 lốp trước' },
  accessory: { label: 'Phụ kiện, trang bị', dir: 'out', group: 'repair', placeholder: 'Camera hành trình, thảm sàn' },
  inspection: { label: 'Đăng kiểm', dir: 'out', group: 'legal', renew: 'inspection', placeholder: 'Đăng kiểm định kỳ' },
  insurance: { label: 'Bảo hiểm xe', dir: 'out', group: 'legal', renew: 'insurance', placeholder: 'Bảo hiểm thân vỏ 1 năm' },
  road_fee: { label: 'Phí đường bộ', dir: 'out', group: 'legal', renew: 'road_fee' },
  fine: { label: 'Nộp phạt nguội', dir: 'out', group: 'legal', placeholder: 'Nộp phạt vượt đèn đỏ ngày …' },
  premises: { label: 'Mặt bằng, điện nước, internet', dir: 'out', group: 'overhead', shared: true },
  salary: { label: 'Lương, thưởng nhân viên', dir: 'out', group: 'overhead', shared: true },
  marketing: { label: 'Quảng cáo, nền tảng', dir: 'out', group: 'overhead', shared: true, placeholder: 'Quảng cáo Facebook, phí sàn' },
  tax: { label: 'Thuế, phí, lệ phí', dir: 'out', group: 'overhead', shared: true },
  other: { label: 'Chi khác', dir: 'out', group: 'overhead' },
  owner_payout: { label: 'Trả chủ xe ký gửi', dir: 'out', group: 'overhead', placeholder: 'Chia doanh thu tháng cho chủ xe' },
  loan: { label: 'Trả góp, lãi vay', dir: 'out', group: 'capital', capital: true, placeholder: 'Trả góp ngân hàng kỳ tháng' },
  purchase: { label: 'Mua xe, nâng cấp lớn', dir: 'out', group: 'capital', capital: true },
  insurance_claim: { label: 'Bảo hiểm bồi thường', dir: 'in', group: 'income', placeholder: 'Bảo hiểm chi trả sửa chữa' },
  other_income: { label: 'Thu khác', dir: 'in', group: 'income' },
  asset_sale: { label: 'Bán xe, thanh lý', dir: 'in', group: 'capital', capital: true },
};

export function categoriesOf(dir: CashDirection): CashCategory[] {
  return CASH_CATEGORIES.filter((c) => CASH_CATEGORY[c].dir === dir);
}

/** Hạng mục theo nhóm (cho ô chọn có nhóm). */
export function groupedCategories(dir: CashDirection): { group: CashGroup; label: string; items: CashCategory[] }[] {
  return CASH_GROUPS.map((group) => ({ group, label: CASH_GROUP_LABEL[group], items: categoriesOf(dir).filter((c) => CASH_CATEGORY[c].group === group) })).filter((g) => g.items.length);
}

// ── Kỳ báo cáo ─────────────────────────────────────────────────────────────

const p2 = (n: number) => String(n).padStart(2, '0');

/** Mốc 00:00 giờ VN ngày 1 của tháng (tháng tràn được: 13 → tháng 1 năm sau). */
export function vnMonthStart(year: number, month: number): number {
  return Date.UTC(year, month - 1, 1) - VN_OFFSET_MS;
}

/** "YYYY-MM" theo giờ VN. */
export function monthKeyOf(ms: number): string {
  const p = vnParts(ms);
  return `${p.year}-${p2(p.month)}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** Cộng k tháng vào khóa "YYYY-MM". */
export function addMonthKey(key: string, k: number): string {
  const p = parseMonthKey(key)!;
  const idx = p.year * 12 + (p.month - 1) + k;
  return `${Math.floor(idx / 12)}-${p2((idx % 12) + 1)}`;
}

export function monthDiff(a: string, b: string): number {
  const x = parseMonthKey(a)!;
  const y = parseMonthKey(b)!;
  return (y.year - x.year) * 12 + (y.month - x.month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "Tháng 10/2026" */
export function fmtMonthKey(key: string): string {
  const p = parseMonthKey(key);
  return p ? `Tháng ${p.month}/${p.year}` : key;
}

export type PeriodKind = 'month' | 'year';

export interface Period {
  kind: PeriodKind;
  key: string;
  start: number;
  end: number;
  label: string;
  /** 12 tháng của biểu đồ: năm → 12 tháng của năm đó; tháng → 12 tháng tính lùi tới tháng đó. */
  trend: string[];
}

/** "2026-10" = tháng, "2026" = năm. */
export function parsePeriod(key: string): Period | null {
  if (/^\d{4}$/.test(key)) {
    const year = Number(key);
    if (year < 2000 || year > 2100) return null;
    return {
      kind: 'year',
      key,
      start: vnMonthStart(year, 1),
      end: vnMonthStart(year + 1, 1),
      label: `Năm ${year}`,
      trend: Array.from({ length: 12 }, (_, i) => `${year}-${p2(i + 1)}`),
    };
  }
  const m = parseMonthKey(key);
  if (!m || m.year < 2000 || m.year > 2100) return null;
  return {
    kind: 'month',
    key,
    start: vnMonthStart(m.year, m.month),
    end: vnMonthStart(m.year, m.month + 1),
    label: fmtMonthKey(key),
    trend: Array.from({ length: 12 }, (_, i) => addMonthKey(key, i - 11)),
  };
}

export function currentPeriodKey(kind: PeriodKind, now = Date.now()): string {
  const p = vnParts(now);
  return kind === 'year' ? String(p.year) : `${p.year}-${p2(p.month)}`;
}

/** Kỳ trước / sau. */
export function shiftPeriod(key: string, delta: number): string {
  if (/^\d{4}$/.test(key)) return String(Number(key) + delta);
  return addMonthKey(key, delta);
}

/** Đổi giữa xem tháng và xem năm, giữ năm đang xem (về tháng: tháng hiện tại nếu cùng năm, không thì tháng 12). */
export function switchPeriodKind(key: string, kind: PeriodKind, now = Date.now()): string {
  const isYear = /^\d{4}$/.test(key);
  if (kind === 'year') return isYear ? key : key.slice(0, 4);
  if (!isYear) return key;
  const cur = currentPeriodKey('month', now);
  return cur.startsWith(key) ? cur : `${key}-12`;
}

// ── Khoản định kỳ ──────────────────────────────────────────────────────────

export const RECUR_INTERVALS = [1, 3, 6, 12] as const;
export const RECUR_INTERVAL_LABEL: Record<number, string> = { 1: 'Hằng tháng', 3: '3 tháng một lần', 6: '6 tháng một lần', 12: 'Hằng năm' };

export interface RecurringRule {
  startMonth: string;
  endMonth: string | null;
  intervalMonths: number;
  dayOfMonth: number;
}

/** Thời điểm ghi khoản của kỳ `monthKey`: 9h sáng ngày `day` (tháng thiếu ngày thì lấy ngày cuối tháng). */
export function recurringDate(monthKey: string, day: number): number {
  const p = parseMonthKey(monthKey)!;
  const d = Math.min(Math.max(1, day), daysInMonth(p.year, p.month));
  return Date.UTC(p.year, p.month - 1, d) - VN_OFFSET_MS + 9 * HOUR_MS;
}

/** Các kỳ (tháng "YYYY-MM") đã đến hạn ghi tính tới `now`. */
export function dueRecurringMonths(rule: RecurringRule, now = Date.now()): string[] {
  const step = Math.max(1, rule.intervalMonths);
  const out: string[] = [];
  let m = rule.startMonth;
  for (let i = 0; i < 1200; i++) {
    if (rule.endMonth && monthDiff(m, rule.endMonth) < 0) break;
    if (recurringDate(m, rule.dayOfMonth) > now) break;
    out.push(m);
    m = addMonthKey(m, step);
  }
  return out;
}

/** "Hằng tháng, ngày 5" */
export function recurringText(rule: Pick<RecurringRule, 'intervalMonths' | 'dayOfMonth'>): string {
  return `${RECUR_INTERVAL_LABEL[rule.intervalMonths] ?? `${rule.intervalMonths} tháng một lần`}, ngày ${rule.dayOfMonth}`;
}

/** Kỳ ghi tiếp theo sau `now` (null nếu đã hết hạn). */
export function nextRecurringDate(rule: RecurringRule, now = Date.now()): number | null {
  const due = dueRecurringMonths(rule, now);
  const next = due.length ? addMonthKey(due[due.length - 1], Math.max(1, rule.intervalMonths)) : rule.startMonth;
  if (rule.endMonth && monthDiff(next, rule.endMonth) < 0) return null;
  return recurringDate(next, rule.dayOfMonth);
}

// ── Chia chi phí chung ─────────────────────────────────────────────────────

/** Chia đều số nguyên `total` cho n phần, phần dư dồn vào các phần đầu — tổng luôn khớp. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(total));
  const base = Math.floor(abs / n);
  const rest = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rest ? 1 : 0)));
}

/** Tỷ lệ % làm tròn, null khi mẫu bằng 0. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Số tiền gọn cho trục biểu đồ: 950k, 12,5tr, 1,2 tỷ. */
export function fmtCompactVnd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const trim = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',');
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)} tỷ`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}tr`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
  return `${sign}${abs}`;
}

/** Đầu ngày VN của "YYYY-MM-DD" + giờ trưa (để ngày không lệch dù đổi múi giờ). */
export function dateKeyToNoon(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - VN_OFFSET_MS + 12 * HOUR_MS;
}
