// Sinh 3 mẫu Word dựng sẵn vào apps/api/assets/templates/.
// Chạy lại khi sửa nội dung mẫu:  npm run templates -w apps/api
//
// Mỗi biến {…} phải nằm trọn trong MỘT TextRun — Word tách run giữa chừng thì
// docxtemplater không nhận ra biến. Vòng lặp/điều kiện đặt ở đoạn riêng.

import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
} from 'docx';

const OUT = path.resolve(import.meta.dirname, '../assets/templates');
fs.mkdirSync(OUT, { recursive: true });

type Piece = string | { b: string } | { i: string };

function runs(pieces: Piece[], base: IRunOptions = {}): TextRun[] {
  return pieces.map((p) =>
    typeof p === 'string'
      ? new TextRun({ ...base, text: p })
      : 'b' in p
        ? new TextRun({ ...base, text: p.b, bold: true })
        : new TextRun({ ...base, text: p.i, italics: true }),
  );
}

const P = (pieces: Piece[], opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; indent?: number } = {}) =>
  new Paragraph({
    children: runs(pieces),
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { after: opts.after ?? 80, line: 300 },
    indent: opts.indent ? { left: opts.indent } : undefined,
  });

const C = (pieces: Piece[], after = 40) => P(pieces, { align: AlignmentType.CENTER, after });
const H = (text: string) => new Paragraph({ children: [new TextRun({ text, bold: true })], spacing: { before: 160, after: 80 } });
const Tag = (tag: string) => new Paragraph({ children: [new TextRun(tag)] });

const thin = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

function cell(pieces: Piece[], width: number, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: runs(pieces, { bold: opts.bold }) })],
  });
}

/** Bảng có hàng lặp: {#loop} ở ô đầu, {/loop} ở ô cuối → docxtemplater nhân bản hàng. */
function loopTable(head: string[], widths: number[], loop: string, cols: string[], aligns: ((typeof AlignmentType)[keyof typeof AlignmentType])[] = []) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell([h], widths[i], { bold: true, align: AlignmentType.CENTER })) }),
      new TableRow({
        children: cols.map((c, i) => {
          const text = `${i === 0 ? `{#${loop}}` : ''}{${c}}${i === cols.length - 1 ? `{/${loop}}` : ''}`;
          return cell([text], widths[i], { align: aligns[i] });
        }),
      }),
    ],
  });
}

function signatures(left: [string, string], right: [string, string]) {
  const col = (title: string, name: string) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, bold: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '(Ký, ghi rõ họ tên)', italics: true })] }),
        new Paragraph({ children: [] }),
        new Paragraph({ children: [] }),
        new Paragraph({ children: [] }),
        new Paragraph({ children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: name, bold: true })] }),
      ],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [new TableRow({ children: [col(left[0], left[1]), col(right[0], right[1])] })],
  });
}

function header(title: string, sub: Piece[]) {
  return [
    C([{ b: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM' }], 0),
    C([{ b: 'Độc lập – Tự do – Hạnh phúc' }], 0),
    C(['———————'], 200),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: title, bold: true, size: 30 })] }),
    C(sub, 200),
  ];
}

function doc(children: (Paragraph | Table)[]) {
  return new Document({
    creator: 'Car Rental',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 26 } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 1134 } } }, children }],
  });
}

const partyA = [
  P([{ b: 'BÊN CHO THUÊ (Bên A): ' }, { b: '{ben_a.ten}' }]),
  P(['Người đại diện: ', '{ben_a.dai_dien}', '     Chức vụ: ', '{ben_a.chuc_vu}']),
  P(['CCCD số: ', '{ben_a.cccd}', '     cấp ngày: ', '{ben_a.cccd_ngay_cap}', '     tại: ', '{ben_a.cccd_noi_cap}']),
  P(['Địa chỉ: ', '{ben_a.dia_chi}']),
  P(['Điện thoại: ', '{ben_a.dien_thoai}', '     Mã số thuế: ', '{ben_a.mst}']),
  P(['Tài khoản: ', '{ben_a.stk}', ' – ', '{ben_a.ngan_hang}', ' – Chủ TK: ', '{ben_a.chu_tk}'], { after: 160 }),
];

