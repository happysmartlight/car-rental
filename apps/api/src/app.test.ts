// Kiểm thử tích hợp: chạy app thật trên DB tạm, đi trọn một lượt thuê.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PizZip from 'pizzip';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vnLocalInputToMs } from './shared/time.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'car-rental-test-'));
process.env.DATA_DIR = dir;
process.env.GOTENBERG_URL = '';
const { buildApp } = await import('./app.js');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie = '';
let staffCookie = '';

const at = vnLocalInputToMs;

async function call(method: string, url: string, body?: unknown, cookie = adminCookie) {
  const res = await app.inject({ method: method as 'GET', url, payload: body as object, headers: { cookie } });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    /* không phải JSON */
  }
  return { status: res.statusCode, json, res };
}

async function upload(kind: string, cookie = adminCookie): Promise<string> {
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3b82f6' } }).png().toBuffer();
  const boundary = '----cr' + Math.random().toString(16).slice(2);
  const head = (name: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`;
  const payload = Buffer.concat([
    Buffer.from(`${head('kind')}${kind}\r\n${head('stamp')}51K-123.45 • test\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: 'POST', url: '/api/files', payload, headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id;
}

const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0];

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('luồng một lượt thuê', () => {
  let vehicleId = 0;
  let customerId = 0;
  let rentalId = 0;

  it('lần đầu: tạo tài khoản quản trị', async () => {
    expect((await call('GET', '/api/auth/state')).json.needsSetup).toBe(true);
    expect((await call('GET', '/api/customers')).status).toBe(401);
    const r = await call('POST', '/api/auth/setup', { username: 'Admin', displayName: 'Chủ xe', password: 'matkhau123' });
    expect(r.status).toBe(200);
    adminCookie = cookieOf(r.res);
    expect((await call('POST', '/api/auth/setup', { username: 'x', displayName: 'x', password: 'matkhau123' })).status).toBe(409);
  });

  it('cài đặt cửa hàng + mẫu dựng sẵn đã có', async () => {
    const r = await call('PUT', '/api/settings/business', { name: 'Xe Tự Lái An Phát', representative: 'Nguyễn Văn Chủ', address: '1 Lê Lợi, Q1', signCity: 'TP. Hồ Chí Minh', bankBin: '970436', bankAccount: '0123456789', bankAccountName: 'NGUYEN VAN CHU' });
    expect(r.status).toBe(200);
    const t = await call('GET', '/api/templates');
    expect(t.json.map((x: any) => x.kind).sort()).toEqual(['contract', 'pickup', 'return']);
  });

  it('thêm xe, chặn trùng biển số', async () => {
    const body = { plate: '51k12345', make: 'Toyota', model: 'Vios', seats: 5, transmission: 'AT', fuel: 'gasoline', odo: 10000, priceDay: 800000, priceHour: 100000, priceWeekendDay: 1000000, kmLimitDay: 300, overKmFee: 3000, overHourFee: 100000, depositAmount: 5000000 };
    const r = await call('POST', '/api/vehicles', body);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.plate).toBe('51K-123.45');
    vehicleId = r.json.id;
    expect((await call('POST', '/api/vehicles', { ...body, plate: '51K-123.45' })).status).toBe(409);
  });

  it('thêm khách, chặn trùng CCCD, tìm không dấu', async () => {
    const body = { fullName: 'Nguyễn Văn An', idNumber: '079090001234', dob: '1990-08-15', phone: '0901234567', licenseNumber: '790123456789', licenseClass: 'B', licenseExpiry: '2030-01-01', permanentAddress: '12 Lê Lợi' };
    const r = await call('POST', '/api/customers', body);
    expect(r.status).toBe(200);
    customerId = r.json.id;
    const dup = await call('POST', '/api/customers', body);
    expect(dup.status).toBe(409);
    expect(dup.json.existingId).toBe(customerId);
    expect((await call('GET', '/api/customers?q=nguyen van')).json.total).toBe(1);
    expect((await call('GET', '/api/customers/lookup?idNumber=079090001234')).json.customer.id).toBe(customerId);
  });

  it('báo giá + đặt xe + chặn trùng lịch', async () => {
    const times = { scheduledStart: at('2026-10-10T08:00'), scheduledEnd: at('2026-10-12T08:00') };
    const pre = await call('POST', '/api/rentals/precheck', { vehicleId, customerId, ...times });
    expect(pre.json.quote.total).toBe(2_000_000); // T7 + CN giá cuối tuần
    expect(pre.json.conflicts).toEqual([]);
    const r = await call('POST', '/api/rentals', {
      vehicleId,
      customerId,
      ...times,
      depositRequired: 5000000,
      payments: [
        { purpose: 'deposit', method: 'transfer', amount: 5000000 },
        { purpose: 'rent', method: 'cash', amount: 2000000 },
      ],
      collaterals: [{ kind: 'motorbike', description: 'Honda Vision 59X1-123.45 + cà vẹt' }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.code).toBe('HD-2026-0001');
    rentalId = r.json.id;
    const clash = await call('POST', '/api/rentals', { vehicleId, customerId, scheduledStart: at('2026-10-11T08:00'), scheduledEnd: at('2026-10-13T08:00') });
    expect(clash.status).toBe(409);
    expect(clash.json.conflicts).toHaveLength(1);
  });

  it('giao xe có ảnh đóng dấu', async () => {
    const photo = await upload('handover_photo');
    const r = await call('POST', `/api/rentals/${rentalId}/pickup`, { at: at('2026-10-10T08:10'), odo: 10050, fuelLevel: 100, checklist: { 'Lốp dự phòng': true }, photos: [{ slot: 'front', fileId: photo }], damages: [{ zone: 'Cản sau', note: 'trầy nhẹ' }] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.status).toBe('active');
    const img = await app.inject({ method: 'GET', url: `/api/files/${photo}`, headers: { cookie: adminCookie } });
    expect(img.headers['content-type']).toBe('image/webp');
  });

  it('nhận xe: gợi ý phụ phí trễ giờ + vượt km', async () => {
    const preview = await call('POST', `/api/rentals/${rentalId}/return-preview`, { at: at('2026-10-12T10:30'), odo: 10750 });
    expect(preview.json.kmDriven).toBe(700);
    const amounts = preview.json.suggestions.map((s: any) => [s.kind, s.amount]);
    expect(amounts).toEqual([
      ['over_time', 300000],
      ['over_km', 300000],
    ]);
    const r = await call('POST', `/api/rentals/${rentalId}/return`, { at: at('2026-10-12T10:30'), odo: 10750, fuelLevel: 75, charges: preview.json.suggestions, damages: [{ zone: 'Cửa trước trái', note: 'móp', isNew: true }] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.status).toBe('returned');
  });

  it('quyết toán: cấn trừ cọc, giữ cọc phạt nguội', async () => {
    const d = await call('GET', `/api/rentals/${rentalId}`);
    expect(d.json.money.due).toBe(600000);
    expect(d.json.money.depositHeld).toBe(5000000);
    const r = await call('POST', `/api/rentals/${rentalId}/settle`, { offset: 600000, refundDeposit: { amount: 2400000, method: 'transfer' }, fineHoldDays: 15 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.status).toBe('settled');
    expect(r.json.fineHoldAmount).toBe(2000000);
  });

  it('sinh hợp đồng .docx với dữ liệu thật', async () => {
    const r = await call('POST', `/api/rentals/${rentalId}/documents`, { kind: 'contract' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.pdfError).toMatch(/GOTENBERG/);
    const file = await app.inject({ method: 'GET', url: `/api/files/${r.json.document.docxFileId}`, headers: { cookie: adminCookie } });
    const xml = new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    expect(xml).toContain('HD-2026-0001');
    expect(xml).toContain('Nguyễn Văn An');
    expect(xml).toContain('51K-123.45');
    expect(xml).toContain('Honda Vision');
    expect(xml).not.toMatch(/\{[a-z_.]+\}/);
    for (const kind of ['pickup', 'return']) {
      expect((await call('POST', `/api/rentals/${rentalId}/documents`, { kind })).status).toBe(200);
    }
  });

  it('tra phạt nguội: trong lúc thuê ra đúng khách, ngoài giờ thì xe ở bãi', async () => {
    const hit = await call('GET', `/api/fines/lookup?plate=51K12345&at=${at('2026-10-11T15:00')}`);
    expect(hit.json.verdict).toBe('rented');
    expect(hit.json.matches[0].customer.fullName).toBe('Nguyễn Văn An');
    expect(hit.json.matches[0].nearBoundary).toBe(false);
    const edge = await call('GET', `/api/fines/lookup?plate=51k-123.45&at=${at('2026-10-12T09:45')}`);
    expect(edge.json.matches[0].nearBoundary).toBe(true);
    const miss = await call('GET', `/api/fines/lookup?plate=51K12345&at=${at('2026-10-13T09:00')}`);
    expect(miss.json.verdict).toBe('idle');
    const before = (await call('GET', '/api/system/audit?entity=vehicle&limit=200')).json.items.length;
    await call('GET', `/api/fines/lookup?plate=51K12345&at=${at('2026-10-11T15:00')}&preview=1`);
    expect((await call('GET', '/api/system/audit?entity=vehicle&limit=200')).json.items.length).toBe(before);
    const unknown = await call('GET', `/api/fines/lookup?plate=30A99999&at=${at('2026-10-13T09:00')}`);
    expect(unknown.json.verdict).toBe('unknown_vehicle');
  });

  it('ghi phạt nguội tự khớp khách, rồi trừ cọc khi hoàn', async () => {
    const f = await call('POST', '/api/fines', { plate: '51K-123.45', violatedAt: at('2026-10-11T15:00'), violation: 'Quá tốc độ', amount: 800000 });
    expect(f.json.customerId).toBe(customerId);
    expect(f.json.rentalId).toBe(rentalId);
    const pre = await call('POST', '/api/rentals/precheck', { vehicleId, customerId, scheduledStart: at('2026-11-01T08:00'), scheduledEnd: at('2026-11-02T08:00') });
    expect(pre.json.warnings.map((w: any) => w.code)).toContain('open_fines');
    const r = await call('POST', `/api/rentals/${rentalId}/release-hold`, { deductions: [{ kind: 'fine', description: 'Phạt nguội quá tốc độ', amount: 800000 }], refund: { method: 'transfer' } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.status).toBe('closed');
    const d = await call('GET', `/api/rentals/${rentalId}`);
    expect(d.json.money.depositHeld).toBe(0);
    expect(d.json.money.due).toBe(0);
  });

  it('dán kết quả tra cứu → tự khớp khách → ghi hồ sơ, không ghi trùng', async () => {
    const text = `Biển kiểm soát: 51K-123.45
Thời gian vi phạm: 09:15, 11/10/2026
Địa điểm vi phạm: Cầu Phú Mỹ
Hành vi vi phạm: 12321.5.a.01.Điều khiển xe chạy quá tốc độ
Trạng thái: Chưa xử phạt

Thời gian vi phạm: 14:30, 11/10/2026
Hành vi vi phạm: Không chấp hành hiệu lệnh đèn tín hiệu
Trạng thái: Chưa xử phạt`;
    const p = await call('POST', '/api/fines/parse', { plate: '51K12345', text });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(p.json.violations).toHaveLength(2);
    // 15:00 11/10 đã ghi ở bước trước → cái 14:30 khác giờ nên chưa có; cả hai đều trong lượt thuê của An
    expect(p.json.violations.map((v: any) => v.renter?.fullName)).toEqual(['Nguyễn Văn An', 'Nguyễn Văn An']);
    const items = p.json.violations.map((v: any) => ({ violatedAt: v.violatedAt, location: v.location, violation: v.violation, statusText: v.statusText }));
    const r1 = await call('POST', '/api/fines/record', { plate: '51K12345', items });
    expect(r1.json).toMatchObject({ created: 2, skipped: 0 });
    expect(r1.json.ids).toHaveLength(2);
    const r2 = await call('POST', '/api/fines/record', { plate: '51K12345', items });
    expect(r2.json).toMatchObject({ created: 0, skipped: 2, ids: r1.json.ids });
    const again = await call('POST', '/api/fines/parse', { plate: '51K12345', text });
    expect(again.json.violations.every((v: any) => v.recordedFineId)).toBe(true);
    expect((await call('POST', '/api/fines/parse', { plate: '51K12345', text: 'không có gì' })).status).toBe(400);
  });

  it('nhân viên không vào được cài đặt / sao lưu', async () => {
    await call('POST', '/api/users', { username: 'nv1', displayName: 'Nhân viên', password: 'nhanvien123', role: 'staff' });
    const login = await call('POST', '/api/auth/login', { username: 'nv1', password: 'nhanvien123' }, '');
    staffCookie = cookieOf(login.res);
    expect((await call('GET', '/api/rentals', undefined, staffCookie)).status).toBe(200);
    expect((await call('PUT', '/api/settings/rules', {}, staffCookie)).status).toBe(403);
    expect((await call('GET', '/api/system/backups', undefined, staffCookie)).status).toBe(403);
    const dash = await call('GET', '/api/dashboard', undefined, staffCookie);
    expect(dash.json.finance).toBeNull();
  });

  it('sao lưu → xóa dữ liệu → khôi phục', async () => {
    const b = await call('POST', '/api/system/backups');
    expect(b.status).toBe(200);
    await call('POST', '/api/customers', { fullName: 'Khách Sau Sao Lưu' });
    expect((await call('GET', '/api/customers')).json.total).toBe(2);
    const prev = await call('GET', `/api/system/backups/${b.json.name}/preview`);
    expect(prev.json.backup.customers).toBe(1);
    const r = await call('POST', `/api/system/backups/${b.json.name}/restore`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await call('GET', '/api/customers')).json.total).toBe(1);
    const list = await call('GET', '/api/system/backups');
    expect(list.json.items.map((x: any) => x.tag)).toContain('pre-restore');
  });

  it('trang tổng quan + lịch + tìm nhanh', async () => {
    const d = await call('GET', '/api/dashboard');
    expect(d.status).toBe(200);
    expect(d.json.vehicles).toHaveLength(1);
    const cal = await call('GET', `/api/calendar?from=${at('2026-10-01T00:00')}&to=${at('2026-10-31T00:00')}`);
    expect(cal.json.items.filter((i: any) => i.type === 'rental')).toHaveLength(1);
    const s = await call('GET', '/api/search?q=hd-2026');
    expect(s.json.rentals).toHaveLength(1);
  });
});

describe('phụ kiện trên xe', () => {
  let vios1 = 0;
  let vios2 = 0;
  let ev = 0;
  const car = (plate: string, model: string, fuel = 'gasoline') => ({ plate, make: 'Toyota', model, fuel, priceDay: 800000, odo: 1000 });

  it('gợi ý ban đầu: đồ thiết yếu', async () => {
    vios1 = (await call('POST', '/api/vehicles', car('51A-111.11', 'Vios 1.5G'))).json.id;
    const r = await call('GET', `/api/vehicles/${vios1}/accessories`);
    expect(r.json.catalog.length).toBeGreaterThan(20);
    const names = r.json.suggestions.map((s: any) => s.name);
    expect(names).toContain('Lốp dự phòng');
    expect(names).toContain('Thẻ thu phí không dừng (ETC)');
    expect(names).not.toContain('Cáp sạc xe điện di động');
  });

  it('thêm từ danh mục, gõ không dấu dùng lại mục cũ, tên mới tự vào danh mục, không nhân đôi', async () => {
    const cat = (await call('GET', '/api/accessories/catalog')).json;
    const tpms = cat.find((c: any) => c.name === 'Cảm biến áp suất lốp');
    const r = await call('POST', `/api/vehicles/${vios1}/accessories`, {
      items: [{ catalogId: tpms.id }, { name: 'sac du phong' }, { name: 'Máy lọc không khí', category: 'comfort', value: 1200000 }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.added.map((a: any) => a.name)).toEqual(['Cảm biến áp suất lốp', 'Sạc dự phòng', 'Máy lọc không khí']);
    const again = await call('POST', `/api/vehicles/${vios1}/accessories`, { items: [{ name: 'SẠC DỰ PHÒNG' }] });
    expect(again.json.skipped).toEqual(['Sạc dự phòng']);
    const items = (await call('GET', `/api/vehicles/${vios1}/accessories`)).json.items;
    expect(items.find((a: any) => a.name === 'Máy lọc không khí').effectiveValue).toBe(1200000);
    expect(items.find((a: any) => a.name === 'Cảm biến áp suất lốp').showInShare).toBe(true);
  });

  it('xe cùng dòng được gợi ý theo xe kia, chép phụ kiện từ xe khác', async () => {
    vios2 = (await call('POST', '/api/vehicles', car('51A-222.22', 'Vios 1.5E'))).json.id;
    const s = (await call('GET', `/api/vehicles/${vios2}/accessories`)).json.suggestions;
    const tpms = s.find((x: any) => x.name === 'Cảm biến áp suất lốp');
    expect(tpms.reasons.join(' ')).toMatch(/cùng dòng/);
    expect(s[0].reasons.join(' ')).toMatch(/cùng dòng/);
    const copy = await call('POST', `/api/vehicles/${vios2}/accessories/copy`, { fromVehicleId: vios1 });
    expect(copy.json.added).toHaveLength(3);
  });

  it('xe điện được gợi ý cáp sạc; áp cho cả đội bỏ qua xe xăng', async () => {
    ev = (await call('POST', '/api/vehicles', { ...car('51K-333.33', 'VF 6', 'electric'), make: 'VinFast' })).json.id;
    const s = (await call('GET', `/api/vehicles/${ev}/accessories`)).json.suggestions;
    expect(s.find((x: any) => x.name === 'Cáp sạc xe điện di động')?.reasons).toContain('Nên có cho xe điện');
    const cat = (await call('GET', '/api/accessories/catalog')).json;
    const cable = cat.find((c: any) => c.name === 'Cáp sạc xe điện di động');
    expect((await call('POST', `/api/accessories/catalog/${cable.id}/apply-all`)).json.added).toBe(1);
    const etc = cat.find((c: any) => c.name === 'Thẻ thu phí không dừng (ETC)');
    expect((await call('POST', `/api/accessories/catalog/${etc.id}/apply-all`)).json.added).toBeGreaterThanOrEqual(3);
  });

  it('giao xe đủ phụ kiện, nhận lại thiếu một món → biên bản ghi rõ', async () => {
    const custId = (await call('POST', '/api/customers', { fullName: 'Trần Phụ Kiện', idNumber: '079099000001' })).json.id;
    const r = await call('POST', '/api/rentals', { vehicleId: vios1, customerId: custId, scheduledStart: at('2026-12-01T08:00'), scheduledEnd: at('2026-12-02T08:00') });
    const rid = r.json.id;
    const items = (await call('GET', `/api/vehicles/${vios1}/accessories`)).json.items;
    const acc = items.map((a: any) => ({ id: a.id, name: a.name, quantity: a.quantity, value: a.effectiveValue, present: true }));
    expect((await call('POST', `/api/rentals/${rid}/pickup`, { at: at('2026-12-01T08:00'), odo: 1000, fuelLevel: 100, accessories: acc })).status).toBe(200);
    const back = acc.map((a: any) => (a.name === 'Sạc dự phòng' ? { ...a, present: false, note: 'Khách làm mất' } : a));
    const ret = await call('POST', `/api/rentals/${rid}/return`, {
      at: at('2026-12-02T08:00'),
      odo: 1200,
      fuelLevel: 100,
      accessories: back,
      charges: [{ kind: 'accessory', description: 'Thiếu phụ kiện: Sạc dự phòng', amount: 500000 }],
    });
    expect(ret.status, JSON.stringify(ret.json)).toBe(200);
    const d = (await call('GET', `/api/rentals/${rid}`)).json;
    expect(d.handovers[1].accessories.find((a: any) => a.name === 'Sạc dự phòng').present).toBe(false);
    for (const kind of ['contract', 'pickup', 'return']) {
      const doc = await call('POST', `/api/rentals/${rid}/documents`, { kind });
      const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
      const xml = new PizZip(file.rawPayload).file('word/document.xml')!.asText();
      expect(xml).toContain('Cảm biến áp suất lốp');
      expect(xml).not.toMatch(/\{[#/^]?[a-z_.]+\}/);
      if (kind === 'return') expect(xml).toContain('Khách làm mất');
      if (kind === 'pickup') expect(xml).toContain('1.200.000');
    }
  });

  it('thuê tháng: báo giá, hợp đồng ghi giá tháng', async () => {
    const vid = (await call('POST', '/api/vehicles', { ...car('51M-444.44', 'Xpander'), priceMonth: 18000000, kmLimitMonth: 3500 })).json.id;
    const custId = (await call('POST', '/api/customers', { fullName: 'Lê Thuê Tháng', idNumber: '079099000002' })).json.id;
    const times = { scheduledStart: at('2027-03-01T08:00'), scheduledEnd: at('2027-04-01T08:00') };
    const pre = await call('POST', '/api/rentals/precheck', { vehicleId: vid, customerId: custId, ...times });
    expect(pre.json.quote).toMatchObject({ mode: 'month', months: 1, total: 18000000, kmLimit: 3500 });
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: custId, ...times });
    expect(r.json.kmLimit).toBe(3500);
    const doc = await call('POST', `/api/rentals/${r.json.id}/documents`, { kind: 'contract' });
    const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
    const xml = new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    expect(xml).toContain('theo tháng');
    expect(xml).toContain('18.000.000');
    expect(xml).toContain('3.500');
    expect(xml).not.toContain('Sạc pin');
  });

  it('xe điện: lượt sạc miễn phí theo số ngày thuê + phí mỗi lượt chốt vào lượt thuê, hợp đồng ghi rõ', async () => {
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    expect((await call('PATCH', `/api/vehicles/${ev}`, { freeCharges: 1, chargeFee: 30000 })).json).toMatchObject({ freeCharges: 1, chargeFee: 30000 });
    const custId = (await call('POST', '/api/customers', { fullName: 'Phạm Xe Điện', idNumber: '079099000003' })).json.id;
    const r = (await call('POST', '/api/rentals', { vehicleId: ev, customerId: custId, scheduledStart: at('2027-05-01T08:00'), scheduledEnd: at('2027-05-06T08:00') })).json;
    expect(JSON.parse(r.pricing)).toMatchObject({ freeCharges: 1, chargeFee: 30000 });
    const contractXml = async (id: number) => {
      const doc = await call('POST', `/api/rentals/${id}/documents`, { kind: 'contract' });
      const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
      return new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    };
    // Đổi giá sau khi đặt không ảnh hưởng lượt đã đặt.
    await call('PATCH', `/api/vehicles/${ev}`, { chargeFee: 40000 });
    expect(await contractXml(r.id)).toContain('chuyến 5 ngày miễn phí 4 lượt sạc, từ lượt thứ 5 tính 30.000 đồng/lượt cắm-rút sạc');
    // Lượt đặt trước khi có tính năng (bảng giá chưa có trường sạc) → lấy theo xe hiện tại.
    const { freeCharges: _f, chargeFee: _c, ...old } = JSON.parse(r.pricing);
    db.update(schema.rentals).set({ pricing: JSON.stringify(old) }).where(eq(schema.rentals.id, r.id)).run();
    expect(await contractXml(r.id)).toContain('từ lượt thứ 5 tính 40.000 đồng/lượt');
  });

  it('mẫu dựng sẵn cũ tự lên bản mới; mẫu người dùng đã thay thì giữ nguyên', async () => {
    const { db, schema } = await import('./db/index.js');
    const { ensureBuiltinTemplates } = await import('./services/documents.js');
    const { eq } = await import('drizzle-orm');
    const [contract, pickupT] = ['contract', 'pickup'].map((k) => db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.kind, k as 'contract')).get()!);
    db.update(schema.contractTemplates).set({ builtin: 'contract-v1' }).where(eq(schema.contractTemplates.id, contract.id)).run();
    db.update(schema.contractTemplates).set({ builtin: 'pickup-user' }).where(eq(schema.contractTemplates.id, pickupT.id)).run();
    ensureBuiltinTemplates();
    const c2 = db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, contract.id)).get()!;
    expect(c2.builtin).toBe('contract-v6');
    expect(c2.version).toBe(contract.version + 1);
    const p2 = db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, pickupT.id)).get()!;
    expect(p2.version).toBe(pickupT.version);
    expect(db.select().from(schema.contractTemplates).all()).toHaveLength(3);
  });
});

describe('khách hủy đặt xe', () => {
  const H = 3_600_000;
  let vid = 0;
  let cust = 0;
  const book = async (startInHours: number, payments: object[]) => {
    const start = Date.now() + startInHours * H;
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, scheduledStart: start, scheduledEnd: start + 48 * H, depositRequired: 3000000, payments });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.id as number;
  };
  const detail = async (id: number) => (await call('GET', `/api/rentals/${id}`)).json;
  const live = (d: any) => d.payments.filter((p: any) => !p.voidedAt).map((p: any) => [p.direction, p.purpose, p.method, p.amount]);
  const revenue = async () => (await call('GET', '/api/dashboard')).json.finance.revenue as number;

  it('chuẩn bị xe + khách; chính sách mặc định 72 giờ / 100%', async () => {
    vid = (await call('POST', '/api/vehicles', { plate: '51A-777.77', make: 'Kia', model: 'Morning', priceDay: 600000, odo: 1000 })).json.id;
    cust = (await call('POST', '/api/customers', { fullName: 'Đỗ Hủy Kèo', idNumber: '079099000077' })).json.id;
    const rules = (await call('GET', '/api/settings')).json.rules;
    expect(rules).toMatchObject({ cancelNoticeHours: 72, cancelForfeitPct: 100 });
  });

  it('hủy sát giờ: mất cọc, hoàn tiền thuê trả trước; sổ tiền về 0, doanh thu cộng phí hủy', async () => {
    const rev0 = await revenue();
    const id = await book(24, [
      { purpose: 'deposit', method: 'transfer', amount: 3000000 },
      { purpose: 'rent', method: 'cash', amount: 1000000 },
    ]);
    const over = await call('POST', `/api/rentals/${id}/cancel`, { reason: 'Khách đổi kế hoạch', keep: 5000000, refund: { method: 'transfer' } });
    expect(over.status).toBe(400);
    const c = await call('POST', `/api/rentals/${id}/cancel`, { reason: 'Khách đổi kế hoạch', keep: 3000000, refund: { method: 'transfer' } });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    expect(c.json.status).toBe('cancelled');
    const d = await detail(id);
    expect(d.charges.map((x: any) => [x.kind, x.amount])).toEqual([['cancel_fee', 3000000]]);
    expect(d.money).toMatchObject({ due: 0, depositHeld: 0 });
    expect(live(d)).toEqual(expect.arrayContaining([['offset', 'deposit', 'offset', 3000000], ['out', 'rent', 'transfer', 1000000]]));
    expect(await revenue()).toBe(rev0 + 3000000);
    expect((await call('POST', `/api/rentals/${id}/cancel`, { reason: 'lần nữa' })).status).toBe(400);
  });

  it('hủy sớm: hoàn đủ cọc, không có phí hủy', async () => {
    const id = await book(240, [{ purpose: 'deposit', method: 'cash', amount: 2000000 }]);
    expect((await call('POST', `/api/rentals/${id}/cancel`, { reason: 'Khách báo sớm', keep: 0, refund: { method: 'cash' } })).status).toBe(200);
    const d = await detail(id);
    expect(d.charges).toEqual([]);
    expect(d.money).toMatchObject({ due: 0, depositHeld: 0 });
    expect(live(d)).toContainEqual(['out', 'deposit', 'cash', 2000000]);
  });

  it('giữ một phần, hoàn sau bằng nút Hoàn cọc', async () => {
    const id = await book(12, [{ purpose: 'deposit', method: 'transfer', amount: 2000000 }]);
    expect((await call('POST', `/api/rentals/${id}/cancel`, { reason: 'Khách bận', keep: 500000 })).status).toBe(200);
    expect((await detail(id)).money).toMatchObject({ due: 0, depositHeld: 1500000 });
    expect((await call('POST', `/api/rentals/${id}/payments`, { direction: 'out', purpose: 'deposit', method: 'transfer', amount: 1500000 })).status).toBe(200);
    expect((await detail(id)).money.depositHeld).toBe(0);
  });

  it('hợp đồng in chính sách hủy theo cài đặt', async () => {
    const rules = (await call('GET', '/api/settings')).json.rules;
    expect((await call('PUT', '/api/settings/rules', { ...rules, cancelNoticeHours: 48, cancelForfeitPct: 50 })).status).toBe(200);
    const id = await book(400, []);
    const doc = await call('POST', `/api/rentals/${id}/documents`, { kind: 'contract' });
    const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
    const xml = new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    expect(xml).toContain('Hủy trong vòng 48 giờ (2 ngày) trước giờ nhận xe hoặc không đến nhận xe: mất 50% tiền cọc');
  });

  it('giờ nhận xe mặc định (Lịch xe): 08:30, chỉnh được, chặn giờ sai', async () => {
    const { defaultPickupTime, ...rules } = (await call('GET', '/api/settings')).json.rules;
    expect(defaultPickupTime).toBe('08:30');
    // Máy gửi cài đặt cũ (chưa có trường này) vẫn lưu được, giữ mặc định
    expect((await call('PUT', '/api/settings/rules', rules)).json.defaultPickupTime).toBe('08:30');
    expect((await call('PUT', '/api/settings/rules', { ...rules, defaultPickupTime: '07:45' })).status).toBe(200);
    expect((await call('GET', '/api/settings')).json.rules.defaultPickupTime).toBe('07:45');
    expect((await call('PUT', '/api/settings/rules', { ...rules, defaultPickupTime: '8h30' })).status).toBe(400);
  });
});

