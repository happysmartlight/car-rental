import { describe, expect, it } from 'vitest';
import { formatPlate, numberToVietnameseWords, parseMoney, plateKey, unaccent, vndInWords } from './text.js';
import { buildVietQrPayload, crc16, sanitizeTransferNote } from './vietqr.js';
import { parseCccdQr } from './cccd.js';
import {
  DEFAULT_PRICING_RULES,
  chargeDays,
  chargingCharge,
  chargingText,
  freeChargesFor,
  overKmCharge,
  overtimeCharge,
  quoteRental,
  rentalChargingPolicy,
  tripChargingText,
  vehicleChargingPolicy,
  type VehiclePricing,
} from './pricing.js';
import { cancelForfeit, cancelMessage, cancelPolicyText, defaultFineHold, planCancellation, planSettlement, rentalFineHold, summarizeMoney } from './money.js';
import { mergeAccessoryPlan } from './accessories.js';
import { CAR_MAKES, findCarMake, findCarModel } from './carModels.js';
import { suggestBookingSlot } from './booking.js';
import { buildRentalShare, rentalShareStages, rentalShareText, type RentalShareInput } from './rentalShare.js';
import { addMonthsVn, fmtDateTime, msToVnLocalInput, vnDateLong, vnLocalInputToMs } from './time.js';

describe('đọc số tiền bằng chữ', () => {
  const cases: [number, string][] = [
    [0, 'không'],
    [10, 'mười'],
    [15, 'mười lăm'],
    [21, 'hai mươi mốt'],
    [24, 'hai mươi bốn'],
    [105, 'một trăm linh năm'],
    [1000, 'một nghìn'],
    [25000, 'hai mươi lăm nghìn'],
    [105000, 'một trăm linh năm nghìn'],
    [1500000, 'một triệu năm trăm nghìn'],
    [1005000, 'một triệu không trăm linh năm nghìn'],
    [3010000, 'ba triệu không trăm mười nghìn'],
    [21000000, 'hai mươi mốt triệu'],
    [1000000000, 'một tỷ'],
    [2500000000, 'hai tỷ năm trăm triệu'],
    [1000000000000, 'một nghìn tỷ'],
  ];
  it.each(cases)('%d', (n, words) => expect(numberToVietnameseWords(n)).toBe(words));
  it('viết hoa + đồng', () => expect(vndInWords(1500000)).toBe('Một triệu năm trăm nghìn đồng'));
});

describe('chữ & biển số', () => {
  it('bỏ dấu', () => expect(unaccent('Nguyễn Văn Đức')).toBe('nguyen van duc'));
  it('khóa biển số', () => expect(plateKey('51k-123.45')).toBe('51K12345'));
  it('định dạng biển 5 số', () => expect(formatPlate('51k12345')).toBe('51K-123.45'));
  it('định dạng biển 4 số', () => expect(formatPlate('30a 1234')).toBe('30A-1234'));
  it('biển 2 chữ cái', () => expect(formatPlate('51LD12345')).toBe('51LD-123.45'));
  it('đọc số tiền gõ tay', () => expect(parseMoney('1.500.000 đ')).toBe(1500000));
});

describe('VietQR', () => {
  it('CRC-16/CCITT-FALSE chuẩn', () => expect(crc16('123456789')).toBe(0x29b1));
  it('nội dung chuyển khoản không dấu, tối đa 25 ký tự', () => {
    expect(sanitizeTransferNote('HĐ-2026-0001 Nguyễn Văn A thuê xe')).toBe('HD 2026 0001 NGUYEN VAN A');
  });
  it('cấu trúc payload', () => {
    const p = buildVietQrPayload({ bin: '970436', accountNumber: '0123456789', amount: 1500000, note: 'HD-2026-0001' });
    expect(p.startsWith('000201010212')).toBe(true);
    expect(p).toContain('0010A000000727');
    expect(p).toContain('0006970436');
    expect(p).toContain('01100123456789');
    expect(p).toContain('54071500000');
    expect(p).toContain('5802VN');
    const body = p.slice(0, -4);
    expect(p.slice(-4)).toBe(crc16(body).toString(16).toUpperCase().padStart(4, '0'));
  });
});

