// Nội dung gửi khách sau từng bước của lượt thuê: giao xe, nhận xe, quyết toán.
// Hàm thuần dựng một "phiếu" (khối + dòng); web vẽ phiếu thành ảnh hoặc ghép thành tin nhắn Zalo.

import type { ChargeKind, FuelType, RentalStatus } from './constants.js';
import type { MoneySummary } from './money.js';
import { chargeDays, rentalChargingPolicy, tripChargingText, type VehiclePricing } from './pricing.js';
import { fmtNumber } from './text.js';
import { fmtDate, fmtDateTime, fmtDuration } from './time.js';

export type RentalShareStage = 'pickup' | 'return' | 'settle';

export const RENTAL_SHARE_STAGE_LABEL: Record<RentalShareStage, string> = {
  pickup: 'Giao xe',
  return: 'Nhận xe',
  settle: 'Quyết toán',
};

interface HandoverLike {
  at: number;
  odo: number;
  fuelLevel: number;
  photos: { slot: string; fileId: string }[];
  damages: { zone: string; note: string; isNew?: boolean }[];
  accessories: { name: string; quantity: number; present: boolean; note?: string | null }[];
}

export interface RentalShareInput {
  stage: RentalShareStage;
  rental: {
    code: string;
    status: RentalStatus;
    scheduledStart: number;
    scheduledEnd: number;
    kmLimit: number;
    pickupLocation: string | null;
    returnLocation: string | null;
    depositRequired: number;
    fineHoldUntil: number | null;
    /** Bảng giá đã chốt (JSON). */
    pricing: string;
  };
  customerName: string;
  vehicle: { plate: string; make: string; model: string; fuel: FuelType | null; freeCharges: number | null; chargeFee: number | null };
  pickup: HandoverLike | null;
  ret: HandoverLike | null;
  charges: { kind: ChargeKind; description: string; amount: number }[];
  money: MoneySummary;
  graceMinutes: number;
  shopName: string;
  shopAddress?: string;
}

export interface ShareRow {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'red' | 'green';
}

export interface ShareBlock {
  heading: string;
  /** Biểu tượng đầu mục trong tin nhắn chữ. */
  icon: string;
  rows: ShareRow[];
}

export interface RentalShareDoc {
  stage: RentalShareStage;
  title: string;
  icon: string;
  code: string;
  plate: string;
  lead: string[];
  blocks: ShareBlock[];
  notes: string[];
  /** Ảnh xe lúc giao / nhận (theo giai đoạn). */
  photos: string[];
  /** Khoản khách cần chuyển khoản (kèm mã QR). */
  pay: { label: string; amount: number; note: string } | null;
}

/** Giai đoạn có thể gửi khách theo trạng thái hiện tại (cũ → mới). */
export function rentalShareStages(status: RentalStatus, hasPickup: boolean, hasReturn: boolean): RentalShareStage[] {
  const out: RentalShareStage[] = [];
  if (hasPickup && ['active', 'returned', 'settled', 'closed'].includes(status)) out.push('pickup');
  if (hasReturn && ['returned', 'settled', 'closed'].includes(status)) out.push('return');
  if (['settled', 'closed'].includes(status)) out.push('settle');
  return out;
}

const vnd = (n: number) => `${n < 0 ? '−' : ''}${fmtNumber(Math.abs(n))}đ`;
const row = (label: string, value: string, extra: Omit<ShareRow, 'label' | 'value'> = {}): ShareRow => ({ label, value, ...extra });
const fuelLabel = (fuel: FuelType | null) => (fuel === 'electric' ? 'Mức pin' : fuel === 'diesel' ? 'Mức dầu' : 'Mức xăng');

function chargesBlock(i: RentalShareInput): ShareBlock {
  return {
    heading: 'Chi phí',
    icon: '🧾',
    rows: [...i.charges.map((c) => row(c.description, vnd(c.amount))), row('Tổng cộng', vnd(i.money.totalCharges), { strong: true })],
  };
}