const partyB = [
  P([{ b: 'BÊN THUÊ (Bên B): ' }, { b: '{khach.ho_ten}' }]),
  P(['Ngày sinh: ', '{khach.ngay_sinh}', '     Giới tính: ', '{khach.gioi_tinh}']),
  P(['CCCD số: ', '{khach.cccd}', '     cấp ngày: ', '{khach.cccd_ngay_cap}', '     tại: ', '{khach.cccd_noi_cap}']),
  P(['Nơi thường trú: ', '{khach.thuong_tru}']),
  P(['Chỗ ở hiện tại: ', '{khach.cho_o}']),
  P(['Điện thoại: ', '{khach.dien_thoai}', '     Email: ', '{khach.email}']),
  P(['Giấy phép lái xe số: ', '{khach.gplx}', '     Hạng: ', '{khach.gplx_hang}', '     Thời hạn: ', '{khach.gplx_han}']),
  P(['Người liên hệ khi khẩn cấp: ', '{khach.lien_he_khan}']),
  Tag('{#co_lai_phu}'),
  P([{ b: 'Người cùng điều khiển xe (lái phụ) — có nghĩa vụ như Bên B:' }]),
  Tag('{#lai_phu}'),
  P(['– ', '{ho_ten}', ', CCCD ', '{cccd}', ', GPLX ', '{gplx}', ', ĐT ', '{dien_thoai}'], { indent: 360 }),
  Tag('{/lai_phu}'),
  Tag('{/co_lai_phu}'),
];

const vehicleLine = P([
  'Biển số: ',
  { b: '{xe.bien_so}' },
  '; nhãn hiệu: ',
  '{xe.hang}',
  ' ',
  '{xe.dong}',
  '; năm sản xuất: ',
  '{xe.nam}',
  '; màu: ',
  '{xe.mau}',
  '; số chỗ: ',
  '{xe.so_cho}',
  '; hộp số: ',
  '{xe.hop_so}',
  '; nhiên liệu: ',
  '{xe.nhien_lieu}',
  '; số khung: ',
  '{xe.so_khung}',
  '; số máy: ',
  '{xe.so_may}',
  '.',
]);

// ── Hợp đồng ────────────────────────────────────────────────────────────────

