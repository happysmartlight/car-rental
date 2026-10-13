// Đo góc nghiêng của dòng chữ trong ảnh chụp giấy tờ — để xoay thẳng trước khi OCR
// (Tesseract đọc hỏng hẳn khi nghiêng quá ~5°).
//
// Cách làm: lấy các điểm "nét chữ" (tối hơn hẳn vùng quanh nó — bỏ qua mảng tối lớn như ảnh chân dung,
// nền bàn), chiếu lên trục vuông góc với từng góc thử; góc nào làm các dòng chữ dồn thành vạch sắc nhất
// (phương sai lớn nhất) là góc của dòng chữ.

/**
 * Góc dòng chữ, độ, trong [-45, 135): ~0 là ảnh thẳng, ~90 là ảnh xoay ngang.
 * Xoay ảnh ngược lại góc này là thẳng dòng (có thể bị lộn ngược 180° — không phân biệt được).
 * `gray`: ảnh xám nhỏ (cạnh dài ~700px là đủ).
 */
export function textSkewDeg(gray: Uint8Array, w: number, h: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const r = Math.max(4, Math.round(Math.min(w, h) / 32));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const mean = (integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      if (gray[y * w + x] < mean * 0.8) {
        xs.push(x);
        ys.push(y);
      }
    }
  }

  // Bin rộng 2px + rải tuyến tính sang 2 bin kề — tránh răng cưa của lưới điểm ảnh ở góc 45°.
  const D = Math.ceil(Math.hypot(w, h)) + 2;
  const bins = new Float64Array(D + 2);
  const score = (a: number) => {
    const rad = (a * Math.PI) / 180;
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    bins.fill(0);
    for (let i = 0; i < xs.length; i++) {
      const p = (-xs[i] * s + ys[i] * c + D) / 2;
      const k = Math.floor(p);
      bins[k] += k + 1 - p;
      bins[k + 1] += p - k;
    }
    let sum = 0;
    for (const b of bins) sum += b * b;
    return sum;
  };
  // Dò thô bước 0,5° rồi dò mịn 0,1° quanh góc tốt nhất.
  let best = 0;
  let bestScore = -1;
  const scan = (from: number, to: number, step: number) => {
    for (let a = from; a <= to + 1e-9; a += step) {
      const sc = score(a);
      if (sc > bestScore) {
        bestScore = sc;
        best = a;
      }
    }
  };
  scan(-45, 134.5, 0.5);
  scan(best - 0.4, best + 0.4, 0.1);
  return Math.round(best * 10) / 10;
}
