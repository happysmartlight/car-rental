// Mã VietQR (chuẩn EMVCo của NAPAS) — chuỗi để vẽ QR chuyển khoản đúng số tiền,
// đúng nội dung. Mọi app ngân hàng VN đều quét được. Tự sinh offline, không gọi API.

import { unaccent } from './text.js';

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — bắt buộc ở trường 63. */
export function crc16(input: string): number {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Nội dung chuyển khoản: không dấu, chỉ chữ/số/khoảng trắng, tối đa 25 ký tự. */
export function sanitizeTransferNote(s: string): string {
  return unaccent(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25);
}

export interface VietQrInput {
  bin: string; // mã BIN ngân hàng, vd 970436
  accountNumber: string;
  amount?: number | null;
  note?: string | null;
}

export function buildVietQrPayload({ bin, accountNumber, amount, note }: VietQrInput): string {
  const consumer = tlv('00', bin.trim()) + tlv('01', accountNumber.replace(/\s/g, ''));
  const merchant = tlv('00', 'A000000727') + tlv('01', consumer) + tlv('02', 'QRIBFTTA');
  const hasAmount = amount != null && amount > 0;
  let s = tlv('00', '01') + tlv('01', hasAmount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (hasAmount) s += tlv('54', String(Math.round(amount)));
  s += tlv('58', 'VN');
  const cleanNote = note ? sanitizeTransferNote(note) : '';
  if (cleanNote) s += tlv('62', tlv('08', cleanNote));
  s += '6304';
  return s + crc16(s).toString(16).toUpperCase().padStart(4, '0');
}

/** Ngân hàng phổ biến. Thiếu ngân hàng nào thì nhập mã BIN tay trong Cài đặt. */
export const BANKS: { bin: string; code: string; name: string }[] = [
  { bin: '970436', code: 'VCB', name: 'Vietcombank' },
  { bin: '970415', code: 'ICB', name: 'VietinBank' },
  { bin: '970418', code: 'BIDV', name: 'BIDV' },
  { bin: '970405', code: 'VBA', name: 'Agribank' },
  { bin: '970407', code: 'TCB', name: 'Techcombank' },
  { bin: '970422', code: 'MB', name: 'MB Bank' },
  { bin: '970416', code: 'ACB', name: 'ACB' },
  { bin: '970432', code: 'VPB', name: 'VPBank' },
  { bin: '970423', code: 'TPB', name: 'TPBank' },
  { bin: '970403', code: 'STB', name: 'Sacombank' },
  { bin: '970437', code: 'HDB', name: 'HDBank' },
  { bin: '970441', code: 'VIB', name: 'VIB' },
  { bin: '970443', code: 'SHB', name: 'SHB' },
  { bin: '970440', code: 'SEAB', name: 'SeABank' },
  { bin: '970448', code: 'OCB', name: 'OCB' },
  { bin: '970426', code: 'MSB', name: 'MSB' },
  { bin: '970431', code: 'EIB', name: 'Eximbank' },
  { bin: '970449', code: 'LPB', name: 'LPBank' },
  { bin: '970428', code: 'NAB', name: 'Nam A Bank' },
  { bin: '970409', code: 'BAB', name: 'Bac A Bank' },
  { bin: '970425', code: 'ABB', name: 'ABBank' },
  { bin: '970412', code: 'PVCB', name: 'PVcomBank' },
  { bin: '970454', code: 'VCCB', name: 'BVBank (Bản Việt)' },
  { bin: '970452', code: 'KLB', name: 'KienlongBank' },
  { bin: '970419', code: 'NCB', name: 'NCB' },
  { bin: '970427', code: 'VAB', name: 'VietABank' },
  { bin: '970438', code: 'BVB', name: 'BaoViet Bank' },
  { bin: '970429', code: 'SCB', name: 'SCB' },
  { bin: '970400', code: 'SGICB', name: 'Saigonbank' },
  { bin: '970430', code: 'PGB', name: 'PGBank' },
  { bin: '970424', code: 'SHBVN', name: 'Shinhan Bank' },
  { bin: '970457', code: 'WVN', name: 'Woori Bank' },
  { bin: '546034', code: 'CAKE', name: 'Cake by VPBank' },
  { bin: '546035', code: 'UBANK', name: 'Ubank by VPBank' },
];
