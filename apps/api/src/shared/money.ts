// Sổ tiền của một lượt thuê.
//
// charges  = khoản khách PHẢI trả (tiền thuê, phụ phí; giảm giá là số âm).
// payments = tiền thực sự đi lại giữa hai bên:
//   in  + rent     khách trả tiền thuê
//   in  + deposit  khách đặt cọc
//   out + rent     mình hoàn tiền thuê thừa
//   out + deposit  mình hoàn cọc
//   offset         cấn trừ: chuyển một phần cọc sang tiền thuê (không có tiền mặt đi lại)

import { fmtVnd } from './text.js';
import { HOUR_MS, fmtDateTime, fmtDuration } from './time.js';

export type PaymentDirection = 'in' | 'out' | 'offset';
export type PaymentPurpose = 'rent' | 'deposit';

export interface MoneyPayment {
  direction: PaymentDirection;
  purpose: PaymentPurpose;
  amount: number;
  voidedAt?: number | null;
}

export interface MoneySummary {
  totalCharges: number;
  rentPaid: number;
  depositReceived: number;
  depositReturned: number;
  depositOffset: number;
  depositHeld: number;
  /** > 0: khách còn nợ. < 0: mình đang thu thừa, phải hoàn. */
  due: number;
}

export function summarizeMoney(charges: { amount: number }[], payments: MoneyPayment[]): MoneySummary {
  const live = payments.filter((p) => !p.voidedAt);
  const sum = (f: (p: MoneyPayment) => boolean) => live.filter(f).reduce((s, p) => s + p.amount, 0);
  const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
  const depositReceived = sum((p) => p.direction === 'in' && p.purpose === 'deposit');
  const depositReturned = sum((p) => p.direction === 'out' && p.purpose === 'deposit');
  const depositOffset = sum((p) => p.direction === 'offset');
  const rentPaid = sum((p) => p.direction === 'in' && p.purpose === 'rent') - sum((p) => p.direction === 'out' && p.purpose === 'rent') + depositOffset;
  const depositHeld = depositReceived - depositReturned - depositOffset;
  return { totalCharges, rentPaid, depositReceived, depositReturned, depositOffset, depositHeld, due: totalCharges - rentPaid };
}

export interface SettlementPlan {
  /** Cấn trừ từ cọc sang tiền thuê. */
  offset: number;
  /** Khách phải trả thêm (sau khi đã cấn trừ hết cọc). */
  collect: number;
  /** Mình hoàn lại tiền thuê thu thừa. */
  refundRent: number;
  /** Giữ lại trong cọc để chờ phạt nguội. */
  keepHold: number;
  /** Hoàn cọc ngay. */
  refundDeposit: number;
}

/** Mức giữ cọc chờ phạt nguội gợi ý khi đặt xe: theo cài đặt nhưng không vượt tiền cọc của lượt. */
export function defaultFineHold(deposit: number, rules: { fineHoldAmount: number }): number {
  return Math.max(0, Math.min(rules.fineHoldAmount, deposit));
}

/** Cọc giữ chờ phạt nguội đã thỏa thuận cho một lượt (lượt tạo trước khi có trường này: theo cài đặt). */
export function rentalFineHold(
  r: { depositRequired: number; fineHoldRequired: number | null; fineHoldDays: number | null },
  rules: { fineHoldAmount: number; fineHoldDays: number },
): { amount: number; days: number } {
  return { amount: r.fineHoldRequired ?? defaultFineHold(r.depositRequired, rules), days: r.fineHoldDays ?? rules.fineHoldDays };
}

/** Gợi ý quyết toán: cấn trừ cọc trước, giữ một phần cọc chờ phạt nguội, hoàn phần còn lại. */
export function planSettlement(s: MoneySummary, fineHoldAmount: number): SettlementPlan {
  const due = Math.max(0, s.due);
  const offset = Math.min(due, Math.max(0, s.depositHeld));
  const collect = due - offset;
  const remaining = Math.max(0, s.depositHeld - offset);
  const keepHold = Math.min(Math.max(0, fineHoldAmount), remaining);
  return {
    offset,
    collect,
    refundRent: s.due < 0 ? -s.due : 0,
    keepHold,
    refundDeposit: remaining - keepHold,
  };
}

// ── Khách hủy đặt xe ─────────────────────────────────────────────────────────

export interface CancelPolicy {
  /** Hủy khi còn ít hơn chừng này giờ tới giờ nhận xe (hoặc đã quá giờ) thì khách mất cọc. */
  cancelNoticeHours: number;
  /** Phần trăm tiền cọc khách mất khi hủy sát giờ. */
  cancelForfeitPct: number;
}

/** Số tiền cọc khách mất nếu hủy lúc `at` theo chính sách; hủy đủ sớm thì 0. */
export function cancelForfeit(depositHeld: number, scheduledStart: number, at: number, p: CancelPolicy): number {
  if (depositHeld <= 0 || p.cancelForfeitPct <= 0) return 0;
  if (scheduledStart - at >= p.cancelNoticeHours * HOUR_MS) return 0;
  return Math.round((depositHeld * Math.min(100, p.cancelForfeitPct)) / 100);
}

export interface CancelPlan {
  /** Số tiền giữ lại thật sự (không vượt quá tiền khách đã đưa). */
  keep: number;
  /** Cấn từ cọc sang phí hủy. */
  offset: number;
  /** Hoàn cọc còn lại. */
  refundDeposit: number;
  /** Hoàn tiền thuê khách đã trả trước. */
  refundRent: number;
}

