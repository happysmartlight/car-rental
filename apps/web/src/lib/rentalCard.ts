// Ảnh phiếu gửi khách của lượt thuê (giao xe / nhận xe / quyết toán), vẽ từ RentalShareDoc.

import QRCode from 'qrcode';
import type { RentalShareDoc, ShareRow } from '@shared/rentalShare';
import { fmtNumber } from '@shared/text';
import { fmtDateTime } from '@shared/time';
import { buildVietQrPayload } from '@shared/vietqr';
import { C, P, Pen, W, drawCover, drawFooter, drawHeader, drawSection, ensureFonts, finish, font, loadImage, newCanvas, rr, wrap } from './shareCard';
import type { BusinessSettings } from './types';

export interface RentalCardOptions {
  /** Ảnh xe lúc giao / nhận. */
  photos: boolean;
  /** Mã VietQR + số tài khoản khi khách còn phải trả. */
  pay: boolean;
}

export const DEFAULT_RENTAL_CARD_OPTIONS: RentalCardOptions = { photos: true, pay: true };

const RED = '#b91c1c';
const GREEN = '#047857';
const MAX_PHOTOS = 9;
const vnd = (n: number) => `${fmtNumber(n)}đ`;

/** Dòng "nhãn …… giá trị". Nhãn dài thì xuống dòng bên trái; giá trị dài thì đặt dưới nhãn. */
function drawRows(pen: Pen, rows: ShareRow[]) {
  const { ctx } = pen;
  const maxW = W - 2 * P;
  for (const r of rows) {
    pen.gap(16);
    const size = r.strong ? 34 : 32;
    const valueFont = font(r.strong ? 700 : 600, size);
    const color = r.tone === 'red' ? RED : r.tone === 'green' ? GREEN : C.fg;
    ctx.font = valueFont;
    const vw = ctx.measureText(r.value).width;
    if (vw <= maxW * 0.5) {
      ctx.font = font(400, 30);
      ctx.fillStyle = C.muted;
      const lines = wrap(ctx, r.label, maxW - vw - 32);
      lines.forEach((l, k) => ctx.fillText(l, P, pen.y + 34 + k * 42));
      ctx.font = valueFont;
      ctx.fillStyle = color;
      ctx.fillText(r.value, W - P - vw, pen.y + 34);
      pen.gap(lines.length * 42 + 8);
    } else {
      pen.text(r.label, { size: 30, color: C.muted, lh: 42 });
      pen.text(r.value, { size, weight: r.strong ? 700 : 600, color, lh: Math.round(size * 1.4) });
      pen.gap(8);
    }
    ctx.fillStyle = C.border;
    ctx.fillRect(P, pen.y, maxW, 2);
  }
}

async function drawPhotos(pen: Pen, heading: string, fileIds: string[]) {
  const imgs = (await Promise.all(fileIds.slice(0, MAX_PHOTOS).map((f) => loadImage(f, true)))).filter((x): x is ImageBitmap => !!x);
  if (!imgs.length) return;
  drawSection(pen, heading);
  const gap = 12;
  const cw = (W - 2 * P - 2 * gap) / 3;
  const ch = Math.round(cw * 0.75);
  imgs.forEach((img, k) => drawCover(pen.ctx, img, P + (k % 3) * (cw + gap), pen.y + Math.floor(k / 3) * (ch + gap), cw, ch, 16));
  pen.gap(Math.ceil(imgs.length / 3) * (ch + gap) - gap);
  imgs.forEach((img) => img.close());
}

async function drawPay(pen: Pen, pay: NonNullable<RentalShareDoc['pay']>, biz: BusinessSettings, bankName: string) {
  const { ctx } = pen;
  const payload = buildVietQrPayload({ bin: biz.bankBin, accountNumber: biz.bankAccount, amount: pay.amount, note: pay.note });
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, payload, { margin: 1, width: 300, errorCorrectionLevel: 'M' });
  pen.gap(44);
  const top = pen.y;
  const pad = 32;
  const x = P + pad + 300 + 36;
  const maxW = W - P - pad - x;
  // Đo trước để khung trắng đủ cao cho phần chữ.
  const lines: [string, number, number, string, number][] = [
    ['Quét mã để chuyển khoản', 26, 400, C.muted, 36],
    [pay.label, 30, 600, C.fg, 40],
    [vnd(pay.amount), 52, 700, C.brand, 66],
    [bankName, 26, 400, C.muted, 36],
    [biz.bankAccount, 30, 700, C.fg, 40],
    ...(biz.bankAccountName ? [[biz.bankAccountName.toUpperCase(), 24, 400, C.muted, 34] as [string, number, number, string, number]] : []),
    [`Nội dung: ${pay.note}`, 24, 400, C.muted, 34],
  ];
  const textH = lines.reduce((s, [t, size, weight, , lh]) => {
    ctx.font = font(weight, size);
    return s + wrap(ctx, t, maxW).length * lh;
  }, 0);
  const h = Math.max(300, textH) + 2 * pad;
  ctx.fillStyle = C.card;
  rr(ctx, P, top, W - 2 * P, h, 28);
  ctx.fill();
  ctx.drawImage(qr, P + pad, top + (h - 300) / 2, 300, 300);
  pen.y = top + (h - textH) / 2 - 6;
  for (const [t, size, weight, color, lh] of lines) pen.text(t, { size, weight, color, x, maxW, lh });
  pen.y = top + h;
}

export async function renderRentalCard(doc: RentalShareDoc, biz: BusinessSettings, bankName: string, opt: RentalCardOptions): Promise<Blob> {
  await ensureFonts();
  const rows = doc.blocks.reduce((s, b) => s + b.rows.length, 0);
  const photoRows = opt.photos ? Math.ceil(Math.min(doc.photos.length, MAX_PHOTOS) / 3) : 0;
  const { canvas, pen } = newCanvas(1600 + rows * 140 + doc.notes.length * 160 + photoRows * 260 + 520);
  drawHeader(pen, biz, 'Thuê xe tự lái');
  pen.gap(44);
  pen.text(doc.title, { size: 56, weight: 700, lh: 70 });
  pen.text(`${doc.code} · ${doc.plate}`, { size: 30, color: C.muted });
  pen.gap(20);
  for (const l of doc.lead) pen.text(l, { size: 30, lh: 44 });
  if (opt.photos && doc.photos.length) await drawPhotos(pen, doc.stage === 'pickup' ? 'Ảnh xe lúc giao' : 'Ảnh xe lúc nhận', doc.photos);
  for (const b of doc.blocks) {
    if (!b.rows.length) continue;
    drawSection(pen, b.heading);
    drawRows(pen, b.rows);
  }
  if (doc.notes.length) {
    drawSection(pen, 'Lưu ý');
    for (const n of doc.notes) pen.text(`•  ${n}`, { size: 30, color: C.muted, lh: 44 });
  }
  if (opt.pay && doc.pay && biz.bankBin && biz.bankAccount) await drawPay(pen, doc.pay, biz, bankName);
  drawFooter(pen, biz, `Gửi lúc ${fmtDateTime(Date.now())}`);
  return finish(canvas, pen.y);
}
