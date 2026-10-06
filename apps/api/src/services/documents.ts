// Sinh hợp đồng / biên bản từ mẫu Word (.docx) bằng docxtemplater, rồi đổi sang
// PDF qua Gotenberg (LibreOffice) nếu có. Văn bản đã sinh không bao giờ bị ghi đè.
//
// Biến trong mẫu viết dạng {khach.ho_ten}. Dữ liệu được "làm phẳng" thành khóa có
// dấu chấm nên không cần bộ parser biểu thức. Vòng lặp: {#khoan}{mo_ta}: {so_tien}{/khoan}.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { and, eq, like } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { ContractTemplate, Customer, Handover, HandoverAccessory } from '../db/schema.js';
import { DOCX_MIME, getFileRow, readFileData, saveBinary } from '../lib/files.js';
import { badRequest, notFound } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';
import {
  CHARGE_KIND_LABEL,
  COLLATERAL_KIND_LABEL,
  FUEL_LABEL,
  TRANSMISSION_LABEL,
  type TemplateKind,
} from '../shared/constants.js';
import { planSettlement } from '../shared/money.js';
import { monthKmLimit, quoteRental } from '../shared/pricing.js';
import { fmtNumber, vndInWords } from '../shared/text.js';
import { fmtDate, fmtDateKey, fmtDateTime, fmtDuration, vnDateLong } from '../shared/time.js';
import { handoverAccessoryTemplate } from './accessories.js';
import { rentalDetail, rentalPricing } from './rentals.js';

// ── Danh sách biến (hiển thị trong Cài đặt → Mẫu hợp đồng) ───────────────────

export interface FieldDoc {
  key: string;
  label: string;
}