const contract = doc([
  ...header('HỢP ĐỒNG THUÊ XE Ô TÔ TỰ LÁI', ['Số: ', { b: '{hd.so}' }]),
  P(['Hôm nay, ', '{hd.ngay_ky}', ', tại ', '{hd.noi_ky}', ', chúng tôi gồm:'], { after: 160 }),
  ...partyA,
  ...partyB,
  P(['Hai bên thống nhất ký kết hợp đồng thuê xe ô tô tự lái với các điều khoản sau:'], { after: 120 }),

  H('Điều 1. Xe cho thuê'),
  vehicleLine,
  Tag('{#co_phu_kien}'),
  P(['Phụ kiện, tiện nghi kèm theo xe:']),
  Tag('{#phu_kien}'),
  P(['+ ', '{ten}', ' (số lượng: ', '{so_luong}', ')'], { indent: 360 }),
  Tag('{/phu_kien}'),
  Tag('{/co_phu_kien}'),
  P(['Tình trạng xe, giấy tờ, phụ kiện và giá trị đền bù từng phụ kiện được ghi tại Biên bản giao xe — là một phần không tách rời của hợp đồng này.']),

  H('Điều 2. Thời gian và địa điểm'),
  P(['– Thời gian thuê: từ ', { b: '{hd.nhan_xe}' }, ' đến ', { b: '{hd.tra_xe}' }, ' (', '{hd.thoi_gian}', ').']),
  P(['– Nơi giao xe: ', '{hd.noi_giao}', '. Nơi trả xe: ', '{hd.noi_tra}', '.']),
  P(['– Giới hạn quãng đường cho cả thời gian thuê: ', '{hd.km_gioi_han}', ' km.']),

  H('Điều 3. Giá thuê và thanh toán'),
  P(['– Hình thức thuê: ', { b: '{hd.hinh_thuc}' }, '.']),
  P(['– Đơn giá: ', '{gia.ngay}', ' đồng/ngày (24 giờ); ngày cuối tuần ', '{gia.cuoi_tuan}', ' đồng/ngày; giờ lẻ ', '{gia.gio}', ' đồng/giờ.']),
  Tag('{#co_gia_thang}'),
  P(['– Thuê theo tháng: ', '{gia.thang}', ' đồng/tháng dương lịch, giới hạn ', '{gia.km_thang}', ' km/tháng; ngày lẻ tính bằng giá tháng chia 30.']),
  Tag('{/co_gia_thang}'),
  P(['– Chi tiết các khoản:']),
  loopTable(['Khoản', 'Diễn giải', 'Số tiền (đồng)'], [22, 53, 25], 'khoan', ['loai', 'mo_ta', 'so_tien'], [AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.RIGHT]),
  P([''], { after: 40 }),
  P(['– Tổng cộng: ', { b: '{tien.tong}' }, ' đồng (bằng chữ: ', { i: '{tien.tong_chu}' }, ').']),
  P(['– Đã thanh toán: ', '{tien.da_tra}', ' đồng. Còn lại: ', { b: '{tien.con_lai}' }, ' đồng.']),
  P(['– Phụ phí phát sinh: trả xe trễ ', '{gia.qua_gio}', ' đồng/giờ; vượt quãng đường ', '{gia.vuot_km}', ' đồng/km; xăng dầu, vệ sinh, phí cầu đường (nếu có) tính theo thực tế.']),
  Tag('{#co_sac}'),
  P(['– Sạc pin (xe điện): ', '{gia.sac}', '.']),
  Tag('{/co_sac}'),

  H('Điều 4. Đặt cọc và tài sản bảo đảm'),
  P(['– Bên B đặt cọc cho Bên A số tiền ', { b: '{tien.coc}' }, ' đồng (bằng chữ: ', { i: '{tien.coc_chu}' }, ') để bảo đảm thực hiện hợp đồng.']),
  Tag('{#co_the_chap}'),
  P(['– Tài sản bảo đảm Bên B giao cho Bên A giữ:']),
  Tag('{#the_chap}'),
  P(['+ ', '{loai}', ': ', '{mo_ta}'], { indent: 360 }),
  Tag('{/the_chap}'),
  Tag('{/co_the_chap}'),
  P([
    '– Khi trả xe, tiền cọc được dùng để cấn trừ các khoản Bên B còn phải thanh toán. Bên A được giữ lại ',
    '{tien.giu_coc}',
    ' đồng trong ',
    '{tien.giu_coc_ngay}',
    ' ngày kể từ ngày trả xe để đối soát vi phạm giao thông phát hiện qua hình ảnh (phạt nguội). Hết thời hạn này, Bên A hoàn trả số tiền giữ lại sau khi trừ các khoản phạt (nếu có).',
  ]),
  P(['– Bên B hủy thuê trước khi nhận xe: ', '{tien.chinh_sach_huy}']),

  H('Điều 5. Quyền và nghĩa vụ của Bên A'),
  P(['1. Giao xe đúng thời gian, địa điểm; xe bảo đảm an toàn kỹ thuật, có giấy tờ theo quy định (bản sao đăng ký xe có chứng thực, bảo hiểm trách nhiệm dân sự bắt buộc, giấy chứng nhận kiểm định).']),
  P(['2. Hướng dẫn Bên B sử dụng xe; hỗ trợ khi xe hỏng hóc kỹ thuật không do lỗi của Bên B.']),
  P(['3. Nhận lại xe, kiểm tra tình trạng và quyết toán theo hợp đồng.']),
  P(['4. Được chấm dứt hợp đồng và thu hồi xe nếu Bên B sử dụng xe sai mục đích, cho thuê lại, cầm cố, hoặc vi phạm nghiêm trọng hợp đồng.']),

  H('Điều 6. Quyền và nghĩa vụ của Bên B'),
  P(['1. Chỉ người có tên trong hợp đồng, có giấy phép lái xe phù hợp còn hiệu lực mới được điều khiển xe. Không giao xe cho người khác; không cho thuê lại, cầm cố, thế chấp, bán xe hoặc giấy tờ xe.']),
  P(['2. Không dùng xe vào mục đích trái pháp luật, chở hàng cấm, đua xe, tập lái, chở quá số người quy định; không điều khiển xe khi trong máu hoặc hơi thở có nồng độ cồn hoặc sử dụng chất ma túy.']),
  P([
    '3. Chấp hành pháp luật về giao thông đường bộ. ',
    { b: 'Bên B chịu toàn bộ trách nhiệm và chi phí đối với mọi vi phạm giao thông xảy ra trong thời gian thuê, kể cả vi phạm được phát hiện sau khi đã trả xe (phạt nguội)' },
    '; có nghĩa vụ đến cơ quan có thẩm quyền giải quyết, hoặc hoàn trả cho Bên A số tiền phạt và chi phí liên quan nếu Bên A đã nộp thay.',
  ]),
  P(['4. Bảo quản xe và phụ kiện kèm theo; không tự ý tháo lắp, thay thế phụ tùng, thay đổi kết cấu xe. Mất hoặc làm hỏng phụ kiện thì bồi thường theo giá trị ghi tại Biên bản giao xe.']),
  P(['5. Trả xe đúng thời gian, địa điểm, đúng tình trạng như khi nhận (trừ hao mòn tự nhiên). Trả trễ phải báo trước và thanh toán phụ phí theo Điều 3.']),
  P([
    '6. Khi tai nạn, va chạm, mất cắp: báo ngay cho Bên A và cơ quan chức năng, giữ nguyên hiện trường, phối hợp với bảo hiểm. Bên B bồi thường thiệt hại do lỗi của mình, phần bảo hiểm không chi trả, và tiền thuê xe theo đơn giá ngày trong thời gian xe nằm sửa chữa.',
  ]),

  H('Điều 7. Thông tin cá nhân'),
  P([
    'Bên B (và người lái phụ) đồng ý để Bên A thu thập, lưu trữ thông tin và hình ảnh giấy tờ tùy thân (CCCD, GPLX) nhằm thực hiện hợp đồng, giải quyết vi phạm giao thông và tranh chấp liên quan. Bên A bảo mật thông tin, chỉ cung cấp cho cơ quan nhà nước có thẩm quyền theo quy định pháp luật.',
  ]),

  H('Điều 8. Điều khoản chung'),
  P(['1. Hai bên cam kết thực hiện đúng hợp đồng. Tranh chấp được giải quyết bằng thương lượng; không thương lượng được thì đưa ra Tòa án có thẩm quyền.']),
  P(['2. Hợp đồng có hiệu lực từ thời điểm ký, lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.']),
  P(['Ghi chú: ', '{hd.ghi_chu}'], { after: 240 }),
  signatures(['BÊN A', '{ben_a.dai_dien}'], ['BÊN B', '{khach.ho_ten}']),
]);

