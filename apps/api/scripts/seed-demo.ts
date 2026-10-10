// Dữ liệu mẫu để thử app / chụp ảnh màn hình. KHÔNG chạy trên máy thật đang dùng.
//   DATA_DIR=./data-demo npx tsx scripts/seed-demo.ts
//
// Tạo: tài khoản admin/demo12345 + nv1/demo12345, 5 xe, 8 khách, các lượt thuê ở đủ trạng thái,
// lịch sử 6 tháng (lượt đã xong, chi phí xe, chi phí chung, khoản định kỳ) cho trang Thu chi.

import { and, eq, ne } from 'drizzle-orm';
import { closeDb, db, openDb, schema } from '../src/db/index.js';
import { hashPassword } from '../src/lib/auth.js';
import { setSetting, getSetting } from '../src/lib/settings.js';
import { addAccessories, ensureAccessoryCatalog, handoverAccessoryTemplate } from '../src/services/accessories.js';
import { ensureBuiltinTemplates } from '../src/services/documents.js';
import { createEntry, createRecurring } from '../src/services/cashflow.js';
import { cancelRental, createRental, pickup, rentalMoney, returnVehicle, settle } from '../src/services/rentals.js';
import { addMonthKey, monthKeyOf, type CashCategory } from '../src/shared/cashflow.js';
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
  { plate: '51K-123.45', make: 'Toyota', model: 'Vios 1.5G', year: 2023, color: 'Trắng', seats: 5, priceDay: 800000, priceWeekendDay: 950000, priceMonth: 15000000, kmLimitMonth: 3000, odo: 31000, inspectionExpiry: '2026-10-20' },
  { plate: '51H-678.90', make: 'Mitsubishi', model: 'Xpander AT', year: 2022, color: 'Bạc', seats: 7, priceDay: 1000000, priceWeekendDay: 1200000, priceMonth: 20000000, odo: 48000, insuranceTndsExpiry: '2026-10-12' },
  { plate: '51L-246.80', make: 'Kia', model: 'Seltos Premium', year: 2024, color: 'Đỏ', seats: 5, priceDay: 1100000, priceWeekendDay: 1300000, odo: 15420 },
  { plate: '51G-135.79', make: 'Hyundai', model: 'Accent AT', year: 2021, color: 'Đen', seats: 5, priceDay: 750000, priceWeekendDay: 850000, priceMonth: 14000000, odo: 66800, nextServiceOdo: 67500 },
  { plate: '51K-999.88', make: 'VinFast', model: 'VF 6 Plus', year: 2025, color: 'Xanh', seats: 5, priceDay: 1200000, priceWeekendDay: 1400000, priceMonth: 22000000, kmLimitMonth: 4000, odo: 8900, fuel: 'electric' as const, freeCharges: 1, chargeFee: 30000 },
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

// ── Lịch sử 6 tháng: lượt đã xong (tiền trả đúng ngày) để trang Thu chi có số liệu ──
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const regulars = customerIds.filter((_, i) => i !== 5);
const histStart = today - 180 * DAY_MS;
const histEnd = today - 14 * DAY_MS;
cars.forEach((car, ci) => {
  const vid = vehicleIds[ci];
  let odo = car.odo - 9000;
  db.update(schema.vehicles).set({ odo }).where(eq(schema.vehicles.id, vid)).run();
  let cursor = histStart + between(0, 3) * DAY_MS;
  for (;;) {
    const start = cursor + between(1, 4) * DAY_MS + 8 * HOUR_MS;
    const days = between(1, 3);
    const end = start + days * DAY_MS;
    if (end > histEnd) break;
    const r = createRental({ ...base, customerId: regulars[between(0, regulars.length - 1)], vehicleId: vid, scheduledStart: start, scheduledEnd: end, depositRequired: 5000000, payments: [{ purpose: 'deposit', method: 'transfer', amount: 5000000 }] }, admin.id);
    const total = rentalMoney(r.id).totalCharges;
    pickup(r.id, { ...ho(start + 0.2 * HOUR_MS, odo, vid), payments: [{ purpose: 'rent', method: rnd() < 0.6 ? 'transfer' : 'cash', amount: total }], collaterals: [] }, admin.id);
    odo = Math.min(odo + between(120, 300) * days, car.odo - 100);
    const extra = rnd();
    const charges = extra < 0.15 ? [{ kind: 'cleaning' as const, description: 'Vệ sinh xe (xe bẩn)', amount: 150000 }] : extra < 0.27 ? [{ kind: 'over_time' as const, description: 'Trả xe trễ 1 giờ', amount: Math.round(car.priceDay / 8 / 1000) * 1000 }] : [];
    returnVehicle(r.id, { ...ho(end, odo, vid), charges }, admin.id);
    const due = rentalMoney(r.id).due;
    settle(r.id, { collect: null, refundRent: null, offset: due, refundDeposit: { amount: 5000000 - due, method: 'transfer' }, fineHoldDays: 15, returnCollaterals: true, note: null }, admin.id);
    db.update(schema.payments).set({ at: start }).where(and(eq(schema.payments.rentalId, r.id), eq(schema.payments.direction, 'in'))).run();
    db.update(schema.payments).set({ at: end + HOUR_MS }).where(and(eq(schema.payments.rentalId, r.id), ne(schema.payments.direction, 'in'))).run();
    cursor = vnStartOfDay(end);
  }
  db.update(schema.vehicles).set({ odo: car.odo }).where(eq(schema.vehicles.id, vid)).run();
});

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
cancelRental(rc.id, { reason: 'Khách đổi lịch', keep: 0, refund: null }, admin.id);