/** Chia tiền khi hủy: giữ `keep` — lấy từ cọc trước, thiếu thì lấy tiếp từ tiền thuê trả trước — hoàn phần còn lại. */
export function planCancellation(s: MoneySummary, keep: number): CancelPlan {
  const deposit = Math.max(0, s.depositHeld);
  const rent = Math.max(0, s.rentPaid);
  const k = Math.min(Math.max(0, keep), deposit + rent);
  const offset = Math.min(k, deposit);
  return { keep: k, offset, refundDeposit: deposit - offset, refundRent: rent - (k - offset) };
}

/** Câu chính sách hủy (in hợp đồng, nhắc khi đặt xe). Lượt không cọc thì không có gì để mất. */
export function cancelPolicyText(p: CancelPolicy, hasDeposit = true): string {
  if (!hasDeposit) return 'Hủy trước giờ nhận xe: hoàn lại toàn bộ tiền thuê đã trả.';
  const refundAll = 'hoàn lại toàn bộ tiền cọc và tiền thuê đã trả';
  if (p.cancelForfeitPct <= 0) return `Hủy trước giờ nhận xe: ${refundAll}.`;
  const lose = `mất ${p.cancelForfeitPct >= 100 ? 'toàn bộ' : `${p.cancelForfeitPct}%`} tiền cọc (tiền thuê đã trả được hoàn lại)`;
  if (p.cancelNoticeHours <= 0) return `Không đến nhận xe: ${lose}. Hủy trước giờ nhận xe: ${refundAll}.`;
  const h = p.cancelNoticeHours;
  const window = h >= 48 && h % 24 === 0 ? `${h} giờ (${h / 24} ngày)` : `${h} giờ`;
  return `Hủy trong vòng ${window} trước giờ nhận xe hoặc không đến nhận xe: ${lose}. Hủy sớm hơn: ${refundAll}.`;
}

export interface CancelMessageInput {
  customerName: string;
  code: string;
  plate: string;
  scheduledStart: number;
  /** Lúc hủy. */
  at: number;
  policy: CancelPolicy | null;
  money: MoneySummary;
  /** Số tiền cửa hàng giữ lại (đã chọn trong hộp thoại). */
  keep: number;
  shopName?: string;
  shopPhone?: string;
}

/** Tin nhắn báo khách khi hủy: thời điểm hủy, chính sách, tiền giữ / hoàn — lời lẽ nhẹ nhàng để khách thông cảm. */
export function cancelMessage(i: CancelMessageInput): string {
  const plan = planCancellation(i.money, i.keep);
  const refund = plan.refundDeposit + plan.refundRent;
  const deposit = Math.max(0, i.money.depositHeld);
  const rent = Math.max(0, i.money.rentPaid);
  const suggested = i.policy ? cancelForfeit(deposit, i.scheduledStart, i.at, i.policy) : 0;
  const left = i.scheduledStart - i.at;
  const shop = i.shopName?.trim() || 'Cửa hàng';
  const lines = [
    `Chào anh/chị ${i.customerName},`,
    `${shop} xác nhận đã hủy lượt thuê ${i.code} – xe ${i.plate}, hẹn nhận xe lúc ${fmtDateTime(i.scheduledStart)}.`,
    `Thời điểm hủy: ${fmtDateTime(i.at)} (${left > 0 ? `trước giờ nhận xe ${fmtDuration(left)}` : `sau giờ nhận xe ${fmtDuration(-left)}`}).`,
  ];
  if (i.policy) lines.push(`Chính sách hủy: ${cancelPolicyText(i.policy)}`);
  lines.push('');
  if (deposit + rent === 0) {
    lines.push('Anh/chị chưa thanh toán khoản nào nên việc hủy không phát sinh phí.');
  } else {
    lines.push('Anh/chị đã thanh toán:');
    if (deposit > 0) lines.push(`• Tiền cọc: ${fmtVnd(deposit)}`);
    if (rent > 0) lines.push(`• Tiền thuê trả trước: ${fmtVnd(rent)}`);
    lines.push('Kết quả:');
    if (plan.keep > 0) lines.push(`• Cửa hàng giữ lại: ${fmtVnd(plan.keep)} ${plan.keep === suggested ? '(mất cọc theo chính sách hủy)' : '(theo thỏa thuận)'}`);
    if (refund > 0) lines.push(`• Hoàn lại anh/chị: ${fmtVnd(refund)}`);
    else lines.push('• Không có khoản hoàn lại.');
    if (suggested > plan.keep) lines.push(`Cửa hàng đã hỗ trợ anh/chị ${fmtVnd(suggested - plan.keep)} so với chính sách.`);
  }
  lines.push('');
  lines.push(
    plan.keep > 0
      ? 'Mong anh/chị thông cảm: xe đã được giữ riêng cho anh/chị trong thời gian này và cửa hàng đã từ chối các khách khác, nên khó cho thuê lại khi hủy sát giờ. Rất mong được phục vụ anh/chị lần sau!'
      : 'Cảm ơn anh/chị đã báo cho cửa hàng. Rất mong được phục vụ anh/chị lần sau!',
  );
  if (i.shopPhone?.trim()) lines.push(`Mọi thắc mắc xin liên hệ ${i.shopPhone.trim()}.`);
  return lines.join('\n');
}