export function buildRentalShare(i: RentalShareInput): RentalShareDoc {
  const { rental: r, money: m, vehicle: v, pickup: p, ret } = i;
  const shop = i.shopName.trim() || 'Cửa hàng';
  const vehicleName = [v.make, v.model].filter(Boolean).join(' ');
  const xe = row('Xe', vehicleName ? `${vehicleName} · ${v.plate}` : v.plate);
  const pricing = JSON.parse(r.pricing) as VehiclePricing;
  const base = { code: r.code, plate: v.plate, lead: [`Chào anh/chị ${i.customerName},`] };
  const thanks = 'Cảm ơn anh/chị đã tin tưởng, rất mong được phục vụ anh/chị lần sau!';

  if (i.stage === 'pickup') {
    const at = p?.at ?? r.scheduledStart;
    const returnPlace = r.returnLocation || r.pickupLocation || i.shopAddress;
    const present = p?.accessories.filter((a) => a.present) ?? [];
    const depositShort = Math.max(0, r.depositRequired - m.depositHeld);
    const rows: ShareRow[] = [];
    if (p) {
      rows.push(row('ODO', `${fmtNumber(p.odo)} km`), row(fuelLabel(v.fuel), `${p.fuelLevel}%`));
      rows.push(row('Giới hạn quãng đường', r.kmLimit ? `${fmtNumber(r.kmLimit)} km (đến ODO ${fmtNumber(p.odo + r.kmLimit)})` : 'Không giới hạn'));
      if (present.length) rows.push(row('Phụ kiện kèm theo', present.map((a) => (a.quantity > 1 ? `${a.name} ×${a.quantity}` : a.name)).join(', ')));
      if (p.damages.length) rows.push(row('Hiện trạng có sẵn', p.damages.map((d) => (d.note ? `${d.zone}: ${d.note}` : d.zone)).join('; ')));
    }
    const notes = [`Vui lòng trả xe đúng hẹn ${fmtDateTime(r.scheduledEnd)}.`];
    const lateFee = pricing.overHourFee || pricing.priceHour;
    if (lateFee) notes[0] = `Vui lòng trả xe đúng hẹn ${fmtDateTime(r.scheduledEnd)}; trả trễ tính ${vnd(lateFee)}/giờ.`;
    if (r.kmLimit && pricing.overKmFee) notes.push(`Đi quá ${fmtNumber(r.kmLimit)} km tính ${vnd(pricing.overKmFee)}/km.`);
    const charging = rentalChargingPolicy(pricing, v);
    if (charging) notes.push(`Sạc pin: ${tripChargingText(charging, chargeDays(r.scheduledStart, r.scheduledEnd, i.graceMinutes))}.`);
    notes.push('Cần gia hạn hoặc gặp sự cố trên đường, anh/chị vui lòng báo ngay cho cửa hàng.');
    return {
      ...base,
      stage: 'pickup',
      title: 'Xác nhận giao xe',
      icon: '🚗',
      lead: [...base.lead, `${shop} xác nhận đã giao xe cho anh/chị. Chúc anh/chị thượng lộ bình an!`],
      blocks: [
        {
          heading: 'Thông tin chuyến',
          icon: '🚗',
          rows: [row('Hợp đồng', r.code), xe, row('Nhận xe', fmtDateTime(at)), row('Hẹn trả', fmtDateTime(r.scheduledEnd), { strong: true }), ...(returnPlace ? [row('Nơi trả', returnPlace)] : [])],
        },
        ...(rows.length ? [{ heading: 'Tình trạng lúc giao', icon: '📋', rows }] : []),
        chargesBlock(i),
        {
          heading: 'Thanh toán',
          icon: '💰',
          rows: [
            row('Đã thanh toán', vnd(m.rentPaid)),
            m.due > 0 ? row('Còn phải trả', vnd(m.due), { strong: true, tone: 'red' }) : row('Còn phải trả', 'Đã thanh toán đủ', { tone: 'green' }),
            row('Tiền cọc đã nhận', depositShort > 0 ? `${vnd(m.depositHeld)} / ${vnd(r.depositRequired)}` : vnd(m.depositHeld)),
          ],
        },
      ],
      notes,
      photos: p?.photos.map((x) => x.fileId) ?? [],
      pay: m.due > 0 ? { label: 'Còn phải trả', amount: m.due, note: r.code } : depositShort > 0 ? { label: 'Tiền cọc còn thiếu', amount: depositShort, note: r.code } : null,
    };
  }

  const trip: ShareRow[] = [row('Hợp đồng', r.code), xe];
  if (p && ret) {
    const late = ret.at - r.scheduledEnd;
    trip.push(row('Nhận xe', fmtDateTime(p.at)));
    trip.push(row('Trả xe', `${fmtDateTime(ret.at)}${late > i.graceMinutes * 60_000 ? ` (trễ ${fmtDuration(late)})` : ''}`));
    trip.push(row('Quãng đường', `${fmtNumber(ret.odo - p.odo)} km${r.kmLimit ? ` / giới hạn ${fmtNumber(r.kmLimit)} km` : ''}`));
  }

  if (i.stage === 'return') {
    if (p && ret) trip.push(row(fuelLabel(v.fuel), `${ret.fuelLevel}% (lúc giao ${p.fuelLevel}%)`));
    const missing = ret?.accessories.filter((a) => !a.present) ?? [];
    if (missing.length) trip.push(row('Phụ kiện thiếu', missing.map((a) => (a.note ? `${a.name} (${a.note})` : a.name)).join(', '), { tone: 'red' }));
    const damages = ret?.damages.filter((d) => d.isNew) ?? [];
    if (damages.length) trip.push(row('Hư hỏng mới', damages.map((d) => (d.note ? `${d.zone}: ${d.note}` : d.zone)).join('; '), { tone: 'red' }));
    const fromDeposit = Math.min(Math.max(0, m.due), Math.max(0, m.depositHeld));
    const extra = Math.max(0, m.due) - fromDeposit;
    const notes: string[] = [];
    if (fromDeposit > 0) notes.push(`Khoản ${vnd(fromDeposit)} còn phải trả sẽ được trừ vào tiền cọc khi quyết toán${extra > 0 ? `; anh/chị vui lòng thanh toán thêm ${vnd(extra)}` : ''}.`);
    else if (extra > 0) notes.push(`Anh/chị vui lòng thanh toán ${vnd(extra)} còn lại.`);
    notes.push('Cửa hàng sẽ gửi quyết toán và hoàn cọc theo hợp đồng.');
    return {
      ...base,
      stage: 'return',
      title: 'Xác nhận nhận xe',
      icon: '🅿️',
      lead: [...base.lead, `${shop} đã nhận lại xe ${v.plate}${ret ? ` lúc ${fmtDateTime(ret.at)}` : ''}. Cảm ơn anh/chị đã sử dụng dịch vụ!`],
      blocks: [
        { heading: 'Chuyến đi', icon: '🚗', rows: trip },
        chargesBlock(i),
        {
          heading: 'Thanh toán',
          icon: '💰',
          rows: [
            row('Đã thanh toán', vnd(m.rentPaid)),
            m.due >= 0 ? row('Còn phải trả', vnd(m.due), { strong: true, tone: m.due > 0 ? 'red' : undefined }) : row('Thu thừa (sẽ hoàn lại)', vnd(-m.due), { strong: true, tone: 'green' }),
            row('Tiền cọc đang giữ', vnd(m.depositHeld)),
          ],
        },
      ],
      notes,
      photos: ret?.photos.map((x) => x.fileId) ?? [],
      pay: extra > 0 ? { label: 'Cần thanh toán thêm', amount: extra, note: r.code } : null,
    };
  }

  // Quyết toán
  const paidCash = m.rentPaid - m.depositOffset;
  const pay: ShareRow[] = [];
  if (paidCash > 0) pay.push(row('Đã thanh toán', vnd(paidCash)));
  if (m.depositReceived > 0) pay.push(row('Tiền cọc đã đặt', vnd(m.depositReceived)));
  if (m.depositOffset > 0) pay.push(row('Trừ vào tiền cọc', vnd(m.depositOffset)));
  if (m.depositReturned > 0) pay.push(row('Đã hoàn cọc', vnd(m.depositReturned), { tone: 'green' }));
  if (m.depositHeld > 0) pay.push(row('Cọc giữ chờ phạt nguội', vnd(m.depositHeld), { strong: true }));
  if (m.due > 0) pay.push(row('Còn phải trả', vnd(m.due), { strong: true, tone: 'red' }));
  if (m.due < 0) pay.push(row('Cửa hàng còn hoàn lại', vnd(-m.due), { strong: true, tone: 'green' }));
  const notes: string[] = [];
  if (r.status === 'settled' && m.depositHeld > 0) {
    notes.push(
      `Cửa hàng giữ lại ${vnd(m.depositHeld)} tiền cọc để đối soát phạt nguội (camera giao thông)${r.fineHoldUntil ? ` đến ${fmtDate(r.fineHoldUntil)}` : ''}. Không có vi phạm, cửa hàng sẽ hoàn lại đủ cho anh/chị.`,
    );
  }
  if (m.due > 0) notes.push(`Anh/chị vui lòng thanh toán ${vnd(m.due)} còn lại.`);
  if (r.status === 'closed' && m.due === 0 && m.depositHeld <= 0) notes.push('Mọi khoản đã hoàn tất.');
  notes.push(thanks);
  return {
    ...base,
    stage: 'settle',
    title: 'Quyết toán lượt thuê',
    icon: '🧾',
    lead: [...base.lead, `${shop} gửi anh/chị quyết toán lượt thuê ${r.code} (xe ${v.plate}).`],
    blocks: [{ heading: 'Chuyến đi', icon: '🚗', rows: trip }, chargesBlock(i), { heading: 'Thanh toán', icon: '💰', rows: pay }],
    notes,
    photos: [],
    pay: m.due > 0 ? { label: 'Còn phải trả', amount: m.due, note: r.code } : null,
  };
}