describe('cọc chờ phạt nguội & phụ kiện theo từng lượt', () => {
  let vid = 0;
  let cust = 0;
  const times = (day: number) => ({ scheduledStart: at(`2027-07-${String(day).padStart(2, '0')}T08:00`), scheduledEnd: at(`2027-07-${String(day + 1).padStart(2, '0')}T08:00`) });
  /** Chữ trong hợp đồng/biên bản (bỏ thẻ XML để dò cả câu). */
  const docText = async (id: number, kind = 'contract') => {
    const doc = await call('POST', `/api/rentals/${id}/documents`, { kind });
    expect(doc.status, JSON.stringify(doc.json)).toBe(200);
    const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
    const xml = new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    expect(xml).not.toMatch(/\{[#/^]?[a-z_.]+\}/);
    return xml.replace(/<[^>]+>/g, '');
  };

  it('không cọc: hợp đồng không nhắc giữ 2.000.000, chính sách hủy chỉ hoàn tiền thuê', async () => {
    vid = (await call('POST', '/api/vehicles', { plate: '51G-888.88', make: 'Hyundai', model: 'Accent', priceDay: 700000, odo: 500 })).json.id;
    cust = (await call('POST', '/api/customers', { fullName: 'Vũ Không Cọc', idNumber: '079099000088' })).json.id;
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(1), depositRequired: 0 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ fineHoldRequired: 0, fineHoldDays: 15, accessories: null });
    const text = await docText(r.json.id);
    expect(text).toContain('Bên B không phải đặt cọc bằng tiền.');
    expect(text).toContain('phạt nguội) sau khi trả xe vẫn do Bên B chịu trách nhiệm theo khoản 3 Điều 6');
    expect(text).toContain('Hủy trước giờ nhận xe: hoàn lại toàn bộ tiền thuê đã trả.');
    expect(text).not.toContain('2.000.000');
    expect(text).not.toContain('được giữ lại');
  });

  it('cọc ít hơn mức cài đặt: tự giữ bằng tiền cọc; tự nhập mức giữ + số ngày cho từng lượt', async () => {
    const small = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(3), depositRequired: 1000000 });
    expect(small.json).toMatchObject({ fineHoldRequired: 1000000, fineHoldDays: 15 });
    expect(await docText(small.json.id)).toContain('Bên A được giữ lại 1.000.000 đồng tiền cọc trong 15 ngày');

    expect((await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(5), depositRequired: 5000000, fineHoldRequired: 6000000 })).status).toBe(400);
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(5), depositRequired: 5000000, fineHoldRequired: 3000000, fineHoldDays: 30 });
    expect(r.json).toMatchObject({ fineHoldRequired: 3000000, fineHoldDays: 30 });
    const text = await docText(r.json.id);
    expect(text).toContain('Bên B đặt cọc cho Bên A số tiền 5.000.000 đồng');
    expect(text).toContain('Bên A được giữ lại 3.000.000 đồng tiền cọc trong 30 ngày');

    // Hạ tiền cọc → mức giữ tự hạ theo; nhập mức giữ lớn hơn cọc thì chặn.
    expect((await call('PATCH', `/api/rentals/${r.json.id}`, { depositRequired: 2000000 })).json.fineHoldRequired).toBe(2000000);
    expect((await call('PATCH', `/api/rentals/${r.json.id}`, { fineHoldRequired: 2500000 })).status).toBe(400);
    expect((await call('PATCH', `/api/rentals/${r.json.id}`, { depositRequired: 4000000, fineHoldRequired: 2500000 })).json.fineHoldRequired).toBe(2500000);

    // Quyết toán: mặc định giữ theo số ngày đã thỏa thuận của lượt (30), không theo cài đặt (15).
    await call('POST', `/api/rentals/${r.json.id}/payments`, { direction: 'in', purpose: 'deposit', method: 'cash', amount: 4000000 });
    await call('POST', `/api/rentals/${r.json.id}/pickup`, { at: times(5).scheduledStart, odo: 600, fuelLevel: 100 });
    await call('POST', `/api/rentals/${r.json.id}/return`, { at: times(5).scheduledEnd, odo: 700, fuelLevel: 100 });
    const d = (await call('GET', `/api/rentals/${r.json.id}`)).json;
    const s = await call('POST', `/api/rentals/${r.json.id}/settle`, { offset: d.money.due, refundDeposit: { amount: 4000000 - d.money.due - 2500000, method: 'cash' } });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    expect(s.json.fineHoldAmount).toBe(2500000);
    expect(s.json.fineHoldUntil).toBe(times(5).scheduledEnd + 30 * 86_400_000);
    expect(await docText(r.json.id, 'return')).toContain('Bên A giữ lại 2.500.000 đồng trong 30 ngày');
  });

  it('phụ kiện: bỏ món đang thiếu, thêm món riêng cho lượt; xe thêm món sau vẫn vào; giao xe rồi thì khóa', async () => {
    const items = (await call('POST', `/api/vehicles/${vid}/accessories`, { items: [{ name: 'Camera hành trình' }, { name: 'Sạc dự phòng' }] })).json.added;
    const plan = items.map((a: any) => ({ id: a.id, name: a.name, quantity: a.quantity, value: 0, present: a.name !== 'Camera hành trình' }));
    plan.push({ id: null, name: 'Ghế trẻ em', quantity: 1, value: 2000000, present: true });
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(10), accessories: plan });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.accessories).toHaveLength(3);
    await call('POST', `/api/vehicles/${vid}/accessories`, { items: [{ name: 'Ô / dù' }] });
    for (const kind of ['contract', 'pickup']) {
      const text = await docText(r.json.id, kind);
      expect(text).toContain('Sạc dự phòng');
      expect(text).toContain('Ghế trẻ em');
      expect(text).toContain('Ô / dù');
      expect(text).not.toContain('Camera hành trình');
    }
    // Lượt không chỉnh thì theo xe (có camera).
    const plain = (await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(13) })).json;
    expect(await docText(plain.id)).toContain('Camera hành trình');

    // Sửa lại trước khi giao xe: camera đã về.
    const back = plan.map((a: any) => ({ ...a, present: true }));
    expect((await call('PATCH', `/api/rentals/${r.json.id}`, { accessories: back })).json.accessories.every((a: any) => a.present)).toBe(true);
    expect(await docText(r.json.id)).toContain('Camera hành trình');
    await call('POST', `/api/rentals/${r.json.id}/pickup`, { at: times(10).scheduledStart, odo: 800, fuelLevel: 100, accessories: back });
    expect((await call('PATCH', `/api/rentals/${r.json.id}`, { accessories: null })).status).toBe(400);
  });

  it('đổi xe khi chưa giao: bỏ danh sách phụ kiện đã chỉnh của xe cũ', async () => {
    const other = (await call('POST', '/api/vehicles', { plate: '51G-999.99', make: 'Kia', model: 'Soluto', priceDay: 600000, odo: 100 })).json.id;
    const plan = [{ id: null, name: 'Ghế trẻ em', quantity: 1, value: 0, present: true }];
    const r = (await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times(20), accessories: plan })).json;
    expect((await call('PATCH', `/api/rentals/${r.id}`, { vehicleId: other })).json.accessories).toBeNull();
  });
});

