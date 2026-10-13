// OCR mặt trước CCCD / thẻ Căn cước — đường dự phòng khi QR không đọc được.
// Nạp bằng import() — kéo theo Tesseract (xem ./ocr).

import { cccdOcrFieldCount, mergeCccdOcr, parseCccdText, type CccdOcrData } from '@shared/cccd';
import { unaccent } from '@shared/text';
import { readCard, type Page } from './ocr';

/**
 * Chữ của cột thông tin, bỏ phần nằm hẳn bên trái cột (dưới ảnh chân dung: "Có giá trị đến …",
 * "Date of expiry") — OCR hay ghép chúng chung dòng với địa chỉ ở cột phải.
 * Mép trái cột = mép trái các dòng nhãn (Họ và tên, Ngày sinh, Quê quán, Nơi thường trú).
 */
function columnText(page: Page): string {
  const lines = page.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
  const labels = lines.filter((l) => l.words.length && /ho\s*(va\s*)?ten|full\s*name|ngay\s*sinh|que\s*quan|thuong\s*tru/.test(unaccent(l.text)));
  if (labels.length < 2) return page.text;
  const mid = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
  const left = mid(labels.map((l) => l.bbox.x0));
  const charH = mid(labels.flatMap((l) => l.words.map((w) => w.bbox.y1 - w.bbox.y0)));
  return lines.map((l) => l.words.filter((w) => w.bbox.x1 >= left - charH * 0.3).map((w) => w.text).join(' ')).join('\n');
}

export function readCccdOcr(file: Blob): Promise<CccdOcrData | null> {
  return readCard<CccdOcrData>(file, {
    channel: 'gray',
    parse: (page) => parseCccdText(columnText(page)),
    merge: mergeCccdOcr,
    count: cccdOcrFieldCount,
    full: 5,
    withNumber: (d, n) => ({ ...d, idNumber: n }),
  });
}
