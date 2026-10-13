// Đọc chữ trên ảnh giấy tờ (GPLX, CCCD) ngay trên máy bằng Tesseract (WebAssembly) — ảnh không gửi đi đâu.
// Lõi OCR (~4MB) + dữ liệu tiếng Việt (~1,4MB) là file trong /assets: chỉ tải lần đầu dùng, sau đó
// service worker giữ lại. Chỉ nạp module này bằng import() để không làm nặng trang lúc mở.

import { createWorker, OEM, PSM, type Page, type RecognizeOptions, type Worker } from 'tesseract.js';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
import coreLstmUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import coreSimdLstmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import vieUrl from '@tesseract.js-data/vie/4.0.0_best_int/vie.traineddata.gz?url';
import { textSkewDeg } from './textSkew';

export type { Page } from 'tesseract.js';

/** Cách đọc một loại thẻ. */
export interface CardOcr<T> {
  /**
   * Kênh màu đưa vào OCR — chọn kênh mà nền thẻ sáng nhất để chữ đen nổi rõ:
   * GPLX nền hồng/cam → kênh đỏ; CCCD nền xanh ngọc (kênh đỏ tối) → ảnh xám.
   */
  channel: 'red' | 'gray';
  /** Tách trường từ kết quả một lượt OCR (có vị trí từng chữ trong `page.blocks`). */
  parse(page: Page): T;
  merge(a: T, b: T): T;
  count(d: T): number;
  /** Đọc đủ bao nhiêu trường thì thôi thử thêm. */
  full: number;
  /** Ghi số 12 chữ số đọc lại riêng (số GPLX / số CCCD) vào kết quả. */
  withNumber(d: T, n: string): T;
}

// Cùng phép thử SIMD như thư viện wasm-feature-detect (Tesseract dùng) — iOS 16.4+ đều có.
const SIMD = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));

// tesseract.js chuyển thẳng tham số lạ cho Tesseract, chỉ trong lần gọi đó (kiểu TS của thư viện chưa khai).
const tess = (params: Record<string, string>) => params as unknown as Partial<RecognizeOptions>;
const DIGITS_ONLY = tess({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_LINE });
/**
 * Các lượt đọc, thử lần lượt tới khi đủ trường; gộp kết quả (mỗi cách hay trượt trường khác nhau).
 * Lượt 1 phân ngưỡng cục bộ (Sauvola): ngưỡng chung mặc định hỏng khi ảnh có viền trắng sau khi xoay
 * thẳng hoặc nền bàn tối — nền thẻ CCCD (xám ~190) bị coi là chữ. Lượt 2 ngưỡng mặc định bù vài trường
 * Sauvola sót. Cả hai tự chia vùng chữ (thẻ có ảnh chân dung bên trái). Đo trên ảnh thật: 73/75 trường.
 */
const LAYOUTS = [
  tess({ tessedit_pageseg_mode: PSM.AUTO, thresholding_method: '2' }),
  tess({ tessedit_pageseg_mode: PSM.AUTO }),
];

/** Cạnh dài ảnh đưa vào OCR — thẻ chiếm cả ảnh thì chữ cao ~30px, vừa tầm Tesseract. */
const OCR_SIDE = 2000;
/** Worker giữ ~100MB bộ nhớ — rảnh một lúc thì tắt, lần sau nạp lại (file đã nằm trong bộ đệm). */
const IDLE_MS = 2 * 60_000;

let worker: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function getWorker(): Promise<Worker> {
  if (idleTimer) clearTimeout(idleTimer);
  worker ??= createWorker('vie', OEM.LSTM_ONLY, {
    workerPath: new URL(workerUrl, location.href).href,
    corePath: new URL(SIMD ? coreSimdLstmUrl : coreLstmUrl, location.href).href,
    // Tesseract tự tải "<langPath>/vie.traineddata.gz" (xem build.rolldownOptions trong vite.config.ts).
    langPath: new URL('.', new URL(vieUrl, location.href)).href,
    workerBlobURL: false,
    // Không cần IndexedDB: file trong /assets đã được service worker + HTTP cache giữ.
    cacheMethod: 'none',
  }).catch((err) => {
    worker = null;
    throw err;
  });
  return worker;
}

function releaseLater() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const w = worker;
    worker = null;
    void w?.then((x) => x.terminate()).catch(() => undefined);
  }, IDLE_MS);
}