describe('QR CCCD', () => {
  it('đọc thẻ CCCD gắn chip', () => {
    const d = parseCccdQr('079090001234|025123456|NGUYỄN VĂN AN|15081990|Nam|12 Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh|20042021');
    expect(d).toMatchObject({
      idNumber: '079090001234',
      oldIdNumber: '025123456',
      fullName: 'Nguyễn Văn An',
      dob: '1990-08-15',
      gender: 'Nam',
      idIssueDate: '2021-04-20',
      idCardType: 'cccd_chip',
    });
  });
  it('thẻ Căn cước mới → Bộ Công an', () => {
    const d = parseCccdQr('001195012345||Trần Thị Bình|01021995|Nữ|Hà Nội|15082024');
    expect(d?.idIssuePlace).toBe('Bộ Công an');
    expect(d?.oldIdNumber).toBeNull();
    expect(d?.gender).toBe('Nữ');
  });
  it('chuỗi lạ → null', () => expect(parseCccdQr('https://example.com')).toBeNull());
});

const car: VehiclePricing = { priceDay: 800000, priceHour: 100000, priceWeekendDay: 1000000, kmLimitDay: 300, overKmFee: 3000, overHourFee: 100000 };
const at = (s: string) => vnLocalInputToMs(s);

describe('tính giá', () => {
  it('2 ngày thường', () => {
    // Thứ hai 05/10/2026 08:00 → thứ tư 07/10 08:00
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-07T08:00'), car, DEFAULT_PRICING_RULES);
    expect(q.days).toBe(2);
    expect(q.total).toBe(1600000);
    expect(q.kmLimit).toBe(600);
  });
  it('trả trong ân hạn không tính thêm', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-07T08:45'), car, DEFAULT_PRICING_RULES);
    expect(q.total).toBe(1600000);
  });
  it('giờ lẻ tính theo giờ', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-06T11:00'), car, DEFAULT_PRICING_RULES);
    expect(q.days).toBe(1);
    expect(q.extraHours).toBe(3);
    expect(q.total).toBe(800000 + 300000);
  });
  it('giờ lẻ quá nhiều → thêm 1 ngày', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-06T20:00'), car, DEFAULT_PRICING_RULES);
    expect(q.days).toBe(2);
    expect(q.extraHours).toBe(0);
  });
  it('khối bắt đầu thứ bảy/chủ nhật lấy giá cuối tuần', () => {
    // Thứ sáu 09/10 08:00 → thứ hai 12/10 08:00: T6 thường, T7 + CN cuối tuần
    const q = quoteRental(at('2026-10-09T08:00'), at('2026-10-12T08:00'), car, DEFAULT_PRICING_RULES);
    expect(q.total).toBe(800000 + 2 * 1000000);
  });
  it('phụ thu lễ', () => {
    const rules = { ...DEFAULT_PRICING_RULES, holidays: [{ name: 'Quốc khánh', from: '2026-09-01', to: '2026-09-02', surchargePct: 50 }] };
    // Thứ ba 01/09 → thứ năm 03/09
    const q = quoteRental(at('2026-09-01T08:00'), at('2026-09-03T08:00'), car, rules);
    expect(q.total).toBe(1600000 + 800000);
  });
  it('thuê ngắn dưới 1 ngày tính giờ', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-05T12:00'), car, DEFAULT_PRICING_RULES);
    expect(q.total).toBe(400000);
  });
  it('trả trễ', () => {
    const line = overtimeCharge(at('2026-10-07T08:00'), at('2026-10-07T11:30'), car, DEFAULT_PRICING_RULES);
    expect(line?.amount).toBe(400000);
    expect(overtimeCharge(at('2026-10-07T08:00'), at('2026-10-07T08:30'), car, DEFAULT_PRICING_RULES)).toBeNull();
  });
  it('vượt km', () => {
    expect(overKmCharge(10000, 10700, 600, 3000)?.amount).toBe(300000);
    expect(overKmCharge(10000, 10500, 600, 3000)).toBeNull();
  });
});