describe('thu chi: chi phí xe, chi phí chung, khoản định kỳ', () => {
  const H = 3_600_000;
  let vid = 0;
  let rid = 0;
  const day = (s: string) => at(`${s}T10:00`);
  const entry = (body: object, cookie = adminCookie) => call('POST', '/api/cash-entries', body, cookie);
  const report = async (p: string, v = 'all') => {
    const r = await call('GET', `/api/cashflow?p=${p}&v=${v}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json;
  };

  it('chuẩn bị xe + lượt thuê có tiền thuê trả vào tháng 03/2025', async () => {
    vid = (await call('POST', '/api/vehicles', { plate: '51A-246.81', make: 'Toyota', model: 'Veloz', priceDay: 900000, odo: 5000, inspectionExpiry: '2025-03-30' })).json.id;
    const cust = (await call('POST', '/api/customers', { fullName: 'Lý Thu Chi', idNumber: '079099000123' })).json.id;
    const start = Date.now() + 200 * 24 * H;
    rid = (await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, scheduledStart: start, scheduledEnd: start + 48 * H, depositRequired: 2000000 })).json.id;
    for (const p of [
      { direction: 'in', purpose: 'rent', method: 'transfer', amount: 1000000, at: day('2025-03-10') },
      { direction: 'in', purpose: 'deposit', method: 'transfer', amount: 2000000, at: day('2025-03-10') },
      { direction: 'out', purpose: 'rent', method: 'cash', amount: 200000, at: day('2025-03-12') },
      { direction: 'offset', purpose: 'deposit', method: 'offset', amount: 300000, at: day('2025-03-14') },
    ]) {
      expect((await call('POST', `/api/rentals/${rid}/payments`, p)).status).toBe(200);
    }
  });

  it('nhân viên ghi được khoản chi, không xem được báo cáo, không ghi thu', async () => {
    expect((await call('GET', '/api/cashflow', undefined, staffCookie)).status).toBe(403);
    const ok = await entry({ category: 'cleaning', amount: 80000, at: Date.now(), vehicleId: vid, description: 'Rửa xe' }, staffCookie);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.entry.direction).toBe('out');
    expect((await entry({ category: 'other_income', amount: 50000, at: Date.now() }, staffCookie)).status).toBe(403);
    expect((await entry({ category: 'inspection', amount: 50000, at: Date.now(), vehicleId: vid, renewal: { inspectionExpiry: '2026-03-30' } }, staffCookie)).status).toBe(403);
    expect((await entry({ category: 'fuel', amount: 0, at: Date.now() })).status).toBe(400);
  });

  it('ghi chi phí theo xe, chi phí chung, thu khác, vốn; đăng kiểm gia hạn luôn cho xe', async () => {
    for (const b of [
      { category: 'fuel', amount: 500000, at: day('2025-03-02'), vehicleId: vid },
      { category: 'parking', amount: 3000000, at: day('2025-03-01'), vehicleId: null, description: 'Bãi xe tháng 3' },
      { category: 'insurance_claim', amount: 2000000, at: day('2025-03-20'), vehicleId: vid },
      { category: 'loan', amount: 5000000, at: day('2025-03-15'), vehicleId: vid },
    ]) {
      expect((await entry(b)).status).toBe(200);
    }
    const insp = await entry({ category: 'inspection', amount: 300000, at: day('2025-03-25'), vehicleId: vid, renewal: { inspectionExpiry: '2026-03-30', insuranceBodyExpiry: null } });
    expect(insp.json.renewed).toEqual({ inspectionExpiry: '2026-03-30' });
    expect((await call('GET', `/api/vehicles/${vid}`)).json.vehicle.inspectionExpiry).toBe('2026-03-30');
    // Phiếu ghi nhầm: hủy (không xóa), không còn tính vào tổng.
    const wrong = (await entry({ category: 'repair', amount: 9000000, at: day('2025-03-05'), vehicleId: vid })).json.entry;
    expect((await call('POST', `/api/cash-entries/${wrong.id}/void`, { reason: 'x' })).status).toBe(400);
    expect((await call('POST', `/api/cash-entries/${wrong.id}/void`, { reason: 'Ghi nhầm xe' })).json.voidedAt).toBeTruthy();
    expect((await call('PUT', `/api/cash-entries/${wrong.id}`, { category: 'repair', amount: 1, at: day('2025-03-05') })).status).toBe(400);
  });

  it('khoản định kỳ: tự ghi đủ các kỳ đã qua, chạy lại không trùng', async () => {
    const body = { category: 'parking', amount: 3000000, vehicleId: null, dayOfMonth: 5, intervalMonths: 1, startMonth: '2025-01', endMonth: '2025-03', description: 'Bãi đậu xe' };
    expect((await call('POST', '/api/recurring-costs', { ...body, endMonth: '2024-12' })).status).toBe(400);
    const r = await call('POST', '/api/recurring-costs', body);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.created).toBe(3);
    const again = await call('PUT', `/api/recurring-costs/${r.json.recurring.id}`, { ...body, amount: 3500000 });
    expect(again.json.created).toBe(0);
    const list = (await call('GET', '/api/recurring-costs')).json;
    expect(list.find((x: any) => x.id === r.json.recurring.id)).toMatchObject({ amount: 3500000, plate: null });
  });

  it('báo cáo tháng: tiền thuê thực nhận (trừ hoàn, cộng cọc cấn trừ), lãi vận hành tách vốn', async () => {
    const r = await report('2025-03');
    // 1.000.000 − 200.000 + 300.000 cấn trừ; cọc 2.000.000 không tính là thu.
    expect(r.totals).toMatchObject({ rent: 1100000, otherIncome: 2000000, income: 3100000, expense: 6800000, profit: -3700000, capitalOut: 5000000, net: -8700000 });
    const car = r.vehicles.find((v: any) => v.vehicleId === vid);
    expect(car).toMatchObject({ rent: 1100000, otherIncome: 2000000, expense: 800000, capitalOut: 5000000 });
    expect(r.shared).toMatchObject({ expense: 6000000 });
    expect(r.categories.find((c: any) => c.category === 'parking')).toMatchObject({ amount: 6000000, count: 2 });
    expect(r.trend.map((m: any) => m.key)).toEqual(['2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03']);
    expect(r.trend.slice(-3).map((m: any) => m.expense)).toEqual([3000000, 3000000, 6800000]);
    expect(r.ledger.filter((l: any) => l.kind === 'entry' && l.entry.voidedAt)).toHaveLength(1);
    expect(r.ledger.filter((l: any) => l.kind === 'rent').map((l: any) => [l.direction, l.amount])).toEqual([
      ['in', 300000],
      ['out', 200000],
      ['in', 1000000],
    ]);
  });

  it('báo cáo năm, theo một xe, chỉ chi phí chung', async () => {
    expect((await report('2025')).totals.expense).toBe(12800000);
    const one = await report('2025-03', String(vid));
    expect(one.totals).toMatchObject({ rent: 1100000, expense: 800000 });
    expect(one.allocation.sharedExpense).toBe(6000000);
    expect(one.vehicles).toEqual([]);
    expect(one.ledger.every((l: any) => l.plate === '51A-246.81')).toBe(true);
    const shared = await report('2025-03', 'shared');
    expect(shared.totals).toMatchObject({ rent: 0, expense: 6000000 });
    expect((await call('GET', '/api/cashflow?p=2025-13')).status).toBe(400);
    expect((await call('GET', '/api/cashflow?p=2025-03&v=abc')).status).toBe(400);
  });

  it('xuất Excel đủ các trang', async () => {
    const r = await call('GET', '/api/cashflow/export?p=2025-03');
    expect(r.status).toBe(200);
    expect(r.res.headers['content-type']).toContain('spreadsheetml');
    const zip = new PizZip(r.res.rawPayload);
    const wb = zip.file('xl/workbook.xml')!.asText();
    for (const name of ['Tổng hợp theo xe', 'Sổ thu chi', 'Theo hạng mục', 'Theo tháng']) expect(wb).toContain(name);
    expect(zip.file('xl/worksheets/sheet2.xml')!.asText()).toContain('Bãi xe tháng 3');
    const one = await call('GET', `/api/cashflow/export?p=2025-03&v=${vid}`);
    expect(one.res.headers['content-disposition']).toContain('51A24681');
  });

  it('trang tổng quan: lãi tháng = thu − chi của tháng hiện tại', async () => {
    const f = (await call('GET', '/api/dashboard')).json.finance;
    expect(f.profit).toBe(f.income - f.expense);
    expect(f.expense).toBeGreaterThanOrEqual(80000);
  });
});
