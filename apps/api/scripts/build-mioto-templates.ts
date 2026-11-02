// Sinh mẫu Word cho lượt đặt qua Mioto từ file gốc của Mioto (scripts/mioto/*.docx) vào assets/templates/.
// Chạy cùng mẫu dựng sẵn:  npm run templates -w apps/api  — sửa xong nhớ tăng `rev` của mẫu mioto-* trong BUILTINS.
//
// Giữ nguyên trình bày của Mioto: tìm đoạn theo chữ trong file gốc rồi thay chỗ trống bằng biến {…}
// (giữ định dạng đoạn và các dấu tab chấm chấm). Ô vuông "đánh dấu X" của biên bản là hình vẽ (shape)
// → gắn ô chữ vào trong hình. Mioto ra bản mới mà chữ đổi thì script báo "không thấy đoạn …":
// chép file mới vào scripts/mioto/, sửa tên file + chữ cần tìm bên dưới cho khớp.

import fs from 'node:fs';
import path from 'node:path';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

const SRC = path.resolve(import.meta.dirname, 'mioto');
const OUT = path.resolve(import.meta.dirname, '../assets/templates');

/** Chuỗi thường: định dạng như chữ đầu tiên của đoạn (bỏ đậm). { b }: in đậm. { small }: cỡ 10. Dấu \t = tab của đoạn. */
type Seg = string | { b: string } | { small: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const RUN = /<w:r[ >][\s\S]*?<\/w:r>/g;
const isGraphic = (run: string) => /<w:drawing|<mc:AlternateContent|<w:pict/.test(run);

function withoutBold(rPr: string): string {
  return rPr.replace(/<w:b\/>|<w:bCs\/>|<w:b w:val="[^"]*"\/>/g, '');
}

function withBold(rPr: string): string {
  const base = withoutBold(rPr);
  // Đúng thứ tự phần tử của rPr: rStyle, rFonts, b, bCs…
  const m = base.match(/^<w:rPr>((?:<w:rStyle[^>]*\/>)?(?:<w:rFonts[^>]*\/>)?)/);
  return m ? base.replace(m[0], `${m[0]}<w:b/><w:bCs/>`) : `<w:rPr><w:b/><w:bCs/></w:rPr>`;
}

function withSize(rPr: string, sz: number): string {
  const base = rPr.replace(/<w:sz w:val="\d+"\/>|<w:szCs w:val="\d+"\/>/g, '');
  return base.replace('</w:rPr>', `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`);
}

/** document.xml cắt thành các đoạn <w:p> (vị trí lẻ) xen phần còn lại (bảng, sectPr…). */
class DocXml {
  parts: string[];
  constructor(xml: string) {
    if (/<w:p [^>]*\/>/.test(xml) || xml.includes('txbxContent')) throw new Error('Mẫu có đoạn rỗng tự đóng / ô chữ — cần sửa script');
    this.parts = xml.split(/(<w:p[ >][\s\S]*?<\/w:p>)/);
  }

  text(i: number): string {
    return unesc([...this.parts[i].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] !== undefined ? m[1] : '\t')).join(''));
  }

  /** Vị trí (trong parts) của đoạn thứ `nth` khớp: chuỗi = bắt đầu bằng (bỏ khoảng trắng đầu), RegExp = khớp. */
  find(match: string | RegExp, nth = 0): number {
    let seen = 0;
    for (let i = 1; i < this.parts.length; i += 2) {
      const t = this.text(i).trim();
      if (typeof match === 'string' ? t.startsWith(match) : match.test(t)) {
        if (seen++ === nth) return i;
      }
    }
    throw new Error(`Không thấy đoạn "${match}" (lần ${nth + 1}) — file gốc của Mioto đã đổi?`);
  }

  /**
   * Đoạn có chữ `segs`, theo định dạng của đoạn `i`. `fresh`: đoạn mới chèn thêm — bỏ hình vẽ và mã định danh
   * của Word (w14:paraId) để khỏi trùng. `plain`: chữ thường cỡ 12, không lấy nghiêng/đậm của chữ đầu đoạn.
   */
  private build(i: number, segs: Seg[], opts: { pPrFrom?: number; plain?: boolean; fresh?: boolean }): string {
    const p = this.parts[i];
    let open = p.match(/^<w:p[^>]*>/)![0];
    if (opts.fresh) open = open.replace(/ w14:(paraId|textId)="[^"]*"/g, '');
    const pPr = this.parts[opts.pPrFrom ?? i].match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    const runs = p.match(RUN) ?? [];
    const firstText = runs.find((r) => !isGraphic(r) && /<w:t[ >]/.test(r));
    const rPr = opts.plain ? '<w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>' : withoutBold(firstText?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '<w:rPr></w:rPr>');
    const out = segs.flatMap((s) => {
      const [text, pr] = typeof s === 'string' ? [s, rPr] : 'b' in s ? [s.b, withBold(rPr)] : [s.small, withSize(rPr, 20)];
      return text.split(/(\t)/).filter(Boolean).map((t) => (t === '\t' ? `<w:r>${pr}<w:tab/></w:r>` : `<w:r>${pr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`));
    });
    return `${open}${pPr}${opts.fresh ? '' : runs.filter(isGraphic).join('')}${out.join('')}</w:p>`;
  }

  /** Thay chữ của đoạn, giữ định dạng đoạn và các hình vẽ trong đoạn. */
  set(i: number, segs: Seg[], opts: { pPrFrom?: number } = {}): void {
    this.parts[i] = this.build(i, segs, opts);
  }

  /** Đoạn trống mới cùng định dạng với đoạn `i`. */
  cloneEmpty(i: number): string {
    return this.build(i, [], { fresh: true });
  }

  /** Đoạn mới cùng định dạng với đoạn `i`, chữ thường. */
  cloneWith(i: number, segs: Seg[], opts: { plain?: boolean } = {}): string {
    return this.build(i, segs, { ...opts, fresh: true });
  }

  /** Thay một đoạn chữ nằm gọn trong một <w:t>. */
  replaceText(i: number, from: string, to: string): void {
    let done = false;
    this.parts[i] = this.parts[i].replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (all, a: string, t: string, b: string) => {
      if (done || !t.includes(esc(from))) return all;
      done = true;
      return `${a}${t.replace(esc(from), esc(to))}${b}`;
    });
    if (!done) throw new Error(`Không thấy chữ "${from}" trong đoạn "${this.text(i)}"`);
  }

  remove(i: number): void {
    this.parts[i] = '';
  }

  toString(): string {
    return this.parts.join('');
  }
}