export const TEMPLATE_FIELDS: { group: string; fields: FieldDoc[] }[] = [
  {
    group: 'Bên cho thuê (Cài đặt → Cửa hàng)',
    fields: [
      { key: 'ben_a.ten', label: 'Tên cửa hàng / doanh nghiệp' },
      { key: 'ben_a.dai_dien', label: 'Người đại diện' },
      { key: 'ben_a.chuc_vu', label: 'Chức vụ' },
      { key: 'ben_a.cccd', label: 'Số CCCD người đại diện' },
      { key: 'ben_a.cccd_ngay_cap', label: 'Ngày cấp' },
      { key: 'ben_a.cccd_noi_cap', label: 'Nơi cấp' },
      { key: 'ben_a.dia_chi', label: 'Địa chỉ' },
      { key: 'ben_a.dien_thoai', label: 'Điện thoại' },
      { key: 'ben_a.mst', label: 'Mã số thuế' },
      { key: 'ben_a.stk', label: 'Số tài khoản' },
      { key: 'ben_a.ngan_hang', label: 'Ngân hàng' },
      { key: 'ben_a.chu_tk', label: 'Chủ tài khoản' },
    ],
  },
  {
    group: 'Bên thuê (khách)',
    fields: [
      { key: 'khach.ho_ten', label: 'Họ tên' },
      { key: 'khach.ngay_sinh', label: 'Ngày sinh' },
      { key: 'khach.gioi_tinh', label: 'Giới tính' },
      { key: 'khach.cccd', label: 'Số CCCD' },
      { key: 'khach.cccd_ngay_cap', label: 'Ngày cấp CCCD' },
      { key: 'khach.cccd_noi_cap', label: 'Nơi cấp CCCD' },
      { key: 'khach.thuong_tru', label: 'Nơi thường trú' },
      { key: 'khach.cho_o', label: 'Chỗ ở hiện tại' },
      { key: 'khach.dien_thoai', label: 'Điện thoại' },
      { key: 'khach.email', label: 'Email' },
      { key: 'khach.gplx', label: 'Số GPLX' },
      { key: 'khach.gplx_hang', label: 'Hạng GPLX' },
      { key: 'khach.gplx_han', label: 'Hạn GPLX' },
      { key: 'khach.lien_he_khan', label: 'Người liên hệ khẩn cấp' },
    ],
  },
  {
    group: 'Lái phụ (vòng lặp {#lai_phu}…{/lai_phu}, điều kiện {#co_lai_phu}…{/co_lai_phu})',
    fields: [
      { key: 'ho_ten', label: 'Họ tên' },
      { key: 'cccd', label: 'Số CCCD' },
      { key: 'gplx', label: 'Số GPLX' },
      { key: 'dien_thoai', label: 'Điện thoại' },
    ],
  },
  {
    group: 'Xe',
    fields: [
      { key: 'xe.bien_so', label: 'Biển số' },
      { key: 'xe.hang', label: 'Hãng' },
      { key: 'xe.dong', label: 'Dòng xe' },
      { key: 'xe.nam', label: 'Năm sản xuất' },
      { key: 'xe.mau', label: 'Màu' },
      { key: 'xe.so_cho', label: 'Số chỗ' },
      { key: 'xe.hop_so', label: 'Hộp số' },
      { key: 'xe.nhien_lieu', label: 'Nhiên liệu' },
      { key: 'xe.so_khung', label: 'Số khung' },
      { key: 'xe.so_may', label: 'Số máy' },
    ],
  },
  {
    group: 'Hợp đồng',
    fields: [
      { key: 'hd.so', label: 'Số hợp đồng (HD-2026-0001)' },
      { key: 'hd.ngay_ky', label: 'Ngày ký dạng "ngày 06 tháng 10 năm 2026"' },
      { key: 'hd.noi_ky', label: 'Nơi ký' },
      { key: 'hd.nhan_xe', label: 'Giờ nhận xe' },
      { key: 'hd.tra_xe', label: 'Giờ trả xe' },
      { key: 'hd.thoi_gian', label: 'Thời gian thuê (vd 3 ngày)' },
      { key: 'hd.km_gioi_han', label: 'Giới hạn km cả lượt' },
      { key: 'hd.noi_giao', label: 'Nơi giao xe' },
      { key: 'hd.noi_tra', label: 'Nơi trả xe' },
      { key: 'hd.ghi_chu', label: 'Ghi chú' },
    ],
  },
  {
    group: 'Giá & tiền',
    fields: [
      { key: 'gia.ngay', label: 'Giá ngày' },
      { key: 'gia.cuoi_tuan', label: 'Giá ngày cuối tuần' },
      { key: 'gia.gio', label: 'Giá giờ' },
      { key: 'gia.vuot_km', label: 'Phí vượt km (đ/km)' },
      { key: 'gia.qua_gio', label: 'Phí quá giờ (đ/giờ)' },
      { key: 'gia.thang', label: 'Giá thuê tháng (điều kiện {#co_gia_thang}…{/co_gia_thang})' },
      { key: 'gia.km_thang', label: 'Giới hạn km mỗi tháng' },
      { key: 'hd.hinh_thuc', label: 'Hình thức thuê: "theo ngày" / "theo tháng"' },
      { key: 'tien.tong', label: 'Tổng tiền' },
      { key: 'tien.tong_chu', label: 'Tổng tiền bằng chữ' },
      { key: 'tien.coc', label: 'Tiền cọc thỏa thuận' },
      { key: 'tien.coc_chu', label: 'Tiền cọc bằng chữ' },
      { key: 'tien.coc_da_nhan', label: 'Tiền cọc đã nhận' },
      { key: 'tien.da_tra', label: 'Đã thanh toán' },
      { key: 'tien.con_lai', label: 'Còn phải trả' },
      { key: 'tien.giu_coc', label: 'Số tiền cọc giữ chờ phạt nguội' },
      { key: 'tien.giu_coc_ngay', label: 'Số ngày giữ cọc' },
    ],
  },
  {
    group: 'Các khoản tiền (vòng lặp {#khoan}…{/khoan})',
    fields: [
      { key: 'loai', label: 'Loại khoản' },
      { key: 'mo_ta', label: 'Diễn giải' },
      { key: 'so_tien', label: 'Số tiền' },
    ],
  },
  {
    group: 'Phụ kiện kèm xe (vòng lặp {#phu_kien}…{/phu_kien}, điều kiện {#co_phu_kien}…{/co_phu_kien})',
    fields: [
      { key: 'ten', label: 'Tên phụ kiện' },
      { key: 'so_luong', label: 'Số lượng' },
      { key: 'gia_tri', label: 'Giá trị đền bù khi mất' },
      { key: 'ghi_chu', label: 'Ghi chú' },
    ],
  },
  {
    group: 'Phụ kiện lúc giao/nhận ({#giao.phu_kien}…{/giao.phu_kien}, {#nhan.phu_kien}…{/nhan.phu_kien})',
    fields: [
      { key: 'ten', label: 'Tên phụ kiện' },
      { key: 'so_luong', label: 'Số lượng' },
      { key: 'gia_tri', label: 'Giá trị đền bù' },
      { key: 'co', label: 'Có / Không (☐ nếu chưa kiểm)' },
      { key: 'luc_giao', label: '(chỉ nhan.phu_kien) Có lúc giao' },
      { key: 'luc_nhan', label: '(chỉ nhan.phu_kien) Có lúc nhận' },
      { key: 'ghi_chu', label: 'Ghi chú' },
    ],
  },
  {
    group: 'Tài sản thế chấp ({#the_chap}…{/the_chap}, {#co_the_chap}…{/co_the_chap})',
    fields: [
      { key: 'loai', label: 'Loại' },
      { key: 'mo_ta', label: 'Mô tả' },
    ],
  },
  {
    group: 'Giao xe / nhận xe (tiền tố giao. hoặc nhan.)',
    fields: [
      { key: 'giao.thoi_gian', label: 'Giờ giao xe thực tế' },
      { key: 'giao.odo', label: 'ODO lúc giao' },
      { key: 'giao.xang', label: 'Mức xăng/pin lúc giao' },
      { key: 'giao.ghi_chu', label: 'Ghi chú lúc giao' },
      { key: 'giao.giay_to', label: 'Vòng lặp giấy tờ/đồ đi kèm: {ten} {co}' },
      { key: 'giao.hu_hong', label: 'Vòng lặp vết trầy có sẵn: {vi_tri} {mo_ta}' },
      { key: 'nhan.thoi_gian', label: 'Giờ nhận lại xe' },
      { key: 'nhan.odo', label: 'ODO lúc nhận lại' },
      { key: 'nhan.km_da_di', label: 'Số km đã đi' },
      { key: 'nhan.xang', label: 'Mức xăng/pin lúc nhận' },
      { key: 'nhan.hu_hong', label: 'Vòng lặp hư hỏng mới: {vi_tri} {mo_ta}' },
    ],
  },
  {
    group: 'Quyết toán',
    fields: [
      { key: 'qt.phai_tra', label: 'Tổng phải trả' },
      { key: 'qt.da_tra', label: 'Đã trả' },
      { key: 'qt.coc_dang_giu', label: 'Cọc đang giữ' },
      { key: 'qt.can_tru', label: 'Cấn trừ từ cọc' },
      { key: 'qt.thu_them', label: 'Khách trả thêm' },
      { key: 'qt.hoan_coc', label: 'Hoàn cọc ngay' },
      { key: 'qt.giu_coc', label: 'Giữ lại chờ phạt nguội' },
    ],
  },
  { group: 'Khác', fields: [{ key: 'ngay_in', label: 'Thời điểm in' }] },
];