// ── Biên bản giao xe ──────────────────────────────────────────────────────────

const pickup = doc([
  ...header('BIÊN BẢN GIAO XE', [{ i: 'Kèm theo Hợp đồng thuê xe số ' }, { b: '{hd.so}' }]),
  P(['Thời điểm giao xe: ', { b: '{giao.thoi_gian}' }, '     Địa điểm: ', '{hd.noi_giao}']),
  P(['Bên giao (Bên A): ', '{ben_a.ten}', ' — đại diện ', '{ben_a.dai_dien}']),
  P(['Bên nhận (Bên B): ', { b: '{khach.ho_ten}' }, ' — CCCD ', '{khach.cccd}', ' — ĐT ', '{khach.dien_thoai}'], { after: 160 }),
  H('1. Xe giao'),
  vehicleLine,
  H('2. Tình trạng khi giao'),
  P(['– Số km trên đồng hồ (ODO): ', { b: '{giao.odo}' }, ' km']),
  P(['– Mức nhiên liệu / pin: ', { b: '{giao.xang}' }]),
  H('3. Giấy tờ kèm theo'),
  loopTable(['Hạng mục', 'Có / Không'], [75, 25], 'giao.giay_to', ['ten', 'co'], [AlignmentType.LEFT, AlignmentType.CENTER]),
  Tag('{#co_phu_kien}'),
  H('Phụ kiện kèm theo xe'),
  loopTable(['Phụ kiện', 'SL', 'Giá trị đền bù (đ)', 'Có / Không'], [46, 10, 26, 18], 'giao.phu_kien', ['ten', 'so_luong', 'gia_tri', 'co'], [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.RIGHT, AlignmentType.CENTER]),
  P([{ i: 'Bên B bồi thường theo giá trị trên nếu làm mất hoặc hỏng phụ kiện.' }]),
  Tag('{/co_phu_kien}'),
  H('4. Hiện trạng có sẵn (trầy xước, móp, hư hỏng)'),
  Tag('{#giao.hu_hong}'),
  P(['– ', '{vi_tri}', ': ', '{mo_ta}'], { indent: 360 }),
  Tag('{/giao.hu_hong}'),
  Tag('{^giao.hu_hong}'),
  P(['Không ghi nhận hư hỏng.'], { indent: 360 }),
  Tag('{/giao.hu_hong}'),
  P([{ i: 'Ảnh chụp xe lúc giao (có ghi thời gian) được lưu trong hệ thống của Bên A và là một phần của biên bản này.' }]),
  H('5. Ghi chú'),
  P(['{giao.ghi_chu}'], { after: 160 }),
  P(['Bên B đã kiểm tra xe, giấy tờ và đồng ý với tình trạng nêu trên.'], { after: 240 }),
  signatures(['BÊN GIAO', '{ben_a.dai_dien}'], ['BÊN NHẬN', '{khach.ho_ten}']),
]);