/** Đặt chữ vào giữa một hình chữ nhật vẽ sẵn (ô đánh dấu X, ô ODO…), theo tên hình trong Word. */
function shapeText(xml: string, name: string, text: string, sz = 24): string {
  // Màu chữ ghi rõ: kiểu hình của Mioto để chữ mặc định màu trắng (lt1).
  const box = `<w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:txbxContent>`;
  // DrawingML (Word 2010+, LibreOffice): thêm wps:txbx ngay trước wps:bodyPr, bỏ lề trong.
  const docPr = xml.indexOf(`name="${name}"`);
  if (docPr < 0) throw new Error(`Không thấy hình "${name}"`);
  const bodyPr = xml.indexOf('<wps:bodyPr', docPr);
  if (bodyPr < 0 || xml.lastIndexOf('</wps:wsp>', bodyPr) > docPr) throw new Error(`Hình "${name}" không phải hình chữ nhật thường`);
  const bodyEnd = xml.indexOf('>', bodyPr);
  const selfClose = xml[bodyEnd - 1] === '/';
  const bodyAttrs = xml.slice(bodyPr, selfClose ? bodyEnd - 1 : bodyEnd).replace(/ [lrtb]Ins="\d+"/g, '');
  xml = `${xml.slice(0, bodyPr)}<wps:txbx>${box}</wps:txbx>${bodyAttrs} lIns="0" tIns="0" rIns="0" bIns="0"${selfClose ? '/' : ''}${xml.slice(bodyEnd)}`;
  // VML dự phòng (Word cũ): <v:rect … id="name" …/> → có v:textbox.
  const vId = xml.indexOf(`id="${name}"`, bodyPr);
  const vStart = xml.lastIndexOf('<v:rect', vId);
  const vEnd = xml.indexOf('>', vId);
  if (vId < 0 || vStart < 0 || xml[vEnd - 1] !== '/') throw new Error(`Không thấy hình VML "${name}"`);
  return `${xml.slice(0, vEnd - 1)}><v:textbox inset="0,0,0,0">${box}</v:textbox></v:rect>${xml.slice(vEnd + 1)}`;
}

