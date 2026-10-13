// Đọc chuỗi trong mã QR mặt trước CCCD gắn chip / thẻ Căn cước.
//
// Dạng thường gặp (7 trường, ngăn bằng "|"):
//   số CCCD | số CMND cũ | họ tên | ngày sinh ddmmyyyy | giới tính | nơi thường trú | ngày cấp ddmmyyyy
// Một số thẻ có thêm trường ở cuối. Parser không tin tuyệt đối vào vị trí:
// kiểm tra định dạng từng trường, sai thì trả null để người dùng nhập tay.

import { dateIn, firstValue, isAddressWord, isLabelLine, number12In, ocrLines, upperNameIn } from './ocrText.js';
import { titleCase, unaccent } from './text.js';

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

/**
 * Thông tin đọc bằng OCR mặt trước thẻ — dùng khi QR không đọc được. Không có ngày cấp (in ở mặt sau);
 * thẻ Căn cước mẫu 2024 còn không có nơi thường trú ở mặt trước.
 */
export interface CccdOcrData {
  idNumber: string | null;
  fullName: string | null;
  dob: string | null; // YYYY-MM-DD
  gender: 'Nam' | 'Nữ' | null;
  permanentAddress: string | null;
  /** Chỉ nhận ra thẻ Căn cước mẫu 2024 (nhãn "Số định danh cá nhân"); còn lại null. */
  idCardType: IdCardType | null;
}

/** Phần giá trị trên chính dòng nhãn địa chỉ: sau ":" — hoặc sau từ nhãn cuối khi OCR làm rơi ":". */
function addressAfterLabel(line: string): string {
  if (line.includes(':')) return line.slice(line.lastIndexOf(':') + 1);
  const toks = line.replace(/-(?=\p{Lu})/gu, ' ').split(/\s+/);
  let last = -1;
  toks.forEach((t, i) => {
    if (/resi|thuong|tru$|place|^of$|^cu$/.test(unaccent(t))) last = i;
  });
  const rest = toks.slice(last + 1).join(' ');
  // Rác OCR thay cho nhãn bị mờ ("vờ NG !") — giữ khi giống địa chỉ: có số, có dấu phẩy hoặc ≥2 từ viết hoa.
  const caps = rest.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w)).length;
  return /\d|,/.test(rest) || caps >= 2 ? rest : '';
}

/** Dọn một dòng địa chỉ: bỏ rác OCR (ký tự lạ, dấu câu dính), gộp chữ số bị tách ("1 5/73" → "15/73"). */
function cleanAddressLine(s: string): string {
  const toks = s
    .replace(/(\d)\s+(?=\d)/g, '$1')
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\d]+|[^\p{L}\d.,]+$/gu, ''))
    .filter((t) => t && isAddressWord(t));
  const start = toks.findIndex((t) => /^[\p{Lu}\d]/u.test(t));
  if (start < 0) return '';
  let end = toks.length;
  while (end > start && !/[\p{L}\d]{2}|\d/u.test(toks[end - 1])) end--;
  return toks
    .slice(start, end)
    .join(' ')
    .replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
}

export function parseCccdText(text: string): CccdOcrData {
  const { raw: lines, keys } = ocrLines(text);
  const out: CccdOcrData = { idNumber: null, fullName: null, dob: null, gender: null, permanentAddress: null, idCardType: null };

  keys.forEach((k, i) => {
    if (!out.idNumber && /(^|[^a-z])(so|no)\s*[/:.]|dinh\s*danh|identification/.test(k)) out.idNumber = firstValue(lines, i, number12In);
    if (!out.fullName && /ho\s*(va\s*)?ten|full\s*name|khai\s*sinh|given\s*name/.test(k)) out.fullName = firstValue(lines, i, upperNameIn);
    if (!out.dob && /ngay.{0,20}sinh|birth|date\s*of\s*bi/.test(k)) out.dob = firstValue(lines, i, dateIn);
    if (!out.gender) {
      const g = /(gioi\s*tinh|sex+)\W{0,4}(nam|nu)\b/.exec(k);
      if (g) out.gender = g[2] === 'nam' ? 'Nam' : 'Nữ';
    }
    if (!out.permanentAddress && /thuong\s*tru|residen|noi\s*cu\s*tru/.test(k)) {
      // Địa chỉ in đúng 2 dòng: phần sau nhãn + dòng dưới, hoặc (nhãn bị mờ) 2 dòng dưới nhãn.
      const parts = [cleanAddressLine(addressAfterLabel(lines[i]))].filter(Boolean);
      for (let j = i + 1; parts.length < 2 && j <= i + 2 && j < lines.length && !isLabelLine(lines[j]); j++) {
        const part = cleanAddressLine(lines[j]);
        if (part) parts.push(part);
      }
      const addr = parts.join(', ').replace(/,\s*,/g, ',');
      if (addr.length >= 5 && /\p{L}/u.test(addr)) out.permanentAddress = addr;
    }
    if (/dinh\s*danh\s*ca\s*nhan|personal\s*ident/.test(k)) out.idCardType = 'can_cuoc';
  });
  out.idNumber ??= number12In(text);
  return out;
}

const wordCount = (s: string | null) => s?.split(' ').length ?? 0;

/** Gộp hai lần đọc: giữ trường của `a`, chỗ trống lấy từ `b`. */
export function mergeCccdOcr(a: CccdOcrData, b: CccdOcrData): CccdOcrData {
  return {
    idNumber: a.idNumber ?? b.idNumber,
    // OCR hay dính hai chữ của tên ("LÊMINH KHOA") — bản nào tách được nhiều chữ hơn thì đúng hơn.
    fullName: wordCount(b.fullName) > wordCount(a.fullName) ? b.fullName : a.fullName,
    dob: a.dob ?? b.dob,
    gender: a.gender ?? b.gender,
    permanentAddress: a.permanentAddress ?? b.permanentAddress,
    idCardType: a.idCardType ?? b.idCardType,
  };
}

/** Số trường đọc được (tối đa 5 — thẻ Căn cước 2024 chỉ có 4 vì không in địa chỉ ở mặt trước). */
export function cccdOcrFieldCount(d: CccdOcrData): number {
  return [d.idNumber, d.fullName, d.dob, d.gender, d.permanentAddress].filter(Boolean).length;
}

/** Tuổi tròn tại thời điểm `atKey` (YYYY-MM-DD). */
export function ageAt(dob: string, atKey: string): number {
  const [y, m, d] = dob.split('-').map(Number);
  const [ay, am, ad] = atKey.split('-').map(Number);
  let age = ay - y;
  if (am < m || (am === m && ad < d)) age--;
  return age;
}
