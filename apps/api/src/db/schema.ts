// Lược đồ dữ liệu. Thời điểm lưu dạng epoch ms (UTC); ngày thuần (hạn đăng kiểm,
// ngày sinh…) lưu chuỗi "YYYY-MM-DD"; tiền lưu số nguyên VND.
//
// QUY TẮC MIGRATION: chỉ THÊM (bảng/cột mới, cột mới phải nullable hoặc có
// default). Không đổi tên/xóa cột trong cùng bản phát hành — nhờ vậy "quay về
// bản cũ" trong trang Cập nhật vẫn chạy được trên DB đã nâng cấp.
// Sửa file này xong: `npm run db:generate` để sinh file SQL trong drizzle/.

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  AccessoryCategory,
  BlockKind,
  ChargeKind,
  CollateralKind,
  FileKind,
  FineSource,
  FineStatus,
  FuelType,
  PaymentMethod,
  RentalStatus,
  RentalType,
  Role,
  TemplateKind,
  Transmission,
} from '../shared/constants.js';
import type { IdCardType } from '../shared/cccd.js';
import type { PaymentDirection, PaymentPurpose } from '../shared/money.js';

const createdAt = () => integer('created_at').notNull();
const updatedAt = () => integer('updated_at').notNull();

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull().default('staff'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
  lastLoginAt: integer('last_login_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id').notNull(),
    createdAt: createdAt(),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    userId: integer('user_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    detail: text('detail'),
    ip: text('ip'),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_at_idx').on(t.at)],
);

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<FileKind>().notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  path: text('path').notNull(),
  thumbPath: text('thumb_path'),
  originalName: text('original_name'),
  sha256: text('sha256').notNull(),
  takenAt: integer('taken_at'),
  createdBy: integer('created_by'),
  createdAt: createdAt(),
});

export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  plate: text('plate').notNull(),
  plateKey: text('plate_key').notNull().unique(),
  make: text('make').notNull().default(''),
  model: text('model').notNull().default(''),
  year: integer('year'),
  color: text('color'),
  seats: integer('seats'),
  transmission: text('transmission').$type<Transmission>(),
  fuel: text('fuel').$type<FuelType>(),
  vin: text('vin'),
  engineNo: text('engine_no'),
  odo: integer('odo').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ownerType: text('owner_type').$type<'own' | 'consigned'>().notNull().default('own'),
  ownerName: text('owner_name'),
  ownerPhone: text('owner_phone'),
  ownerSharePct: integer('owner_share_pct'),
  priceDay: integer('price_day').notNull().default(0),
  priceHour: integer('price_hour').notNull().default(0),
  priceWeekendDay: integer('price_weekend_day'),
  kmLimitDay: integer('km_limit_day').notNull().default(0),
  overKmFee: integer('over_km_fee').notNull().default(0),
  overHourFee: integer('over_hour_fee').notNull().default(0),
  depositAmount: integer('deposit_amount').notNull().default(0),
  /** Giá thuê tháng (null/0 = không nhận thuê tháng). */
  priceMonth: integer('price_month'),
  /** Giới hạn km mỗi tháng (null = 30 × km/ngày). */
  kmLimitMonth: integer('km_limit_month'),
  inspectionExpiry: text('inspection_expiry'),
  insuranceTndsExpiry: text('insurance_tnds_expiry'),
  insuranceBodyExpiry: text('insurance_body_expiry'),
  roadFeeExpiry: text('road_fee_expiry'),
  nextServiceOdo: integer('next_service_odo'),
  nextServiceDate: text('next_service_date'),
  photoFileId: text('photo_file_id'),
  registrationFileId: text('registration_file_id'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: integer('archived_at'),
});

/** Khoảng xe không cho thuê được (gara, chủ xe dùng). Cũng là bằng chứng khi tra phạt nguội. */
export const vehicleBlocks = sqliteTable(
  'vehicle_blocks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vehicleId: integer('vehicle_id').notNull(),
    kind: text('kind').$type<BlockKind>().notNull(),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at'),
    location: text('location'),
    notes: text('notes'),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('blocks_vehicle_idx').on(t.vehicleId, t.startAt)],
);

