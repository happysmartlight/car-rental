// Ảnh + tin nhắn bảng giá để gửi khách qua Zalo/Messenger.
// Vẽ bằng canvas ngay trên máy (khách không vào được app qua Tailscale nên không gửi link).

import { FUEL_LABEL, TRANSMISSION_LABEL } from '@shared/constants';
import { CHARGE_BASE_DAYS, chargingText, vehicleChargingPolicy } from '@shared/pricing';
import { fmtNumber } from '@shared/text';
import { daysUntil, fmtDate, fmtDateKey } from '@shared/time';
import { fileUrl } from './api';
import type { BusinessSettings, RulesSettings, Vehicle } from './types';

export interface ShareOptions {
  plate: boolean;
  deposit: boolean;
  extras: boolean;
  highlights: boolean;
  note: boolean;
  /** Xe điện: số lần sạc miễn phí, phí mỗi lượt sạc thêm. */
  charging: boolean;
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = { plate: false, deposit: true, extras: true, highlights: true, note: true, charging: true };

export type ShareVehicle = Pick<
  Vehicle,
  | 'plate'
  | 'make'
  | 'model'
  | 'year'
  | 'color'
  | 'seats'
  | 'transmission'
  | 'fuel'
  | 'photoFileId'
  | 'priceDay'
  | 'priceWeekendDay'
  | 'priceHour'
  | 'kmLimitDay'
  | 'overKmFee'
  | 'overHourFee'
  | 'depositAmount'
  | 'priceMonth'
  | 'kmLimitMonth'
  | 'freeCharges'
  | 'chargeFee'
> & { highlights: string[] };

// Bộ vẽ dùng chung với ảnh gửi khách của lượt thuê (rentalCard.ts).
export const W = 1080;
export const P = 64;
export const C = {
  brand: '#2563eb',
  brandSoft: '#e8efff',
  fg: '#0e1420',
  muted: '#5f6b7d',
  subtle: '#8a94a5',
  bg: '#f5f6f8',
  card: '#ffffff',
  border: '#e3e6eb',
  amber: '#b45309',
  amberSoft: '#fef3c7',
  footer: '#0e1420',
  footerMuted: '#aab3c5',
};
const FAMILY = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif';
export const font = (weight: number, size: number) => `${weight} ${size}px ${FAMILY}`;

const vnd = (n: number) => `${fmtNumber(n)}đ`;
const title = (v: ShareVehicle) => [v.make, v.model].filter(Boolean).join(' ') || v.plate;
const specs = (v: ShareVehicle) =>
  [v.year, v.seats && `${v.seats} chỗ`, v.transmission && TRANSMISSION_LABEL[v.transmission], v.fuel && FUEL_LABEL[v.fuel], v.color].filter(Boolean).join(' · ');
const monthKm = (v: ShareVehicle) => (v.kmLimitMonth && v.kmLimitMonth > 0 ? v.kmLimitMonth : v.kmLimitDay * 30);
const monthLine = (v: ShareVehicle) => (v.priceMonth ? `Thuê tháng: ${vnd(v.priceMonth)}/tháng${monthKm(v) ? ` (${fmtNumber(monthKm(v))} km)` : ''}` : null);
const weekendPrice = (v: ShareVehicle) => (v.priceWeekendDay && v.priceWeekendDay !== v.priceDay ? v.priceWeekendDay : null);
const WEEKDAY_NAME = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** Chính sách sạc của đội xe, gộp các xe giống nhau: ["Xe điện: miễn phí…"] hoặc ["VinFast VF 3: …", "VinFast VF 8: …"]. */
function fleetCharging(vehicles: ShareVehicle[]): string[] {
  const groups = new Map<string, string[]>();
  for (const v of vehicles) {
    const c = vehicleChargingPolicy(v);
    if (!c) continue;
    const t = chargingText(c);
    const names = groups.get(t) ?? [];
    if (!names.includes(title(v))) names.push(title(v));
    groups.set(t, names);
  }
  const evs = vehicles.filter((v) => v.fuel === 'electric').length;
  const first = [...groups.keys()][0];
  if (groups.size === 1 && vehicles.filter((v) => vehicleChargingPolicy(v)).length === evs) return [`Xe điện: ${first}`];
  return [...groups].map(([t, names]) => `${names.join(', ')}: ${t}`);
}
const weekendLabel = (rules: RulesSettings) => (rules.weekendDays.length ? [...rules.weekendDays].sort((a, b) => (a || 7) - (b || 7)).map((d) => WEEKDAY_NAME[d]).join(', ') : 'Cuối tuần');

/** Kỳ lễ còn hiệu lực trong 120 ngày tới — báo trước để khách khỏi bất ngờ. */
export function upcomingHolidays(rules: RulesSettings) {
  return rules.holidays
    .filter((h) => h.to && daysUntil(h.to) >= 0 && daysUntil(h.from) <= 120 && h.surchargePct > 0)
    .sort((a, b) => a.from.localeCompare(b.from));
}

function requirements(rules: RulesSettings): string[] {
  const r = ['CCCD gắn chip / thẻ Căn cước + giấy phép lái xe (bản gốc)'];
  if (rules.minDriverAge) r.push(`Người lái từ ${rules.minDriverAge} tuổi`);
  return r;
}

// ── Vẽ ──────────────────────────────────────────────────────────────────────

export async function ensureFonts() {
  const sample = 'Bảng giá thuê xe tự lái Ếấộữ 0123456789đ';
  try {
    await Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(font(w, 32), sample)));
  } catch {
    /* thiếu font thì dùng font hệ thống */
  }
}