describe('sạc pin xe điện', () => {
  const policy = { baseFree: 1, fee: 30000 };
  it('thuê đến 2 ngày được lượt cơ bản, từ ngày thứ 3 mỗi ngày thêm 1 lượt', () => {
    expect([1, 2, 3, 4, 5, 7].map((d) => freeChargesFor(policy, d))).toEqual([1, 1, 2, 3, 4, 6]);
    expect(freeChargesFor({ baseFree: 2, fee: 0 }, 4)).toBe(4);
    expect(freeChargesFor({ baseFree: 0, fee: 30000 }, 5)).toBe(0);
  });
  it('số ngày thuê: khối 24 giờ, phần lẻ quá ân hạn tính thêm 1 ngày', () => {
    const s = at('2026-10-05T08:00');
    expect(chargeDays(s, at('2026-10-05T12:00'), 60)).toBe(1);
    expect(chargeDays(s, at('2026-10-07T08:00'), 60)).toBe(2);
    expect(chargeDays(s, at('2026-10-07T08:45'), 60)).toBe(2);
    expect(chargeDays(s, at('2026-10-07T11:00'), 60)).toBe(3);
  });
  it('chỉ tính lượt vượt số lượt miễn phí của chuyến', () => {
    expect(chargingCharge(1, policy, 2)).toBeNull();
    expect(chargingCharge(2, policy, 2)).toMatchObject({ kind: 'fuel', amount: 30000, description: 'Sạc pin 2 lượt (chuyến 2 ngày miễn phí 1): 1 × 30.000' });
    expect(chargingCharge(4, policy, 5)).toBeNull();
    expect(chargingCharge(6, policy, 5)?.amount).toBe(60000);
    expect(chargingCharge(1, { baseFree: 0, fee: 30000 }, 5)?.amount).toBe(30000);
    expect(chargingCharge(9, { baseFree: 3, fee: 0 }, 2)).toBeNull();
    expect(chargingCharge(9, null, 2)).toBeNull();
  });
  it('câu chữ cho bảng giá / hợp đồng', () => {
    expect(chargingText(policy)).toBe('thuê đến 2 ngày miễn phí 1 lượt sạc, từ ngày thứ 3 mỗi ngày thêm 1 lượt (3 ngày: 2 lượt, 4 ngày: 3 lượt…); sạc vượt tính 30.000đ/lượt cắm-rút sạc');
    expect(chargingText({ baseFree: 0, fee: 30000 })).toBe('30.000đ/lượt cắm-rút sạc');
    expect(tripChargingText(policy, 5)).toBe('chuyến 5 ngày miễn phí 4 lượt sạc, từ lượt thứ 5 tính 30.000đ/lượt cắm-rút sạc');
    expect(tripChargingText({ baseFree: 0, fee: 30000 }, 5)).toBe('30.000đ/lượt cắm-rút sạc');
  });
  it('chỉ xe điện; lượt thuê dùng giá đã chốt, lượt cũ lấy theo xe', () => {
    expect(vehicleChargingPolicy({ fuel: 'gasoline', freeCharges: 2, chargeFee: 30000 })).toBeNull();
    expect(vehicleChargingPolicy({ fuel: 'electric', freeCharges: null, chargeFee: null })).toBeNull();
    expect(vehicleChargingPolicy({ fuel: 'electric', freeCharges: 0, chargeFee: 0 })).toBeNull();
    const ev = { fuel: 'electric' as const, freeCharges: 2, chargeFee: 40000 };
    const base = { priceDay: 1, priceHour: 0, priceWeekendDay: null, kmLimitDay: 0, overKmFee: 0, overHourFee: 0 };
    expect(rentalChargingPolicy({ ...base, freeCharges: 1, chargeFee: 30000 }, ev)).toEqual(policy);
    expect(rentalChargingPolicy({ ...base, freeCharges: null, chargeFee: null }, ev)).toBeNull();
    expect(rentalChargingPolicy(base, ev)).toEqual({ baseFree: 2, fee: 40000 });
  });
});