function build(srcFile: string, outFile: string, edit: (doc: DocXml) => void, shapes: [string, string, number?][] = []) {
  const zip = new PizZip(fs.readFileSync(path.join(SRC, srcFile)));
  const doc = new DocXml(zip.file('word/document.xml')!.asText());
  edit(doc);
  let xml = doc.toString();
  for (const [name, text, sz] of shapes) xml = shapeText(xml, name, text, sz);
  zip.file('word/document.xml', xml);
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  // Kiểm tra cú pháp biến ngay khi sinh (như lúc tải mẫu lên).
  new Docxtemplater(new PizZip(out), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' }).render({});
  fs.writeFileSync(path.join(OUT, outFile), out);
  console.log('✓', outFile);
}

// ── Hợp đồng cho thuê xe ô tô tự lái (Mioto Ver 26.02.07) ────────────────────

build('00-HDCTXTL-Ver8-26-02-07.docx', 'mioto-hop-dong.docx', (d) => {
  // Tìm hết vị trí trước khi sửa (chữ thay rồi thì không tìm lại được).
  const at = {
    so: d.find('(Số:'),
    homNay: d.find('Hôm nay, ngày'),
    benA: d.find('BÊN CHO THUÊ XE (BÊN A)'),
    cccdA: d.find('CCCD số:', 0),
    thuongTruA: d.find('Địa chỉ thường trú', 0),
    tamTruA: d.find('Địa chỉ tạm trú', 0),
    dtA: d.find('Điện thoại', 0),
    benB: d.find('BÊN THUÊ XE (BÊN B)', 0),
    cccdB: d.find('CCCD số:', 1),
    passport: d.find('Passport số:'),
    gplx: d.find('GPLX số'),
    thuongTruB: d.find('Địa chỉ thường trú', 1),
    tamTruB: d.find('Địa chỉ tạm trú', 1),
    dtB: d.find('Điện thoại', 1),
    toChuc: d.find('Trường hợp Bên thuê xe là tổ chức'),
    sauKhi: d.find('Sau khi bàn bạc'),
    bienSo: d.find('Biển số xe'),
    namSx: d.find('Sản xuất năm'),
    dangKy: d.find('Giấy đăng ký xe ô tô số'),
    capTai: d.find('Cấp tại'),
    tu: d.find(/^Từ …/),
    den: d.find(/^Đến …/),
    donGia: d.find('Đơn giá thuê xe'),
    giaTri: d.find('Giá trị Hợp đồng:', 1),
    tra40: d.find(/^☐\s*Bên B thanh toán trước 40%/),
    tra100: d.find(/^☐\s*Bên B thanh toán 100%/),
    kyA: d.find('(Ký, ghi rõ họ và tên)', 0),
    kyB: d.find('(Ký, ghi rõ họ và tên)', 1),
  };

  d.set(at.so, ['(Số: {kenh.ma_chuyen}/HĐCTXTL)']);
  d.set(at.homNay, ['Hôm nay, ngày {hd.ngay_giao} tại {hd.noi_giao}\t']);
  d.set(at.benA, [{ b: 'BÊN CHO THUÊ XE (BÊN A): {ben_a.ho_ten}' }, '\t']);
  d.set(at.cccdA, ['CCCD số: {ben_a.cccd}\tcấp ngày {ben_a.cccd_ngay_cap} tại {ben_a.cccd_noi_cap}\t']);
  d.set(at.thuongTruA, ['Địa chỉ thường trú: {ben_a.thuong_tru}\t']);
  d.set(at.tamTruA, ['Địa chỉ tạm trú: {ben_a.tam_tru}\t']);
  d.set(at.dtA, ['Điện thoại: {ben_a.dien_thoai}\t']);
  d.set(at.benB, [{ b: 'BÊN THUÊ XE (BÊN B): {khach.ho_ten}' }, '\t']);
  d.set(at.cccdB, ['CCCD số: {khach.can_cuoc}\tcấp ngày {khach.can_cuoc_ngay_cap} tại {khach.can_cuoc_noi_cap}\t']);
  d.set(at.passport, ['Passport số: {khach.ho_chieu}\tcấp ngày {khach.ho_chieu_ngay_cap} tại {khach.ho_chieu_noi_cap}\t']);
  d.set(at.gplx, ['GPLX số: {khach.gplx}\tcấp ngày {khach.gplx_ngay_cap} tại {khach.gplx_noi_cap}\t']);
  d.set(at.thuongTruB, ['Địa chỉ thường trú: {khach.thuong_tru}\t']);
  d.set(at.tamTruB, ['Địa chỉ tạm trú: {khach.cho_o}\t']);
  d.set(at.dtB, ['Điện thoại: {khach.dien_thoai}\t']);
  // Khách luôn là cá nhân → bỏ phần "Trường hợp Bên thuê xe là tổ chức".
  for (let i = at.toChuc; i < at.sauKhi; i += 2) d.remove(i);
  d.set(at.bienSo, ['Biển số xe: {xe.bien_so}\tNhãn hiệu: {xe.ten}\t']);
  d.set(at.namSx, ['Sản xuất năm: {xe.nam}\tMàu: {xe.mau}\t']);
  d.set(at.dangKy, ['Giấy đăng ký xe ô tô số: {xe.dang_ky_so}\tNgày cấp: {xe.dang_ky_ngay}\t']);
  d.set(at.capTai, ['Cấp tại: {xe.dang_ky_noi}\tTên chủ xe: {xe.chu_xe}\t']);
  d.set(at.tu, ['Từ {hd.nhan_gio} giờ {hd.nhan_phut} phút, ngày {hd.nhan_ngay}\t']);
  d.set(at.den, ['Đến {hd.tra_gio} giờ {hd.tra_phut} phút, ngày {hd.tra_ngay}\t']);
  d.set(at.donGia, ['Đơn giá thuê xe: {kenh.don_gia}\tVND/ngày']);
  d.set(at.giaTri, ['Giá trị Hợp đồng: {kenh.gia_tri}\tVND']);
  d.replaceText(at.tra40, '☐', '{kenh.o_40}');
  d.replaceText(at.tra100, '☐', '{kenh.o_100}');
  // Chỗ ký (trong bảng 2 cột): chừa khoảng trống rồi in sẵn họ tên hai bên, căn giữa như dòng "(Ký…)".
  for (const [ky, name] of [
    [at.kyA, '{ben_a.ho_ten}'],
    [at.kyB, '{khach.ho_ten}'],
  ] as const) {
    // Dòng trống có sẵn ngay sau trong cùng ô (cột A có, cột B không) → bỏ để hai cột cao bằng nhau.
    if (d.parts[ky + 1] === '' && !d.text(ky + 2).trim()) d.remove(ky + 2);
    d.parts[ky] += d.cloneEmpty(ky).repeat(4) + d.cloneWith(ky, [{ b: name }], { plain: true });
  }
});

// ── Biên bản bàn giao xe ô tô (Mioto v4 10.06) ───────────────────────────────

build(
  'Bien-ban-ban-giao-xe-v4-10-06.docx',
  'mioto-bien-ban.docx',
  (d) => {
    const dash = (n: number) => d.find(/^-$/, n);
    const at = {
      canCu: d.find('Căn c'),
      homNay: d.find('Hôm này'),
      benA: d.find('Đại diện Bên A'),
      benB: d.find('Đại diện Bên B'),
      nhanHieu: d.find('Nhãn hiệu:'),
      mauSon: d.find('Màu'),
      bienSo: d.find('Biển'),
      giao: d.find('Tình trạng xe khi giao nhận'),
      giaoHh: [0, 1, 2, 3, 4, 5].map(dash),
      xangGiao: d.find('Đồng hồ xăng/dầu', 0),
      cccd: d.find('- CCCD gắn chip'),
      xeMay: d.find('- Xe máy'),
      caVet: d.find('- Giấy đăng ký xe máy'),
      tienMat: d.find('- Tiền mặt'),
      khac: d.find('- Tài sản khác'),
      nhan: d.find('Tình trạng xe khi hoàn trả'),
      nhanHh: [6, 7, 8, 9, 10, 11].map(dash),
      odoNhan: d.find('Công tơ mét', 1),
      xangNhan: d.find('Đồng hồ xăng/dầu', 1),
      thieu: [1, 2, 3, 4].map((n) => d.find(new RegExp(`^${n}\\.$`))),
    };

    d.set(at.canCu, ['Căn cứ theo Hợp đồng cho thuê xe số {kenh.ma_chuyen} {hd.ngay_giao_dai}']);
    d.set(at.homNay, ['Hôm nay, {hd.ngay_giao_dai} tại {hd.noi_giao}']);
    d.set(at.benA, [{ b: 'Đại diện Bên A - Chủ xe: ' }, 'Ông/Bà ', { b: '{ben_a.ho_ten}' }]);
    d.set(at.benB, [{ b: 'Đại diện Bên B - Khách thuê xe: ' }, 'Ông/Bà ', { b: '{khach.ho_ten}' }]);
    d.set(at.nhanHieu, ['Nhãn hiệu: {xe.hang}\tLoại xe: {xe.dong}'], { pPrFrom: at.mauSon });
    d.set(at.mauSon, ['Màu sơn: {xe.mau}\tNăm sản xuất: {xe.nam}']);
    d.set(at.bienSo, ['Biển số xe: {xe.bien_so}\tSố chỗ ngồi: {xe.so_cho}']);
    d.set(at.giao, ['Tình trạng xe khi giao nhận (Vào lúc {giao.gio_phut}, ngày {giao.ngay})']);
    at.giaoHh.forEach((p, i) => d.set(p, [`- {giao.hh_${i + 1}}`]));
    // App ghi mức xăng/pin theo %, không theo lít.
    d.replaceText(at.xangGiao, '(Lít)', '(mức)');
    d.set(at.cccd, ['- CCCD gắn chip (đối chiếu)/passport số {tc.giay_to}']);
    d.set(at.xeMay, ['- Xe máy (hiệu, biển số): {tc.xe_may}']);
    d.set(at.caVet, ['- Giấy đăng ký xe máy (cà vẹt), số {tc.ca_vet}']);
    d.set(at.tienMat, ['- Tiền mặt, số tiền: {tc.tien_mat}']);
    d.set(at.khac, ['- Tài sản khác gồm: {tc.khac}']);
    d.set(at.nhan, ['Tình trạng xe khi hoàn trả (Vào lúc {nhan.gio_phut}, ngày {nhan.ngay})']);
    at.nhanHh.forEach((p, i) => d.set(p, [`- {nhan.hh_${i + 1}}`]));
    d.set(at.odoNhan, ['Công tơ mét (Km): {nhan.odo}']);
    d.set(at.xangNhan, ['Đồng hồ xăng/dầu (mức): {nhan.xang}']);
    // Viết ngay sau số thứ tự (cột rộng), chữ nhỏ cho khỏi xuống dòng — trang 3 vừa khít, dư một dòng là sang trang 4.
    at.thieu.forEach((p, i) => d.set(p, [`${i + 1}. `, { small: `{nhan.thieu_${i + 1}}` }]));
  },
  [
    ['Rectangle 16', '{giao.o_binh_thuong}'],
    ['Rectangle 17', '{giao.odo_km}', 22],
    ['Rectangle 18', '{giao.xang_muc}', 22],
    ['Rectangle 2', '{tc.o_mien}'],
    ['Rectangle 3', '{tc.o_co}'],
    ['Rectangle 19', '{nhan.o_giong}'],
    ['Rectangle 20', '{nhan.o_tra_du}'],
  ],
);