// Xe vào gara
db.insert(schema.vehicleBlocks).values({ vehicleId: vehicleIds[4], kind: 'maintenance', startAt: at(-1, 9), endAt: at(1, 17), location: 'VinFast Thảo Điền', notes: 'Bảo dưỡng 10.000 km', createdBy: admin.id, createdAt: now }).run();

// Phạt nguội gắn với lượt 1
db.insert(schema.trafficFines)
  .values({ vehicleId: vehicleIds[0], plate: '51K-123.45', plateKey: '51K12345', violatedAt: at(-8, 14.5), location: 'Cao tốc TP.HCM – Long Thành', violation: 'Chạy quá tốc độ 10–20 km/h', amount: 4000000, source: 'csgt', rentalId: r1.id, customerId: customerIds[0], status: 'notified', createdBy: admin.id, createdAt: now, updatedAt: now })
  .run();

// ── Chi phí xe, chi phí chung, khoản định kỳ ──
const spend = (category: CashCategory, amount: number, dayOffset: number, vehicleId: number | null, description: string | null, vendor: string | null = null, odo: number | null = null) =>
  createEntry({ category, amount, at: Math.min(now - HOUR_MS, at(Math.min(0, dayOffset), 10 + between(0, 8))), vehicleId, method: rnd() < 0.5 ? 'cash' : 'transfer', description, vendor, odo, receiptFileIds: [] }, admin.id);
for (let d = -178; d < 0; d += 7) {
  cars.forEach((car, ci) => {
    if (rnd() < 0.7) spend('cleaning', between(8, 12) * 10000, d + between(0, 6), vehicleIds[ci], 'Rửa xe, hút bụi', 'Tiệm rửa xe Bảo Ngọc');
    if (rnd() < 0.35) spend('fuel', car.fuel === 'electric' ? between(15, 25) * 10000 : between(30, 55) * 10000, d + between(0, 6), vehicleIds[ci], car.fuel === 'electric' ? 'Sạc đầy trước khi giao xe' : 'Đổ đầy bình trước khi giao xe', car.fuel === 'electric' ? 'Trạm sạc V-Green' : 'Petrolimex');
  });
  if (rnd() < 0.5) spend('delivery', between(6, 12) * 10000, d + between(0, 6), null, 'Grab về sau khi giao xe tận nơi');
}
for (let m = 0; m < 6; m++) spend('marketing', between(10, 16) * 100000, -170 + m * 30, null, 'Quảng cáo Facebook', 'Meta');
spend('maintenance', 1850000, -120, vehicleIds[0], 'Bảo dưỡng 30.000 km: thay dầu, lọc dầu, lọc gió', 'Toyota Lý Thường Kiệt', 25500);
spend('maintenance', 950000, -60, vehicleIds[3], 'Thay dầu, lọc nhớt', 'Gara Minh Phát', 63000);
spend('repair', 2500000, -95, vehicleIds[1], 'Gò sơn cản sau (khách va chạm)', 'Gara Hoàng Long');
spend('insurance_claim', 2000000, -80, vehicleIds[1], 'Bảo hiểm bồi thường sửa cản sau', 'Bảo Việt');
spend('parts', 3200000, -40, vehicleIds[3], 'Thay 2 lốp trước Michelin', 'Lốp Thành Công', 64800);
spend('inspection', 560000, -150, vehicleIds[2], 'Đăng kiểm định kỳ', 'Trung tâm đăng kiểm 50-03V');
spend('insurance', 9800000, -170, vehicleIds[4], 'Bảo hiểm thân vỏ 1 năm', 'PVI');
spend('insurance', 480700, -30, vehicleIds[0], 'Bảo hiểm TNDS 1 năm', 'Bảo Việt');
spend('accessory', 1650000, -100, vehicleIds[2], 'Camera hành trình 70mai', 'Shopee');
spend('toll', 500000, -75, vehicleIds[1], 'Nạp tiền thẻ ETC', 'VETC');
const startMonth = monthKeyOf(today - 175 * DAY_MS);
createRecurring({ category: 'parking', amount: 4500000, vehicleId: null, method: 'transfer', description: 'Thuê bãi đậu 5 xe', vendor: 'Bãi xe Nguyễn Văn Linh', dayOfMonth: 1, intervalMonths: 1, startMonth, endMonth: null, active: true }, admin.id);
createRecurring({ category: 'salary', amount: 7000000, vehicleId: null, method: 'transfer', description: 'Lương Tuấn giao xe', vendor: null, dayOfMonth: 5, intervalMonths: 1, startMonth, endMonth: null, active: true }, admin.id);
createRecurring({ category: 'loan', amount: 9200000, vehicleId: vehicleIds[4], method: 'transfer', description: 'Trả góp VinFast VF 6', vendor: 'VPBank', dayOfMonth: 15, intervalMonths: 1, startMonth, endMonth: addMonthKey(startMonth, 35), active: true }, admin.id);
createRecurring({ category: 'premises', amount: 300000, vehicleId: null, method: 'transfer', description: 'Internet + điện thoại cửa hàng', vendor: 'Viettel', dayOfMonth: 10, intervalMonths: 1, startMonth, endMonth: null, active: true }, admin.id);

closeDb();
console.log('✓ Đã tạo dữ liệu mẫu. Đăng nhập admin / demo12345');
