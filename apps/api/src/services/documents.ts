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
import { and, asc, eq, isNull, like } from 'drizzle-orm';
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
  RENTAL_CHANNEL_LABEL,
  TRANSMISSION_LABEL,
  type RentalChannel,
  type TemplateKind,
} from '../shared/constants.js';
import { cancelPolicyText, channelMoney, planSettlement, rentalFineHold } from '../shared/money.js';
import { chargeDays, freeChargesFor, monthKmLimit, quoteRental, rentalChargingPolicy, tripChargingText } from '../shared/pricing.js';
import { fmtNumber, vndInWords } from '../shared/text.js';
import { DAY_MS, fmtDate, fmtDateKey, fmtDateTime, fmtDuration, vnDateLong, vnParts } from '../shared/time.js';
import { rentalAccessoryPlan } from './accessories.js';
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
      { key: 'khach.gplx_ngay_cap', label: 'Ngày cấp GPLX' },
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
      { key: 'gia.sac', label: 'Xe điện — lượt sạc miễn phí, phụ thu, tiền điện (điều kiện {#co_sac}…{/co_sac})' },
      { key: 'gia.sac_mien_phi', label: 'Xe điện — số lượt sạc miễn phí của chuyến này (theo số ngày thuê)' },
      { key: 'gia.phi_sac', label: 'Xe điện — phí mỗi lượt cắm-rút sạc (đ)' },
      { key: 'hd.hinh_thuc', label: 'Hình thức thuê: "theo ngày" / "theo tháng"' },
      { key: 'tien.tong', label: 'Tổng tiền' },
      { key: 'tien.tong_chu', label: 'Tổng tiền bằng chữ' },
      { key: 'tien.coc', label: 'Tiền cọc thỏa thuận (điều kiện {#co_coc}…{/co_coc} khi có cọc, {^co_coc}…{/co_coc} khi không cọc)' },
      { key: 'tien.coc_chu', label: 'Tiền cọc bằng chữ' },
      { key: 'tien.coc_da_nhan', label: 'Tiền cọc đã nhận' },
      { key: 'tien.da_tra', label: 'Đã thanh toán' },
      { key: 'tien.con_lai', label: 'Còn phải trả' },
      { key: 'tien.giu_coc', label: 'Số tiền cọc giữ chờ phạt nguội, thỏa thuận khi đặt xe (điều kiện {#co_giu_coc}…{/co_giu_coc})' },
      { key: 'tien.giu_coc_ngay', label: 'Số ngày giữ cọc' },
      { key: 'tien.chinh_sach_huy', label: 'Chính sách hủy thuê (mất cọc khi hủy sát giờ)' },
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
      { key: 'qt.giu_coc', label: 'Giữ lại chờ phạt nguội (điều kiện {#co_qt_giu_coc}…{/co_qt_giu_coc})' },
      { key: 'qt.giu_coc_ngay', label: 'Số ngày giữ lại' },
    ],
  },
  {
    group: 'Phụ lục gia hạn — lần gia hạn gần nhất (điều kiện {#co_gia_han}…{/co_gia_han})',
    fields: [
      { key: 'gia_han.so', label: 'Số phụ lục (HD-2026-0001-PL01)' },
      { key: 'gia_han.lan', label: 'Lần gia hạn thứ' },
      { key: 'gia_han.ngay', label: 'Ngày lập dạng "ngày 06 tháng 10 năm 2026"' },
      { key: 'gia_han.tra_cu', label: 'Giờ trả xe trước khi gia hạn' },
      { key: 'gia_han.tra_moi', label: 'Giờ trả xe mới' },
      { key: 'gia_han.thay_doi', label: 'Thay đổi (vd "thêm 2 ngày")' },
      { key: 'gia_han.km_cu', label: 'Giới hạn km trước khi gia hạn' },
      { key: 'gia_han.km_moi', label: 'Giới hạn km mới' },
      { key: 'gia_han.tien_cu', label: 'Tổng tiền trước khi gia hạn' },
      { key: 'gia_han.tien_moi', label: 'Tổng tiền sau khi gia hạn' },
      { key: 'gia_han.tang_giam', label: '"tăng thêm" / "giảm"' },
      { key: 'gia_han.tien_them', label: 'Số tiền tăng thêm / giảm' },
      { key: 'gia_han.tien_them_chu', label: 'Số tiền tăng thêm / giảm bằng chữ' },
    ],
  },
  {
    group: 'Kênh đặt xe (mẫu Mioto)',
    fields: [
      { key: 'kenh.ten', label: '"Trực tiếp" / "Mioto"' },
      { key: 'kenh.ma_chuyen', label: 'Mã chuyến trên app (chưa nhập thì mã hợp đồng của app)' },
      { key: 'kenh.gia_tri', label: 'Giá trị hợp đồng = tiền thuê trên app (đ)' },
      { key: 'kenh.gia_tri_chu', label: 'Giá trị hợp đồng bằng chữ' },
      { key: 'kenh.don_gia', label: 'Đơn giá thuê/ngày trên app (đ)' },
      { key: 'kenh.tra_truoc', label: 'Khách đã trả trước qua app (đ)' },
      { key: 'kenh.o_40', label: '☒ nếu khách trả trước một phần qua app, ☐ nếu không' },
      { key: 'kenh.o_100', label: '☒ nếu khách trả 100% qua app, ☐ nếu không' },
      { key: 'ben_a.ho_ten', label: 'Bên A là cá nhân: họ tên người đại diện' },
      { key: 'ben_a.thuong_tru', label: 'Địa chỉ thường trú người đại diện' },
      { key: 'ben_a.tam_tru', label: 'Địa chỉ tạm trú người đại diện (trống = địa chỉ cửa hàng)' },
      { key: 'khach.can_cuoc', label: 'Số CCCD/căn cước (trống nếu khách dùng hộ chiếu); kèm _ngay_cap, _noi_cap' },
      { key: 'khach.ho_chieu', label: 'Số hộ chiếu (trống nếu khách dùng CCCD); kèm _ngay_cap, _noi_cap' },
      { key: 'khach.gplx_noi_cap', label: 'Nơi cấp GPLX' },
      { key: 'xe.ten', label: 'Hãng + dòng xe' },
      { key: 'xe.dang_ky_so', label: 'Số giấy đăng ký xe (cà vẹt)' },
      { key: 'xe.dang_ky_ngay', label: 'Ngày cấp đăng ký xe' },
      { key: 'xe.dang_ky_noi', label: 'Nơi cấp đăng ký xe' },
      { key: 'xe.chu_xe', label: 'Tên chủ xe theo đăng ký' },
      { key: 'hd.nhan_gio', label: 'Giờ nhận xe (hẹn) — kèm hd.nhan_phut, hd.nhan_ngay (dd/mm/yyyy)' },
      { key: 'hd.tra_gio', label: 'Giờ trả xe (hẹn) — kèm hd.tra_phut, hd.tra_ngay' },
      { key: 'hd.ngay_giao', label: 'Ngày giao xe dd/mm/yyyy (ngày ký hợp đồng Mioto)' },
      { key: 'hd.ngay_giao_dai', label: 'Ngày giao xe dạng "ngày 06 tháng 10 năm 2026"' },
      { key: 'giao.gio_phut', label: 'Lúc giao xe dạng "14 giờ 30" (cũng có nhan.gio_phut)' },
      { key: 'giao.ngay', label: 'Ngày giao xe dd/mm/yyyy (cũng có nhan.ngay)' },
      { key: 'giao.odo_km', label: 'ODO lúc giao, để trống nếu chưa giao (cho ô vuông)' },
      { key: 'giao.xang_muc', label: 'Mức xăng/pin lúc giao, để trống nếu chưa giao (cho ô vuông)' },
      { key: 'giao.hh_1', label: 'Dòng hư hỏng có sẵn 1…6 (giao.hh_1 … giao.hh_6; nhan.hh_1 … nhan.hh_6 = hư hỏng mới)' },
      { key: 'giao.o_binh_thuong', label: '"X" nếu lúc giao xe không ghi hư hỏng nào' },
      { key: 'nhan.o_giong', label: '"X" nếu lúc nhận xe không có hư hỏng mới' },
      { key: 'tc.o_mien', label: '"X" nếu miễn thế chấp (đã giao xe, không cọc, không tài sản)' },
      { key: 'tc.o_co', label: '"X" nếu có thế chấp' },
      { key: 'tc.giay_to', label: 'Giấy tờ thế chấp' },
      { key: 'tc.xe_may', label: 'Xe máy thế chấp' },
      { key: 'tc.ca_vet', label: 'Cà vẹt xe máy' },
      { key: 'tc.tien_mat', label: 'Tiền cọc' },
      { key: 'tc.khac', label: 'Tài sản thế chấp khác' },
      { key: 'nhan.o_tra_du', label: '"X" nếu đã trả khách toàn bộ giấy tờ, tài sản, tiền cọc' },
      { key: 'nhan.thieu_1', label: 'Giấy tờ / tài sản / cọc chưa trả khách, dòng 1…4 (nhan.thieu_1 … nhan.thieu_4)' },
    ],
  },
  { group: 'Khác', fields: [{ key: 'ngay_in', label: 'Thời điểm in' }] },
];