// ── Biên bản nhận xe & quyết toán ───────────────────────────────────────────

const ret = doc([
  ...header('BIÊN BẢN NHẬN LẠI XE VÀ QUYẾT TOÁN', [{ i: 'Kèm theo Hợp đồng thuê xe số ' }, { b: '{hd.so}' }]),
  P(['Thời điểm nhận lại xe: ', { b: '{nhan.thoi_gian}' }, '     Địa điểm: ', '{hd.noi_tra}']),
  P(['Bên thuê: ', { b: '{khach.ho_ten}' }, ' — CCCD ', '{khach.cccd}', ' — ĐT ', '{khach.dien_thoai}']),
  P(['Xe: ', { b: '{xe.bien_so}' }, ' — ', '{xe.hang}', ' ', '{xe.dong}'], { after: 160 }),
  H('1. Tình trạng khi nhận lại'),
  P(['– ODO: ', { b: '{nhan.odo}' }, ' km (lúc giao ', '{giao.odo}', ' km, đã đi ', { b: '{nhan.km_da_di}' }, ' km; giới hạn ', '{hd.km_gioi_han}', ' km)']),
  P(['– Nhiên liệu / pin: ', { b: '{nhan.xang}' }, ' (lúc giao ', '{giao.xang}', ')']),
  Tag('{#co_phu_kien}'),
  H('Phụ kiện'),
  loopTable(['Phụ kiện', 'SL', 'Lúc giao', 'Lúc nhận', 'Ghi chú'], [34, 8, 14, 14, 30], 'nhan.phu_kien', ['ten', 'so_luong', 'luc_giao', 'luc_nhan', 'ghi_chu'], [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.LEFT]),
  Tag('{/co_phu_kien}'),
  H('2. Hư hỏng mới phát sinh'),
  Tag('{#nhan.hu_hong}'),
  P(['– ', '{vi_tri}', ': ', '{mo_ta}'], { indent: 360 }),
  Tag('{/nhan.hu_hong}'),
  Tag('{^nhan.hu_hong}'),
  P(['Không phát sinh hư hỏng mới.'], { indent: 360 }),
  Tag('{/nhan.hu_hong}'),
  H('3. Các khoản tiền'),
  loopTable(['Khoản', 'Diễn giải', 'Số tiền (đồng)'], [22, 53, 25], 'khoan', ['loai', 'mo_ta', 'so_tien'], [AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.RIGHT]),
  P([''], { after: 40 }),
  P(['– Tổng phải trả: ', { b: '{qt.phai_tra}' }, ' đồng; đã trả: ', '{qt.da_tra}', ' đồng.']),
  P(['– Tiền cọc đang giữ: ', '{qt.coc_dang_giu}', ' đồng; cấn trừ vào tiền thuê: ', '{qt.can_tru}', ' đồng.']),
  P(['– Bên B trả thêm: ', { b: '{qt.thu_them}' }, ' đồng.']),
  P(['– Bên A hoàn cọc ngay: ', { b: '{qt.hoan_coc}' }, ' đồng.']),
  P(['– Bên A giữ lại ', { b: '{qt.giu_coc}' }, ' đồng trong ', '{tien.giu_coc_ngay}', ' ngày để đối soát phạt nguội, hết hạn sẽ hoàn sau khi trừ các khoản phạt (nếu có).']),
  H('4. Ghi chú'),
  P(['{nhan.ghi_chu}'], { after: 240 }),
  signatures(['BÊN A', '{ben_a.dai_dien}'], ['BÊN B', '{khach.ho_ten}']),
]);

for (const [name, d] of [
  ['hop-dong-thue-xe.docx', contract],
  ['bien-ban-giao-xe.docx', pickup],
  ['bien-ban-nhan-xe.docx', ret],
] as const) {
  fs.writeFileSync(path.join(OUT, name), await Packer.toBuffer(d));
  console.log('✓', name);
}