/** Vẽ ảnh xoay `deg` độ, cạnh dài = `side` px (nền trắng), đổi sang ảnh xám theo `channel`. */
function render(bmp: ImageBitmap, deg: number, side: number, channel: CardOcr<unknown>['channel']): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = bmp.width * cos + bmp.height * sin;
  const bh = bmp.width * sin + bmp.height * cos;
  const k = Math.min(side / Math.max(bw, bh), 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bw * k);
  canvas.height = Math.round(bh * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.scale(k, k);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = channel === 'red' ? d[i] : (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function grayOf(canvas: HTMLCanvasElement): Uint8Array {
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
  const g = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = d[i];
  return g;
}

/**
 * Đọc lại riêng số giấy tờ (12 chữ số): cắt đúng cụm chữ số, phóng cao 100px, chỉ cho phép chữ số.
 * Lần đọc chung hay lẫn 5↔6 ở ảnh nhỏ/nén mạnh; đọc riêng thì đúng (đo trên ảnh thật).
 */
async function rereadNumber(w: Worker, page: Page, canvas: HTMLCanvasElement): Promise<string | null> {
  const words = page.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) ?? [];
  const digits = words.map((x) => x.symbols.filter((s) => /\d/.test(s.text))).find((s) => s.length >= 9);
  if (!digits) return null;
  // Dòng số còn nghiêng chút ít (xoay cả ảnh không tuyệt đối) — khớp đường thẳng qua tâm các chữ số rồi xoay thẳng riêng dòng này.
  const cx = digits.map((s) => (s.bbox.x0 + s.bbox.x1) / 2);
  const cy = digits.map((s) => (s.bbox.y0 + s.bbox.y1) / 2);
  const mx = cx.reduce((a, b) => a + b) / cx.length;
  const my = cy.reduce((a, b) => a + b) / cy.length;
  let sxy = 0;
  let sxx = 0;
  cx.forEach((x, i) => {
    sxy += (x - mx) * (cy[i] - my);
    sxx += (x - mx) ** 2;
  });
  const angle = sxx ? Math.atan(sxy / sxx) : 0;
  const charH = digits.map((s) => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b)[digits.length >> 1];
  const lineW = Math.hypot(cx[cx.length - 1] - cx[0], cy[cy.length - 1] - cy[0]) + charH;
  const k = 100 / (charH * 1.8);
  const crop = document.createElement('canvas');
  crop.height = 100;
  crop.width = Math.round((lineW + charH) * k);
  const ctx = crop.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(crop.width / 2, crop.height / 2);
  ctx.scale(k, k);
  ctx.rotate(-angle);
  ctx.drawImage(canvas, -mx, -my);
  const { data } = await w.recognize(crop, DIGITS_ONLY);
  const d = data.text.replace(/\D/g, '');
  return d.length === 12 ? d : null;
}

/**
 * Đọc ảnh một mặt thẻ → các trường đọc được (trường không chắc để null).
 * null nếu không đọc ra trường nào (ảnh mờ, không phải loại thẻ này…).
 */
export async function readCard<T>(file: Blob, card: CardOcr<T>): Promise<T | null> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const small = render(bmp, 0, 700, card.channel);
    const measured = textSkewDeg(grayOf(small), small.width, small.height);
    // Lệch dưới 1,5° so với thẳng/xoay ngang thì coi như thẳng — Tesseract tự chịu được, đỡ phải nội suy lại ảnh.
    const square = Math.round(measured / 90) * 90;
    const skew = Math.abs(measured - square) < 1.5 ? square : measured;
    const w = await getWorker();
    let best: T | null = null;
    // Xoay thẳng dòng chữ; gần như không đọc ra gì thì có thể ảnh đang lộn ngược → thử xoay thêm 180°.
    for (const flip of [0, 180]) {
      const canvas = render(bmp, flip - skew, OCR_SIDE, card.channel);
      let got: T | null = null;
      let number: string | null = null;
      // Lượt xoay 180° chỉ để cứu ảnh lộn ngược — một lần đọc là đủ, khỏi chờ lâu.
      for (const layout of flip ? LAYOUTS.slice(0, 1) : LAYOUTS) {
        const { data } = await w.recognize(canvas, layout, { text: true, blocks: true });
        const d = card.parse(data);
        got = got ? card.merge(got, d) : d;
        number ??= await rereadNumber(w, data, canvas);
        // Đủ rồi; hoặc gần như không ra chữ (có thể lộn ngược) → khỏi thử cách chia vùng khác, sang xoay 180°.
        if (card.count(got) >= card.full || card.count(got) < 2) break;
      }
      if (got && number) got = card.withNumber(got, number);
      if (got && (!best || card.count(got) > card.count(best))) best = got;
      if (best && card.count(best) >= 2) break;
    }
    return best && card.count(best) > 0 ? best : null;
  } finally {
    bmp.close();
    releaseLater();
  }
}
