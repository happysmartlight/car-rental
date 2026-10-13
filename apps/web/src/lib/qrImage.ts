// Tiền xử lý ảnh trước khi đưa cho zxing đọc QR căn cước.
//
// QR in trên thẻ hay bị loang mực (ô đen "phình" ra) hoặc mờ vì ảnh đã nén qua Zalo/Messenger.
// Bộ phân ngưỡng mặc định của zxing lấy ngưỡng ở giữa sáng/tối nên ô định vị lệch tỉ lệ 1:1:3:1:1
// và không tìm ra mã. Thử thêm vài cách phân ngưỡng lệch + phóng to ×2 thì đọc được phần lớn ảnh
// kiểu này (đo trên ảnh thật: từ 17/144 lên 132/144 biến thể tỉ lệ/xoay/nén).

export type QrFilter = 'none' | 'local' | 'otsu';

/**
 * Các lượt thử, rẻ trước đắt sau. Ảnh chọn từ máy: chạy lần lượt tới khi đọc được.
 * Camera: mỗi khung hình một lượt, xoay vòng.
 */
export const QR_PASSES: readonly { scale: number; filter: QrFilter }[] = [
  { scale: 1, filter: 'none' },
  { scale: 1, filter: 'local' },
  { scale: 2, filter: 'none' },
  { scale: 1, filter: 'otsu' },
  { scale: 2, filter: 'local' },
  { scale: 2, filter: 'otsu' },
];

/** Trần số điểm ảnh mỗi lượt — canvas iOS giới hạn ~16,7 triệu, chừa bộ nhớ cho WASM. */
export const QR_MAX_PIXELS = 10_000_000;

/** Tỉ lệ phóng thực tế cho vùng `w×h` sau khi áp trần điểm ảnh (ảnh lớn có thể bị thu nhỏ). */
export function qrScale(scale: number, w: number, h: number): number {
  return Math.min(scale, Math.sqrt(QR_MAX_PIXELS / (w * h)));
}

export interface Pt {
  x: number;
  y: number;
}

/** 4 góc mã QR theo chiều của chính mã (zxing trả về). */
export interface Quad {
  topLeft: Pt;
  topRight: Pt;
  bottomRight: Pt;
  bottomLeft: Pt;
}

/**
 * Khung ảnh chân dung trên mặt trước CCCD gắn chip (mẫu 2021), tính theo mã QR:
 * gốc = góc trên-trái QR, 1 đơn vị = 1 cạnh QR (QR in cỡ cố định dù phiên bản mã khác nhau).
 * Đo trên ảnh thẻ thật, thu vào ~0,05 cạnh để không lẹm hoa văn viền.
 */
const PORTRAIT = { left: -6.12, right: -4.22, top: 1.36, bottom: 3.86 };

/**
 * Cách cắt ảnh chân dung từ ảnh chụp thẻ, dựa vào vị trí mã QR — tự xoay thẳng nếu ảnh chụp
 * nghiêng/ngược. Trả về kích thước ảnh ra + ma trận canvas (ảnh gốc → ảnh ra) cho `setTransform`;
 * null nếu khung rơi ra ngoài ảnh (ảnh chỉ chụp góc QR, hoặc không phải mặt trước).
 */