/** Biểu tượng xe (icon app) cho ô ảnh trống. */
async function loadPlaceholder(): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = '/icons/icon.svg';
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

export async function loadImage(fileId: string | null, thumb = false): Promise<ImageBitmap | null> {
  if (!fileId) return null;
  try {
    const res = await fetch(fileUrl(fileId, { thumb }), { credentials: 'same-origin' });
    return res.ok ? await createImageBitmap(await res.blob()) : null;
  } catch {
    return null;
  }
}

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number, radius = 0) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.save();
  rr(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

/** Bút vẽ chạy dọc trang, tự cộng chiều cao. */
export class Pen {
  y = 0;
  constructor(public ctx: CanvasRenderingContext2D) {}
  text(t: string, opts: { size: number; weight?: number; color?: string; x?: number; maxW?: number; lh?: number }) {
    const { ctx } = this;
    ctx.font = font(opts.weight ?? 400, opts.size);
    ctx.fillStyle = opts.color ?? C.fg;
    const lh = opts.lh ?? Math.round(opts.size * 1.35);
    for (const line of wrap(ctx, t, opts.maxW ?? W - 2 * P)) {
      ctx.fillText(line, opts.x ?? P, this.y + opts.size);
      this.y += lh;
    }
  }
  gap(n: number) {
    this.y += n;
  }
}

export function drawHeader(pen: Pen, biz: BusinessSettings, label: string) {
  const { ctx } = pen;
  ctx.fillStyle = C.brand;
  ctx.fillRect(0, pen.y, W, 132);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 42);
  ctx.fillText(biz.name || 'Thuê xe tự lái', P, pen.y + 66);
  ctx.font = font(500, 26);
  ctx.globalAlpha = 0.85;
  ctx.fillText(label.toUpperCase(), P, pen.y + 106);
  ctx.globalAlpha = 1;
  if (biz.phone) {
    ctx.font = font(700, 36);
    const w = ctx.measureText(biz.phone).width;
    ctx.fillText(biz.phone, W - P - w, pen.y + 80);
  }
  pen.y += 132;
}

