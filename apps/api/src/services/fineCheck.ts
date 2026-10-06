// Kiểm tra phạt nguội theo biển số — KHÔNG cần biết trước giờ vi phạm.
//
// Nguồn:
// 1. Dịch vụ tra cứu công khai (api.checkphatnguoi.vn, lấy dữ liệu từ Cục CSGT).
//    Không chính thức → có lúc sập; lỗi thì báo rõ, không làm hỏng gì.
// 2. Văn bản người dùng chép từ trang chính thức (csgt.bocongan.gov.vn có reCAPTCHA
//    nên app không tự tra được) hoặc từ thông báo trên app VNeTraffic → dán vào app.
// Mỗi vi phạm tìm được được khớp với lượt thuê đang giữ xe lúc đó (lookupFine).

import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalConfig, updateLocalConfig } from '../lib/localConfig.js';
import { escapeHtml, notify } from '../lib/telegram.js';
import { plateKey } from '../shared/text.js';
import { normalizeViolation, type FoundViolation } from '../shared/violationText.js';
import { lookupFine, recordFine } from './fines.js';

export { parseViolationText } from '../shared/violationText.js';
export type { FoundViolation } from '../shared/violationText.js';

export interface MatchedViolation extends FoundViolation {
  verdict: 'rented' | 'blocked' | 'idle' | 'unknown_vehicle' | 'no_time';
  renter: { customerId: number; fullName: string; phone: string | null } | null;
  rental: { id: number; code: string } | null;
  nearBoundary: boolean;
  /** Đã có trong hồ sơ phạt nguội của app (cùng biển, cùng giờ). */
  recordedFineId: number | null;
}

const PROVIDER_URL = 'https://api.checkphatnguoi.vn/phatnguoi';

export type ProviderResult = { ok: true; violations: FoundViolation[] } | { ok: false; error: string };

/** Hỏi dịch vụ tra cứu công khai. Không bao giờ ném lỗi — trả { ok: false } để giao diện chuyển sang cách dán kết quả. */
export async function checkProvider(plate: string): Promise<ProviderResult> {
  const key = plateKey(plate);
  try {
    const res = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://checkphatnguoi.vn', referer: 'https://checkphatnguoi.vn/', 'user-agent': 'Mozilla/5.0 car-rental-app' },
      body: JSON.stringify({ bienso: key }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false, error: `Dịch vụ tra cứu đang lỗi (HTTP ${res.status})` };
    const data = (await res.json()) as { status?: number; data?: Record<string, unknown>[] };
    // status != 1 = không có vi phạm (dịch vụ trả như vậy khi biển sạch).
    if (data.status !== 1 || !Array.isArray(data.data)) return { ok: true, violations: [] };
    return { ok: true, violations: data.data.map((r) => normalizeViolation(r, key)) };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: e.name === 'TimeoutError' ? 'Dịch vụ tra cứu không phản hồi' : `Không gọi được dịch vụ tra cứu: ${e.message}` };
  }
}

/** Gắn mỗi vi phạm với người đang giữ xe lúc đó + đánh dấu cái nào đã ghi hồ sơ. */
export function matchViolations(plate: string, list: FoundViolation[]): MatchedViolation[] {
  const key = plateKey(plate);
  return list.map((v) => {
    if (v.violatedAt == null) return { ...v, verdict: 'no_time', renter: null, rental: null, nearBoundary: false, recordedFineId: null };
    const found = lookupFine(key, v.violatedAt);
    const m = found.matches[0];
    const recorded = db
      .select({ id: schema.trafficFines.id })
      .from(schema.trafficFines)
      .where(and(eq(schema.trafficFines.plateKey, key), gte(schema.trafficFines.violatedAt, v.violatedAt - 60_000), lte(schema.trafficFines.violatedAt, v.violatedAt + 60_000)))
      .get();
    return {
      ...v,
      verdict: found.verdict,
      renter: m ? { customerId: m.customer.id, fullName: m.customer.fullName, phone: m.customer.phone } : null,
      rental: m ? { id: m.rental.id, code: m.rental.code } : null,
      nearBoundary: m?.nearBoundary ?? false,
      recordedFineId: recorded?.id ?? null,
    };
  });
}

export interface FleetCheckResult {
  ok: boolean;
  error: string | null;
  checked: number;
  found: number;
  recorded: number;
  vehicles: { plate: string; ok: boolean; error?: string; found: number; recorded: number }[];
}

/**
 * Kiểm tra mọi xe đang hoạt động. Vi phạm CHƯA XỬ PHẠT mà hồ sơ chưa có → tự ghi
 * (khớp sẵn người giữ xe) + báo Telegram. Dịch vụ lỗi → dừng, ghi lại lỗi.
 */
export async function runFleetFineCheck(userId: number | null): Promise<FleetCheckResult> {
  const vehicles = db.select().from(schema.vehicles).where(and(isNull(schema.vehicles.archivedAt), eq(schema.vehicles.active, true))).all();
  const result: FleetCheckResult = { ok: true, error: null, checked: 0, found: 0, recorded: 0, vehicles: [] };
  for (const v of vehicles) {
    const r = await checkProvider(v.plate);
    if (!r.ok) {
      result.ok = false;
      result.error = r.error;
      result.vehicles.push({ plate: v.plate, ok: false, error: r.error, found: 0, recorded: 0 });
      break;
    }
    result.checked++;
    const matched = matchViolations(v.plate, r.violations);
    let recorded = 0;
    for (const m of matched) {
      if (m.violatedAt == null || m.recordedFineId || m.status === 'paid') continue;
      recordFine(
        { plate: v.plate, violatedAt: m.violatedAt, location: m.location, violation: m.violation, source: 'csgt', notes: ['Tự phát hiện khi kiểm tra định kỳ', m.unit && `Phát hiện: ${m.unit}`].filter(Boolean).join(' · ') },
        userId,
      );
      recorded++;
    }
    result.found += r.violations.length;
    result.recorded += recorded;
    result.vehicles.push({ plate: v.plate, ok: true, found: r.violations.length, recorded });
  }
  const wasFailing = !!getLocalConfig().fineCheck.lastError;
  updateLocalConfig((c) => {
    c.fineCheck.lastRunAt = Date.now();
    c.fineCheck.lastError = result.error;
    c.fineCheck.lastFound = result.found;
    c.fineCheck.lastNew = result.recorded;
  });
  if (!result.ok && userId == null && !wasFailing) notify(`⚠️ Không tự kiểm tra được phạt nguội: ${escapeHtml(result.error ?? '')}. Tra tay trong app → Phạt nguội.`);
  return result;
}
