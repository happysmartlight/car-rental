// OCR mặt trước GPLX thẻ PET. Nạp bằng import() — kéo theo Tesseract (xem ./ocr).

import { gplxFieldCount, mergeGplx, parseGplxText, type GplxData } from '@shared/gplx';
import { readCard } from './ocr';

export function readGplxPhoto(file: Blob): Promise<GplxData | null> {
  return readCard<GplxData>(file, {
    channel: 'red',
    parse: (page) => parseGplxText(page.text),
    merge: mergeGplx,
    count: gplxFieldCount,
    full: 5,
    withNumber: (d, n) => ({ ...d, licenseNumber: n }),
  });
}