// ── Dựng dữ liệu cho mẫu ─────────────────────────────────────────────────────

const money = (n: number | null | undefined) => (n == null ? '' : fmtNumber(n));
const fuel = (n: number | null | undefined) => (n == null ? '' : `${n}%`);

function customerFields(c: Customer) {
  return {
    ho_ten: c.fullName,
    ngay_sinh: fmtDateKey(c.dob),
    gioi_tinh: c.gender ?? '',
    cccd: c.idNumber ?? '',
    cccd_ngay_cap: fmtDateKey(c.idIssueDate),
    cccd_noi_cap: c.idIssuePlace ?? '',
    thuong_tru: c.permanentAddress ?? '',
    cho_o: c.currentAddress || c.permanentAddress || '',
    dien_thoai: c.phone ?? '',
    email: c.email ?? '',
    gplx: c.licenseNumber ?? '',
    gplx_hang: c.licenseClass ?? '',
    gplx_han: c.licenseExpiry ? fmtDateKey(c.licenseExpiry) : 'Không thời hạn',
    lien_he_khan: [c.emergencyName, c.emergencyRelation && `(${c.emergencyRelation})`, c.emergencyPhone].filter(Boolean).join(' '),
  };
}

function handoverFields(h: Handover | undefined, checklistItems: string[]) {
  if (!h) return { thoi_gian: '', odo: '', xang: '', ghi_chu: '', giay_to: [], hu_hong: [] };
  return {
    thoi_gian: fmtDateTime(h.at),
    odo: fmtNumber(h.odo),
    xang: fuel(h.fuelLevel),
    ghi_chu: h.notes ?? '',
    giay_to: checklistItems.map((ten) => ({ ten, co: h.checklist[ten] ? 'Có' : 'Không' })),
    hu_hong: h.damages.map((d) => ({ vi_tri: d.zone, mo_ta: d.note })),
  };
}

