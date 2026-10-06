// Tiện ích chữ: bỏ dấu tiếng Việt, biển số, số tiền, đọc số bằng chữ.

/** Bỏ dấu + chữ thường. Dùng để tìm kiếm "nguyen van a" ra "Nguyễn Văn A". */
export function unaccent(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Khóa so khớp biển số: "51K-123.45" → "51K12345". */
export function plateKey(plate: string): string {
  return unaccent(plate).toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Chuẩn hóa cách viết biển số ô tô: "51k12345" → "51K-123.45", "30a1234" → "30A-1234". */
export function formatPlate(plate: string): string {
  const key = plateKey(plate);
  const m = /^(\d{2}[A-Z]{1,2})(\d{4,5})$/.exec(key);
  if (!m) return plate.trim().toUpperCase();
  const [, series, num] = m;
  return num.length === 5 ? `${series}-${num.slice(0, 3)}.${num.slice(3)}` : `${series}-${num}`;
}

/** 1500000 → "1.500.000" */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const s = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return neg ? `-${s}` : s;
}

/** 1500000 → "1.500.000 đ" */
export function fmtVnd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return `${fmtNumber(n)} đ`;
}

/** "1.500.000" / "1500000đ" → 1500000. Trả null khi rỗng. */
export function parseMoney(s: string): number | null {
  const digits = s.replace(/[^\d-]/g, '');
  if (!digits || digits === '-') return null;
  return Number.parseInt(digits, 10);
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc một nhóm 3 chữ số. `full` = nhóm không đứng đầu → phải đọc cả "không trăm", "linh". */
function readTriple(n: number, full: boolean): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const w: string[] = [];
  if (full || h > 0) w.push(DIGITS[h], 'trăm');
  if (t === 0) {
    if (u > 0) {
      if (full || h > 0) w.push('linh');
      w.push(DIGITS[u]);
    }
  } else if (t === 1) {
    w.push('mười');
    if (u === 5) w.push('lăm');
    else if (u > 0) w.push(DIGITS[u]);
  } else {
    w.push(DIGITS[t], 'mươi');
    if (u === 1) w.push('mốt');
    else if (u === 5) w.push('lăm');
    else if (u > 0) w.push(DIGITS[u]);
  }
  return w;
}

/** 1500000 → "một triệu năm trăm nghìn". Chỉ phần nguyên, không dấu âm. */
export function numberToVietnameseWords(input: number): string {
  if (!Number.isFinite(input)) return '';
  let num = Math.round(Math.abs(input));
  if (num === 0) return 'không';
  const groups: number[] = [];
  while (num > 0) {
    groups.push(num % 1000);
    num = Math.floor(num / 1000);
  }
  const units = ['', 'nghìn', 'triệu'];
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g !== 0) {
      words.push(...readTriple(g, i !== groups.length - 1));
      if (units[i % 3]) words.push(units[i % 3]);
    }
    if (i > 0 && i % 3 === 0 && groups.slice(i, i + 3).some((x) => x !== 0)) {
      for (let k = 0; k < i / 3; k++) words.push('tỷ');
    }
  }
  return words.join(' ');
}

/** 1500000 → "Một triệu năm trăm nghìn đồng" */
export function vndInWords(amount: number): string {
  const s = `${amount < 0 ? 'âm ' : ''}${numberToVietnameseWords(amount)} đồng`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Viết hoa chữ cái đầu mỗi từ: "nguyễn văn a" → "Nguyễn Văn A". */
export function titleCase(s: string): string {
  return s
    .toLocaleLowerCase('vi')
    .replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toLocaleUpperCase('vi'));
}