// ── Dựng dữ liệu cho mẫu ─────────────────────────────────────────────────────

const money = (n: number | null | undefined) => (n == null ? '' : fmtNumber(n));
const fuel = (n: number | null | undefined) => (n == null ? '' : `${n}%`);
const p2 = (n: number) => String(n).padStart(2, '0');
/** Chữ trong ô vuông vẽ sẵn của mẫu Mioto: dấu X, hoặc khoảng trắng (không để chuỗi rỗng — sẽ thành dòng chấm). */
const mark = (b: boolean) => (b ? 'X' : ' ');
/** Ô ☐ in sẵn trong mẫu. */
const tick = (b: boolean) => (b ? '☒' : '☐');
/** Đúng `n` dòng (mẫu Mioto có số dòng cố định trong khung): thừa thì gộp vào dòng cuối, thiếu thì để trống. */
function fixedLines(items: string[], n: number): string[] {
  const out = items.slice(0, n);
  if (items.length > n) out[n - 1] = items.slice(n - 1).join('; ');
  while (out.length < n) out.push(' ');
  return out;
}
const numbered = (prefix: string, xs: string[]) => Object.fromEntries(xs.map((x, i) => [`${prefix}_${i + 1}`, x]));

function customerFields(c: Customer) {
  const passport = c.idCardType === 'passport';
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
    gplx_ngay_cap: fmtDateKey(c.licenseIssueDate),
    gplx_noi_cap: c.licenseIssuePlace ?? '',
    lien_he_khan: [c.emergencyName, c.emergencyRelation && `(${c.emergencyRelation})`, c.emergencyPhone].filter(Boolean).join(' '),
    can_cuoc: passport ? '' : (c.idNumber ?? ''),
    can_cuoc_ngay_cap: passport ? '' : fmtDateKey(c.idIssueDate),
    can_cuoc_noi_cap: passport ? '' : (c.idIssuePlace ?? ''),
    ho_chieu: passport ? (c.idNumber ?? '') : '',
    ho_chieu_ngay_cap: passport ? fmtDateKey(c.idIssueDate) : '',
    ho_chieu_noi_cap: passport ? (c.idIssuePlace ?? '') : '',
  };
}