describe('thuê tháng', () => {
  const monthly: VehiclePricing = { ...car, priceMonth: 15_000_000, kmLimitMonth: 3000 };
  it('cộng tháng dương lịch, ngày cuối tháng lùi về cuối tháng sau', () => {
    expect(msToVnLocalInput(addMonthsVn(at('2027-01-31T08:00'), 1))).toBe('2027-02-28T08:00');
    expect(msToVnLocalInput(addMonthsVn(at('2026-10-05T08:30'), 3))).toBe('2027-01-05T08:30');
  });
  it('đúng 1 tháng', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-11-05T08:00'), monthly, DEFAULT_PRICING_RULES);
    expect(q).toMatchObject({ mode: 'month', months: 1, total: 15_000_000, kmLimit: 3000 });
  });
  it('trả trong ân hạn vẫn tính đủ 1 tháng', () => {
    expect(quoteRental(at('2026-10-05T08:00'), at('2026-11-05T08:45'), monthly, DEFAULT_PRICING_RULES).total).toBe(15_000_000);
  });
  it('1 tháng + 10 ngày lẻ tính giá tháng ÷ 30', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-11-15T08:00'), monthly, DEFAULT_PRICING_RULES);
    expect(q.months).toBe(1);
    expect(q.days).toBe(10);
    expect(q.total).toBe(15_000_000 + 10 * 500_000);
    expect(q.kmLimit).toBe(4000);
  });
  it('3 tháng', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2027-01-05T08:00'), monthly, DEFAULT_PRICING_RULES);
    expect(q).toMatchObject({ months: 3, total: 45_000_000, kmLimit: 9000 });
  });
  it('chưa đủ tháng nhưng tính ngày đắt hơn → áp giá 1 tháng', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-30T08:00'), monthly, DEFAULT_PRICING_RULES);
    expect(q).toMatchObject({ mode: 'month', total: 15_000_000 });
  });
  it('thuê ngắn vẫn tính theo ngày', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-10-08T08:00'), monthly, DEFAULT_PRICING_RULES);
    expect(q).toMatchObject({ mode: 'day', total: 2_400_000 });
  });
  it('không đặt giới hạn km/tháng → 30 × km/ngày', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-11-05T08:00'), { ...monthly, kmLimitMonth: null }, DEFAULT_PRICING_RULES);
    expect(q.kmLimit).toBe(9000);
  });
  it('xe không có giá tháng → luôn tính ngày', () => {
    const q = quoteRental(at('2026-10-05T08:00'), at('2026-11-05T08:00'), car, DEFAULT_PRICING_RULES);
    expect(q.mode).toBe('day');
    expect(q.months).toBe(0);
  });
});

describe('sổ tiền & quyết toán', () => {
  it('cấn trừ cọc, giữ cọc phạt nguội, hoàn phần còn lại', () => {
    const s = summarizeMoney(
      [{ amount: 1600000 }, { amount: 300000 }],
      [
        { direction: 'in', purpose: 'rent', amount: 1600000 },
        { direction: 'in', purpose: 'deposit', amount: 5000000 },
      ],
    );
    expect(s.due).toBe(300000);
    expect(s.depositHeld).toBe(5000000);
    const plan = planSettlement(s, 2000000);
    expect(plan).toEqual({ offset: 300000, collect: 0, refundRent: 0, keepHold: 2000000, refundDeposit: 2700000 });
  });
  it('phiếu đã hủy không tính', () => {
    const s = summarizeMoney([{ amount: 1000 }], [{ direction: 'in', purpose: 'rent', amount: 1000, voidedAt: 1 }]);
    expect(s.due).toBe(1000);
  });
  it('offset chuyển cọc sang tiền thuê', () => {
    const s = summarizeMoney([{ amount: 1000 }], [
      { direction: 'in', purpose: 'deposit', amount: 3000 },
      { direction: 'offset', purpose: 'deposit', amount: 1000 },
    ]);
    expect(s).toMatchObject({ rentPaid: 1000, depositHeld: 2000, due: 0 });
  });
});