/** Danh mục phụ kiện dùng chung cho cả đội xe (tên chuẩn, giá trị đền bù gợi ý). */
export const accessoryCatalog = sqliteTable('accessory_catalog', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Tên không dấu, chữ thường — chống trùng "Sạc dự phòng" / "sac du phong". */
  nameKey: text('name_key').notNull().unique(),
  aliases: text('aliases'),
  category: text('category').$type<AccessoryCategory>().notNull().default('other'),
  defaultValue: integer('default_value').notNull().default(0),
  highlight: integer('highlight', { mode: 'boolean' }).notNull().default(false),
  essential: integer('essential', { mode: 'boolean' }).notNull().default(false),
  evOnly: integer('ev_only', { mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at'),
  createdBy: integer('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Phụ kiện đang có trên từng xe. */
export const vehicleAccessories = sqliteTable(
  'vehicle_accessories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vehicleId: integer('vehicle_id').notNull(),
    catalogId: integer('catalog_id'),
    name: text('name').notNull(),
    category: text('category').$type<AccessoryCategory>().notNull().default('other'),
    quantity: integer('quantity').notNull().default(1),
    note: text('note'),
    /** null = dùng giá trị mặc định của danh mục. */
    value: integer('value'),
    checkOnHandover: integer('check_on_handover', { mode: 'boolean' }).notNull().default(true),
    showInShare: integer('show_in_share', { mode: 'boolean' }).notNull().default(false),
    photoFileId: text('photo_file_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    removedAt: integer('removed_at'),
  },
  (t) => [index('vehicle_accessories_vehicle_idx').on(t.vehicleId)],
);

export const customers = sqliteTable(
  'customers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fullName: text('full_name').notNull(),
    idNumber: text('id_number').unique(),
    oldIdNumber: text('old_id_number'),
    idCardType: text('id_card_type').$type<IdCardType>(),
    dob: text('dob'),
    gender: text('gender'),
    idIssueDate: text('id_issue_date'),
    idIssuePlace: text('id_issue_place'),
    permanentAddress: text('permanent_address'),
    currentAddress: text('current_address'),
    phone: text('phone'),
    phone2: text('phone2'),
    zalo: text('zalo'),
    email: text('email'),
    occupation: text('occupation'),
    licenseNumber: text('license_number'),
    licenseClass: text('license_class'),
    licenseExpiry: text('license_expiry'),
    emergencyName: text('emergency_name'),
    emergencyPhone: text('emergency_phone'),
    emergencyRelation: text('emergency_relation'),
    notes: text('notes'),
    blacklisted: integer('blacklisted', { mode: 'boolean' }).notNull().default(false),
    blacklistReason: text('blacklist_reason'),
    idFrontFileId: text('id_front_file_id'),
    idBackFileId: text('id_back_file_id'),
    licenseFrontFileId: text('license_front_file_id'),
    licenseBackFileId: text('license_back_file_id'),
    portraitFileId: text('portrait_file_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: integer('archived_at'),
  },
  (t) => [index('customers_phone_idx').on(t.phone)],
);

export const rentals = sqliteTable(
  'rentals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull().unique(),
    type: text('type').$type<RentalType>().notNull().default('self_drive'),
    status: text('status').$type<RentalStatus>().notNull(),
    customerId: integer('customer_id').notNull(),
    vehicleId: integer('vehicle_id').notNull(),
    scheduledStart: integer('scheduled_start').notNull(),
    scheduledEnd: integer('scheduled_end').notNull(),
    actualStart: integer('actual_start'),
    actualEnd: integer('actual_end'),
    pickupMethod: text('pickup_method').$type<'at_shop' | 'delivery'>().notNull().default('at_shop'),
    pickupLocation: text('pickup_location'),
    returnLocation: text('return_location'),
    /** Bảng giá xe tại thời điểm đặt (JSON VehiclePricing) — đổi giá xe sau này không ảnh hưởng. */
    pricing: text('pricing').notNull(),
    kmLimit: integer('km_limit').notNull().default(0),
    depositRequired: integer('deposit_required').notNull().default(0),
    fineHoldAmount: integer('fine_hold_amount').notNull().default(0),
    fineHoldUntil: integer('fine_hold_until'),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    createdBy: integer('created_by'),
    handledBy: integer('handled_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('rentals_vehicle_idx').on(t.vehicleId, t.scheduledStart),
    index('rentals_customer_idx').on(t.customerId),
    index('rentals_status_idx').on(t.status),
  ],
);

/**
 * Xe nào nằm trong tay khách từ lúc nào đến lúc nào (theo giờ THỰC TẾ).
 * Nguồn sự thật để tra phạt nguội. Đổi xe giữa chừng = thêm một đoạn.
 */
export const rentalSegments = sqliteTable(
  'rental_segments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    vehicleId: integer('vehicle_id').notNull(),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at'),
    note: text('note'),
  },
  (t) => [index('segments_vehicle_idx').on(t.vehicleId, t.startAt), index('segments_rental_idx').on(t.rentalId)],
);

/** Người lái phụ (người thuê = rentals.customer_id là người lái chính). */
export const rentalDrivers = sqliteTable(
  'rental_drivers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    customerId: integer('customer_id').notNull(),
    note: text('note'),
  },
  (t) => [uniqueIndex('rental_drivers_uq').on(t.rentalId, t.customerId)],
);

export interface HandoverPhoto {
  slot: string;
  fileId: string;
}
/** Ảnh chụp tình trạng một phụ kiện lúc giao/nhận (lưu nguyên khối, không phụ thuộc thay đổi sau này). */
export interface HandoverAccessory {
  /** id trong vehicle_accessories (null nếu phụ kiện đã bị xóa khỏi xe). */
  id: number | null;
  name: string;
  quantity: number;
  value: number;
  present: boolean;
  note?: string | null;
}
export interface HandoverDamage {
  zone: string;
  note: string;
  fileId?: string | null;
  isNew?: boolean;
}

export const handovers = sqliteTable(
  'handovers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    kind: text('kind').$type<'pickup' | 'return'>().notNull(),
    vehicleId: integer('vehicle_id').notNull(),
    at: integer('at').notNull(),
    odo: integer('odo').notNull(),
    fuelLevel: integer('fuel_level').notNull(),
    checklist: text('checklist', { mode: 'json' }).$type<Record<string, boolean>>().notNull(),
    photos: text('photos', { mode: 'json' }).$type<HandoverPhoto[]>().notNull(),
    damages: text('damages', { mode: 'json' }).$type<HandoverDamage[]>().notNull(),
    accessories: text('accessories', { mode: 'json' }).$type<HandoverAccessory[]>().notNull().default([]),
    notes: text('notes'),
    signatureFileId: text('signature_file_id'),
    staffUserId: integer('staff_user_id'),
    createdAt: createdAt(),
  },
  (t) => [index('handovers_rental_idx').on(t.rentalId)],
);