export function portraitCrop(q: Quad, imgW: number, imgH: number, maxW = 600): { width: number; height: number; matrix: [number, number, number, number, number, number] } | null {
  // Trục ngang/dọc của QR — lấy trung bình hai cạnh đối cho đỡ sai số.
  const ux = (q.topRight.x - q.topLeft.x + q.bottomRight.x - q.bottomLeft.x) / 2;
  const uy = (q.topRight.y - q.topLeft.y + q.bottomRight.y - q.bottomLeft.y) / 2;
  const vx = (q.bottomLeft.x - q.topLeft.x + q.bottomRight.x - q.topRight.x) / 2;
  const vy = (q.bottomLeft.y - q.topLeft.y + q.bottomRight.y - q.topRight.y) / 2;
  const ox = (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4 - (ux + vx) / 2;
  const oy = (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4 - (uy + vy) / 2;
  const at = (s: number, t: number) => ({ x: ox + s * ux + t * vx, y: oy + s * uy + t * vy });

  const tol = 0.02 * Math.max(imgW, imgH);
  for (const s of [PORTRAIT.left, PORTRAIT.right])
    for (const t of [PORTRAIT.top, PORTRAIT.bottom]) {
      const p = at(s, t);
      if (p.x < -tol || p.y < -tol || p.x > imgW + tol || p.y > imgH + tol) return null;
    }

  const sw = PORTRAIT.right - PORTRAIT.left;
  const th = PORTRAIT.bottom - PORTRAIT.top;
  const srcW = sw * Math.hypot(ux, uy);
  const srcH = th * Math.hypot(vx, vy);
  const k = Math.min(1, maxW / srcW);
  const width = Math.round(srcW * k);
  const height = Math.round(srcH * k);

  // Điểm (X, Y) của ảnh ra ứng với điểm nào trên ảnh gốc: x = a·X + c·Y + e, y = b·X + d·Y + f.
  const a = (ux * sw) / width;
  const b = (uy * sw) / width;
  const c = (vx * th) / height;
  const d = (vy * th) / height;
  const o = at(PORTRAIT.left, PORTRAIT.top);
  // Canvas cần chiều ngược lại (ảnh gốc → ảnh ra).
  const det = a * d - b * c;
  return {
    width,
    height,
    matrix: [d / det, -b / det, -c / det, a / det, (c * o.y - d * o.x) / det, (b * o.x - a * o.y) / det],
  };
}

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Đổi ảnh RGBA thành đen trắng (tại chỗ) theo bộ lọc. `none` giữ nguyên. */
export function applyQrFilter(img: Pixels, filter: QrFilter): void {
  if (filter === 'none') return;
  const { data, width: w, height: h } = img;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  if (filter === 'otsu') {
    // Ngưỡng toàn ảnh hơi thấp hơn Otsu — hợp với ảnh nét, ô đen mảnh.
    const t = otsu(gray) * 0.85;
    for (let j = 0; j < gray.length; j++) put(data, j, gray[j] < t);
  } else {
    localThreshold(gray, w, h, data);
  }
}

function put(data: Uint8ClampedArray, j: number, dark: boolean) {
  const v = dark ? 0 : 255;
  const i = j * 4;
  data[i] = data[i + 1] = data[i + 2] = v;
  data[i + 3] = 255;
}

function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    const wF = gray.length - wB;
    if (!wB) continue;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

const BLOCK = 8;

/**
 * Ngưỡng = 0,6 × độ sáng trung bình quanh điểm (cửa sổ ≈ 1/8 cạnh ngắn) — chỉ giữ phần tối hẳn,
 * làm "gầy" ô đen bị loang mực. Tính theo khối 8×8 cho nhẹ bộ nhớ (như HybridBinarizer của zxing).
 */
function localThreshold(gray: Uint8Array, w: number, h: number, data: Uint8ClampedArray) {
  const gw = Math.ceil(w / BLOCK);
  const gh = Math.ceil(h / BLOCK);
  const mean = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / BLOCK) | 0) * gw;
    for (let x = 0; x < w; x++) mean[row + ((x / BLOCK) | 0)] += gray[y * w + x];
  }
  for (let by = 0; by < gh; by++)
    for (let bx = 0; bx < gw; bx++) mean[by * gw + bx] /= Math.min(BLOCK, w - bx * BLOCK) * Math.min(BLOCK, h - by * BLOCK);

  // Tổng tích lũy trên lưới khối để lấy trung bình cửa sổ trong O(1).
  const W = gw + 1;
  const integral = new Float64Array(W * (gh + 1));
  for (let by = 0; by < gh; by++) {
    let row = 0;
    for (let bx = 0; bx < gw; bx++) {
      row += mean[by * gw + bx];
      integral[(by + 1) * W + bx + 1] = integral[by * W + bx + 1] + row;
    }
  }

  const r = Math.max(1, Math.round(Math.min(w, h) / 16 / BLOCK));
  for (let by = 0; by < gh; by++) {
    const y0 = Math.max(0, by - r);
    const y1 = Math.min(gh, by + r + 1);
    for (let bx = 0; bx < gw; bx++) {
      const x0 = Math.max(0, bx - r);
      const x1 = Math.min(gw, bx + r + 1);
      const s = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const t = (s / ((x1 - x0) * (y1 - y0))) * 0.6;
      const yEnd = Math.min(h, (by + 1) * BLOCK);
      const xEnd = Math.min(w, (bx + 1) * BLOCK);
      for (let y = by * BLOCK; y < yEnd; y++)
        for (let x = bx * BLOCK; x < xEnd; x++) put(data, y * w + x, gray[y * w + x] < t);
    }
  }
}