/** Làm phẳng { khach: { ho_ten } } → { 'khach.ho_ten': … }. Mảng giữ nguyên. */
function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    // Chuỗi rỗng → null để mẫu in dòng chấm "……" cho người ký điền tay.
    else out[key] = v === '' ? null : v;
  }
  return out;
}

export function buildTemplateData(rentalId: number): Record<string, unknown> {
  const d = rentalDetail(rentalId);
  const biz = getSetting('business');
  const rules = getSetting('rules');
  const pricing = rentalPricing(d.rental);
  const r = d.rental;
  const v = d.vehicle;
  const pickupHo = d.handovers.find((h) => h.kind === 'pickup');
  const returnHo = [...d.handovers].reverse().find((h) => h.kind === 'return');
  const plan = planSettlement(d.money, rules.fineHoldAmount);
  // Phụ kiện: theo biên bản giao xe nếu đã giao, chưa giao thì theo danh sách hiện tại của xe.
  const accGiao: HandoverAccessory[] = pickupHo?.accessories?.length ? pickupHo.accessories : handoverAccessoryTemplate(v.id).map((a) => ({ ...a, present: false }));
  const accNhan = returnHo?.accessories ?? [];
  const yesNo = (x: boolean | undefined, checked: boolean) => (!checked ? '☐' : x ? 'Có' : 'Không');
  const giaoChecked = !!pickupHo?.accessories?.length;
  const start = r.actualStart ?? r.scheduledStart;
  const end = r.actualEnd ?? r.scheduledEnd;

  const data = {
    ben_a: {
      ten: biz.name,
      dai_dien: biz.representative,
      chuc_vu: biz.position,
      cccd: biz.idNumber,
      cccd_ngay_cap: fmtDateKey(biz.idIssueDate),
      cccd_noi_cap: biz.idIssuePlace,
      dia_chi: biz.address,
      dien_thoai: biz.phone,
      mst: biz.taxCode,
      stk: biz.bankAccount,
      ngan_hang: biz.bankName,
      chu_tk: biz.bankAccountName,
    },
    khach: customerFields(d.customer),
    lai_phu: d.drivers.map((c) => customerFields(c)),
    co_lai_phu: d.drivers.length > 0,
    xe: {
      bien_so: v.plate,
      hang: v.make,
      dong: v.model,
      nam: v.year ?? '',
      mau: v.color ?? '',
      so_cho: v.seats ?? '',
      hop_so: v.transmission ? TRANSMISSION_LABEL[v.transmission] : '',
      nhien_lieu: v.fuel ? FUEL_LABEL[v.fuel] : '',
      so_khung: v.vin ?? '',
      so_may: v.engineNo ?? '',
    },
    hd: {
      so: r.code,
      ngay_ky: vnDateLong(r.createdAt),
      noi_ky: biz.signCity,
      nhan_xe: fmtDateTime(r.scheduledStart),
      tra_xe: fmtDateTime(r.scheduledEnd),
      thoi_gian: fmtDuration(r.scheduledEnd - r.scheduledStart),
      hinh_thuc: quoteRental(r.scheduledStart, r.scheduledEnd, pricing, rules).mode === 'month' ? 'theo tháng' : 'theo ngày',
      km_gioi_han: r.kmLimit ? fmtNumber(r.kmLimit) : 'Không giới hạn',
      noi_giao: r.pickupLocation || biz.address,
      noi_tra: r.returnLocation || r.pickupLocation || biz.address,
      ghi_chu: r.notes ?? '',
    },
    gia: {
      ngay: money(pricing.priceDay),
      cuoi_tuan: money(pricing.priceWeekendDay || pricing.priceDay),
      gio: money(pricing.priceHour),
      vuot_km: money(pricing.overKmFee),
      qua_gio: money(pricing.overHourFee || pricing.priceHour),
      thang: money(pricing.priceMonth || null),
      km_thang: pricing.priceMonth ? (monthKmLimit(pricing) ? fmtNumber(monthKmLimit(pricing)) : 'Không giới hạn') : '',
    },
    co_gia_thang: !!pricing.priceMonth,
    tien: {
      tong: money(d.money.totalCharges),
      tong_chu: vndInWords(d.money.totalCharges),
      coc: money(r.depositRequired),
      coc_chu: vndInWords(r.depositRequired),
      coc_da_nhan: money(d.money.depositReceived),
      da_tra: money(d.money.rentPaid),
      con_lai: money(Math.max(0, d.money.due)),
      giu_coc: money(r.fineHoldAmount || rules.fineHoldAmount),
      giu_coc_ngay: rules.fineHoldDays,
    },
    khoan: d.charges.map((c) => ({ loai: CHARGE_KIND_LABEL[c.kind], mo_ta: c.description, so_tien: money(c.amount) })),
    phu_kien: accGiao.filter((a) => !giaoChecked || a.present).map((a) => ({ ten: a.name, so_luong: a.quantity, gia_tri: money(a.value), ghi_chu: a.note ?? '' })),
    co_phu_kien: accGiao.length > 0,
    the_chap: d.collaterals.map((c) => ({ loai: COLLATERAL_KIND_LABEL[c.kind], mo_ta: c.description })),
    co_the_chap: d.collaterals.length > 0,
    giao: {
      ...handoverFields(pickupHo, rules.checklist),
      phu_kien: accGiao.map((a) => ({ ten: a.name, so_luong: a.quantity, gia_tri: money(a.value), co: yesNo(a.present, giaoChecked), ghi_chu: a.note ?? '' })),
    },
    nhan: {
      ...handoverFields(returnHo, rules.checklist),
      phu_kien: (accNhan.length ? accNhan : accGiao.filter((a) => !giaoChecked || a.present)).map((a) => {
        const atPickup = accGiao.find((g) => (g.id != null && g.id === a.id) || g.name === a.name);
        return {
          ten: a.name,
          so_luong: a.quantity,
          gia_tri: money(a.value),
          luc_giao: yesNo(atPickup?.present, giaoChecked),
          luc_nhan: yesNo(a.present, accNhan.length > 0),
          ghi_chu: a.note ?? '',
        };
      }),
      km_da_di: pickupHo && returnHo ? fmtNumber(returnHo.odo - pickupHo.odo) : '',
      hu_hong: returnHo ? returnHo.damages.filter((x) => x.isNew).map((x) => ({ vi_tri: x.zone, mo_ta: x.note })) : [],
    },
    qt: {
      phai_tra: money(d.money.totalCharges),
      da_tra: money(d.money.rentPaid),
      coc_dang_giu: money(d.money.depositHeld),
      can_tru: money(plan.offset),
      thu_them: money(plan.collect),
      hoan_coc: money(plan.refundDeposit),
      giu_coc: money(plan.keepHold),
    },
    thoi_gian_thuc: `${fmtDateTime(start)} → ${fmtDateTime(end)}`,
    ngay_in: fmtDateTime(Date.now()),
    ngay_in_ngan: fmtDate(Date.now()),
  };
  return flatten(data);
}