export const charges = sqliteTable(
  'charges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    kind: text('kind').$type<ChargeKind>().notNull(),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    /** Dòng tiền thuê do bộ tính giá sinh ra — được tính lại khi đổi lịch. */
    auto: integer('auto', { mode: 'boolean' }).notNull().default(false),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('charges_rental_idx').on(t.rentalId)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    direction: text('direction').$type<PaymentDirection>().notNull(),
    purpose: text('purpose').$type<PaymentPurpose>().notNull(),
    method: text('method').$type<PaymentMethod>().notNull(),
    amount: integer('amount').notNull(),
    at: integer('at').notNull(),
    note: text('note'),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
    voidedAt: integer('voided_at'),
    voidReason: text('void_reason'),
  },
  (t) => [index('payments_rental_idx').on(t.rentalId)],
);

export const collaterals = sqliteTable(
  'collaterals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    kind: text('kind').$type<CollateralKind>().notNull(),
    description: text('description').notNull(),
    photoFileIds: text('photo_file_ids', { mode: 'json' }).$type<string[]>().notNull(),
    receivedAt: integer('received_at').notNull(),
    returnedAt: integer('returned_at'),
    notes: text('notes'),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('collaterals_rental_idx').on(t.rentalId)],
);

export const contractTemplates = sqliteTable('contract_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind').$type<TemplateKind>().notNull(),
  fileId: text('file_id').notNull(),
  version: integer('version').notNull().default(1),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  builtin: text('builtin'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Văn bản đã sinh — đóng băng: không bao giờ sinh lại đè lên bản cũ. */
export const documents = sqliteTable(
  'documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id').notNull(),
    templateId: integer('template_id'),
    templateName: text('template_name').notNull(),
    templateVersion: integer('template_version').notNull(),
    kind: text('kind').$type<TemplateKind>().notNull(),
    docxFileId: text('docx_file_id').notNull(),
    pdfFileId: text('pdf_file_id'),
    sha256: text('sha256').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    scanFileIds: text('scan_file_ids', { mode: 'json' }).$type<string[]>().notNull(),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('documents_rental_idx').on(t.rentalId)],
);

export const trafficFines = sqliteTable(
  'traffic_fines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vehicleId: integer('vehicle_id'),
    plate: text('plate').notNull(),
    plateKey: text('plate_key').notNull(),
    violatedAt: integer('violated_at').notNull(),
    location: text('location'),
    violation: text('violation'),
    amount: integer('amount'),
    source: text('source').$type<FineSource>().notNull().default('csgt'),
    noticeFileId: text('notice_file_id'),
    rentalId: integer('rental_id'),
    customerId: integer('customer_id'),
    status: text('status').$type<FineStatus>().notNull().default('new'),
    notes: text('notes'),
    createdBy: integer('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('fines_plate_idx').on(t.plateKey, t.violatedAt), index('fines_customer_idx').on(t.customerId)],
);

/** Bộ đếm số hợp đồng theo năm: "rental-2026" → 17. */
export const sequences = sqliteTable('sequences', {
  name: text('name').primaryKey(),
  value: integer('value').notNull(),
});

/** Chống gửi trùng nhắc việc (Telegram): mỗi khóa chỉ gửi một lần. */
export const reminderLog = sqliteTable('reminder_log', {
  key: text('key').primaryKey(),
  sentAt: integer('sent_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type AccessoryCatalogItem = typeof accessoryCatalog.$inferSelect;
export type VehicleAccessory = typeof vehicleAccessories.$inferSelect;
export type VehicleBlock = typeof vehicleBlocks.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
export type RentalSegment = typeof rentalSegments.$inferSelect;
export type Handover = typeof handovers.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Collateral = typeof collaterals.$inferSelect;
export type ContractTemplate = typeof contractTemplates.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type TrafficFine = typeof trafficFines.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