describe('khách hủy đặt xe', () => {
  const H = 3_600_000;
  const policy = { cancelNoticeHours: 72, cancelForfeitPct: 100 };
  it('hủy sát giờ (hoặc không đến) mất cọc, hủy sớm thì không', () => {
    const start = vnLocalInputToMs('2026-10-20T08:00');
    expect(cancelForfeit(3000000, start, start - 73 * H, policy)).toBe(0);
    expect(cancelForfeit(3000000, start, start - 72 * H, policy)).toBe(0);
    expect(cancelForfeit(3000000, start, start - 71 * H, policy)).toBe(3000000);
    expect(cancelForfeit(3000000, start, start + 2 * H, policy)).toBe(3000000);
    expect(cancelForfeit(3000000, start, start - H, { cancelNoticeHours: 24, cancelForfeitPct: 50 })).toBe(1500000);
    expect(cancelForfeit(3000000, start, start - H, { cancelNoticeHours: 24, cancelForfeitPct: 0 })).toBe(0);
    expect(cancelForfeit(0, start, start - H, policy)).toBe(0);
  });
  it('giữ từ cọc trước, thiếu thì lấy tiền thuê trả trước; hoàn phần còn lại', () => {
    const s = summarizeMoney([{ amount: 2000000 }], [
      { direction: 'in', purpose: 'deposit', amount: 3000000 },
      { direction: 'in', purpose: 'rent', amount: 1000000 },
    ]);
    expect(planCancellation(s, 3000000)).toEqual({ keep: 3000000, offset: 3000000, refundDeposit: 0, refundRent: 1000000 });
    expect(planCancellation(s, 1000000)).toEqual({ keep: 1000000, offset: 1000000, refundDeposit: 2000000, refundRent: 1000000 });
    expect(planCancellation(s, 3500000)).toEqual({ keep: 3500000, offset: 3000000, refundDeposit: 0, refundRent: 500000 });
    expect(planCancellation(s, 9000000).keep).toBe(4000000); // không giữ quá tiền khách đã đưa
    expect(planCancellation(s, 0)).toEqual({ keep: 0, offset: 0, refundDeposit: 3000000, refundRent: 1000000 });
  });
  it('tin nhắn báo khách: mất cọc / được giảm / chưa đặt cọc', () => {
    const start = vnLocalInputToMs('2026-10-20T08:00');
    const money = summarizeMoney([], [
      { direction: 'in', purpose: 'deposit', amount: 3000000 },
      { direction: 'in', purpose: 'rent', amount: 500000 },
    ]);
    const base = { customerName: 'Nguyễn Văn A', code: 'HD-2026-0007', plate: '51A-123.45', scheduledStart: start, at: start - 5 * H, policy, money, shopName: 'Xe Tự Lái An Phát', shopPhone: '0909 000 111' };
    const lost = cancelMessage({ ...base, keep: 3000000 });
    expect(lost).toContain('Xe Tự Lái An Phát xác nhận đã hủy lượt thuê HD-2026-0007 – xe 51A-123.45, hẹn nhận xe lúc 08:00 20/10/2026.');
    expect(lost).toContain('Thời điểm hủy: 03:00 20/10/2026 (trước giờ nhận xe 5 giờ).');
    expect(lost).toContain('• Cửa hàng giữ lại: 3.000.000 đ (mất cọc theo chính sách hủy)');
    expect(lost).toContain('• Hoàn lại anh/chị: 500.000 đ');
    expect(lost).toContain('Mong anh/chị thông cảm');
    expect(lost).toContain('Mọi thắc mắc xin liên hệ 0909 000 111.');
    const eased = cancelMessage({ ...base, keep: 1000000 });
    expect(eased).toContain('(theo thỏa thuận)');
    expect(eased).toContain('Cửa hàng đã hỗ trợ anh/chị 2.000.000 đ so với chính sách.');
    const none = cancelMessage({ ...base, money: summarizeMoney([], []), keep: 0 });
    expect(none).toContain('chưa thanh toán khoản nào');
    expect(none).toContain('Cảm ơn anh/chị đã báo');
  });
  it('câu chính sách', () => {
    expect(cancelPolicyText(policy)).toBe('Hủy trong vòng 72 giờ (3 ngày) trước giờ nhận xe hoặc không đến nhận xe: mất toàn bộ tiền cọc (tiền thuê đã trả được hoàn lại). Hủy sớm hơn: hoàn lại toàn bộ tiền cọc và tiền thuê đã trả.');
    expect(cancelPolicyText({ cancelNoticeHours: 24, cancelForfeitPct: 50 })).toContain('trong vòng 24 giờ trước giờ nhận xe hoặc không đến nhận xe: mất 50% tiền cọc');
    expect(cancelPolicyText({ cancelNoticeHours: 24, cancelForfeitPct: 0 })).toBe('Hủy trước giờ nhận xe: hoàn lại toàn bộ tiền cọc và tiền thuê đã trả.');
    expect(cancelPolicyText(policy, false)).toBe('Hủy trước giờ nhận xe: hoàn lại toàn bộ tiền thuê đã trả.');
  });
});

describe('cọc chờ phạt nguội theo lượt', () => {
  const rules = { fineHoldAmount: 2000000, fineHoldDays: 15 };
  it('mặc định theo cài đặt nhưng không vượt tiền cọc', () => {
    expect(defaultFineHold(5000000, rules)).toBe(2000000);
    expect(defaultFineHold(1000000, rules)).toBe(1000000);
    expect(defaultFineHold(0, rules)).toBe(0);
  });
  it('lượt đã thỏa thuận thì theo lượt; lượt cũ (null) theo cài đặt', () => {
    expect(rentalFineHold({ depositRequired: 5000000, fineHoldRequired: 3000000, fineHoldDays: 30 }, rules)).toEqual({ amount: 3000000, days: 30 });
    expect(rentalFineHold({ depositRequired: 0, fineHoldRequired: null, fineHoldDays: null }, rules)).toEqual({ amount: 0, days: 15 });
  });
});

