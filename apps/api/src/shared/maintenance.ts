// Lịch bảo dưỡng theo hạng mục: danh mục gợi ý + tính hạn từ lần làm gần nhất. Hàm thuần, dùng chung API và web.
//
// Mỗi hạng mục có chu kỳ km và/hoặc tháng; đến hạn theo cái nào tới trước.
// Chu kỳ gợi ý là mức phổ biến cho xe du lịch — chỉnh theo sổ bảo dưỡng của hãng.

import type { FuelType } from './constants.js';
import { fmtNumber } from './text.js';
import { DAY_MS, addMonthsVn, fmtDateKey, vnDateKey, vnDateKeyToMs } from './time.js';

export interface MaintenancePreset {
  key: string;
  name: string;
  km: number | null;
  months: number | null;
  /** Nhiên liệu áp dụng (null = mọi xe). */
  fuels: FuelType[] | null;
  /** Chọn sẵn khi thiết lập lịch lần đầu. */
  common: boolean;
}

const ENGINE: FuelType[] = ['gasoline', 'diesel', 'hybrid'];

export const MAINTENANCE_PRESETS: MaintenancePreset[] = [
  { key: 'oil', name: 'Thay dầu máy', km: 5000, months: 6, fuels: ENGINE, common: true },
  { key: 'oil_filter', name: 'Thay lọc dầu', km: 10000, months: 12, fuels: ENGINE, common: true },
  { key: 'air_filter', name: 'Thay lọc gió động cơ', km: 20000, months: 24, fuels: ENGINE, common: true },
  { key: 'ev_service', name: 'Bảo dưỡng định kỳ theo hãng', km: 12000, months: 12, fuels: ['electric'], common: true },
  { key: 'cabin_filter', name: 'Thay lọc gió điều hòa', km: 10000, months: 12, fuels: null, common: true },
  { key: 'tire_rotation', name: 'Đảo lốp, cân chỉnh độ chụm', km: 10000, months: 12, fuels: null, common: true },
  { key: 'brake_pads', name: 'Kiểm tra / thay má phanh', km: 20000, months: 12, fuels: null, common: true },
  { key: 'brake_fluid', name: 'Thay dầu phanh', km: 40000, months: 24, fuels: null, common: true },
  { key: 'coolant', name: 'Thay nước làm mát', km: 40000, months: 24, fuels: null, common: false },
  { key: 'spark_plugs', name: 'Thay bugi', km: 40000, months: 36, fuels: ['gasoline', 'hybrid'], common: false },
  { key: 'transmission_oil', name: 'Thay dầu hộp số', km: 40000, months: 36, fuels: ENGINE, common: false },
  { key: 'battery_12v', name: 'Kiểm tra ắc quy 12V', km: null, months: 12, fuels: null, common: false },
  { key: 'ac_service', name: 'Vệ sinh điều hòa', km: null, months: 12, fuels: null, common: false },
  { key: 'wipers', name: 'Thay gạt mưa', km: null, months: 12, fuels: null, common: false },
  { key: 'tires', name: 'Thay lốp', km: 50000, months: 48, fuels: null, common: true },
];

/** Hạng mục gợi ý hợp với loại nhiên liệu của xe (chưa rõ nhiên liệu → coi như xe xăng). */
export function presetsFor(fuel: FuelType | null): MaintenancePreset[] {
  const f = fuel ?? 'gasoline';
  return MAINTENANCE_PRESETS.filter((p) => !p.fuels || p.fuels.includes(f));
}

export type MaintenanceState = 'overdue' | 'soon' | 'ok' | 'unknown';

export interface MaintenanceStatus {
  nextOdo: number | null;
  /** "YYYY-MM-DD". */
  nextDate: string | null;
  /** Âm = đã quá. */
  kmLeft: number | null;
  daysLeft: number | null;
  state: MaintenanceState;
}

interface ItemLike {
  intervalKm: number | null;
  intervalMonths: number | null;
  lastOdo: number | null;
  lastDate: string | null;
}

export const addMonthsToKey = (key: string, n: number) => vnDateKey(addMonthsVn(vnDateKeyToMs(key), n));
const daysBetween = (from: string, to: string) => Math.round((vnDateKeyToMs(to) - vnDateKeyToMs(from)) / DAY_MS);

/** Sắp đến hạn khi còn ≤ 10% chu kỳ km (tối thiểu 500 km) hoặc ≤ 14 ngày. */
export function maintenanceStatus(item: ItemLike, odo: number, today: string): MaintenanceStatus {
  const nextOdo = item.intervalKm && item.lastOdo != null ? item.lastOdo + item.intervalKm : null;
  const nextDate = item.intervalMonths && item.lastDate ? addMonthsToKey(item.lastDate, item.intervalMonths) : null;
  const kmLeft = nextOdo != null ? nextOdo - odo : null;
  const daysLeft = nextDate ? daysBetween(today, nextDate) : null;
  if (kmLeft == null && daysLeft == null) return { nextOdo, nextDate, kmLeft, daysLeft, state: 'unknown' };
  const soonKm = item.intervalKm ? Math.max(500, Math.round(item.intervalKm * 0.1)) : 0;
  const overdue = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft < 0);
  const soon = (kmLeft != null && kmLeft <= soonKm) || (daysLeft != null && daysLeft <= 14);
  return { nextOdo, nextDate, kmLeft, daysLeft, state: overdue ? 'overdue' : soon ? 'soon' : 'ok' };
}

/** "mỗi 5.000 km hoặc 6 tháng". */
export function intervalText(item: { intervalKm: number | null; intervalMonths: number | null }): string {
  const parts = [item.intervalKm && `${fmtNumber(item.intervalKm)} km`, item.intervalMonths && `${item.intervalMonths} tháng`].filter(Boolean);
  return parts.length ? `mỗi ${parts.join(' hoặc ')}` : 'chưa đặt chu kỳ';
}

/** "Quá 800 km" / "Còn 1.200 km · 45 ngày" / "Chưa ghi lần làm gần nhất". */
export function statusText(s: MaintenanceStatus): string {
  if (s.state === 'unknown') return 'Chưa ghi lần làm gần nhất';
  const km = s.kmLeft == null ? null : s.kmLeft <= 0 ? `quá ${fmtNumber(-s.kmLeft)} km` : `còn ${fmtNumber(s.kmLeft)} km`;
  const days = s.daysLeft == null ? null : s.daysLeft < 0 ? `quá ${-s.daysLeft} ngày` : s.daysLeft === 0 ? 'đến hạn hôm nay' : `còn ${s.daysLeft} ngày`;
  const t = [km, days].filter(Boolean).join(' · ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "mốc 50.000 km · hạn 12/09/2026". */
export function dueText(s: MaintenanceStatus): string {
  return [s.nextOdo != null && `mốc ${fmtNumber(s.nextOdo)} km`, s.nextDate && `hạn ${fmtDateKey(s.nextDate)}`].filter(Boolean).join(' · ');
}