/** Ghép phiếu thành tin nhắn chữ (dán Zalo / Messenger). */
export function rentalShareText(doc: RentalShareDoc, shop: { name: string; phone: string; bank?: { name: string; account: string; holder: string } | null }): string {
  const lines = [`${doc.icon} ${doc.title.toUpperCase()} — ${doc.code}`, ...doc.lead];
  for (const b of doc.blocks) {
    if (!b.rows.length) continue;
    lines.push('', `${b.icon} ${b.heading}`);
    for (const r of b.rows) lines.push(`• ${r.label}: ${r.value}`);
  }
  if (doc.notes.length) {
    lines.push('', '📌 Lưu ý');
    for (const n of doc.notes) lines.push(`• ${n}`);
  }
  if (doc.pay && shop.bank) {
    lines.push('', `💳 Chuyển khoản ${vnd(doc.pay.amount)} (${doc.pay.label.toLowerCase()}): ${shop.bank.name} ${shop.bank.account}${shop.bank.holder ? ` — ${shop.bank.holder}` : ''}, nội dung: ${doc.pay.note}`);
  }
  if (shop.phone.trim()) lines.push('', `📞 ${shop.phone.trim()}${shop.name.trim() ? ` — ${shop.name.trim()}` : ''}`);
  return lines.join('\n');
}