function handoverFields(h: Handover | undefined, checklistItems: string[]) {
  // odo_km / xang_muc: in trong ô vuông của mẫu Mioto → chưa có thì để trống, không in dòng chấm.
  if (!h) return { thoi_gian: '', odo: '', xang: '', ghi_chu: '', giay_to: [], hu_hong: [], gio_phut: '', ngay: '', odo_km: ' ', xang_muc: ' ' };
  const t = vnParts(h.at);
  return {
    thoi_gian: fmtDateTime(h.at),
    odo: fmtNumber(h.odo),
    xang: fuel(h.fuelLevel),
    ghi_chu: h.notes ?? '',
    giay_to: checklistItems.map((ten) => ({ ten, co: h.checklist[ten] ? 'Có' : 'Không' })),
    hu_hong: h.damages.map((d) => ({ vi_tri: d.zone, mo_ta: d.note })),
    gio_phut: `${p2(t.hour)} giờ ${p2(t.minute)}`,
    ngay: fmtDate(h.at),
    odo_km: fmtNumber(h.odo),
    xang_muc: fuel(h.fuelLevel),
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
  const charging = rentalChargingPolicy(pricing, v);
  const tripDays = chargeDays(r.scheduledStart, r.scheduledEnd, rules.graceMinutes);
  const pickupHo = d.handovers.find((h) => h.kind === 'pickup');
  const returnHo = [...d.handovers].reverse().find((h) => h.kind === 'return');
  const hold = rentalFineHold(r, rules);
  const plan = planSettlement(d.money, hold.amount);
  // Đã quyết toán thì lấy đúng số ngày đã giữ, chưa thì theo thỏa thuận.
  const holdDays = r.fineHoldUntil && r.actualEnd ? Math.round((r.fineHoldUntil - r.actualEnd) / DAY_MS) : hold.days;
  // Phụ kiện: theo biên bản giao xe nếu đã giao, chưa giao thì theo danh sách thỏa thuận lúc đặt xe (bỏ món không kèm).
  const accGiao: HandoverAccessory[] = pickupHo?.accessories?.length
    ? pickupHo.accessories
    : rentalAccessoryPlan(r)
        .filter((a) => a.present)
        .map((a) => ({ ...a, present: false }));
  const accNhan = returnHo?.accessories ?? [];
  const yesNo = (x: boolean | undefined, checked: boolean) => (!checked ? '☐' : x ? 'Có' : 'Không');
  const giaoChecked = !!pickupHo?.accessories?.length;
  const start = r.actualStart ?? r.scheduledStart;
  const end = r.actualEnd ?? r.scheduledEnd;
  const ext = d.extensions.at(-1);
  const kmText = (n: number) => (n ? fmtNumber(n) : 'Không giới hạn');

  // Mẫu Mioto: giá trị hợp đồng là tiền thuê trên app; ô trả trước 40% / 100% theo tiền khách trả qua app.
  // TUYỆT ĐỐI không đưa phí sàn vào đây — dữ liệu này in ra và lưu kèm văn bản.
  const rentTotal = d.charges.filter((c) => c.kind === 'rental').reduce((s, c) => s + c.amount, 0);
  const contractValue = r.channel !== 'direct' && r.channelPrice != null ? r.channelPrice : rentTotal;
  const dayPrice = r.channel !== 'direct' ? (r.channelDayPrice ?? Math.round(contractValue / Math.max(1, tripDays) / 1000) * 1000) : pricing.priceDay;
  const prepaid = channelMoney(r, d.payments)?.prepaid ?? 0;
  const sp = vnParts(r.scheduledStart);
  const ep = vnParts(r.scheduledEnd);
  const giaoDamages = pickupHo ? pickupHo.damages.map((x) => [x.zone, x.note].filter(Boolean).join(': ')) : [];
  const nhanDamages = returnHo ? returnHo.damages.filter((x) => x.isNew).map((x) => [x.zone, x.note].filter(Boolean).join(': ')) : [];
  const collOf = (k: string) =>
    d.collaterals
      .filter((c) => c.kind === k)
      .map((c) => c.description)
      .join('; ');
  const depositCash = d.money.depositReceived || r.depositRequired;
  const hasCollateral = d.collaterals.length > 0 || depositCash > 0;
  // Lúc nhận xe: giấy tờ / tài sản / cọc chưa trả lại khách.
  const notReturned = returnHo
    ? [
        ...d.collaterals.filter((c) => !c.returnedAt).map((c) => `${COLLATERAL_KIND_LABEL[c.kind]}: ${c.description}`),
        // Ngắn gọn: in trong một dòng của bảng biên bản Mioto.
        ...(d.money.depositHeld > 0 ? [`Tiền cọc ${fmtNumber(d.money.depositHeld)} đ${r.fineHoldUntil ? `, giữ đến ${fmtDate(r.fineHoldUntil)}` : ''}`] : []),
      ]
    : [];

  const data = {
    kenh: {
      ten: RENTAL_CHANNEL_LABEL[r.channel],
      ma_chuyen: r.channelRef || r.code,
      gia_tri: money(contractValue),
      gia_tri_chu: vndInWords(contractValue),
      don_gia: money(dayPrice),
      tra_truoc: money(prepaid),
      o_40: tick(prepaid > 0 && prepaid < contractValue),
      o_100: tick(contractValue > 0 && prepaid >= contractValue),
    },
    tc: {
      giay_to: collOf('document'),
      xe_may: collOf('motorbike'),
      ca_vet: d.collaterals.some((c) => c.kind === 'motorbike') ? 'kèm xe máy nêu trên' : '',
      tien_mat: depositCash > 0 ? `${fmtNumber(depositCash)} đồng` : '',
      khac: collOf('other'),
      o_mien: mark(!!pickupHo && !hasCollateral),
      o_co: mark(hasCollateral),
    },
    ben_a: {
      ten: biz.name,
      ho_ten: biz.representative || biz.name,
      thuong_tru: biz.permanentAddress,
      tam_tru: biz.currentAddress || biz.address,
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
      ten: [v.make, v.model].filter(Boolean).join(' '),
      dang_ky_so: v.regNumber ?? '',
      dang_ky_ngay: fmtDateKey(v.regDate),
      dang_ky_noi: v.regPlace ?? '',
      chu_xe: v.regOwner || (v.ownerType === 'consigned' ? (v.ownerName ?? '') : biz.representative),
    },
    hd: {
      so: r.code,
      ngay_ky: vnDateLong(r.createdAt),
      noi_ky: biz.signCity,
      nhan_xe: fmtDateTime(r.scheduledStart),
      tra_xe: fmtDateTime(r.scheduledEnd),
      nhan_gio: p2(sp.hour),
      nhan_phut: p2(sp.minute),
      nhan_ngay: fmtDate(r.scheduledStart),
      tra_gio: p2(ep.hour),
      tra_phut: p2(ep.minute),
      tra_ngay: fmtDate(r.scheduledEnd),
      ngay_giao: fmtDate(start),
      ngay_giao_dai: vnDateLong(start),
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
      sac: charging ? tripChargingText(charging, tripDays, (n) => `${fmtNumber(n)} đồng`) : '',
      sac_mien_phi: charging ? freeChargesFor(charging, tripDays) : '',
      phi_sac: money(charging?.fee || null),
    },
    co_gia_thang: !!pricing.priceMonth,
    co_sac: !!charging,
    tien: {
      tong: money(d.money.totalCharges),
      tong_chu: vndInWords(d.money.totalCharges),
      coc: money(r.depositRequired),
      coc_chu: vndInWords(r.depositRequired),
      coc_da_nhan: money(d.money.depositReceived),
      da_tra: money(d.money.rentPaid),
      con_lai: money(Math.max(0, d.money.due)),
      giu_coc: money(hold.amount),
      giu_coc_ngay: hold.days,
      chinh_sach_huy: cancelPolicyText(rules, r.depositRequired > 0),
    },
    co_coc: r.depositRequired > 0,
    co_giu_coc: hold.amount > 0 && hold.days > 0,
    khoan: d.charges.map((c) => ({ loai: CHARGE_KIND_LABEL[c.kind], mo_ta: c.description, so_tien: money(c.amount) })),
    phu_kien: accGiao.filter((a) => !giaoChecked || a.present).map((a) => ({ ten: a.name, so_luong: a.quantity, gia_tri: money(a.value), ghi_chu: a.note ?? '' })),
    co_phu_kien: accGiao.length > 0,
    the_chap: d.collaterals.map((c) => ({ loai: COLLATERAL_KIND_LABEL[c.kind], mo_ta: c.description })),
    co_the_chap: d.collaterals.length > 0,
    giao: {
      ...handoverFields(pickupHo, rules.checklist),
      phu_kien: accGiao.map((a) => ({ ten: a.name, so_luong: a.quantity, gia_tri: money(a.value), co: yesNo(a.present, giaoChecked), ghi_chu: a.note ?? '' })),
      ...numbered('hh', fixedLines(giaoDamages, 6)),
      o_binh_thuong: mark(!!pickupHo && giaoDamages.length === 0),
    },
    nhan: {
      ...handoverFields(returnHo, rules.checklist),
      ...numbered('hh', fixedLines(nhanDamages, 6)),
      ...numbered('thieu', fixedLines(notReturned, 4)),
      o_giong: mark(!!returnHo && nhanDamages.length === 0),
      o_tra_du: mark(!!returnHo && notReturned.length === 0),
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
      giu_coc_ngay: holdDays,
    },
    co_qt_giu_coc: plan.keepHold > 0,
    gia_han: ext
      ? {
          so: `${r.code}-PL${String(ext.seq).padStart(2, '0')}`,
          lan: ext.seq,
          ngay: vnDateLong(ext.createdAt),
          tra_cu: fmtDateTime(ext.oldEnd),
          tra_moi: fmtDateTime(ext.newEnd),
          thay_doi: ext.newEnd >= ext.oldEnd ? `thêm ${fmtDuration(ext.newEnd - ext.oldEnd)}` : `rút ngắn ${fmtDuration(ext.oldEnd - ext.newEnd)}`,
          km_cu: kmText(ext.oldKmLimit),
          km_moi: kmText(ext.newKmLimit),
          tien_cu: money(ext.oldTotal),
          tien_moi: money(ext.newTotal),
          tang_giam: ext.newTotal >= ext.oldTotal ? 'tăng thêm' : 'giảm',
          tien_them: money(Math.abs(ext.newTotal - ext.oldTotal)),
          tien_them_chu: vndInWords(Math.abs(ext.newTotal - ext.oldTotal)),
        }
      : {},
    co_gia_han: !!ext,
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

/** Mẫu mặc định của loại văn bản cho kênh của lượt; kênh chưa có mẫu loại này (vd phụ lục gia hạn Mioto) thì dùng mẫu trực tiếp. */
export function defaultTemplate(kind: TemplateKind, channel: RentalChannel = 'direct'): ContractTemplate | undefined {
  const t = schema.contractTemplates;
  const forChannel = (c: RentalChannel) => {
    const ch = c === 'direct' ? isNull(t.channel) : eq(t.channel, c);
    return (
      db.select().from(t).where(and(eq(t.kind, kind), ch, eq(t.isDefault, true), eq(t.active, true))).get() ??
      db.select().from(t).where(and(eq(t.kind, kind), ch, eq(t.active, true))).orderBy(asc(t.id)).get()
    );
  };
  return (channel !== 'direct' ? forChannel(channel) : undefined) ?? forChannel('direct');
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
const BUILTINS: { key: string; rev: number; file: string; name: string; kind: TemplateKind; channel?: RentalChannel }[] = [
  { key: 'contract', rev: 6, file: 'hop-dong-thue-xe.docx', name: 'Hợp đồng thuê xe tự lái', kind: 'contract' },
  { key: 'pickup', rev: 3, file: 'bien-ban-giao-xe.docx', name: 'Biên bản giao xe', kind: 'pickup' },
  { key: 'return', rev: 4, file: 'bien-ban-nhan-xe.docx', name: 'Biên bản nhận xe & quyết toán', kind: 'return' },
  { key: 'extension', rev: 1, file: 'phu-luc-gia-han.docx', name: 'Phụ lục gia hạn hợp đồng', kind: 'extension' },
  // Mẫu của Mioto (sinh từ file gốc: npm run templates -w apps/api). Biên bản Mioto gộp giao + nhận xe:
  // in lúc giao thì phần hoàn trả để trống viết tay, in lúc nhận xe thì điền đủ cả hai phần.
  { key: 'mioto-contract', rev: 1, file: 'mioto-hop-dong.docx', name: 'Hợp đồng Mioto', kind: 'contract', channel: 'mioto' },
  { key: 'mioto-pickup', rev: 1, file: 'mioto-bien-ban.docx', name: 'Biên bản bàn giao Mioto (giao xe)', kind: 'pickup', channel: 'mioto' },
  { key: 'mioto-return', rev: 1, file: 'mioto-bien-ban.docx', name: 'Biên bản bàn giao Mioto (nhận xe)', kind: 'return', channel: 'mioto' },
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
    const t = schema.contractTemplates;
    const hasDefault = db
      .select()
      .from(t)
      .where(and(eq(t.kind, b.kind), b.channel ? eq(t.channel, b.channel) : isNull(t.channel), eq(t.isDefault, true)))
      .get();
    db.insert(t)
      .values({ name: b.name, kind: b.kind, channel: b.channel ?? null, fileId: file.id, version: 1, isDefault: !hasDefault, active: true, builtin: tag, createdAt: now, updatedAt: now })
      .run();
  }
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
