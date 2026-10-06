// Dữ liệu mẫu để thử app / chụp ảnh màn hình. KHÔNG chạy trên máy thật đang dùng.
//   DATA_DIR=./data-demo npx tsx scripts/seed-demo.ts
//
// Tạo: tài khoản admin/demo12345 + nv1/demo12345, 5 xe, 8 khách, các lượt thuê ở đủ trạng thái.

import { closeDb, db, openDb, schema } from '../src/db/index.js';
import { hashPassword } from '../src/lib/auth.js';
import { setSetting, getSetting } from '../src/lib/settings.js';
import { addAccessories, ensureAccessoryCatalog, handoverAccessoryTemplate } from '../src/services/accessories.js';
import { ensureBuiltinTemplates } from '../src/services/documents.js';
import { cancelRental, createRental, pickup, returnVehicle, settle } from '../src/services/rentals.js';
import { DAY_MS, HOUR_MS, vnStartOfDay } from '../src/shared/time.js';
import { plateKey } from '../src/shared/text.js';

openDb();
ensureBuiltinTemplates();
ensureAccessoryCatalog();

if (db.select().from(schema.users).all().length) {
  console.error('DB đã có dữ liệu — dừng để không ghi đè. Dùng DATA_DIR trống.');
  process.exit(1);
}

const now = Date.now();
const today = vnStartOfDay(now);
const at = (dayOffset: number, hour: number) => today + dayOffset * DAY_MS + hour * HOUR_MS;

const admin = db
  .insert(schema.users)
  .values({ username: 'admin', displayName: 'Anh Bằng', passwordHash: await hashPassword('demo12345'), role: 'admin', active: true, createdAt: now })
  .returning()
  .get();
db.insert(schema.users).values({ username: 'nv1', displayName: 'Tuấn giao xe', passwordHash: await hashPassword('demo12345'), role: 'staff', active: true, createdAt: now }).run();

setSetting('business', {
  ...getSetting('business'),
  name: 'Xe Tự Lái Happy Car',
  representative: 'Nguyễn Duy Bằng',
  position: 'Chủ hộ kinh doanh',
  phone: '0901 234 567',
  address: '123 Nguyễn Văn Linh, Phường Tân Phong, TP. Hồ Chí Minh',
  signCity: 'TP. Hồ Chí Minh',
  shareNote: 'Giao xe tận nơi nội thành TP.HCM\nNhận đặt xe 24/7 qua Zalo',
  bankBin: '970436',
  bankName: 'Vietcombank',
  bankAccount: '0123456789',
  bankAccountName: 'NGUYEN DUY BANG',
});
setSetting('rules', { ...getSetting('rules'), holidays: [{ name: 'Tết Nguyên đán', from: '2027-02-05', to: '2027-02-12', surchargePct: 50 }] });