describe('phụ kiện theo lượt', () => {
  const a = (id: number | null, name: string, present = true) => ({ id, name, quantity: 1, value: 0, present });
  it('chưa chỉnh thì theo xe; đã chỉnh thì giữ nguyên + thêm món xe mới có', () => {
    const current = [a(1, 'Camera'), a(2, 'Sạc'), a(3, 'Ô')];
    expect(mergeAccessoryPlan(null, current)).toBe(current);
    expect(mergeAccessoryPlan([a(1, 'Camera', false), a(2, 'Sạc'), a(null, 'Ghế trẻ em')], current).map((x) => [x.name, x.present])).toEqual([
      ['Camera', false],
      ['Sạc', true],
      ['Ghế trẻ em', true],
      ['Ô', true],
    ]);
  });
});

describe('giờ VN', () => {
  it('khứ hồi input datetime-local', () => expect(msToVnLocalInput(vnLocalInputToMs('2026-10-06T14:30'))).toBe('2026-10-06T14:30'));
  it('định dạng', () => {
    const ms = vnLocalInputToMs('2026-10-06T14:30');
    expect(fmtDateTime(ms)).toBe('14:30 06/10/2026');
    expect(vnDateLong(ms)).toBe('ngày 06 tháng 10 năm 2026');
  });
});

describe('danh mục hãng / dòng xe', () => {
  it('VinFast đứng đầu; khớp tên không phân biệt hoa thường, khoảng trắng', () => {
    expect(CAR_MAKES[0].name).toBe('VinFast');
    const vf = findCarMake('vinfast');
    expect(vf?.name).toBe('VinFast');
    expect(findCarModel(vf, 'VF3')).toBe('VF 3');
    expect(findCarModel(findCarMake('Toyota'), 'vios')).toBe('Vios');
    expect(findCarModel(findCarMake('Toyota'), 'Vios 1.5G')).toBeUndefined();
    expect(findCarMake('Lada')).toBeUndefined();
    expect(vf?.electric).toContain('VF 3');
  });
});

describe('gợi ý giờ đặt xe từ Lịch xe', () => {
  const t = vnLocalInputToMs;
  const now = t('2026-10-08T14:10');
  const buffer = 120 * 60_000;
  const rental = (start: string, end: string, status = 'booked') => ({ type: 'rental' as const, status, start: t(start), end: t(end) });
  const slot = (firstDay: string, items: ReturnType<typeof rental>[] = [], lastDay?: string) => {
    const s = suggestBookingSlot({ firstDay: t(firstDay), lastDay: lastDay ? t(lastDay) : undefined, items, bufferMs: buffer, now });
    return { start: msToVnLocalInput(s.start), end: msToVnLocalInput(s.end), after: s.after, before: s.before };
  };

  it('ngày trống: nhận giờ mặc định 8:30, thuê 1 ngày', () => expect(slot('2026-10-10T00:00')).toMatchObject({ start: '2026-10-10T08:30', end: '2026-10-11T08:30' }));
  it('giờ nhận mặc định chỉnh trong cài đặt; sai định dạng thì về 8:30', () => {
    const at = (pickupTime: string) => msToVnLocalInput(suggestBookingSlot({ firstDay: t('2026-10-10T00:00'), items: [], bufferMs: buffer, now, pickupTime }).start);
    expect(at('07:15')).toBe('2026-10-10T07:15');
    expect(at('25:00')).toBe('2026-10-10T08:30');
  });
  it('hôm nay: sớm nhất sau 1 tiếng, tròn nửa giờ', () => expect(slot('2026-10-08T00:00')).toMatchObject({ start: '2026-10-08T15:30', end: '2026-10-09T15:30' }));
  it('kéo nhiều ngày: thuê đủ số ngày', () => expect(slot('2026-10-10T00:00', [], '2026-10-12T00:00')).toMatchObject({ start: '2026-10-10T08:30', end: '2026-10-13T08:30' }));

  it('lượt trước trả trong ngày: nhận sau giờ trả + dọn xe', () => {
    const prev = rental('2026-10-08T09:00', '2026-10-10T10:15');
    expect(slot('2026-10-10T00:00', [prev])).toMatchObject({ start: '2026-10-10T12:30', end: '2026-10-11T12:30', after: prev });
  });

  it('lượt kế tiếp: trả sớm cho kịp dọn xe', () => {
    const next = rental('2026-10-11T07:00', '2026-10-12T07:00');
    expect(slot('2026-10-10T00:00', [next])).toMatchObject({ start: '2026-10-10T08:30', end: '2026-10-11T05:00', before: next });
  });

  it('khe giữa 2 lượt: lùi giờ nhận và kéo giờ trả', () => {
    const prev = rental('2026-10-09T08:00', '2026-10-10T08:00');
    const next = rental('2026-10-12T08:00', '2026-10-13T08:00');
    expect(slot('2026-10-10T00:00', [prev, next], '2026-10-13T00:00')).toMatchObject({ start: '2026-10-10T10:00', end: '2026-10-12T06:00', after: prev, before: next });
  });

  it('lượt chiếm buổi sáng: nhận sau khi lượt đó xong', () => {
    const morning = rental('2026-10-10T09:00', '2026-10-10T13:00');
    expect(slot('2026-10-10T00:00', [morning])).toMatchObject({ start: '2026-10-10T15:00', after: morning });
  });

  it('ngày kín lịch: giữ giờ mặc định để form báo trùng', () => {
    expect(slot('2026-10-10T00:00', [rental('2026-10-09T08:00', '2026-10-12T08:00')])).toEqual({ start: '2026-10-10T08:30', end: '2026-10-11T08:30', after: undefined, before: undefined });
  });

  it('bỏ qua lượt đã trả/đã hủy; khối tạm ngưng không cần đệm', () => {
    expect(slot('2026-10-10T00:00', [rental('2026-10-09T08:00', '2026-10-10T10:00', 'returned')])).toMatchObject({ start: '2026-10-10T08:30' });
    const block = { type: 'block' as const, status: 'garage', start: t('2026-10-09T00:00'), end: t('2026-10-10T09:00') };
    expect(suggestBookingSlot({ firstDay: t('2026-10-10T00:00'), items: [block], bufferMs: buffer, now }).start).toBe(t('2026-10-10T09:00'));
  });
});

