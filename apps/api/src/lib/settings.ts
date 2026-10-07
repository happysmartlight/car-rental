// Cài đặt nghiệp vụ, lưu trong DB (đi theo bản sao lưu).
// Cấu hình máy (Telegram token, mật khẩu backup, tự cập nhật) nằm ở localConfig.ts — KHÔNG trong DB,
// để khôi phục một bản sao lưu cũ không làm mất cấu hình đó.

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { DEFAULT_CHECKLIST } from '../shared/constants.js';
import type { CancelPolicy } from '../shared/money.js';
import { DEFAULT_PRICING_RULES, type PricingRules } from '../shared/pricing.js';

export interface BusinessSettings {
  name: string;
  representative: string;
  position: string;
  idNumber: string;
  idIssueDate: string;
  idIssuePlace: string;
  phone: string;
  email: string;
  address: string;
  taxCode: string;
  bankBin: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  signCity: string;
  /** Ghi chú in trên ảnh/tin nhắn chia sẻ bảng giá (giao xe tận nơi, thủ tục…). */
  shareNote: string;
}

export interface RulesSettings extends PricingRules, CancelPolicy {
  /** Khoảng đệm giữa 2 lượt thuê (rửa xe, kiểm tra). */
  bufferMinutes: number;
  /** Số tiền cọc giữ lại chờ phạt nguội. */
  fineHoldAmount: number;
  fineHoldDays: number;
  minDriverAge: number;
  checklist: string[];
  deliveryFeeDefault: number;
}

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: '',
  representative: '',
  position: '',
  idNumber: '',
  idIssueDate: '',
  idIssuePlace: '',
  phone: '',
  email: '',
  address: '',
  taxCode: '',
  bankBin: '',
  bankName: '',
  bankAccount: '',
  bankAccountName: '',
  signCity: '',
  shareNote: '',
};

export const DEFAULT_RULES: RulesSettings = {
  ...DEFAULT_PRICING_RULES,
  bufferMinutes: 120,
  fineHoldAmount: 2_000_000,
  fineHoldDays: 15,
  minDriverAge: 21,
  checklist: DEFAULT_CHECKLIST,
  deliveryFeeDefault: 0,
  cancelNoticeHours: 72,
  cancelForfeitPct: 100,
};

interface SettingsMap {
  business: BusinessSettings;
  rules: RulesSettings;
}

const DEFAULTS: SettingsMap = { business: DEFAULT_BUSINESS, rules: DEFAULT_RULES };

export function getSetting<K extends keyof SettingsMap>(key: K): SettingsMap[K] {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row) return structuredClone(DEFAULTS[key]);
  try {
    return { ...structuredClone(DEFAULTS[key]), ...JSON.parse(row.value) };
  } catch {
    return structuredClone(DEFAULTS[key]);
  }
}

export function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): void {
  const json = JSON.stringify(value);
  const now = Date.now();
  db.insert(schema.settings)
    .values({ key, value: json, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: json, updatedAt: now } })
    .run();
}
