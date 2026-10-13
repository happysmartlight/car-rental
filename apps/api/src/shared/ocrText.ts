// Tiện ích đọc chữ OCR trên giấy tờ (GPLX, CCCD) — dùng chung cho các bộ tách trường.
//
// OCR hay: sai dấu ở nhãn, mất/dư dấu ":", chèn khoảng trắng giữa chữ số, lẫn O↔0, I/l↔1, chèn ký tự rác
// quanh giá trị, đưa giá trị xuống dòng dưới nhãn. Các hàm ở đây chịu được những lỗi đó và trả null khi không chắc.

import { titleCase, unaccent } from './text.js';

export interface OcrLines {
  /** Dòng gốc (NFC, đã trim, bỏ dòng trống). */
  raw: string[];
  /** Cùng dòng đó, bỏ dấu + chữ thường — để dò nhãn. */
  keys: string[];
}

export function ocrLines(text: string): OcrLines {
  const raw = text
    .normalize('NFC')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { raw, keys: raw.map(unaccent) };
}

export function dateKey(d: string, mo: string, y: string): string | null {
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +y < 1900 || +y > 2100) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Sửa chữ cái OCR hay đọc nhầm với chữ số (O/o/Q→0, I/l/|→1) — chỉ khi đứng sát chữ số hoặc dấu ngày,
 * và gộp khoảng trắng chen giữa các chữ số ("1 997" → "1997").
 */
function fixDigits(s: string): string {
  const near = (c: string | undefined) => !!c && /[\d/.-]/.test(c);
  return s
    .replace(/[OoQIl|]/g, (c, i: number) => (near(s[i - 1]) || near(s[i + 1]) ? (/[OoQ]/.test(c) ? '0' : '1') : c))
    .replace(/(\d)\s+(?=\d)/g, '$1');
}

/** Ngày dd/mm/yyyy đầu tiên trong chuỗi ("17.09.2025", "09/09/1 997", "O9/09/1997" đều được) → "YYYY-MM-DD". */
export function dateIn(s: string): string | null {
  const m = /(?:^|\D)(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})(?!\d)/.exec(fixDigits(s));
  return m ? dateKey(m[1], m[2], m[3]) : null;
}

/** Số giấy tờ 12 chữ số trong chuỗi (lẫn O→0, I/l→1, khoảng trắng giữa các chữ số). */
export function number12In(s: string): string | null {
  return /(?:^|\D)(\d{12})(?!\d)/.exec(fixDigits(s))?.[1] ?? null;
}

/** Chữ cái tiếng Việt (không có ä, ï, ÿ… mà OCR hay sinh ra từ hoa văn nền). */
export const VI_LETTERS = 'A-Za-zĐđÀ-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúýĂăĨĩŨũƠơƯưẠ-ỹ';
const VI_WORD = new RegExp(`^[${VI_LETTERS}]+$`);

/**
 * Họ tên in HOA trên giấy tờ: chỉ giữ các từ tiếng Việt viết hoa toàn bộ, có nguyên âm
 * (bỏ rác OCR như "ˆ", "~", "M7", "ồn", "L", "CC"), cần ít nhất 2 từ → "Nguyễn Văn A".
 */
export function upperNameIn(s: string): string | null {
  const words = s
    .normalize('NFC')
    .split(/[^\p{L}]+/u)
    .filter((w) => VI_WORD.test(w) && w === w.toLocaleUpperCase('vi') && /[aeiouy]/.test(unaccent(w)));
  return words.length >= 2 && words.join('').length >= 4 ? titleCase(words.join(' ')) : null;
}

const ADDRESS_WORD = new RegExp(`^[${VI_LETTERS}\\d.,/-]+$`);

/** Từ trong địa chỉ: chữ tiếng Việt / chữ số / ".,/-" (bỏ "ïP.", dãy ≥5 chữ số rác, chữ thường đứng lẻ). */
export function isAddressWord(w: string): boolean {
  return ADDRESS_WORD.test(w) && !/\d{5}/.test(w) && !/^\p{Ll}$/u.test(w);
}

/** Dòng trông như nhãn (có ":" hoặc dạng "Tiếng Việt/English") — không phải giá trị của nhãn phía trên. */
export function isLabelLine(line: string): boolean {
  return line.includes(':') || (line.includes('/') && /[a-z]{3}/i.test(line));
}

/**
 * Các chỗ có thể chứa giá trị của nhãn ở dòng `i`, theo thứ tự nên thử: phần sau dấu ":" cuối
 * (không có ":" thì cả dòng), rồi dòng kế tiếp nếu dòng đó không phải nhãn khác.
 */
export function valuesAt(lines: string[], i: number): string[] {
  const line = lines[i];
  const out = [line.includes(':') ? line.slice(line.lastIndexOf(':') + 1).trim() : line];
  const next = lines[i + 1]?.trim();
  if (next && !isLabelLine(next)) out.push(next);
  return out.filter(Boolean);
}

/** Giá trị đầu tiên đọc được (khác null) trong các chỗ `valuesAt`. */
export function firstValue<T>(lines: string[], i: number, read: (s: string) => T | null): T | null {
  for (const v of valuesAt(lines, i)) {
    const r = read(v);
    if (r != null) return r;
  }
  return null;
}
