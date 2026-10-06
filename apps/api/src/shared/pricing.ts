// Bộ tính giá thuê. Hàm thuần — API và web dùng chung để số trên màn hình
// luôn khớp số ghi vào hợp đồng.
//
// Quy ước:
// - Tính theo khối 24 giờ kể từ giờ nhận xe. Khối nào bắt đầu vào ngày cuối
//   tuần (giờ VN) thì lấy giá cuối tuần; rơi vào kỳ lễ thì cộng % phụ thu.
// - Giờ lẻ sau các khối 24h: trong ân hạn thì bỏ qua; ≤ `hourlyMaxHours` và rẻ
//   hơn 1 ngày thì tính theo giờ; còn lại tính thêm 1 ngày.
// - Xe có giá tháng: tính thêm phương án theo tháng dương lịch (ngày lẻ = giá tháng ÷ 30,
//   không phụ thu cuối tuần/lễ) và lấy phương án RẺ HƠN. Thuê chưa đủ tháng mà tính ngày
//   đắt hơn giá tháng → áp giá 1 tháng.

import type { ChargeKind } from './constants.js';
import { DAY_MS, HOUR_MS, addMonthsVn, fmtDuration, vnDateKey, vnParts } from './time.js';
import { fmtNumber } from './text.js';

export interface VehiclePricing {
  priceDay: number;
  priceHour: number;
  priceWeekendDay: number | null;
  kmLimitDay: number;
  overKmFee: number;
  overHourFee: number;
  /** Giá thuê tháng (null/0 = không nhận thuê tháng). Bảng giá cũ chưa có trường này. */
  priceMonth?: number | null;
  /** Giới hạn km mỗi tháng (null/0 = 30 × km/ngày). */
  kmLimitMonth?: number | null;
}

export interface Holiday {
  name: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (tính cả ngày này)
  surchargePct: number;
}

export interface PricingRules {
  weekendDays: number[]; // 0 = CN … 6 = T7
  hourlyMaxHours: number;
  graceMinutes: number;
  holidays: Holiday[];
}

export const DEFAULT_PRICING_RULES: PricingRules = {
  weekendDays: [0, 6],
  hourlyMaxHours: 6,
  graceMinutes: 60,
  holidays: [],
};

export interface PriceLine {
  kind: ChargeKind;
  description: string;
  amount: number;
}

export interface Quote {
  /** Cách tính đã áp: theo ngày hay theo tháng. */
  mode: 'day' | 'month';
  months: number;
  days: number;
  extraHours: number;
  kmLimit: number;
  lines: PriceLine[];
  total: number;
}

const roundK = (n: number) => Math.round(n / 1000) * 1000;

function holidayFor(ms: number, holidays: Holiday[]): Holiday | undefined {
  const key = vnDateKey(ms);
  return holidays.find((h) => h.from <= key && key <= h.to);
}

export function quoteRental(start: number, end: number, p: VehiclePricing, rules: PricingRules): Quote {
  const daily = quoteDaily(start, end, p, rules);
  if (!p.priceMonth || p.priceMonth <= 0 || !(end > start)) return daily;
  const monthly = quoteMonthly(start, end, p, rules);
  return monthly.total <= daily.total ? monthly : daily;
}

/** Km cho mỗi tháng thuê. 0 = không giới hạn. */
export function monthKmLimit(p: VehiclePricing): number {
  if (p.kmLimitMonth && p.kmLimitMonth > 0) return p.kmLimitMonth;
  return p.kmLimitDay > 0 ? p.kmLimitDay * 30 : 0;
}

/** Giá một ngày lẻ khi thuê tháng. */
export const monthDayRate = (p: VehiclePricing) => roundK((p.priceMonth ?? 0) / 30);

function quoteMonthly(start: number, end: number, p: VehiclePricing, rules: PricingRules): Quote {
  const priceMonth = p.priceMonth ?? 0;
  const grace = rules.graceMinutes * 60_000;
  const perMonthKm = monthKmLimit(p);
  let months = 0;
  while (addMonthsVn(start, months + 1) <= end + grace) months++;

  if (months === 0) {
    const line: PriceLine = { kind: 'rental', description: 'Thuê tháng (áp giá 1 tháng — rẻ hơn tính theo ngày)', amount: priceMonth };
    return { mode: 'month', months: 1, days: 0, extraHours: 0, kmLimit: perMonthKm, lines: [line], total: priceMonth };
  }

  const lines: PriceLine[] = [{ kind: 'rental', description: `Thuê tháng ${months} tháng × ${fmtNumber(priceMonth)}`, amount: months * priceMonth }];
  const dayRate = monthDayRate(p);
  const remMs = Math.max(0, end - addMonthsVn(start, months));
  let remDays = 0;
  let hourly = 0;
  if (remMs > grace) {
    remDays = Math.floor(remMs / DAY_MS);
    const leftover = remMs - remDays * DAY_MS;
    const remHours = leftover > (remDays > 0 ? grace : 0) ? Math.ceil(leftover / HOUR_MS) : 0;
    if (remHours > 0) {
      if (p.priceHour > 0 && remHours <= rules.hourlyMaxHours && remHours * p.priceHour < dayRate) hourly = remHours;
      else remDays += 1;
    }
  }
  const remAmount = remDays * dayRate + hourly * p.priceHour;
  if (remAmount >= priceMonth) {
    lines.push({ kind: 'rental', description: 'Phần lẻ (tối đa bằng 1 tháng)', amount: priceMonth });
  } else {
    if (remDays) lines.push({ kind: 'rental', description: `Ngày lẻ ${remDays} ngày × ${fmtNumber(dayRate)} (giá tháng ÷ 30)`, amount: remDays * dayRate });
    if (hourly) lines.push({ kind: 'rental', description: `Giờ lẻ ${hourly} giờ × ${fmtNumber(p.priceHour)}`, amount: hourly * p.priceHour });
  }
  return {
    mode: 'month',
    months,
    days: remDays,
    extraHours: hourly,
    kmLimit: perMonthKm > 0 ? months * perMonthKm + Math.round((remDays * perMonthKm) / 30) : 0,
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
  };
}

