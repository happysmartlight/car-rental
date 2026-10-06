// Đọc chuỗi trong mã QR mặt trước CCCD gắn chip / thẻ Căn cước.
//
// Dạng thường gặp (7 trường, ngăn bằng "|"):
//   số CCCD | số CMND cũ | họ tên | ngày sinh ddmmyyyy | giới tính | nơi thường trú | ngày cấp ddmmyyyy
// Một số thẻ có thêm trường ở cuối. Parser không tin tuyệt đối vào vị trí:
// kiểm tra định dạng từng trường, sai thì trả null để người dùng nhập tay.

import { titleCase } from './text.js';

export type IdCardType = 'cccd_chip' | 'can_cuoc' | 'cccd' | 'cmnd' | 'passport' | 'other';

export interface CccdData {
  idNumber: string;
  oldIdNumber: string | null;
  fullName: string;
  dob: string | null; // YYYY-MM-DD
  gender: string | null;
  permanentAddress: string | null;
  idIssueDate: string | null; // YYYY-MM-DD
  idIssuePlace: string | null;
  idCardType: IdCardType;
}

/** "01011990" → "1990-01-01" */
function ddmmyyyy(s: string | undefined): string | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec((s ?? '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** Thẻ Căn cước mẫu mới cấp từ 01/07/2024 do Bộ Công an cấp. */
export const CAN_CUOC_FROM = '2024-07-01';

export function inferIssuePlace(issueDate: string | null): { place: string; type: IdCardType } {
  if (issueDate && issueDate >= CAN_CUOC_FROM) return { place: 'Bộ Công an', type: 'can_cuoc' };
  return { place: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội', type: 'cccd_chip' };
}

export function parseCccdQr(raw: string): CccdData | null {
  const parts = raw.trim().split('|').map((p) => p.trim());
  if (parts.length < 6) return null;
  const idNumber = parts[0];
  if (!/^\d{12}$/.test(idNumber)) return null;
  const fullName = parts[2];
  if (!fullName) return null;
  const dob = ddmmyyyy(parts[3]);
  const issueDate = ddmmyyyy(parts[6]);
  const g = (parts[4] ?? '').toLowerCase();
  const gender = g.startsWith('nam') ? 'Nam' : g.startsWith('n') ? 'Nữ' : parts[4] || null;
  const { place, type } = inferIssuePlace(issueDate);
  return {
    idNumber,
    oldIdNumber: /^\d{9}$/.test(parts[1]) ? parts[1] : null,
    fullName: titleCase(fullName),
    dob,
    gender,
    permanentAddress: parts[5] || null,
    idIssueDate: issueDate,
    idIssuePlace: place,
    idCardType: type,
  };
}

/** Tuổi tròn tại thời điểm `atKey` (YYYY-MM-DD). */
export function ageAt(dob: string, atKey: string): number {
  const [y, m, d] = dob.split('-').map(Number);
  const [ay, am, ad] = atKey.split('-').map(Number);
  let age = ay - y;
  if (am < m || (am === m && ad < d)) age--;
  return age;
}