// ── Render + PDF ─────────────────────────────────────────────────────────────

export function renderDocx(template: Buffer, data: Record<string, unknown>): Buffer {
  let zip: PizZip;
  try {
    zip = new PizZip(template);
  } catch {
    throw badRequest('File mẫu không phải .docx hợp lệ');
  }
  try {
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Biến trống → chừa dòng chấm để điền tay khi in.
      nullGetter: (part) => (part.module ? '' : '……………'),
    });
    doc.render(data);
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  } catch (err) {
    const e = err as { properties?: { errors?: { properties?: { explanation?: string } }[] } };
    const detail = e.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean).join('; ');
    throw badRequest(`Mẫu Word có lỗi cú pháp biến: ${detail || (err as Error).message}`);
  }
}

/** Kiểm tra mẫu ngay lúc tải lên: render thử với dữ liệu rỗng. */
export function validateTemplate(template: Buffer): void {
  renderDocx(template, {});
}

export async function convertToPdf(docx: Buffer): Promise<Buffer> {
  if (!config.gotenbergUrl) throw new Error('Chưa cấu hình dịch vụ chuyển PDF (GOTENBERG_URL)');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(docx)], { type: DOCX_MIME }), 'document.docx');
  const res = await fetch(`${config.gotenbergUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Dịch vụ PDF trả lỗi HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function pdfServiceStatus(): Promise<'ok' | 'down' | 'disabled'> {
  if (!config.gotenbergUrl) return 'disabled';
  try {
    const res = await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

export function getTemplate(id: number): ContractTemplate {
  const t = db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, id)).get();
  if (!t) throw notFound('Không tìm thấy mẫu');
  return t;
}

export function defaultTemplate(kind: TemplateKind): ContractTemplate | undefined {
  return (
    db
      .select()
      .from(schema.contractTemplates)
      .where(and(eq(schema.contractTemplates.kind, kind), eq(schema.contractTemplates.isDefault, true), eq(schema.contractTemplates.active, true)))
      .get() ??
    db
      .select()
      .from(schema.contractTemplates)
      .where(and(eq(schema.contractTemplates.kind, kind), eq(schema.contractTemplates.active, true)))
      .get()
  );
}

export async function generateDocument(rentalId: number, templateId: number, userId: number) {
  const tpl = getTemplate(templateId);
  const data = buildTemplateData(rentalId);
  const docx = renderDocx(readFileData(getFileRow(tpl.fileId)), data);
  const code = String(data['hd.so'] ?? rentalId);
  const baseName = `${code} - ${tpl.name}`;
  const docxFile = saveBinary(docx, DOCX_MIME, { kind: 'document_docx', originalName: `${baseName}.docx`, userId });
  let pdfFileId: string | null = null;
  let pdfError: string | null = null;
  try {
    const pdf = await convertToPdf(docx);
    pdfFileId = saveBinary(pdf, 'application/pdf', { kind: 'document_pdf', originalName: `${baseName}.pdf`, userId }).id;
  } catch (err) {
    pdfError = (err as Error).message;
  }
  const row = db
    .insert(schema.documents)
    .values({
      rentalId,
      templateId: tpl.id,
      templateName: tpl.name,
      templateVersion: tpl.version,
      kind: tpl.kind,
      docxFileId: docxFile.id,
      pdfFileId,
      sha256: docxFile.sha256,
      data,
      scanFileIds: [],
      createdBy: userId,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  return { document: row, pdfError };
}

/** Thử chuyển PDF lại cho văn bản đã sinh (file .docx giữ nguyên, không render lại). */
export async function retryPdf(documentId: number, userId: number) {
  const doc = db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).get();
  if (!doc) throw notFound('Không tìm thấy văn bản');
  if (doc.pdfFileId) return doc;
  const docxRow = getFileRow(doc.docxFileId);
  const pdf = await convertToPdf(readFileData(docxRow));
  const name = (docxRow.originalName ?? 'document.docx').replace(/\.docx$/i, '.pdf');
  const pdfRow = saveBinary(pdf, 'application/pdf', { kind: 'document_pdf', originalName: name, userId });
  return db.update(schema.documents).set({ pdfFileId: pdfRow.id }).where(eq(schema.documents.id, doc.id)).returning().get();
}

// ── Mẫu dựng sẵn ─────────────────────────────────────────────────────────────

/**
 * Mẫu dựng sẵn. Tăng `rev` khi sửa nội dung mẫu: máy đang chạy sẽ tự lên mẫu mới
 * (thành phiên bản mới của mẫu) — trừ khi người dùng đã thay file mẫu đó (builtin = "<key>-user").
 */
const BUILTINS: { key: string; rev: number; file: string; name: string; kind: TemplateKind }[] = [
  { key: 'contract', rev: 3, file: 'hop-dong-thue-xe.docx', name: 'Hợp đồng thuê xe tự lái', kind: 'contract' },
  { key: 'pickup', rev: 3, file: 'bien-ban-giao-xe.docx', name: 'Biên bản giao xe', kind: 'pickup' },
  { key: 'return', rev: 3, file: 'bien-ban-nhan-xe.docx', name: 'Biên bản nhận xe & quyết toán', kind: 'return' },
];

export function builtinTemplatePath(file: string): string {
  return path.join(config.assetsDir, 'templates', file);
}

/** Đăng ký mẫu dựng sẵn lần đầu; nâng cấp mẫu dựng sẵn cũ khi app có bản mẫu mới. */
export function ensureBuiltinTemplates(): void {
  for (const b of BUILTINS) {
    const tag = `${b.key}-v${b.rev}`;
    const p = builtinTemplatePath(b.file);
    if (!fs.existsSync(p)) continue;
    const existing = db.select().from(schema.contractTemplates).where(like(schema.contractTemplates.builtin, `${b.key}-%`)).get();
    // Đã đúng bản, hoặc người dùng đã thay file ("<key>-user") → không đụng tới.
    if (existing && (existing.builtin === tag || existing.builtin?.endsWith('-user'))) continue;
    const now = Date.now();
    const file = saveBinary(fs.readFileSync(p), DOCX_MIME, { kind: 'template', originalName: b.file });
    if (existing) {
      db.update(schema.contractTemplates)
        .set({ fileId: file.id, version: existing.version + 1, builtin: tag, updatedAt: now })
        .where(eq(schema.contractTemplates.id, existing.id))
        .run();
      continue;
    }
    const hasDefault = db
      .select()
      .from(schema.contractTemplates)
      .where(and(eq(schema.contractTemplates.kind, b.kind), eq(schema.contractTemplates.isDefault, true)))
      .get();
    db.insert(schema.contractTemplates)
      .values({ name: b.name, kind: b.kind, fileId: file.id, version: 1, isDefault: !hasDefault, active: true, builtin: tag, createdAt: now, updatedAt: now })
      .run();
  }
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