function drawChips(pen: Pen, items: string[]) {
  const { ctx } = pen;
  ctx.font = font(500, 30);
  let x = P;
  const h = 58;
  for (const t of items) {
    const w = ctx.measureText(t).width + 44;
    if (x + w > W - P) {
      x = P;
      pen.y += h + 12;
    }
    ctx.fillStyle = C.card;
    rr(ctx, x, pen.y, w, h, 29);
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = C.fg;
    ctx.fillText(t, x + 22, pen.y + 39);
    x += w + 12;
  }
  pen.y += h;
}

export function drawSection(pen: Pen, heading: string) {
  pen.gap(44);
  pen.text(heading, { size: 36, weight: 700 });
  pen.gap(14);
}

function drawNotes(pen: Pen, biz: BusinessSettings, rules: RulesSettings, opt: ShareOptions) {
  drawSection(pen, 'Thủ tục');
  for (const r of requirements(rules)) pen.text(`•  ${r}`, { size: 30, color: C.muted, lh: 44 });
  if (opt.note && biz.shareNote.trim()) {
    pen.gap(8);
    for (const line of biz.shareNote.trim().split('\n')) pen.text(line.startsWith('•') || line.startsWith('-') ? line : `•  ${line}`, { size: 30, color: C.muted, lh: 44 });
  }
}

function drawHolidays(pen: Pen, rules: RulesSettings) {
  const hs = upcomingHolidays(rules);
  if (!hs.length) return;
  const { ctx } = pen;
  pen.gap(24);
  const lines = hs.map((h) => `${h.name} (${fmtDateKey(h.from).slice(0, 5)}–${fmtDateKey(h.to).slice(0, 5)}): phụ thu ${h.surchargePct}%`);
  const h = 32 + lines.length * 44;
  ctx.fillStyle = C.amberSoft;
  rr(ctx, P, pen.y, W - 2 * P, h, 20);
  ctx.fill();
  pen.gap(16);
  for (const l of lines) pen.text(l, { size: 30, weight: 600, color: C.amber, x: P + 28, lh: 44 });
  pen.gap(16);
}

export function drawFooter(pen: Pen, biz: BusinessSettings, stamp = `Báo giá ngày ${fmtDate(Date.now())}`) {
  const { ctx } = pen;
  pen.gap(56);
  const top = pen.y;
  const lines: [string, number, number, string][] = [];
  if (biz.phone) lines.push([`Gọi / Zalo: ${biz.phone}`, 40, 700, '#ffffff']);
  if (biz.address) lines.push([biz.address, 28, 400, C.footerMuted]);
  lines.push([stamp, 24, 400, C.footerMuted]);
  ctx.font = font(400, 28);
  const height = 56 + lines.reduce((s, [t, size]) => s + wrap(ctx, t, W - 2 * P).length * Math.round(size * 1.45), 0) + 40;
  ctx.fillStyle = C.footer;
  ctx.fillRect(0, top, W, height);
  pen.gap(48);
  for (const [t, size, weight, color] of lines) pen.text(t, { size, weight, color, lh: Math.round(size * 1.45) });
  pen.y = top + height;
}

export async function finish(canvas: HTMLCanvasElement, height: number): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.ceil(height);
  out.getContext('2d')!.drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Không tạo được ảnh'))), 'image/jpeg', 0.92));
}

export function newCanvas(height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, height);
  ctx.textBaseline = 'alphabetic';
  return { canvas, pen: new Pen(ctx) };
}