function quoteDaily(start: number, end: number, p: VehiclePricing, rules: PricingRules): Quote {
  const dur = end - start;
  if (!(dur > 0)) return { mode: 'day', months: 0, days: 0, extraHours: 0, kmLimit: 0, lines: [], total: 0 };

  const fullDays = Math.floor(dur / DAY_MS);
  const remMs = dur - fullDays * DAY_MS;
  const grace = rules.graceMinutes * 60_000;
  const remHours = remMs > (fullDays > 0 ? grace : 0) ? Math.ceil(remMs / HOUR_MS) : 0;

  let dayBlocks = fullDays;
  let hourly = 0;
  if (remHours > 0) {
    const nextDayPrice = blockPrice(start + fullDays * DAY_MS, p, rules).base;
    if (p.priceHour > 0 && remHours <= rules.hourlyMaxHours && remHours * p.priceHour < nextDayPrice) {
      hourly = remHours;
    } else {
      dayBlocks += 1;
    }
  }

  let normalDays = 0;
  let weekendDays = 0;
  const holidayTotals = new Map<string, { days: number; amount: number; pct: number }>();
  for (let i = 0; i < dayBlocks; i++) {
    const b = blockPrice(start + i * DAY_MS, p, rules);
    if (b.weekend) weekendDays++;
    else normalDays++;
    if (b.holiday) {
      const cur = holidayTotals.get(b.holiday.name) ?? { days: 0, amount: 0, pct: b.holiday.surchargePct };
      cur.days++;
      cur.amount += b.surcharge;
      holidayTotals.set(b.holiday.name, cur);
    }
  }

  const lines: PriceLine[] = [];
  if (normalDays) {
    lines.push({ kind: 'rental', description: `Tiền thuê ${normalDays} ngày × ${fmtNumber(p.priceDay)}`, amount: normalDays * p.priceDay });
  }
  if (weekendDays) {
    const wp = weekendPrice(p);
    lines.push({ kind: 'rental', description: `Tiền thuê ${weekendDays} ngày cuối tuần × ${fmtNumber(wp)}`, amount: weekendDays * wp });
  }
  for (const [name, h] of holidayTotals) {
    if (h.amount > 0) {
      lines.push({ kind: 'rental', description: `Phụ thu ${name} ${h.days} ngày (+${h.pct}%)`, amount: h.amount });
    }
  }
  if (hourly) {
    lines.push({ kind: 'rental', description: `Giờ lẻ ${hourly} giờ × ${fmtNumber(p.priceHour)}`, amount: hourly * p.priceHour });
  }

  return {
    mode: 'day',
    months: 0,
    days: dayBlocks,
    extraHours: hourly,
    kmLimit: p.kmLimitDay > 0 ? p.kmLimitDay * Math.max(1, dayBlocks) : 0,
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
  };
}

function weekendPrice(p: VehiclePricing): number {
  return p.priceWeekendDay && p.priceWeekendDay > 0 ? p.priceWeekendDay : p.priceDay;
}

function blockPrice(blockStart: number, p: VehiclePricing, rules: PricingRules) {
  const weekend = rules.weekendDays.includes(vnParts(blockStart).weekday) && weekendPrice(p) !== p.priceDay;
  const base = weekend ? weekendPrice(p) : p.priceDay;
  const holiday = holidayFor(blockStart, rules.holidays);
  const surcharge = holiday ? roundK((base * holiday.surchargePct) / 100) : 0;
  return { base: base + surcharge, weekend, holiday, surcharge };
}

/** Phụ thu trả xe trễ. Mỗi 24h trễ tính 1 ngày giá thường; giờ lẻ tính theo giờ, trần 1 ngày. */
export function overtimeCharge(scheduledEnd: number, actualEnd: number, p: VehiclePricing, rules: PricingRules): PriceLine | null {
  const late = actualEnd - scheduledEnd;
  if (late <= rules.graceMinutes * 60_000) return null;
  const hours = Math.ceil(late / HOUR_MS);
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  const hourFee = p.overHourFee || p.priceHour;
  const amount = days * p.priceDay + Math.min(remH * hourFee, p.priceDay);
  if (amount <= 0) return null;
  return { kind: 'over_time', description: `Trả xe trễ ${fmtDuration(late)}`, amount };
}

/** Phụ thu vượt km so với giới hạn của lượt thuê. */
export function overKmCharge(odoStart: number, odoEnd: number, kmLimit: number, feePerKm: number): PriceLine | null {
  if (!kmLimit || !feePerKm) return null;
  const used = odoEnd - odoStart;
  const over = used - kmLimit;
  if (over <= 0) return null;
  return {
    kind: 'over_km',
    description: `Vượt ${fmtNumber(over)} km (đi ${fmtNumber(used)}/${fmtNumber(kmLimit)} km) × ${fmtNumber(feePerKm)}`,
    amount: over * feePerKm,
  };
}