const cars = [
  { plate: '51K-123.45', make: 'Toyota', model: 'Vios 1.5G', year: 2023, color: 'Trắng', seats: 5, priceDay: 800000, priceWeekendDay: 950000, odo: 31000, inspectionExpiry: '2026-10-20' },
  { plate: '51H-678.90', make: 'Mitsubishi', model: 'Xpander AT', year: 2022, color: 'Bạc', seats: 7, priceDay: 1000000, priceWeekendDay: 1200000, odo: 48000, insuranceTndsExpiry: '2026-10-12' },
  { plate: '51L-246.80', make: 'Kia', model: 'Seltos Premium', year: 2024, color: 'Đỏ', seats: 5, priceDay: 1100000, priceWeekendDay: 1300000, odo: 15420 },
  { plate: '51G-135.79', make: 'Hyundai', model: 'Accent AT', year: 2021, color: 'Đen', seats: 5, priceDay: 750000, priceWeekendDay: 850000, odo: 66800, nextServiceOdo: 67500 },
  { plate: '51K-999.88', make: 'VinFast', model: 'VF 6 Plus', year: 2025, color: 'Xanh', seats: 5, priceDay: 1200000, priceWeekendDay: 1400000, odo: 8900, fuel: 'electric' as const },
];
const vehicleIds: number[] = [];
for (const c of cars) {
  const v = db
    .insert(schema.vehicles)
    .values({
      ...c,
      plateKey: plateKey(c.plate),
      transmission: 'AT',
      fuel: c.fuel ?? 'gasoline',
      priceHour: Math.round(c.priceDay / 8 / 1000) * 1000,
      kmLimitDay: 300,
      overKmFee: 3000,
      overHourFee: Math.round(c.priceDay / 8 / 1000) * 1000,
      depositAmount: 5000000,
      roadFeeExpiry: '2027-06-30',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  vehicleIds.push(v.id);
}

const kit: string[][] = [
  ['Cảm biến áp suất lốp', 'Camera hành trình', 'Sạc dự phòng', 'Lốp dự phòng', 'Bộ dụng cụ / kích', 'Thẻ thu phí không dừng (ETC)', 'Nước hoa xe'],
  ['Camera lùi', 'Màn hình Android / CarPlay', 'Ghế trẻ em', 'Lốp dự phòng', 'Thẻ thu phí không dừng (ETC)', 'Cáp sạc điện thoại'],
  ['Cảm biến áp suất lốp', 'Camera 360', 'Lốp dự phòng', 'Thẻ thu phí không dừng (ETC)'],
  ['Lốp dự phòng', 'Bộ dụng cụ / kích', 'Thẻ thu phí không dừng (ETC)'],
  ['Cáp sạc xe điện di động', 'Thẻ sạc trạm', 'Camera 360', 'Thẻ thu phí không dừng (ETC)', 'Sạc dự phòng'],
];
kit.forEach((names, i) => addAccessories(vehicleIds[i], names.map((name) => ({ name, note: name === 'Sạc dự phòng' ? 'Xiaomi 10.000mAh, hộc trước' : null })), admin.id));

const people = [
  ['Nguyễn Văn An', '079090001234', '0903111222', '1990-08-15', 'Nam'],
  ['Trần Thị Bình', '001195012345', '0912333444', '1995-02-01', 'Nữ'],
  ['Lê Hoàng Cường', '052088004321', '0987555666', '1988-11-20', 'Nam'],
  ['Phạm Minh Đức', '079092007777', '0938777888', '1992-05-09', 'Nam'],
  ['Võ Thị Hồng', '080197002468', '0909999000', '1997-12-30', 'Nữ'],
  ['Đặng Quốc Huy', '075085001357', '0977222111', '1985-07-07', 'Nam'],
  ['Bùi Gia Khánh', '079099008642', '0966333222', '1999-03-14', 'Nam'],
  ['Hồ Thanh Lam', '068091003579', '0945444333', '1991-09-25', 'Nữ'],
];
const customerIds: number[] = [];
for (const [fullName, idNumber, phone, dob, gender] of people) {
  const c = db
    .insert(schema.customers)
    .values({
      fullName,
      idNumber,
      phone,
      dob,
      gender,
      idCardType: 'cccd_chip',
      idIssueDate: '2021-04-20',
      idIssuePlace: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội',
      permanentAddress: 'TP. Hồ Chí Minh',
      licenseNumber: `79${idNumber.slice(2)}`,
      licenseClass: 'B',
      licenseExpiry: '2032-01-01',
      blacklisted: fullName === 'Đặng Quốc Huy',
      blacklistReason: fullName === 'Đặng Quốc Huy' ? 'Không trả tiền phạt nguội lần trước' : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  customerIds.push(c.id);
}

const base = { pickupMethod: 'at_shop' as const, pickupLocation: null, returnLocation: null, deliveryFee: 0, discount: 0, discountNote: null, driverIds: [], notes: null, collaterals: [], allowConflict: true, allowBlacklisted: true };
const ho = (t: number, odo: number, vehicleId = 0) => ({ at: t, odo, fuelLevel: 100, checklist: {}, photos: [], damages: [], accessories: vehicleId ? handoverAccessoryTemplate(vehicleId) : [], notes: null, signatureFileId: null });

// Đã xong, đang giữ cọc phạt nguội
const r1 = createRental({ ...base, customerId: customerIds[0], vehicleId: vehicleIds[0], scheduledStart: at(-9, 8), scheduledEnd: at(-6, 8), depositRequired: 5000000, payments: [{ purpose: 'deposit', method: 'transfer', amount: 5000000 }, { purpose: 'rent', method: 'cash', amount: 2550000 }] }, admin.id);
pickup(r1.id, { ...ho(at(-9, 8.2), 31200, vehicleIds[0]), payments: [], collaterals: [] }, admin.id);
returnVehicle(r1.id, { ...ho(at(-6, 9.5), 32150, vehicleIds[0]), fuelLevel: 75, charges: [{ kind: 'over_time', description: 'Trả xe trễ 1 giờ 30 phút', amount: 200000 }] }, admin.id);
settle(r1.id, { collect: null, refundRent: null, offset: 200000, refundDeposit: { amount: 2800000, method: 'transfer' }, fineHoldDays: 15, returnCollaterals: true, note: null }, admin.id);

// Đang thuê, trả hôm nay
const r2 = createRental({ ...base, customerId: customerIds[1], vehicleId: vehicleIds[1], scheduledStart: at(-2, 9), scheduledEnd: at(0, 18), depositRequired: 5000000, payments: [{ purpose: 'deposit', method: 'transfer', amount: 5000000 }] }, admin.id);
pickup(r2.id, { ...ho(at(-2, 9.1), 48300, vehicleIds[1]), payments: [{ purpose: 'rent', method: 'transfer', amount: 1500000 }], collaterals: [] }, admin.id);

// Đang thuê, quá hạn
const r3 = createRental({ ...base, customerId: customerIds[2], vehicleId: vehicleIds[3], scheduledStart: at(-3, 10), scheduledEnd: now - 3 * HOUR_MS, depositRequired: 5000000, payments: [{ purpose: 'deposit', method: 'cash', amount: 5000000 }] }, admin.id);
pickup(r3.id, { ...ho(at(-3, 10.2), 66900, vehicleIds[3]), payments: [], collaterals: [] }, admin.id);

// Đã đặt: giao hôm nay + tuần sau
createRental({ ...base, customerId: customerIds[3], vehicleId: vehicleIds[2], scheduledStart: at(0, 16), scheduledEnd: at(3, 16), depositRequired: 5000000, payments: [{ purpose: 'deposit', method: 'transfer', amount: 1000000 }], pickupMethod: 'delivery', pickupLocation: '45 Lê Lợi, Q1', deliveryFee: 150000 }, admin.id);
createRental({ ...base, customerId: customerIds[4], vehicleId: vehicleIds[0], scheduledStart: at(2, 8), scheduledEnd: at(4, 8), depositRequired: 5000000, payments: [] }, admin.id);
createRental({ ...base, customerId: customerIds[6], vehicleId: vehicleIds[4], scheduledStart: at(4, 7), scheduledEnd: at(7, 19), depositRequired: 5000000, payments: [] }, admin.id);
const rc = createRental({ ...base, customerId: customerIds[7], vehicleId: vehicleIds[4], scheduledStart: at(-5, 8), scheduledEnd: at(-4, 8), depositRequired: 0, payments: [] }, admin.id);
cancelRental(rc.id, 'Khách đổi lịch', admin.id);

// Xe vào gara
db.insert(schema.vehicleBlocks).values({ vehicleId: vehicleIds[4], kind: 'maintenance', startAt: at(-1, 9), endAt: at(1, 17), location: 'VinFast Thảo Điền', notes: 'Bảo dưỡng 10.000 km', createdBy: admin.id, createdAt: now }).run();

// Phạt nguội gắn với lượt 1
db.insert(schema.trafficFines)
  .values({ vehicleId: vehicleIds[0], plate: '51K-123.45', plateKey: '51K12345', violatedAt: at(-8, 14.5), location: 'Cao tốc TP.HCM – Long Thành', violation: 'Chạy quá tốc độ 10–20 km/h', amount: 4000000, source: 'csgt', rentalId: r1.id, customerId: customerIds[0], status: 'notified', createdBy: admin.id, createdAt: now, updatedAt: now })
  .run();

closeDb();
console.log('✓ Đã tạo dữ liệu mẫu. Đăng nhập admin / demo12345');