describe('phiếu gửi khách (giao xe / nhận xe / quyết toán)', () => {
  const at = (s: string) => vnLocalInputToMs(s);
  const pricing: VehiclePricing = { priceDay: 1000000, priceHour: 150000, priceWeekendDay: null, kmLimitDay: 300, overKmFee: 3000, overHourFee: 0, freeCharges: 1, chargeFee: 30000 };
  const rent = [{ kind: 'rental' as const, description: 'Tiền thuê 3 ngày × 1.000.000', amount: 3000000 }];
  const paid = [
    { direction: 'in' as const, purpose: 'rent' as const, amount: 1000000 },
    { direction: 'in' as const, purpose: 'deposit' as const, amount: 5000000 },
  ];
  const base: RentalShareInput = {
    stage: 'pickup',
    rental: {
      code: 'HD-2026-0001',
      status: 'active',
      scheduledStart: at('2026-12-01T08:00'),
      scheduledEnd: at('2026-12-04T08:00'),
      kmLimit: 900,
      pickupLocation: null,
      returnLocation: null,
      depositRequired: 5000000,
      fineHoldUntil: null,
      pricing: JSON.stringify(pricing),
    },
    customerName: 'Nguyễn Văn A',
    vehicle: { plate: '51K-999.88', make: 'VinFast', model: 'VF 6', fuel: 'electric', freeCharges: 1, chargeFee: 30000 },
    pickup: {
      at: at('2026-12-01T08:10'),
      odo: 1000,
      fuelLevel: 90,
      photos: [{ slot: 'front', fileId: 'f1' }],
      damages: [{ zone: 'Cản trước', note: 'trầy 5cm' }],
      accessories: [{ name: 'Cáp sạc', quantity: 1, present: true }],
    },
    ret: null,
    charges: rent,
    money: summarizeMoney(rent, paid),
    graceMinutes: 60,
    shopName: 'Xe Happy',
  };
  const shop = { name: 'Xe Happy', phone: '0901 234 567', bank: { name: 'Vietcombank', account: '0123456789', holder: 'NGUYEN VAN B' } };

  it('giai đoạn gửi được theo trạng thái', () => {
    expect(rentalShareStages('booked', false, false)).toEqual([]);
    expect(rentalShareStages('active', true, false)).toEqual(['pickup']);
    expect(rentalShareStages('returned', true, true)).toEqual(['pickup', 'return']);
    expect(rentalShareStages('settled', true, true)).toEqual(['pickup', 'return', 'settle']);
    expect(rentalShareStages('cancelled', false, false)).toEqual([]);
  });

  it('giao xe: hẹn trả, km tới ODO bao nhiêu, hiện trạng, lượt sạc, còn phải trả kèm chuyển khoản', () => {
    const doc = buildRentalShare(base);
    const text = rentalShareText(doc, shop);
    expect(text).toContain('XÁC NHẬN GIAO XE — HD-2026-0001');
    expect(text).toContain('• Hẹn trả: 08:00 04/12/2026');
    expect(text).toContain('• Giới hạn quãng đường: 900 km (đến ODO 1.900)');
    expect(text).toContain('• Hiện trạng có sẵn: Cản trước: trầy 5cm');
    expect(text).toContain('• Còn phải trả: 2.000.000đ');
    expect(text).toContain('trả trễ tính 150.000đ/giờ');
    expect(text).toContain('chuyến 3 ngày miễn phí 2 lượt sạc');
    expect(text).toContain('💳 Chuyển khoản 2.000.000đ (còn phải trả): Vietcombank 0123456789 — NGUYEN VAN B, nội dung: HD-2026-0001');
    expect(doc.photos).toEqual(['f1']);
  });

  it('nhận xe: trễ giờ, km đã đi, thiếu phụ kiện, hư hỏng mới, phần trừ vào cọc', () => {
    const charges = [...rent, { kind: 'over_time' as const, description: 'Trả xe trễ 3 giờ', amount: 450000 }];
    const doc = buildRentalShare({
      ...base,
      stage: 'return',
      rental: { ...base.rental, status: 'returned' },
      ret: {
        at: at('2026-12-04T11:00'),
        odo: 2000,
        fuelLevel: 40,
        photos: [],
        damages: [{ zone: 'Cản trước', note: 'trầy 5cm' }, { zone: 'Gương trái', note: 'nứt', isNew: true }],
        accessories: [{ name: 'Cáp sạc', quantity: 1, present: false, note: 'quên ở nhà' }],
      },
      charges,
      money: summarizeMoney(charges, paid),
    });
    const text = rentalShareText(doc, { ...shop, bank: null });
    expect(text).toContain('• Trả xe: 11:00 04/12/2026 (trễ 3 giờ)');
    expect(text).toContain('• Quãng đường: 1.000 km / giới hạn 900 km');
    expect(text).toContain('• Mức pin: 40% (lúc giao 90%)');
    expect(text).toContain('• Phụ kiện thiếu: Cáp sạc (quên ở nhà)');
    expect(text).toContain('• Hư hỏng mới: Gương trái: nứt');
    expect(text).not.toContain('Cản trước');
    expect(text).toContain('• Tổng cộng: 3.450.000đ');
    expect(text).toContain('Khoản 2.450.000đ còn phải trả sẽ được trừ vào tiền cọc khi quyết toán.');
    expect(doc.pay).toBeNull();
  });

  it('quyết toán: cấn trừ cọc, hoàn cọc, giữ lại chờ phạt nguội đến ngày', () => {
    const charges = [...rent, { kind: 'over_time' as const, description: 'Trả xe trễ 3 giờ', amount: 450000 }];
    const money = summarizeMoney(charges, [
      ...paid,
      { direction: 'offset', purpose: 'deposit', amount: 2450000 },
      { direction: 'out', purpose: 'deposit', amount: 1550000 },
    ]);
    const doc = buildRentalShare({ ...base, stage: 'settle', rental: { ...base.rental, status: 'settled', fineHoldUntil: at('2027-01-03T08:00') }, charges, money });
    const text = rentalShareText(doc, shop);
    expect(text).toContain('QUYẾT TOÁN LƯỢT THUÊ — HD-2026-0001');
    expect(text).toContain('• Đã thanh toán: 1.000.000đ');
    expect(text).toContain('• Trừ vào tiền cọc: 2.450.000đ');
    expect(text).toContain('• Đã hoàn cọc: 1.550.000đ');
    expect(text).toContain('• Cọc giữ chờ phạt nguội: 1.000.000đ');
    expect(text).toContain('đến 03/01/2027');
    expect(text).not.toContain('Chuyển khoản');
    expect(doc.pay).toBeNull();
  });
});