export async function renderVehicleCard(v: ShareVehicle, biz: BusinessSettings, rules: RulesSettings, opt: ShareOptions): Promise<Blob> {
  await ensureFonts();
  const photo = await loadImage(v.photoFileId);
  const { canvas, pen } = newCanvas(4200);
  const { ctx } = pen;
  drawHeader(pen, biz, 'Bảng giá thuê xe tự lái');
  if (photo) {
    drawCover(ctx, photo, 0, pen.y, W, 608);
    pen.gap(608);
  }
  pen.gap(48);
  pen.text(title(v), { size: 60, weight: 700, lh: 74 });
  const sp = specs(v);
  if (sp) pen.text(sp, { size: 32, color: C.muted });
  if (opt.plate) {
    pen.gap(10);
    pen.text(`Biển số ${v.plate}`, { size: 30, weight: 600, color: C.muted });
  }

  // Khung giá chính
  pen.gap(32);
  const we = weekendPrice(v);
  const ml = monthLine(v);
  const boxH = 140 + (we ? 56 : 0) + (ml ? 56 : 0);
  ctx.fillStyle = C.brandSoft;
  rr(ctx, P, pen.y, W - 2 * P, boxH, 28);
  ctx.fill();
  ctx.fillStyle = C.brand;
  ctx.font = font(700, 76);
  const price = vnd(v.priceDay);
  ctx.fillText(price, P + 40, pen.y + 98);
  const pw = ctx.measureText(price).width;
  ctx.font = font(500, 34);
  ctx.fillText(' / ngày (24 giờ)', P + 40 + pw, pen.y + 98);
  let lineY = pen.y + 160;
  ctx.fillStyle = C.fg;
  ctx.font = font(600, 34);
  if (we) {
    ctx.fillText(`${weekendLabel(rules)}: ${vnd(we)}/ngày`, P + 40, lineY);
    lineY += 56;
  }
  if (ml) ctx.fillText(ml, P + 40, lineY);
  pen.gap(boxH);

  const rows: [string, string][] = [];
  if (opt.extras) {
    if (v.priceHour) rows.push(['Giờ lẻ', `${vnd(v.priceHour)}/giờ`]);
    rows.push(['Giới hạn quãng đường', v.kmLimitDay ? `${fmtNumber(v.kmLimitDay)} km/ngày` : 'Không giới hạn']);
    if (v.kmLimitDay && v.overKmFee) rows.push(['Vượt km', `${vnd(v.overKmFee)}/km`]);
    if (v.overHourFee) rows.push(['Trả xe trễ', `${vnd(v.overHourFee)}/giờ`]);
  }
  const ch = opt.charging ? vehicleChargingPolicy(v) : null;
  if (ch?.baseFree) {
    rows.push([`Sạc pin miễn phí (thuê ≤ ${CHARGE_BASE_DAYS} ngày)`, `${ch.baseFree} lượt`]);
    rows.push([`Từ ngày thứ ${CHARGE_BASE_DAYS + 1}, mỗi ngày thêm`, '1 lượt miễn phí']);
  }
  if (ch?.fee) rows.push([ch.baseFree ? 'Sạc vượt (mỗi lần cắm-rút)' : 'Sạc pin (mỗi lần cắm-rút)', `${vnd(ch.fee)}/lượt`]);
  if (opt.deposit && v.depositAmount) rows.push(['Đặt cọc', vnd(v.depositAmount)]);
  if (rows.length) {
    pen.gap(20);
    for (const [label, value] of rows) {
      pen.gap(18);
      ctx.font = font(400, 32);
      ctx.fillStyle = C.muted;
      ctx.fillText(label, P, pen.y + 34);
      ctx.font = font(600, 32);
      ctx.fillStyle = C.fg;
      const w = ctx.measureText(value).width;
      ctx.fillText(value, W - P - w, pen.y + 34);
      pen.gap(52);
      ctx.fillStyle = C.border;
      ctx.fillRect(P, pen.y, W - 2 * P, 2);
    }
  }
  drawHolidays(pen, rules);

  if (opt.highlights && v.highlights.length) {
    drawSection(pen, 'Tiện nghi trên xe');
    drawChips(pen, v.highlights);
  }
  drawNotes(pen, biz, rules, opt);
  drawFooter(pen, biz);
  photo?.close();
  return finish(canvas, pen.y);
}

