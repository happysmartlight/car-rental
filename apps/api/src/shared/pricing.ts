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

import type { ChargeKind, FuelType } from './constants.js';
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
  /** Xe điện: số lượt sạc miễn phí cho chuyến đến 2 ngày (xem `freeChargesFor`). Bảng giá cũ chưa có trường này. */
  freeCharges?: number | null;
  /** Xe điện: phí mỗi lượt cắm-rút sạc vượt số lần miễn phí. */
  chargeFee?: number | null;
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

// ── Sạc pin xe điện ─────────────────────────────────────────────────────────
// Mỗi lần cắm-rút sạc tính 1 lượt. Chuyến đến 2 ngày được miễn phí `baseFree` lượt, từ ngày
// thứ 3 mỗi ngày thêm 1 lượt (1 lượt → 3 ngày: 2, 4 ngày: 3…): thuê dài không bị thiệt, còn sạc
// lắt nhắt quá số lượt thì trả `fee` mỗi lượt. Nhân viên đếm số lượt khi nhận xe.

/** Số ngày đầu chỉ được số lượt miễn phí cơ bản; từ ngày sau đó mỗi ngày thêm 1 lượt. */
export const CHARGE_BASE_DAYS = 2;

export interface ChargingPolicy {
  /** Số lượt miễn phí cho chuyến đến `CHARGE_BASE_DAYS` ngày (0 = không miễn phí lượt nào). */
  baseFree: number;
  fee: number;
}

type ChargingFields = { freeCharges?: number | null; chargeFee?: number | null };

export function chargingPolicy(p: ChargingFields): ChargingPolicy | null {
  const baseFree = p.freeCharges ?? 0;
  const fee = p.chargeFee ?? 0;
  return baseFree > 0 || fee > 0 ? { baseFree, fee } : null;
}

/** Chỉ xe điện mới có chính sách sạc (xe đổi sang xăng thì bỏ qua số đã nhập). */
export function vehicleChargingPolicy(v: ChargingFields & { fuel: FuelType | null }): ChargingPolicy | null {
  return v.fuel === 'electric' ? chargingPolicy(v) : null;
}

/** Theo bảng giá đã chốt vào lượt thuê; lượt đặt trước khi có tính năng này thì lấy theo xe hiện tại. */
export function rentalChargingPolicy(snapshot: VehiclePricing, vehicle: ChargingFields & { fuel: FuelType | null }): ChargingPolicy | null {
  if (snapshot.chargeFee !== undefined || snapshot.freeCharges !== undefined) return chargingPolicy(snapshot);
  return vehicleChargingPolicy(vehicle);
}

/** Số ngày thuê để tính lượt sạc: khối 24 giờ, phần lẻ quá ân hạn tính thêm 1 ngày. */
export function chargeDays(start: number, end: number, graceMinutes: number): number {
  return Math.max(1, Math.ceil((end - start - graceMinutes * 60_000) / DAY_MS));
}

export function freeChargesFor(c: ChargingPolicy, days: number): number {
  return c.baseFree > 0 ? c.baseFree + Math.max(0, days - CHARGE_BASE_DAYS) : 0;
}

const vndShort = (n: number) => `${fmtNumber(n)}đ`;

/** Quy định chung cho bảng giá (chữ thường đầu câu):
 *  "thuê đến 2 ngày miễn phí 1 lượt sạc, từ ngày thứ 3 mỗi ngày thêm 1 lượt (3 ngày: 2 lượt, 4 ngày: 3 lượt…); sạc vượt tính 30.000đ/lượt cắm-rút sạc" */
export function chargingText(c: ChargingPolicy, money: (n: number) => string = vndShort): string {
  const fee = c.fee ? `${money(c.fee)}/lượt cắm-rút sạc` : '';
  if (!c.baseFree) return fee;
  const d = CHARGE_BASE_DAYS;
  const examples = [d + 1, d + 2].map((n) => `${n} ngày: ${freeChargesFor(c, n)} lượt`).join(', ');
  const free = `thuê đến ${d} ngày miễn phí ${c.baseFree} lượt sạc, từ ngày thứ ${d + 1} mỗi ngày thêm 1 lượt (${examples}…)`;
  return fee ? `${free}; sạc vượt tính ${fee}` : free;
}

/** Cho một chuyến cụ thể (hợp đồng, nhận xe): "chuyến 5 ngày miễn phí 4 lượt sạc, từ lượt thứ 5 tính 30.000đ/lượt cắm-rút sạc". */
export function tripChargingText(c: ChargingPolicy, days: number, money: (n: number) => string = vndShort): string {
  const free = freeChargesFor(c, days);
  const fee = c.fee ? `${money(c.fee)}/lượt cắm-rút sạc` : '';
  if (!free) return fee;
  const text = `chuyến ${days} ngày miễn phí ${free} lượt sạc`;
  return fee ? `${text}, từ lượt thứ ${free + 1} tính ${fee}` : text;
}

/** Phụ phí sạc khi nhận xe: số lượt vượt quá số lượt miễn phí của chuyến × phí mỗi lượt. */
export function chargingCharge(sessions: number, c: ChargingPolicy | null, days: number): PriceLine | null {
  if (!c?.fee) return null;
  const free = freeChargesFor(c, days);
  const extra = sessions - free;
  if (extra <= 0) return null;
  return {
    kind: 'fuel',
    description: `Sạc pin ${sessions} lượt${free ? ` (chuyến ${days} ngày miễn phí ${free})` : ''}: ${extra} × ${fmtNumber(c.fee)}`,
    amount: extra * c.fee,
  };
}
