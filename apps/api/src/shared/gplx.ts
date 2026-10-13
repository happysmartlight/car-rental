// Tách thông tin từ chữ OCR mặt trước GPLX thẻ PET — cả mẫu Bộ GTVT (2013–2025) lẫn mẫu Cục CSGT (từ 3/2025).
//
// Mẫu Cục CSGT:  Số/No · Họ tên/Full name · Ngày sinh · Ngày cấp/Date of issue · Ngày hết hạn/Expiration date · Hạng/Class
// Mẫu Bộ GTVT:   Số/No · Họ tên/Full name · Ngày sinh · "…, ngày/date 15 tháng/month 06 năm/year 2019" · Hạng/Class
//                · Có giá trị đến/Expires (hoặc "Không thời hạn")
//
// OCR hay sai dấu ở nhãn, dính dấu câu, tách nhãn và giá trị ra hai dòng — nên tìm nhãn trên chữ đã bỏ dấu
// (cả tiếng Việt lẫn tiếng Anh), kiểm tra định dạng từng trường; không chắc thì để null cho người dùng nhập tay.

import { LICENSE_CLASSES } from './constants.js';
import { dateIn, dateKey, firstValue, number12In, ocrLines, upperNameIn, valuesAt } from './ocrText.js';
import { unaccent } from './text.js';

export interface GplxData {
  licenseNumber: string | null;
  fullName: string | null;
  dob: string | null; // YYYY-MM-DD
  issueDate: string | null;
  expiry: string | null;
  /** Thẻ ghi "Không thời hạn". */
  noExpiry: boolean;
  licenseClass: string | null;
}

// Dài trước ngắn để "C1E" không bị bắt thành "C1".
const CLASSES = [...LICENSE_CLASSES].sort((a, b) => b.length - a.length);

function classIn(s: string): string | null {
  for (const raw of s.toUpperCase().split(/[\s,;/]+/)) {
    // OCR hay đọc "B" thành "8", "2" thành "Z".
    const tok = raw.replace(/[^0-9A-Z]/g, '').replace(/^8/, 'B').replace(/^([BD])Z$/, '$12');
    const hit = CLASSES.find((c) => c === tok);
    if (hit) return hit;
  }
  return null;
}

const NO_EXPIRY = /khong\s*thoi\s*han|unlimited/;

export function parseGplxText(text: string): GplxData {
  const { raw: lines, keys } = ocrLines(text);
  const out: GplxData = { licenseNumber: null, fullName: null, dob: null, issueDate: null, expiry: null, noExpiry: false, licenseClass: null };

  keys.forEach((k, i) => {
    if (!out.licenseNumber && /(^|[^a-z])(so|no)\s*[/:.]/.test(k)) out.licenseNumber = firstValue(lines, i, number12In);
    if (!out.fullName && /full\s*name|ho\s*ten/.test(k)) out.fullName = firstValue(lines, i, upperNameIn);
    if (!out.dob && /birth|ngay\s*sinh/.test(k)) out.dob = firstValue(lines, i, dateIn);
    if (!out.issueDate && /date\s*of\s*issue|ngay\s*cap/.test(k)) out.issueDate = firstValue(lines, i, dateIn);
    if (!out.expiry && /expir|het\s*han|gia\s*tri\s*den/.test(k)) {
      if (NO_EXPIRY.test(k) || valuesAt(lines, i).some((v) => NO_EXPIRY.test(unaccent(v)))) out.noExpiry = true;
      else out.expiry = firstValue(lines, i, dateIn);
    }
    if (!out.licenseClass && /class|hang\s*[/:]/.test(k)) out.licenseClass = firstValue(lines, i, classIn);
  });

  // Mẫu Bộ GTVT: ngày cấp viết "ngày/date 15 tháng/month 06 năm/year 2019".
  if (!out.issueDate) {
    const all = keys.join(' ');
    const m =
      /date\D{0,4}(\d{1,2})\D{1,16}month\D{0,4}(\d{1,2})\D{1,16}year\D{0,4}(\d{4})/.exec(all) ??
      /ngay\D{0,6}(\d{1,2})\D{1,10}thang\D{0,8}(\d{1,2})\D{1,10}nam\D{0,7}(\d{4})/.exec(all);
    if (m) out.issueDate = dateKey(m[1], m[2], m[3]);
  }
  out.licenseNumber ??= number12In(text);
  // Hết hạn phải sau ngày cấp — ngược lại là OCR đọc sai một trong hai.
  if (out.issueDate && out.expiry && out.expiry <= out.issueDate) out.expiry = null;
  return out;
}

/** Gộp hai lần đọc: giữ trường của `a`, chỗ trống lấy từ `b`. */
export function mergeGplx(a: GplxData, b: GplxData): GplxData {
  const out: GplxData = {
    licenseNumber: a.licenseNumber ?? b.licenseNumber,
    fullName: a.fullName ?? b.fullName,
    dob: a.dob ?? b.dob,
    issueDate: a.issueDate ?? b.issueDate,
    expiry: a.expiry ?? (a.noExpiry ? null : b.expiry),
    noExpiry: a.noExpiry || (!a.expiry && b.noExpiry),
    licenseClass: a.licenseClass ?? b.licenseClass,
  };
  if (out.issueDate && out.expiry && out.expiry <= out.issueDate) out.expiry = null;
  return out;
}

/** Số trường đọc được — để biết OCR có ra gì không (ảnh ngược thì gần như bằng 0). */
export function gplxFieldCount(d: GplxData): number {
  return [d.licenseNumber, d.fullName, d.issueDate, d.expiry || d.noExpiry || null, d.licenseClass].filter(Boolean).length;
}