export async function renderFleetCard(vehicles: ShareVehicle[], biz: BusinessSettings, rules: RulesSettings, opt: ShareOptions): Promise<Blob> {
  await ensureFonts();
  const thumbs = await Promise.all(vehicles.map((v) => loadImage(v.photoFileId, true)));
  const placeholder = thumbs.some((t) => !t) ? await loadPlaceholder() : null;
  const { canvas, pen } = newCanvas(1400 + vehicles.length * 290);
  const { ctx } = pen;
  drawHeader(pen, biz, 'Bảng giá thuê xe tự lái');
  pen.gap(44);
  pen.text('Bảng giá thuê xe', { size: 56, weight: 700, lh: 70 });
  pen.text(`${vehicles.length} xe · giá theo ngày 24 giờ`, { size: 30, color: C.muted });
  pen.gap(16);

  vehicles.forEach((v, i) => {
    pen.gap(20);
    const top = pen.y;
    const h = 250;
    ctx.fillStyle = C.card;
    rr(ctx, P, top, W - 2 * P, h, 28);
    ctx.fill();
    const img = thumbs[i];
    const tx = P + 24;
    if (img) drawCover(ctx, img, tx, top + 24, 260, 202, 20);
    else {
      ctx.fillStyle = C.bg;
      rr(ctx, tx, top + 24, 260, 202, 20);
      ctx.fill();
      if (placeholder) {
        ctx.globalAlpha = 0.35;
        ctx.drawImage(placeholder, tx + 130 - 48, top + 125 - 48, 96, 96);
        ctx.globalAlpha = 1;
      }
    }
    const x = tx + 260 + 32;
    const maxW = W - P - 24 - x;
    pen.y = top + 22;
    pen.text(title(v), { size: 38, weight: 700, x, maxW, lh: 48 });
    const sp = [v.seats && `${v.seats} chỗ`, v.transmission && TRANSMISSION_LABEL[v.transmission], v.fuel && FUEL_LABEL[v.fuel], opt.plate && v.plate].filter(Boolean).join(' · ');
    if (sp) pen.text(sp, { size: 26, color: C.muted, x, maxW, lh: 36 });
    pen.gap(6);
    pen.text(`${vnd(v.priceDay)}/ngày`, { size: 42, weight: 700, color: C.brand, x, maxW, lh: 52 });
    const we = weekendPrice(v);
    const sub = [we && `${weekendLabel(rules)}: ${vnd(we)}`, v.priceMonth && `Tháng: ${vnd(v.priceMonth)}`, opt.highlights && v.highlights.slice(0, 2).join(', ')]
      .filter(Boolean)
      .join(' · ');
    if (sub) pen.text(sub, { size: 26, color: C.muted, x, maxW, lh: 34 });
    pen.y = top + h;
  });

  const limits = [...new Set(vehicles.map((v) => v.kmLimitDay))];
  const deposits = vehicles.map((v) => v.depositAmount).filter((d) => d > 0);
  const charging = opt.charging ? fleetCharging(vehicles) : [];
  if (opt.extras || opt.deposit || charging.length) {
    drawSection(pen, 'Điều kiện');
    if (opt.extras) pen.text(`•  Giới hạn ${limits.length === 1 ? (limits[0] ? `${fmtNumber(limits[0])} km/ngày` : 'không giới hạn km') : 'km tùy xe'}`, { size: 30, color: C.muted, lh: 44 });
    if (opt.deposit && deposits.length) pen.text(`•  Đặt cọc từ ${vnd(Math.min(...deposits))}`, { size: 30, color: C.muted, lh: 44 });
    for (const line of charging) pen.text(`•  ${line}`, { size: 30, color: C.muted, lh: 44 });
  }
  drawHolidays(pen, rules);
  drawNotes(pen, biz, rules, opt);
  drawFooter(pen, biz);
  thumbs.forEach((t) => t?.close());
  return finish(canvas, pen.y);
}

// ── Tin nhắn chữ (dán vào Zalo) ──────────────────────────────────────────────

