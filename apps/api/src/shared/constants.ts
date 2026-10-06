// Danh mục giá trị + nhãn tiếng Việt, dùng chung cho API, web và mẫu hợp đồng.

export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

export const ROLES = ['admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { admin: 'Quản trị', staff: 'Nhân viên' };

export const RENTAL_STATUSES = ['booked', 'active', 'returned', 'settled', 'closed', 'cancelled'] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
export const RENTAL_STATUS: Record<RentalStatus, { label: string; tone: Tone; hint: string }> = {
  booked: { label: 'Đã đặt', tone: 'blue', hint: 'Chờ giao xe' },
  active: { label: 'Đang thuê', tone: 'violet', hint: 'Khách đang giữ xe' },
  returned: { label: 'Đã trả xe', tone: 'amber', hint: 'Chờ quyết toán' },
  settled: { label: 'Chờ hoàn cọc', tone: 'amber', hint: 'Đang giữ cọc chờ phạt nguội' },
  closed: { label: 'Hoàn tất', tone: 'green', hint: 'Đã xong mọi khoản' },
  cancelled: { label: 'Đã hủy', tone: 'gray', hint: '' },
};

export const RENTAL_TYPES = ['self_drive', 'with_driver'] as const;
export type RentalType = (typeof RENTAL_TYPES)[number];

export const CHARGE_KINDS = ['rental', 'delivery', 'over_km', 'over_time', 'fuel', 'cleaning', 'damage', 'accessory', 'toll', 'fine', 'other', 'discount'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = {
  rental: 'Tiền thuê xe',
  delivery: 'Giao/nhận xe tận nơi',
  over_km: 'Vượt km',
  over_time: 'Quá giờ',
  fuel: 'Bù xăng / sạc',
  cleaning: 'Vệ sinh xe',
  damage: 'Hư hỏng',
  accessory: 'Thiếu / hỏng phụ kiện',
  toll: 'Phí cầu đường',
  fine: 'Phạt nguội',
  other: 'Khoản khác',
  discount: 'Giảm giá',
};

export const PAYMENT_METHODS = ['cash', 'transfer', 'offset'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  offset: 'Cấn trừ cọc',
};

export const FUEL_TYPES = ['gasoline', 'diesel', 'electric', 'hybrid'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const FUEL_LABEL: Record<FuelType, string> = { gasoline: 'Xăng', diesel: 'Dầu', electric: 'Điện', hybrid: 'Hybrid' };

export const TRANSMISSIONS = ['AT', 'MT'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];
export const TRANSMISSION_LABEL: Record<Transmission, string> = { AT: 'Số tự động', MT: 'Số sàn' };

export const BLOCK_KINDS = ['maintenance', 'owner_use', 'other'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  maintenance: 'Bảo dưỡng / sửa chữa',
  owner_use: 'Chủ xe sử dụng',
  other: 'Tạm ngưng',
};

export const FINE_STATUSES = ['new', 'notified', 'customer_paid', 'we_paid', 'recovered', 'closed'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];
export const FINE_STATUS: Record<FineStatus, { label: string; tone: Tone }> = {
  new: { label: 'Mới phát hiện', tone: 'red' },
  notified: { label: 'Đã báo khách', tone: 'amber' },
  customer_paid: { label: 'Khách tự nộp', tone: 'green' },
  we_paid: { label: 'Mình nộp hộ — chờ thu lại', tone: 'amber' },
  recovered: { label: 'Đã thu lại / trừ cọc', tone: 'green' },
  closed: { label: 'Đóng', tone: 'gray' },
};

export const FINE_SOURCES = ['csgt', 'vnetraffic', 'notice', 'other'] as const;
export type FineSource = (typeof FINE_SOURCES)[number];
export const FINE_SOURCE_LABEL: Record<FineSource, string> = {
  csgt: 'Cổng tra cứu CSGT',
  vnetraffic: 'Ứng dụng VNeTraffic',
  notice: 'Thông báo giấy',
  other: 'Nguồn khác',
};

export const COLLATERAL_KINDS = ['motorbike', 'document', 'other'] as const;
export type CollateralKind = (typeof COLLATERAL_KINDS)[number];
export const COLLATERAL_KIND_LABEL: Record<CollateralKind, string> = {
  motorbike: 'Xe máy + cà vẹt',
  document: 'Giấy tờ',
  other: 'Tài sản khác',
};

export const TEMPLATE_KINDS = ['contract', 'pickup', 'return', 'other'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  contract: 'Hợp đồng thuê xe',
  pickup: 'Biên bản giao xe',
  return: 'Biên bản nhận xe & quyết toán',
  other: 'Văn bản khác',
};

export const FILE_KINDS = [
  'vehicle_photo',
  'vehicle_doc',
  'id_front',
  'id_back',
  'license_front',
  'license_back',
  'portrait',
  'handover_photo',
  'signature',
  'collateral_photo',
  'document_docx',
  'document_pdf',
  'document_scan',
  'fine_notice',
  'template',
  'other',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Ảnh giấy tờ tùy thân — mỗi lần xem đều ghi nhật ký. */
export const SENSITIVE_FILE_KINDS: FileKind[] = ['id_front', 'id_back', 'license_front', 'license_back', 'portrait'];

/** Khung ảnh gợi ý khi giao/nhận xe. */
export const PHOTO_SLOTS = [
  { key: 'front', label: 'Đầu xe' },
  { key: 'rear', label: 'Đuôi xe' },
  { key: 'left', label: 'Bên trái' },
  { key: 'right', label: 'Bên phải' },
  { key: 'interior', label: 'Nội thất' },
  { key: 'dashboard', label: 'Táp-lô (ODO, xăng)' },
] as const;

export const DAMAGE_ZONES = [
  'Cản trước',
  'Nắp capo',
  'Đèn trước',
  'Kính chắn gió',
  'Cửa trước trái',
  'Cửa sau trái',
  'Cửa trước phải',
  'Cửa sau phải',
  'Gương trái',
  'Gương phải',
  'Mui xe',
  'Cốp sau',
  'Cản sau',
  'Đèn sau',
  'Mâm / lốp',
  'Nội thất',
  'Khác',
] as const;

/** Giấy tờ chung cho mọi xe. Đồ dùng trên xe (lốp dự phòng, ETC, sạc…) quản lý theo từng xe ở mục Phụ kiện. */
export const DEFAULT_CHECKLIST = [
  'Giấy đăng ký xe (bản sao có chứng thực)',
  'Giấy chứng nhận bảo hiểm',
  'Giấy chứng nhận kiểm định',
  'Chìa khóa / thẻ khóa',
];

// ── Phụ kiện trên xe ────────────────────────────────────────────────────────

export const ACCESSORY_CATEGORIES = ['safety', 'tech', 'comfort', 'ev', 'other'] as const;
export type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];
export const ACCESSORY_CATEGORY_LABEL: Record<AccessoryCategory, string> = {
  safety: 'An toàn & dụng cụ',
  tech: 'Công nghệ',
  comfort: 'Tiện nghi',
  ev: 'Xe điện',
  other: 'Khác',
};

export interface CatalogSeed {
  name: string;
  category: AccessoryCategory;
  value: number;
  /** Tên gọi khác để tìm kiếm (vd TPMS). */
  aliases?: string;
  /** Điểm cộng khi giới thiệu xe với khách → mặc định hiện trong ảnh chia sẻ. */
  highlight?: boolean;
  /** Xe nào cũng nên có → luôn được gợi ý. */
  essential?: boolean;
  /** Chỉ dành cho xe điện. */
  evOnly?: boolean;
}

/** Danh mục dựng sẵn — nạp một lần khi danh mục còn trống. Giá trị = mức đền bù gợi ý khi mất. */
export const DEFAULT_ACCESSORY_CATALOG: CatalogSeed[] = [
  { name: 'Lốp dự phòng', category: 'safety', value: 1_500_000, aliases: 'lop du phong, banh xe du phong', essential: true },
  { name: 'Bộ dụng cụ / kích', category: 'safety', value: 300_000, aliases: 'con doi, kich xe, do nghe', essential: true },
  { name: 'Tam giác cảnh báo', category: 'safety', value: 100_000, aliases: 'bien bao nguy hiem' },
  { name: 'Bình chữa cháy mini', category: 'safety', value: 250_000, aliases: 'binh cuu hoa' },
  { name: 'Búa thoát hiểm', category: 'safety', value: 100_000 },
  { name: 'Bơm lốp mini', category: 'safety', value: 500_000, aliases: 'bom hoi, may bom lop', highlight: true },
  { name: 'Cảm biến áp suất lốp', category: 'safety', value: 1_500_000, aliases: 'tpms, cam bien lop, ap suat lop', highlight: true },
  { name: 'Thẻ thu phí không dừng (ETC)', category: 'tech', value: 0, aliases: 'etc, vetc, epass, the thu phi', highlight: true, essential: true },
  { name: 'Camera hành trình', category: 'tech', value: 1_500_000, aliases: 'dashcam, camera truoc', highlight: true },
  { name: 'Camera lùi', category: 'tech', value: 1_000_000, aliases: 'camera sau, camera de', highlight: true },
  { name: 'Camera 360', category: 'tech', value: 8_000_000, highlight: true },
  { name: 'Màn hình Android / CarPlay', category: 'tech', value: 5_000_000, aliases: 'man hinh, carplay, android auto', highlight: true },
  { name: 'Thiết bị định vị GPS', category: 'tech', value: 800_000, aliases: 'dinh vi, gps tracker' },
  { name: 'Sạc dự phòng', category: 'tech', value: 500_000, aliases: 'pin du phong, power bank', highlight: true },
  { name: 'Cáp sạc điện thoại', category: 'tech', value: 100_000, aliases: 'day sac, cap lightning, usb c', highlight: true },
  { name: 'Tẩu sạc USB', category: 'tech', value: 150_000, aliases: 'cuc sac oto, sac tau thuoc', highlight: true },
  { name: 'Giá đỡ điện thoại', category: 'tech', value: 150_000, aliases: 'kep dien thoai', highlight: true },
  { name: 'Nước hoa xe', category: 'comfort', value: 200_000, aliases: 'sap thom, khu mui', highlight: true },
  { name: 'Thảm sàn', category: 'comfort', value: 800_000, aliases: 'tham lot san, tham 5d, tham 6d' },
  { name: 'Áo trùm xe', category: 'comfort', value: 500_000, aliases: 'bat phu xe' },
  { name: 'Ô / dù', category: 'comfort', value: 150_000, aliases: 'du che mua' },
  { name: 'Ghế trẻ em', category: 'comfort', value: 2_000_000, aliases: 'ghe em be, ghe ngoi tre em', highlight: true },
  { name: 'Gối tựa cổ', category: 'comfort', value: 200_000 },
  { name: 'Rèm che nắng', category: 'comfort', value: 300_000, aliases: 'tam che nang', highlight: true },
  { name: 'Hộp khăn giấy', category: 'comfort', value: 50_000 },
  { name: 'Tủ lạnh mini', category: 'comfort', value: 2_000_000, highlight: true },
  { name: 'Cáp sạc xe điện di động', category: 'ev', value: 5_000_000, aliases: 'sac di dong, bo sac xe dien', highlight: true, evOnly: true },
  { name: 'Đầu chuyển đổi sạc', category: 'ev', value: 1_000_000, aliases: 'adapter sac', evOnly: true },
  { name: 'Thẻ sạc trạm', category: 'ev', value: 0, aliases: 'the sac vinfast', evOnly: true },
];

export const LICENSE_CLASSES = ['B', 'B1', 'B2', 'C1', 'C', 'D1', 'D2', 'D', 'BE', 'C1E', 'CE', 'D1E', 'D2E', 'DE'];
