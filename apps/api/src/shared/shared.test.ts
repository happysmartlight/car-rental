import { describe, expect, it } from 'vitest';
import { formatPlate, numberToVietnameseWords, parseMoney, plateKey, unaccent, vndInWords } from './text.js';
import { buildVietQrPayload, crc16, sanitizeTransferNote } from './vietqr.js';
import { parseCccdQr } from './cccd.js';
import { DEFAULT_PRICING_RULES, overKmCharge, overtimeCharge, quoteRental, type VehiclePricing } from './pricing.js';
import { cancelForfeit, cancelPolicyText, planCancellation, planSettlement, summarizeMoney } from './money.js';
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
  it('câu chính sách', () => {
    expect(cancelPolicyText(policy)).toBe('Hủy trong vòng 72 giờ (3 ngày) trước giờ nhận xe hoặc không đến nhận xe: mất toàn bộ tiền cọc (tiền thuê đã trả được hoàn lại). Hủy sớm hơn: hoàn lại toàn bộ tiền cọc và tiền thuê đã trả.');
    expect(cancelPolicyText({ cancelNoticeHours: 24, cancelForfeitPct: 50 })).toContain('trong vòng 24 giờ trước giờ nhận xe hoặc không đến nhận xe: mất 50% tiền cọc');
    expect(cancelPolicyText({ cancelNoticeHours: 24, cancelForfeitPct: 0 })).toBe('Hủy trước giờ nhận xe: hoàn lại toàn bộ tiền cọc và tiền thuê đã trả.');
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