export function vehicleShareText(v: ShareVehicle, biz: BusinessSettings, rules: RulesSettings, opt: ShareOptions): string {
  const lines = [`🚗 ${title(v)}${specs(v) ? ` — ${specs(v)}` : ''}`];
  if (opt.plate) lines.push(`🔖 Biển số: ${v.plate}`);
  const we = weekendPrice(v);
  lines.push(`💰 Giá thuê: ${vnd(v.priceDay)}/ngày${we ? ` (${weekendLabel(rules)}: ${vnd(we)})` : ''}`);
  const ml = monthLine(v);
  if (ml) lines.push(`📅 ${ml}`);
  if (opt.extras) {
    const extra = [v.priceHour && `giờ lẻ ${vnd(v.priceHour)}/giờ`, v.kmLimitDay ? `giới hạn ${fmtNumber(v.kmLimitDay)} km/ngày${v.overKmFee ? `, vượt ${vnd(v.overKmFee)}/km` : ''}` : 'không giới hạn km'].filter(Boolean);
    const extraText = extra.join(' · ');
    lines.push(`⏱ ${extraText.charAt(0).toUpperCase()}${extraText.slice(1)}`);
  }
  const ch = opt.charging ? vehicleChargingPolicy(v) : null;
  if (ch) lines.push(`🔌 Sạc pin: ${chargingText(ch)}`);
  if (opt.deposit && v.depositAmount) lines.push(`🔒 Đặt cọc: ${vnd(v.depositAmount)}`);
  for (const h of upcomingHolidays(rules)) lines.push(`🎉 ${h.name} (${fmtDateKey(h.from).slice(0, 5)}–${fmtDateKey(h.to).slice(0, 5)}): phụ thu ${h.surchargePct}%`);
  if (opt.highlights && v.highlights.length) lines.push(`✨ Tiện nghi: ${v.highlights.join(', ')}`);
  lines.push(...footerText(biz, rules, opt));
  return lines.join('\n');
}

export function fleetShareText(vehicles: ShareVehicle[], biz: BusinessSettings, rules: RulesSettings, opt: ShareOptions): string {
  const lines = [`🚗 BẢNG GIÁ THUÊ XE TỰ LÁI${biz.name ? ` — ${biz.name}` : ''}`, ''];
  for (const v of vehicles) {
    const we = weekendPrice(v);
    const month = v.priceMonth ? `, tháng ${vnd(v.priceMonth)}` : '';
    lines.push(`• ${title(v)}${v.seats ? ` (${v.seats} chỗ)` : ''}${opt.plate ? ` [${v.plate}]` : ''}: ${vnd(v.priceDay)}/ngày${we ? `, ${weekendLabel(rules)} ${vnd(we)}` : ''}${month}`);
  }
  lines.push('');
  const deposits = vehicles.map((v) => v.depositAmount).filter((d) => d > 0);
  if (opt.deposit && deposits.length) lines.push(`🔒 Đặt cọc từ ${vnd(Math.min(...deposits))}`);
  if (opt.charging) for (const line of fleetCharging(vehicles)) lines.push(`🔌 ${line}`);
  for (const h of upcomingHolidays(rules)) lines.push(`🎉 ${h.name}: phụ thu ${h.surchargePct}%`);
  lines.push(...footerText(biz, rules, opt));
  return lines.join('\n');
}

function footerText(biz: BusinessSettings, rules: RulesSettings, opt: ShareOptions): string[] {
  const out = [`📄 Thủ tục: ${requirements(rules).join('; ')}`];
  if (opt.note && biz.shareNote.trim()) out.push(biz.shareNote.trim());
  if (biz.phone) out.push(`📞 ${biz.phone}${biz.name ? ` — ${biz.name}` : ''}`);
  return out;
}

// ── Gửi ─────────────────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Mở bảng chia sẻ của điện thoại (Zalo, Messenger…); máy không hỗ trợ thì tải ảnh về. */
export async function shareImage(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export async function shareText(text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
