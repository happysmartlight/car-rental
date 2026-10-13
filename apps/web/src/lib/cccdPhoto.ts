// Đọc ảnh căn cước ngay trên máy (WebAssembly), ảnh không gửi đi đâu:
// mã QR → thông tin; mặt trước CCCD gắn chip → cắt luôn ảnh chân dung theo vị trí QR.

import { prepareZXingModule, readBarcodes, type ReadResult } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { cccdOcrFieldCount, parseCccdQr, type CccdData, type CccdOcrData } from '@shared/cccd';
import { applyQrFilter, portraitCrop, QR_PASSES, qrScale, type Pt, type Quad } from './qrImage';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

const OPTS = { formats: ['QRCode' as const], tryHarder: true, maxNumberOfSymbols: 1 };

/** Vẽ vùng (sx, sy, sw, sh) của ảnh nguồn lên canvas, phóng `scale` lần (có trần), trả về điểm ảnh. */
export function grab(canvas: HTMLCanvasElement, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, scale: number): ImageData {
  const s = qrScale(scale, sw, sh);
  canvas.width = Math.round(sw * s);
  canvas.height = Math.round(sh * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Đọc mã QR trong một khung ảnh đã xử lý; null nếu không thấy. */
export async function readQr(img: ImageData): Promise<ReadResult | null> {
  const [res] = await readBarcodes(img, OPTS);
  return res?.text ? res : null;
}

export interface CccdPhoto {
  text: string;
  /** null nếu QR không phải QR căn cước. */
  data: CccdData | null;
  /** Ảnh chân dung cắt từ thẻ (JPEG), null nếu không cắt được. */
  portrait: Blob | null;
}

/** Đọc ảnh chụp thẻ: thử lần lượt các cách xử lý ảnh tới khi ra mã QR. null nếu không thấy mã. */
export async function readCccdPhoto(file: Blob): Promise<CccdPhoto | null> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  try {
    const hit = await findQr(bmp, canvas);
    if (!hit) return null;
    const data = parseCccdQr(hit.text);
    // Thẻ Căn cước mẫu 2024 in QR ở mặt sau — mặt đó không có ảnh chân dung.
    const portrait = data?.idCardType === 'cccd_chip' ? await cutPortrait(bmp, hit.quad, canvas) : null;
    return { text: hit.text, data, portrait };
  } finally {
    bmp.close();
  }
}

export type CccdRead = { source: 'qr'; text: string; data: CccdData; portrait: Blob | null } | { source: 'ocr'; data: CccdOcrData };

/**
 * Đọc ảnh thẻ: QR trước (đúng tuyệt đối); không ra QR căn cước thì đọc chữ trên thẻ (OCR — nạp Tesseract
 * khi cần, chậm hơn, có thể sai). `ocr: false` = chỉ thử QR. null nếu không đọc được gì đáng tin.
 */
export async function readCccdImage(file: Blob, opts: { ocr: boolean; onOcrStart?: () => void }): Promise<CccdRead | null> {
  const qr = await readCccdPhoto(file);
  if (qr?.data) return { source: 'qr', text: qr.text, data: qr.data, portrait: qr.portrait };
  if (!opts.ocr) return null;
  opts.onOcrStart?.();
  const { readCccdOcr } = await import('./cccdOcr');
  const data = await readCccdOcr(file);
  // Ít hơn 2 trường thường là ảnh không phải thẻ (đọc nhầm vài chữ) — coi như không đọc được.
  return data && cccdOcrFieldCount(data) >= 2 ? { source: 'ocr', data } : null;
}

async function findQr(bmp: ImageBitmap, canvas: HTMLCanvasElement): Promise<{ text: string; quad: Quad } | null> {
  const tried = new Set<string>();
  for (const { scale, filter } of QR_PASSES) {
    const key = `${qrScale(scale, bmp.width, bmp.height)}:${filter}`;
    if (tried.has(key)) continue; // ảnh lớn: ×1 và ×2 cùng chạm trần
    tried.add(key);
    const img = grab(canvas, bmp, 0, 0, bmp.width, bmp.height, scale);
    applyQrFilter(img, filter);
    const res = await readQr(img);
    if (res) {
      // Góc QR đang theo canvas đã phóng/thu — đổi về toạ độ ảnh gốc.
      const kx = img.width / bmp.width;
      const ky = img.height / bmp.height;
      const back = (p: Pt) => ({ x: p.x / kx, y: p.y / ky });
      const p = res.position;
      return { text: res.text, quad: { topLeft: back(p.topLeft), topRight: back(p.topRight), bottomRight: back(p.bottomRight), bottomLeft: back(p.bottomLeft) } };
    }
    await new Promise((r) => setTimeout(r)); // nhường luồng cho giao diện
  }
  return null;
}

function cutPortrait(bmp: ImageBitmap, quad: Quad, canvas: HTMLCanvasElement): Promise<Blob | null> {
  const crop = portraitCrop(quad, bmp.width, bmp.height);
  if (!crop) return Promise.resolve(null);
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...crop.matrix);
  ctx.drawImage(bmp, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
}
