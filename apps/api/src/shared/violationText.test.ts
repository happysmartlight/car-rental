import { describe, expect, it } from 'vitest';
import { msToVnLocalInput } from './time.js';
import { cleanBehavior, normalizeViolation, parseVnDateTime, parseViolationText } from './violationText.js';

const iso = (ms: number | null) => (ms == null ? null : msToVnLocalInput(ms));

describe('đọc giờ vi phạm', () => {
  it.each([
    ['14:30, 28/09/2026', '2026-09-28T14:30'],
    ['28/09/2026 14:30', '2026-09-28T14:30'],
    ['09h05 ngày 3/10/2026', '2026-10-03T09:05'],
  ])('%s', (s, want) => expect(iso(parseVnDateTime(s))).toBe(want));
  it('chuỗi lạ → null', () => expect(parseVnDateTime('hôm qua')).toBeNull());
});

describe('kết quả dịch vụ tra cứu (JSON)', () => {
  it('chuẩn hóa một vi phạm', () => {
    const v = normalizeViolation(
      {
        'Biển kiểm soát': '51K12345',
        'Thời gian vi phạm': '14:30, 28/09/2026',
        'Địa điểm vi phạm': 'Km 15+200 cao tốc TP.HCM – Long Thành',
        'Hành vi vi phạm': '12321.5.a.01.Điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h',
        'Trạng thái': 'Chưa xử phạt',
        'Đơn vị phát hiện vi phạm': 'Đội CSGT cao tốc',
        'Nơi giải quyết vụ việc': ['1. Đội CSGT cao tốc', 'Địa chỉ: …'],
      },
      '51K12345',
    );
    expect(iso(v.violatedAt)).toBe('2026-09-28T14:30');
    expect(v.violation).toBe('Điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h');
    expect(v.status).toBe('unpaid');
    expect(v.resolvePlaces).toHaveLength(2);
  });
  it('đã xử phạt', () => expect(normalizeViolation({ 'Trạng thái': 'Đã xử phạt' }, 'x').status).toBe('paid'));
  it('bỏ mã điều khoản', () => expect(cleanBehavior('16824.7.a.01.Không chấp hành hiệu lệnh của đèn tín hiệu')).toBe('Không chấp hành hiệu lệnh của đèn tín hiệu'));
});

describe('văn bản dán từ trang chính thức', () => {
  const text = `Biển kiểm soát: 51K-123.45
Màu biển: Nền mầu trắng, chữ và số màu đen
Loại phương tiện: Ô tô
Thời gian vi phạm: 14:30, 28/09/2026
Địa điểm vi phạm: Km 15+200 cao tốc TP.HCM – Long Thành
Hành vi vi phạm: 12321.5.a.01.Điều khiển xe chạy quá tốc độ quy định
từ 05 km/h đến dưới 10 km/h
Trạng thái: Chưa xử phạt
Đơn vị phát hiện vi phạm: Đội CSGT cao tốc

Biển kiểm soát: 51K-123.45
Thời gian vi phạm: 08:05, 02/10/2026
Địa điểm vi phạm: Ngã tư Hàng Xanh
Hành vi vi phạm: Không chấp hành hiệu lệnh của đèn tín hiệu giao thông
Trạng thái: Đã xử phạt`;
  it('tách đúng 2 vi phạm, nối dòng xuống hàng', () => {
    const list = parseViolationText(text, '51K12345');
    expect(list).toHaveLength(2);
    expect(iso(list[0].violatedAt)).toBe('2026-09-28T14:30');
    expect(list[0].violation).toBe('Điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h');
    expect(list[1].status).toBe('paid');
    expect(list[1].location).toBe('Ngã tư Hàng Xanh');
  });
  it('dán dạng bảng (tab) cũng đọc được', () => {
    const list = parseViolationText('Thời gian vi phạm\t14:30, 28/09/2026\nHành vi vi phạm\tVượt đèn đỏ', '51K12345');
    expect(iso(list[0].violatedAt)).toBe('2026-09-28T14:30');
    expect(list[0].violation).toBe('Vượt đèn đỏ');
  });
  it('không có nhãn → vẫn bắt được ngày giờ', () => {
    const list = parseViolationText('Xe 51K-123.45 vi phạm lúc 21:10 ngày 01/10/2026 tại Quận 1', '51K12345');
    expect(iso(list[0].violatedAt)).toBe('2026-10-01T21:10');
  });
});
