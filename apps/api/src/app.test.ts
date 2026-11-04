// Kiểm thử tích hợp: chạy app thật trên DB tạm, đi trọn một lượt thuê.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PizZip from 'pizzip';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fmtDateTime, vnDateKey, vnLocalInputToMs } from './shared/time.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'car-rental-test-'));
process.env.DATA_DIR = dir;
process.env.GOTENBERG_URL = '';
const HUB = 'h'.repeat(64);
process.env.HUB_TOKEN = HUB;
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
    expect(t.json.filter((x: any) => !x.channel).map((x: any) => x.kind).sort()).toEqual(['contract', 'extension', 'pickup', 'return']);
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
    const body = { fullName: 'Nguyễn Văn An', idNumber: '079090001234', dob: '1990-08-15', phone: '0901234567', licenseNumber: '790123456789', licenseClass: 'B', licenseExpiry: '2030-01-01', licenseIssueDate: '2020-01-01', permanentAddress: '12 Lê Lợi' };
    const r = await call('POST', '/api/customers', body);
    expect(r.status).toBe(200);
    expect(r.json.licenseIssueDate).toBe('2020-01-01');
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

  it('sửa ODO lúc giao (nhập nhầm): biên bản giao + ODO xe đổi theo', async () => {
    const odoOf = async () => {
      const d = (await call('GET', `/api/rentals/${rentalId}`)).json;
      return [d.handovers.find((h: any) => h.kind === 'pickup').odo, d.vehicle.odo];
    };
    const r = await call('PATCH', `/api/rentals/${rentalId}`, { pickupOdo: 10150 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await odoOf()).toEqual([10150, 10150]);
    await call('PATCH', `/api/rentals/${rentalId}`, { pickupOdo: 10050 });
    expect(await odoOf()).toEqual([10050, 10050]);
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
    expect((await call('PATCH', `/api/rentals/${rentalId}`, { pickupOdo: 10000 })).status).toBe(400);
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

describe('Family Organizer điều khiển cập nhật (HUB_TOKEN)', () => {
  const hub = (method: string, url: string, token = HUB) =>
    app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` } });

  it('khóa đúng chỉ mở các route cập nhật, không mở dữ liệu', async () => {
    const r = await hub('GET', '/api/system/update');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().current.version).toBeTruthy();
    expect((await hub('GET', '/api/system/update?x=1')).statusCode).toBe(200);
    expect((await hub('GET', '/api/system/update', 'x'.repeat(64))).statusCode).toBe(401);
    expect((await hub('GET', '/api/system/update', HUB.slice(1))).statusCode).toBe(401);
    expect((await hub('GET', '/api/customers')).statusCode).toBe(401);
    expect((await hub('GET', '/api/system/backups')).statusCode).toBe(401);
    expect((await hub('PUT', '/api/system/update/config')).statusCode).toBe(401);
    expect((await hub('POST', '/api/system/restart')).statusCode).toBe(401);
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
    expect((await call('GET', `/api/rentals/${r.json.id}`)).json.monthly).toBeNull(); // 1 tháng: không cần lịch

    // 3 tháng + 5 ngày lẻ: lịch 4 kỳ, tiền trả trước phủ dần từ tháng đầu.
    const long = await call('POST', '/api/rentals', {
      vehicleId: vid,
      customerId: custId,
      scheduledStart: at('2027-05-01T08:00'),
      scheduledEnd: at('2027-08-06T08:00'),
      payments: [{ purpose: 'rent', method: 'transfer', amount: 27_000_000, note: 'Tháng 1–2' }],
    });
    expect(long.status, JSON.stringify(long.json)).toBe(200);
    const plan = (await call('GET', `/api/rentals/${long.json.id}`)).json.monthly;
    expect(plan.map((p: any) => [p.n, p.amount, p.paid])).toEqual([
      [1, 18_000_000, 18_000_000],
      [2, 18_000_000, 9_000_000],
      [3, 18_000_000, 0],
      [4, 3_000_000, 0],
    ]);
    expect(plan[1].from).toBe(at('2027-06-01T08:00'));
    await call('POST', `/api/rentals/${long.json.id}/cancel`, { reason: 'Dọn dữ liệu test' });
  });

  it('xe điện: mỗi ngày thuê 1 lượt sạc miễn phí, phụ thu mỗi lượt vượt + tiền điện chốt vào lượt thuê, hợp đồng ghi rõ', async () => {
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    expect((await call('PATCH', `/api/vehicles/${ev}`, { freeCharges: 1, chargeFee: 40000 })).json).toMatchObject({ freeCharges: 1, chargeFee: 40000 });
    const custId = (await call('POST', '/api/customers', { fullName: 'Phạm Xe Điện', idNumber: '079099000003' })).json.id;
    const r = (await call('POST', '/api/rentals', { vehicleId: ev, customerId: custId, scheduledStart: at('2027-05-01T08:00'), scheduledEnd: at('2027-05-06T08:00') })).json;
    // Tiền điện chưa chỉnh ở xe → theo mặc định 800đ/1% pin (cách mặc định), 400đ/km.
    expect(JSON.parse(r.pricing)).toMatchObject({ freeCharges: 1, chargeFee: 40000, chargePerDay: true, energyFeePct: 800, energyFeeKm: 400, energyMethod: 'pct' });
    const contractXml = async (id: number) => {
      const doc = await call('POST', `/api/rentals/${id}/documents`, { kind: 'contract' });
      const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
      return new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    };
    // Đổi giá sau khi đặt không ảnh hưởng lượt đã đặt.
    await call('PATCH', `/api/vehicles/${ev}`, { chargeFee: 50000, energyMethod: 'km' });
    expect(await contractXml(r.id)).toContain('chuyến 5 ngày được sạc miễn phí 5 lượt, từ lượt thứ 6 phụ thu 40.000 đồng/lượt cắm sạc; tiền điện 800 đồng cho mỗi 1% pin thấp hơn lúc nhận xe');
    // Lượt đặt trước khi đổi quy tắc (bảng giá chưa có chargePerDay) → giữ cách tính cũ, không tiền điện.
    const { chargePerDay: _p, energyFeePct: _e1, energyFeeKm: _e2, energyMethod: _e3, ...before } = JSON.parse(r.pricing);
    db.update(schema.rentals).set({ pricing: JSON.stringify(before) }).where(eq(schema.rentals.id, r.id)).run();
    const oldXml = await contractXml(r.id);
    expect(oldXml).toContain('chuyến 5 ngày được sạc miễn phí 4 lượt, từ lượt thứ 5 phụ thu 40.000 đồng/lượt cắm sạc');
    expect(oldXml).not.toContain('tiền điện');
    // Lượt đặt trước khi có tính năng sạc (bảng giá chưa có trường sạc) → lấy theo xe hiện tại.
    const { freeCharges: _f, chargeFee: _c, ...older } = before;
    db.update(schema.rentals).set({ pricing: JSON.stringify(older) }).where(eq(schema.rentals.id, r.id)).run();
    expect(await contractXml(r.id)).toContain('từ lượt thứ 6 phụ thu 50.000 đồng/lượt cắm sạc; tiền điện 400 đồng/km di chuyển (theo ODO)');
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
    expect(db.select().from(schema.contractTemplates).all()).toHaveLength(7);
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

describe('gia hạn, nhắc việc, phạt nguội trước và sau khi hoàn cọc', () => {
  let vid = 0;
  let cust = 0;
  let rid = 0;
  let code = '';
  const plate = '51H-246.80';
  const detail = async (id: number) => (await call('GET', `/api/rentals/${id}`)).json;
  const alerts = async () => (await call('GET', '/api/dashboard')).json.alerts as { kind: string; title: string; detail: string; link: string }[];
  const docText = async (id: number, kind: string) => {
    const doc = await call('POST', `/api/rentals/${id}/documents`, { kind });
    expect(doc.status, JSON.stringify(doc.json)).toBe(200);
    const file = await app.inject({ method: 'GET', url: `/api/files/${doc.json.document.docxFileId}`, headers: { cookie: adminCookie } });
    const xml = new PizZip(file.rawPayload).file('word/document.xml')!.asText();
    expect(xml).not.toMatch(/\{[#/^]?[a-z_.]+\}/);
    return xml.replace(/<[^>]+>/g, '');
  };
  /** Giả lập dịch vụ tra cứu phạt nguội (api.checkphatnguoi.vn). */
  const provider = (rows: Record<string, string>[] | 'down') =>
    vi.stubGlobal('fetch', async (url: string | URL) => {
      if (!String(url).includes('checkphatnguoi')) throw new Error(`fetch không mong đợi: ${url}`);
      if (rows === 'down') return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify({ status: rows.length ? 1 : 0, data: rows }), { status: 200 });
    });

  it('gia hạn khi khách đang giữ xe: ghi lịch sử từng lần, in phụ lục đúng số liệu', async () => {
    vid = (await call('POST', '/api/vehicles', { plate, make: 'VinFast', model: 'VF 5', priceDay: 600000, kmLimitDay: 200, odo: 100, depositAmount: 3000000 })).json.id;
    cust = (await call('POST', '/api/customers', { fullName: 'Trần Gia Hạn', idNumber: '079099000246', phone: '0909000246' })).json.id;
    const r = await call('POST', '/api/rentals', {
      vehicleId: vid,
      customerId: cust,
      scheduledStart: at('2028-03-01T08:00'),
      scheduledEnd: at('2028-03-03T08:00'),
      depositRequired: 3000000,
      payments: [
        { purpose: 'deposit', method: 'transfer', amount: 3000000 },
        { purpose: 'rent', method: 'cash', amount: 1200000 },
      ],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    rid = r.json.id;
    code = r.json.code;
    expect((await call('POST', `/api/rentals/${rid}/documents`, { kind: 'extension' })).status).toBe(400);
    // Đổi giờ trả trước khi giao xe không phải gia hạn.
    expect((await call('PATCH', `/api/rentals/${rid}`, { scheduledEnd: at('2028-03-03T10:00') })).status).toBe(200);
    expect((await call('PATCH', `/api/rentals/${rid}`, { scheduledEnd: at('2028-03-03T08:00') })).status).toBe(200);
    expect((await detail(rid)).extensions).toEqual([]);

    await call('POST', `/api/rentals/${rid}/pickup`, { at: at('2028-03-01T08:00'), odo: 100, fuelLevel: 100 });
    expect((await call('PATCH', `/api/rentals/${rid}`, { scheduledEnd: at('2028-03-04T08:00') })).status).toBe(200);
    let d = await detail(rid);
    expect(d.extensions).toHaveLength(1);
    expect(d.extensions[0]).toMatchObject({ seq: 1, oldEnd: at('2028-03-03T08:00'), newEnd: at('2028-03-04T08:00'), oldTotal: 1200000, newTotal: 1800000, oldKmLimit: 400, newKmLimit: 600 });
    let text = await docText(rid, 'extension');
    expect(text).toContain('PHỤ LỤC HỢP ĐỒNG THUÊ XE');
    expect(text).toContain(`${code}-PL01`);
    expect(text).toContain(`Giờ trả xe mới: ${fmtDateTime(at('2028-03-04T08:00'))} (thêm 1 ngày)`);
    expect(text).toContain('tăng thêm 600.000 đồng');
    expect(text).toContain('Còn phải trả: 600.000 đồng');

    // Gia hạn lần 2; sửa ghi chú không tính là gia hạn.
    await call('PATCH', `/api/rentals/${rid}`, { scheduledEnd: at('2028-03-05T08:00') });
    await call('PATCH', `/api/rentals/${rid}`, { notes: 'Khách đi Đà Lạt' });
    d = await detail(rid);
    expect(d.extensions.map((x: any) => [x.seq, x.oldTotal, x.newTotal])).toEqual([
      [1, 1200000, 1800000],
      [2, 1800000, 2400000],
    ]);
    text = await docText(rid, 'extension');
    expect(text).toContain(`${code}-PL02`);
    expect(text).toContain(`Giờ trả xe theo hợp đồng: ${fmtDateTime(at('2028-03-04T08:00'))}`);
  });

  it('đã nhận xe, chưa quyết toán → Việc cần làm nhắc "Chờ quyết toán" kèm tiền khách còn nợ', async () => {
    expect((await call('POST', `/api/rentals/${rid}/return`, { at: at('2028-03-05T08:00'), odo: 900, fuelLevel: 90 })).status).toBe(200);
    const a = (await alerts()).find((x) => x.kind === 'settle_pending' && x.title.includes(code));
    expect(a?.detail).toContain('khách còn phải trả 1.200.000 đ');
  });

  it('phạt nguội phát hiện khi đang giữ cọc: trừ thẳng vào cọc đang giữ', async () => {
    const s = await call('POST', `/api/rentals/${rid}/settle`, { offset: 1200000, fineHoldDays: 15 });
    expect(s.json).toMatchObject({ status: 'settled', fineHoldAmount: 1800000 });
    expect((await alerts()).some((x) => x.kind === 'settle_pending' && x.title.includes(code))).toBe(false);
    const f = (await call('POST', '/api/fines', { plate, violatedAt: at('2028-03-02T10:00'), violation: 'Vượt đèn đỏ', amount: 800000 })).json;
    expect(f.rentalId).toBe(rid);
    const rec = await call('POST', `/api/fines/${f.id}/recover`, { amount: 800000, method: 'deposit' });
    expect(rec.status, JSON.stringify(rec.json)).toBe(200);
    expect(rec.json.status).toBe('recovered');
    const d = await detail(rid);
    expect(d.money).toMatchObject({ depositHeld: 1000000, due: 0 });
    expect(d.rental).toMatchObject({ status: 'settled', fineHoldAmount: 1000000 });
    expect(d.charges.find((c: any) => c.kind === 'fine')).toMatchObject({ amount: 800000 });
    expect((await call('POST', `/api/fines/${f.id}/recover`, { amount: 800000, method: 'cash' })).status).toBe(400);
  });

  it('tra phạt nguội riêng cho lượt trước khi hoàn cọc: chỉ lấy vi phạm lúc khách giữ xe, tự ghi hồ sơ', async () => {
    provider([
      { 'Biển kiểm soát': plate, 'Thời gian vi phạm': '10:30, 03/03/2028', 'Địa điểm vi phạm': 'Đèo Bảo Lộc', 'Hành vi vi phạm': 'Chạy quá tốc độ', 'Trạng thái': 'Chưa xử phạt' },
      { 'Biển kiểm soát': plate, 'Thời gian vi phạm': '09:00, 02/03/2028', 'Hành vi vi phạm': 'Dừng đỗ sai quy định', 'Trạng thái': 'Đã xử phạt' },
      { 'Biển kiểm soát': plate, 'Thời gian vi phạm': '10:00, 10/03/2028', 'Hành vi vi phạm': 'Vượt đèn đỏ', 'Trạng thái': 'Chưa xử phạt' },
    ]);
    try {
      const r = await call('POST', `/api/rentals/${rid}/fine-check`);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ ok: true, found: 1, recorded: 1 });
      expect(r.json.violations.map((v: any) => v.status).sort()).toEqual(['paid', 'unpaid']);
      expect((await call('POST', `/api/rentals/${rid}/fine-check`)).json).toMatchObject({ found: 1, recorded: 0 });
      const d = await detail(rid);
      expect(d.rental.fineCheckFound).toBe(1);
      expect(d.rental.fineCheckedAt).toBeGreaterThan(0);
      expect(d.fines.filter((f: any) => f.status === 'new').map((f: any) => f.violation)).toEqual(['Chạy quá tốc độ']);
      provider('down');
      const down = await call('POST', `/api/rentals/${rid}/fine-check`);
      expect(down.json).toMatchObject({ ok: false });
      expect(down.json.error).toContain('502');
      expect((await detail(rid)).rental.fineCheckFound).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hoàn cọc: khoản trừ gắn hồ sơ phạt nguội → hồ sơ chuyển "Đã thu lại / trừ cọc"', async () => {
    const open = (await detail(rid)).fines.find((f: any) => f.status === 'new');
    const r = await call('POST', `/api/rentals/${rid}/release-hold`, {
      deductions: [{ kind: 'fine', description: 'Phạt nguội 03/03: quá tốc độ', amount: 600000, fineId: open.id }],
      refund: { method: 'transfer' },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = await detail(rid);
    expect(d.rental.status).toBe('closed');
    expect(d.money).toMatchObject({ depositHeld: 0, due: 0 });
    expect(d.fines.find((f: any) => f.id === open.id)).toMatchObject({ status: 'recovered', amount: 600000 });
  });

  it('phạt nguội phát hiện sau khi đã hoàn cọc: khách nợ thì nhắc; khách trả lại thì ghi tiền, Thu chi khớp', async () => {
    const f = (await call('POST', '/api/fines', { plate, violatedAt: at('2028-03-04T15:00'), violation: 'Quá tốc độ', amount: 1000000, status: 'we_paid' })).json;
    expect((await call('POST', `/api/fines/${f.id}/recover`, { amount: 1000000, method: 'deposit' })).status).toBe(400);

    expect((await call('POST', `/api/rentals/${rid}/charges`, { kind: 'cleaning', description: 'Vệ sinh ghế', amount: 200000 })).status).toBe(200);
    expect((await alerts()).find((x) => x.kind === 'customer_debt' && x.detail.includes(code))?.title).toBe('Khách còn nợ 200.000 đ');
    await call('POST', `/api/rentals/${rid}/payments`, { direction: 'in', purpose: 'rent', method: 'cash', amount: 200000 });
    expect((await alerts()).some((x) => x.kind === 'customer_debt' && x.detail.includes(code))).toBe(false);

    const month = fmtDateTime(Date.now()).slice(-7).split('/').reverse().join('-');
    const before = (await call('GET', `/api/cashflow?p=${month}`)).json.totals.rent;
    const rec = await call('POST', `/api/fines/${f.id}/recover`, { amount: 1000000, method: 'transfer' });
    expect(rec.status, JSON.stringify(rec.json)).toBe(200);
    const d = await detail(rid);
    expect(d.money.due).toBe(0);
    expect(d.payments.find((p: any) => p.note === 'Khách trả lại tiền phạt nguội')).toMatchObject({ direction: 'in', method: 'transfer', amount: 1000000 });
    expect((await call('GET', `/api/cashflow?p=${month}`)).json.totals.rent).toBe(before + 1000000);
  });

  it('phạt lớn hơn cọc đang giữ: trừ hết cọc, phần vượt thành tiền khách còn nợ (cả khi hoàn cọc lẫn khi trừ ngay)', async () => {
    /** Lượt 1 ngày đã trả đủ tiền thuê, cọc 1.000.000 giữ chờ phạt nguội. */
    const settledRental = async (day: string, odo: number) => {
      const start = at(`${day}T08:00`);
      const r = (
        await call('POST', '/api/rentals', {
          vehicleId: vid,
          customerId: cust,
          scheduledStart: start,
          scheduledEnd: start + 86_400_000,
          depositRequired: 1000000,
          payments: [
            { purpose: 'deposit', method: 'cash', amount: 1000000 },
            { purpose: 'rent', method: 'cash', amount: 600000 },
          ],
        })
      ).json;
      await call('POST', `/api/rentals/${r.id}/pickup`, { at: start, odo, fuelLevel: 100 });
      await call('POST', `/api/rentals/${r.id}/return`, { at: start + 86_400_000, odo: odo + 100, fuelLevel: 100 });
      expect((await call('POST', `/api/rentals/${r.id}/settle`, { fineHoldDays: 15 })).json).toMatchObject({ status: 'settled', fineHoldAmount: 1000000 });
      return r as { id: number; code: string };
    };

    const a = await settledRental('2028-06-01', 1000);
    const fa = (await call('POST', '/api/fines', { plate, violatedAt: at('2028-06-01T15:00'), violation: 'Vượt đèn đỏ', amount: 1500000 })).json;
    const rel = await call('POST', `/api/rentals/${a.id}/release-hold`, { deductions: [{ kind: 'fine', description: 'Phạt vượt đèn đỏ', amount: 1500000, fineId: fa.id }] });
    expect(rel.status, JSON.stringify(rel.json)).toBe(200);
    let d = await detail(a.id);
    expect(d.rental.status).toBe('closed');
    expect(d.money).toMatchObject({ depositHeld: 0, due: 500000 });
    expect(d.fines[0].status).toBe('recovered');
    expect((await alerts()).find((x) => x.kind === 'customer_debt' && x.detail.includes(a.code))?.title).toBe('Khách còn nợ 500.000 đ');

    const b = await settledRental('2028-06-05', 1200);
    const fb = (await call('POST', '/api/fines', { plate, violatedAt: at('2028-06-05T15:00'), violation: 'Quá tốc độ', amount: 1200000 })).json;
    expect((await call('POST', `/api/fines/${fb.id}/recover`, { amount: 1200000, method: 'deposit' })).status).toBe(200);
    d = await detail(b.id);
    expect(d.rental).toMatchObject({ status: 'closed', fineHoldAmount: 0 });
    expect(d.money).toMatchObject({ depositHeld: 0, due: 200000 });
  });

  it('lượt hủy còn cọc chưa hoàn → nhắc "Chưa hoàn cho khách"', async () => {
    const r = (
      await call('POST', '/api/rentals', {
        vehicleId: vid,
        customerId: cust,
        scheduledStart: at('2028-04-01T08:00'),
        scheduledEnd: at('2028-04-02T08:00'),
        depositRequired: 1000000,
        payments: [{ purpose: 'deposit', method: 'transfer', amount: 1000000 }],
      })
    ).json;
    await call('POST', `/api/rentals/${r.id}/cancel`, { reason: 'Khách đổi ngày', keep: 0 });
    const a = (await alerts()).find((x) => x.kind === 'refund_pending' && x.detail.includes(r.code));
    expect(a?.title).toBe('Chưa hoàn cho khách 1.000.000 đ');
    await call('POST', `/api/rentals/${r.id}/payments`, { direction: 'out', purpose: 'deposit', method: 'transfer', amount: 1000000 });
    expect((await alerts()).some((x) => x.kind === 'refund_pending' && x.detail.includes(r.code))).toBe(false);
  });

  it('xe trống & báo giá: mỗi xe đang hoạt động một dòng, xe bận ghi rõ trùng lịch', async () => {
    const free = await call('POST', '/api/rentals/availability', { scheduledStart: at('2028-03-10T08:00'), scheduledEnd: at('2028-03-12T08:00') });
    expect(free.status).toBe(200);
    const mine = free.json.items.find((x: any) => x.vehicle.id === vid);
    expect(mine).toMatchObject({ available: true, deposit: 3000000 });
    expect(mine.quote.total).toBe(1200000);
    const busy = (
      await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, scheduledStart: at('2028-05-01T08:00'), scheduledEnd: at('2028-05-03T08:00') })
    ).json;
    const r = await call('POST', '/api/rentals/availability', { scheduledStart: at('2028-05-02T08:00'), scheduledEnd: at('2028-05-04T08:00') });
    const x = r.json.items.find((i: any) => i.vehicle.id === vid);
    expect(x.available).toBe(false);
    expect(x.conflicts[0].label).toContain(busy.code);
    expect((await call('POST', '/api/rentals/availability', { scheduledStart: at('2028-05-02T08:00'), scheduledEnd: at('2028-05-02T08:00') })).status).toBe(400);
    await call('POST', `/api/rentals/${busy.id}/cancel`, { reason: 'Dọn dữ liệu test' });
  });

  it('Telegram: nhắc trước giờ giao xe tận nơi; mất mạng thì lần sau gửi lại, không gửi trùng', async () => {
    const { updateLocalConfig } = await import('./lib/localConfig.js');
    const { tick } = await import('./lib/scheduler.js');
    const sent: string[] = [];
    let down = true;
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes('api.telegram.org')) throw new Error(`fetch không mong đợi: ${url}`);
      if (down) return new Response(JSON.stringify({ ok: false, description: 'Bad Gateway' }), { status: 502 });
      sent.push(JSON.parse(String(init!.body)).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const start = Math.ceil((Date.now() + 5 * 3_600_000) / 60_000) * 60_000;
    updateLocalConfig((c) => {
      c.telegram = { ...c.telegram, botToken: '123:abc', chatId: '1', notify: true, dailyDigest: false };
      c.backup.nightlyHour = 99;
      c.fineCheck.frequency = 'off';
      c.update.lastCheckAt = start;
    });
    try {
      const r = (
        await call('POST', '/api/rentals', {
          vehicleId: vid,
          customerId: cust,
          scheduledStart: start,
          scheduledEnd: start + 86_400_000,
          pickupMethod: 'delivery',
          pickupLocation: '12 Nguyễn Huệ, Q1',
          depositRequired: 2000000,
        })
      ).json;
      const mine = () => sent.filter((t) => t.includes('Sắp giao xe') && t.includes(r.code));
      const now = start - 90 * 60_000;
      await tick(now - 60 * 60_000); // còn 2,5 giờ: chưa tới lúc nhắc
      await tick(now); // Telegram lỗi
      down = false;
      await tick(now + 60_000); // đang chờ thử lại
      expect(mine()).toHaveLength(0);
      await tick(now + 6 * 60_000);
      expect(mine()).toHaveLength(1);
      expect(mine()[0]).toContain('12 Nguyễn Huệ, Q1');
      expect(mine()[0]).toContain('Cần thu: tiền thuê 600.000 đ + cọc 2.000.000 đ');
      await tick(now + 7 * 60_000);
      expect(mine()).toHaveLength(1);
      await call('POST', `/api/rentals/${r.id}/cancel`, { reason: 'Dọn dữ liệu test' });
    } finally {
      vi.unstubAllGlobals();
      updateLocalConfig((c) => {
        c.telegram = { ...c.telegram, botToken: '', chatId: '' };
      });
    }
  });
});

describe('lịch bảo dưỡng theo hạng mục', () => {
  let vid = 0;
  let oil = 0;
  let cabin = 0;
  const today = vnDateKey(Date.now());
  const plate = '51M-135.79';
  const maint = async () => (await call('GET', `/api/vehicles/${vid}/maintenance`)).json;
  const serviceAlert = async () => ((await call('GET', '/api/dashboard')).json.alerts as any[]).find((a) => a.kind === 'service_due' && a.title.includes(plate));

  it('thiết lập hạng mục từ gợi ý theo nhiên liệu; thiếu chu kỳ thì chặn', async () => {
    vid = (await call('POST', '/api/vehicles', { plate, make: 'Toyota', model: 'Innova', fuel: 'gasoline', priceDay: 900000, odo: 48000 })).json.id;
    const m = await maint();
    expect(m.items).toEqual([]);
    const keys = m.presets.map((p: any) => p.key);
    expect(keys).toContain('oil');
    expect(keys).not.toContain('ev_service');
    expect((await call('POST', `/api/vehicles/${vid}/maintenance`, { items: [{ name: 'Rửa gầm' }] })).status).toBe(400);
    expect((await call('POST', `/api/vehicles/${vid}/maintenance`, { items: [{ name: 'Thay dầu máy', intervalKm: 5000 }] }, staffCookie)).status).toBe(403);
    const r = await call('POST', `/api/vehicles/${vid}/maintenance`, {
      items: [
        { name: 'Thay dầu máy', preset: 'oil', intervalKm: 5000, intervalMonths: 6, lastOdo: 43000, lastDate: today },
        { name: 'Thay lọc gió điều hòa', preset: 'cabin_filter', intervalKm: 10000, intervalMonths: 12, lastOdo: 45000, lastDate: today },
        { name: 'Kiểm tra ắc quy 12V', intervalMonths: 12 },
      ],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    [oil, cabin] = r.json.created.map((x: any) => x.id);
    const states = (await maint()).items.map((i: any) => [i.name, i.status.state, i.status.kmLeft]);
    expect(states).toEqual([
      ['Thay dầu máy', 'overdue', 0],
      ['Thay lọc gió điều hòa', 'ok', 7000],
      ['Kiểm tra ắc quy 12V', 'unknown', null],
    ]);
  });

  it('quá hạn → Việc cần làm (gộp theo xe) + cảnh báo khi đặt xe', async () => {
    const a = await serviceAlert();
    expect(a.title).toBe(`Quá hạn bảo dưỡng ${plate}`);
    expect(a.detail).toContain('Thay dầu máy (mốc 48.000 km');
    expect(a.detail).not.toContain('lọc gió');
    const cust = (await call('POST', '/api/customers', { fullName: 'Hồ Bảo Dưỡng', idNumber: '079099000555' })).json.id;
    const pre = await call('POST', '/api/rentals/precheck', { vehicleId: vid, customerId: cust, scheduledStart: at('2028-08-01T08:00'), scheduledEnd: at('2028-08-02T08:00') });
    expect(pre.json.warnings.find((w: any) => w.code === 'maintenance_overdue')?.message).toContain('Thay dầu máy');
  });

  it('ghi đã làm kèm chi phí: dời mốc, cập nhật ODO xe, ghi phiếu chi bảo dưỡng; nhân viên cũng ghi được', async () => {
    const r = await call('POST', `/api/vehicles/${vid}/maintenance/done`, { itemIds: [oil], date: today, odo: 48100, cost: { amount: 600000, method: 'cash', vendor: 'Gara Minh' } }, staffCookie);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.done).toBe(1);
    expect(r.json.entry).toMatchObject({ category: 'maintenance', amount: 600000, vehicleId: vid, description: 'Bảo dưỡng: Thay dầu máy', vendor: 'Gara Minh', odo: 48100 });
    const m = await maint();
    expect(m.items.find((i: any) => i.id === oil)).toMatchObject({ lastOdo: 48100, lastDate: today, status: { state: 'ok', nextOdo: 53100 } });
    expect(m.records[0]).toMatchObject({ itemId: oil, odo: 48100, cashEntryId: r.json.entry.id });
    expect((await call('GET', `/api/vehicles/${vid}`)).json.vehicle.odo).toBe(48100);
    expect(await serviceAlert()).toBeUndefined();
  });

  it('ghi chi phí ở Thu chi tick hạng mục đã làm; ghi bù lần cũ không dời mốc; bỏ hạng mục giữ lịch sử', async () => {
    const e = await call('POST', '/api/cash-entries', { category: 'parts', amount: 350000, at: Date.now(), vehicleId: vid, odo: 48200, description: 'Lọc gió điều hòa', maintenanceDone: [cabin] });
    expect(e.status, JSON.stringify(e.json)).toBe(200);
    expect(e.json.maintenance).toBe(1);
    expect((await maint()).items.find((i: any) => i.id === cabin)).toMatchObject({ lastOdo: 48200 });
    await call('POST', `/api/vehicles/${vid}/maintenance/done`, { itemIds: [oil], date: '2026-01-05', odo: 38000 });
    const m = await maint();
    expect(m.items.find((i: any) => i.id === oil).lastOdo).toBe(48100);
    expect(m.records.filter((x: any) => x.itemId === oil)).toHaveLength(2);
    expect((await call('POST', `/api/vehicles/${vid}/maintenance/done`, { itemIds: [999999], date: today })).status).toBe(404);
    expect((await call('POST', `/api/maintenance/${cabin}/archive`)).status).toBe(200);
    const after = await maint();
    expect(after.items.map((i: any) => i.id)).not.toContain(cabin);
    expect(after.records.some((x: any) => x.itemId === cabin)).toBe(true);
  });
});

describe('hủy hồ sơ phạt nguội (không xóa)', () => {
  it('hủy có lý do → không còn trong việc cần xử lý / cảnh báo khách; vẫn xem được; khôi phục được', async () => {
    const f = (await call('POST', '/api/fines', { plate: '51M-135.79', violatedAt: at('2026-02-01T10:00'), violation: 'Ghi nhầm xe', amount: 500000 })).json;
    const openIds = async () => (await call('GET', '/api/fines?status=open')).json.items.map((x: any) => x.id);
    expect(await openIds()).toContain(f.id);
    expect((await call('DELETE', `/api/fines/${f.id}`)).status).toBe(404);
    expect((await call('POST', `/api/fines/${f.id}/void`, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/fines/${f.id}/void`, { reason: 'Ghi nhầm' }, staffCookie)).status).toBe(403);
    const v = await call('POST', `/api/fines/${f.id}/void`, { reason: 'Ghi nhầm biển số' });
    expect(v.json).toMatchObject({ voidReason: 'Ghi nhầm biển số' });
    expect(v.json.voidedAt).toBeGreaterThan(0);
    expect(await openIds()).not.toContain(f.id);
    expect((await call('GET', '/api/fines?status=all')).json.items.find((x: any) => x.id === f.id).voidedAt).toBeTruthy();
    expect((await call('PATCH', `/api/fines/${f.id}`, { amount: 1 })).status).toBe(400);
    expect((await call('POST', `/api/fines/${f.id}/void`, { reason: 'lần nữa' })).status).toBe(404);
    expect((await call('POST', `/api/fines/${f.id}/restore`)).status).toBe(200);
    expect(await openIds()).toContain(f.id);
    await call('POST', `/api/fines/${f.id}/void`, { reason: 'Ghi nhầm biển số' });
  });
});

describe('thông báo Telegram một lần: có hàng đợi gửi lại', () => {
  it('mất mạng lúc đặt xe → tin nằm trong hàng đợi, lần sau gửi lại kèm giờ gốc, không gửi trùng; quá 24 giờ thì bỏ', async () => {
    const { updateLocalConfig } = await import('./lib/localConfig.js');
    const { flushNotifyQueue } = await import('./lib/telegram.js');
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    const sent: string[] = [];
    let down = true;
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes('api.telegram.org')) throw new Error(`fetch không mong đợi: ${url}`);
      if (down) return new Response(JSON.stringify({ ok: false, description: 'Bad Gateway' }), { status: 502 });
      sent.push(JSON.parse(String(init!.body)).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    updateLocalConfig((c) => {
      c.telegram = { ...c.telegram, botToken: '123:abc', chatId: '1', notify: true };
    });
    try {
      const vid = (await call('POST', '/api/vehicles', { plate: '51N-777.88', make: 'Kia', model: 'K3', priceDay: 700000 })).json.id;
      const cust = (await call('POST', '/api/customers', { fullName: 'Lâm Hàng Đợi', idNumber: '079099000777' })).json.id;
      const r = (await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, scheduledStart: at('2028-09-01T08:00'), scheduledEnd: at('2028-09-02T08:00') })).json;
      await new Promise((ok) => setTimeout(ok, 50));
      const row = () => db.select().from(schema.notifyQueue).all().find((m) => m.html.includes(r.code))!;
      expect(row()).toMatchObject({ sentAt: null, attempts: 1 });
      down = false;
      expect(await flushNotifyQueue()).toBe(0); // chưa tới giờ thử lại
      expect(await flushNotifyQueue(Date.now() + 10 * 60_000)).toBeGreaterThanOrEqual(1);
      const mine = sent.filter((t) => t.includes(r.code));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toContain('⏳ Tin lúc');
      expect(mine[0]).toContain('Đặt xe');
      expect(row().sentAt).toBeGreaterThan(0);
      await flushNotifyQueue(Date.now() + 20 * 60_000);
      expect(sent.filter((t) => t.includes(r.code))).toHaveLength(1);

      const old = db.insert(schema.notifyQueue).values({ html: 'tin quá cũ', nextAttemptAt: 0, createdAt: Date.now() - 25 * 3_600_000 }).returning().get();
      await flushNotifyQueue();
      expect(sent).not.toContain('tin quá cũ');
      expect(db.select().from(schema.notifyQueue).where(eq(schema.notifyQueue.id, old.id)).get()!.droppedAt).toBeGreaterThan(0);
      await call('POST', `/api/rentals/${r.id}/cancel`, { reason: 'Dọn dữ liệu test' });
      await new Promise((ok) => setTimeout(ok, 50));
    } finally {
      vi.unstubAllGlobals();
      updateLocalConfig((c) => {
        c.telegram = { ...c.telegram, botToken: '', chatId: '' };
      });
    }
  });
});

describe('sao lưu ảnh lên Telegram: không sót file', () => {
  it('file đọc lỗi / gửi hỏng giữa chừng → lần sau gửi tiếp; ảnh + thumbnail cùng gói; giữ mốc của bản cũ', async () => {
    const { getLocalConfig, updateLocalConfig } = await import('./lib/localConfig.js');
    const { runOffsiteBackup } = await import('./lib/backup.js');
    const { decryptPack } = await import('./lib/pack.js');
    const { absPath, getFileRow } = await import('./lib/files.js');
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    const PASS = 'matkhau-sao-luu';
    const packs: string[][] = [];
    let filesDown = false;
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes('api.telegram.org')) throw new Error(`fetch không mong đợi: ${url}`);
      const doc = init!.body instanceof FormData ? (init!.body.get('document') as File) : null;
      if (doc?.name.includes('-files-')) {
        if (filesDown) return new Response(JSON.stringify({ ok: false, description: 'Bad Gateway' }), { status: 502 });
        packs.push(decryptPack(Buffer.from(await doc.arrayBuffer()), PASS).entries.map((e) => e.path));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    updateLocalConfig((c) => {
      c.telegram = { ...c.telegram, botToken: '123:abc', chatId: '1', notify: false };
      c.backup.passphrase = PASS;
    });
    const sentPaths = () => packs.flat();
    const tick = () => new Promise((ok) => setTimeout(ok, 5));
    try {
      // Bản cũ đã gửi tới mốc này: mọi file tạo trước đó (cả của các test trên) không gửi lại.
      const old = getFileRow(await upload('vehicle_photo'));
      await tick();
      updateLocalConfig((c) => {
        c.backup.filesSyncedUntil = Date.now();
      });
      await tick();
      const b = getFileRow(await upload('vehicle_photo'));
      const c = getFileRow(await upload('id_front'));
      fs.renameSync(absPath(c.path), `${absPath(c.path)}.bak`);

      const r1 = await runOffsiteBackup();
      expect(r1).toMatchObject({ files: 1, parts: 1, skipped: 1 });
      expect(packs).toEqual([[b.path, b.thumbPath]]);
      expect(sentPaths()).not.toContain(old.path);
      expect(getLocalConfig().backup.filesSkipped).toBe(1);
      expect((await call('GET', '/api/system/backups')).json.config.filesSkipped).toBe(1);

      // File đọc được lại, nhưng gói ảnh gửi hỏng → không đánh dấu, lần sau gửi tiếp.
      fs.renameSync(`${absPath(c.path)}.bak`, absPath(c.path));
      const d = getFileRow(await upload('vehicle_photo'));
      filesDown = true;
      await expect(runOffsiteBackup()).rejects.toThrow('Bad Gateway');
      expect(getFileRow(c.id).offsiteAt).toBeNull();
      expect(getFileRow(d.id).offsiteAt).toBeNull();
      filesDown = false;
      const r2 = await runOffsiteBackup();
      expect(r2).toMatchObject({ files: 2, skipped: 0 });
      expect(sentPaths()).toEqual(expect.arrayContaining([c.path, c.thumbPath, d.path, d.thumbPath]));
      expect(getLocalConfig().backup.filesSkipped).toBeUndefined();
      expect(getLocalConfig().backup.filesSyncedUntil).toBe(d.createdAt);

      expect(await runOffsiteBackup()).toMatchObject({ files: 0, parts: 0 });
      // Khôi phục một DB cũ chưa có dấu đã gửi: file trước mốc bản cũ vẫn không gửi lại.
      db.update(schema.files).set({ offsiteAt: null }).where(eq(schema.files.id, old.id)).run();
      expect(await runOffsiteBackup()).toMatchObject({ files: 0, parts: 0 });
    } finally {
      vi.unstubAllGlobals();
      updateLocalConfig((c) => {
        c.telegram = { ...c.telegram, botToken: '', chatId: '' };
        c.backup.passphrase = '';
      });
    }
  });
});

describe('lượt thuê qua Mioto', () => {
  let vid = 0;
  let cust = 0;
  let id = 0;
  const detail = async (rid = id, cookie = adminCookie) => (await call('GET', `/api/rentals/${rid}`, undefined, cookie)).json;
  const month = vnDateKey(Date.now()).slice(0, 7);
  const feeEntries = async () =>
    (await call('GET', `/api/cashflow?p=${month}&v=${vid}`)).json.ledger
      .filter((l: any) => l.kind === 'entry' && l.entry.rentalId != null && !l.entry.voidedAt)
      .map((l: any) => l.amount)
      .sort((a: number, b: number) => b - a);
  const docXml = async (kind: string, rid = id) => {
    const r = await call('POST', `/api/rentals/${rid}/documents`, { kind });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const file = await app.inject({ method: 'GET', url: `/api/files/${r.json.document.docxFileId}`, headers: { cookie: adminCookie } });
    // Xem bản in thật: MIOTO_DUMP=<thư mục> npx vitest run -w apps/api
    if (process.env.MIOTO_DUMP) fs.writeFileSync(path.join(process.env.MIOTO_DUMP, `${kind}-${rid}.docx`), file.rawPayload);
    return { doc: r.json.document, xml: new PizZip(file.rawPayload).file('word/document.xml')!.asText() };
  };
  /** Chữ trong ô vuông vẽ sẵn của biên bản Mioto, theo thứ tự trong văn bản (mỗi ô 2 bản: Word mới + Word cũ). */
  const boxes = (xml: string) => [...xml.matchAll(/<w:txbxContent>[\s\S]*?<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((m) => m[1]).filter((_, i) => i % 2 === 0);

  it('mẫu Mioto dựng sẵn có đủ: hợp đồng + biên bản (giao, nhận)', async () => {
    const t = (await call('GET', '/api/templates')).json.filter((x: any) => x.channel === 'mioto');
    expect(t.map((x: any) => [x.kind, x.isDefault]).sort()).toEqual([
      ['contract', true],
      ['pickup', true],
      ['return', true],
    ]);
  });

  it('chuẩn bị: Bên A là cá nhân, xe có giấy đăng ký, khách có nơi cấp GPLX; phí mặc định 15%', async () => {
    const biz = (await call('GET', '/api/settings')).json.business;
    expect((await call('PUT', '/api/settings/business', { ...biz, permanentAddress: '5 Trần Hưng Đạo, Q5', currentAddress: '' })).status).toBe(200);
    expect((await call('GET', '/api/settings')).json.rules.miotoFeePct).toBe(15);
    expect((await call('GET', '/api/settings', undefined, staffCookie)).json.rules.miotoFeePct).toBeUndefined();
    const v = await call('POST', '/api/vehicles', {
      plate: '51F-468.02',
      make: 'Mitsubishi',
      model: 'Xpander',
      year: 2023,
      color: 'Trắng',
      seats: 7,
      priceDay: 900000,
      kmLimitDay: 300,
      overKmFee: 3000,
      odo: 20000,
      regNumber: '0123456',
      regDate: '2023-05-10',
      regPlace: 'Phòng CSGT TP.HCM',
      regOwner: 'Nguyễn Văn Chủ',
    });
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    vid = v.json.id;
    cust = (
      await call('POST', '/api/customers', {
        fullName: 'Lê Mi Ô Tô',
        idNumber: '079095004321',
        idIssueDate: '2021-04-01',
        idIssuePlace: 'Cục Cảnh sát QLHC về TTXH',
        phone: '0911222333',
        licenseNumber: '790987654321',
        licenseClass: 'B',
        licenseIssueDate: '2019-06-01',
        licenseIssuePlace: 'Sở GTVT TP.HCM',
        permanentAddress: '9 Hai Bà Trưng, Q1',
      })
    ).json.id;
  });

  it('đặt qua Mioto: tiền thuê đúng giá app, tiền trả trước qua app, phí 15% ghi vào Thu chi', async () => {
    const times = { scheduledStart: at('2026-12-04T09:00'), scheduledEnd: at('2026-12-07T09:00') };
    const noPrice = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times, channel: 'mioto' });
    expect(noPrice.status).toBe(400);
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times, channel: 'mioto', channelRef: 'MI8K2X', channelPrice: 2_550_000, channelPrepaid: 1_020_000, depositRequired: 5_000_000, source: 'zalo' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    id = r.json.id;
    expect(r.json).toMatchObject({ channel: 'mioto', channelRef: 'MI8K2X', channelFeePct: 15, channelFee: 382_500, source: null });
    const d = await detail();
    expect(d.charges.map((c: any) => [c.kind, c.amount])).toEqual([['rental', 2_550_000]]);
    expect(d.money).toMatchObject({ totalCharges: 2_550_000, rentPaid: 1_020_000, due: 1_530_000 });
    expect(d.payments.map((p: any) => [p.method, p.amount])).toEqual([['mioto', 1_020_000]]);
    expect(d.channelMoney).toEqual({ prepaid: 1_020_000, fee: 382_500, payout: null, owed: 637_500 });
    expect(await feeEntries()).toEqual([382_500]);
    // Phí sàn do app tự ghi: không ghi tay, không sửa/hủy ở Thu chi.
    const entry = (await call('GET', `/api/cashflow?p=${month}&v=${vid}`)).json.ledger.find((l: any) => l.entry?.rentalId === id).entry;
    // Hạng mục có sẵn (bản cũ đọc được khi quay về), nội dung ghi rõ phí sàn.
    expect(entry).toMatchObject({ category: 'marketing', description: expect.stringContaining('Phí sàn Mioto'), vendor: 'Mioto' });
    expect((await call('PUT', `/api/cash-entries/${entry.id}`, { category: 'marketing', amount: 1000, at: Date.now() })).status).toBe(400);
    expect((await call('POST', `/api/cash-entries/${entry.id}/void`, { reason: 'thử' })).status).toBe(400);
    // Còn phiếu trả qua app thì không đổi sang khách trực tiếp được (sổ tiền sẽ sai).
    expect((await call('PATCH', `/api/rentals/${id}`, { channel: 'direct' })).status).toBe(400);
    // Tìm theo mã chuyến Mioto.
    expect((await call('GET', '/api/rentals?q=mi8k2x')).json.items.map((x: any) => x.id)).toEqual([id]);
  });

  it('nhân viên không thấy phí sàn ở bất kỳ đâu, không sửa được phí', async () => {
    const d = await detail(id, staffCookie);
    expect(d.rental.channel).toBe('mioto');
    expect(d.rental).not.toHaveProperty('channelFee');
    expect(d.rental).not.toHaveProperty('channelFeePct');
    expect(d).not.toHaveProperty('channelMoney');
    const list = await call('GET', '/api/rentals?q=mi8k2x', undefined, staffCookie);
    expect(JSON.stringify(list.json)).not.toContain('382500');
    const c = await call('GET', `/api/customers/${cust}`, undefined, staffCookie);
    expect(JSON.stringify(c.json)).not.toMatch(/channelFee|382500/);
    expect((await call('POST', `/api/rentals/${id}/channel-payout`, { amount: 600000 }, staffCookie)).status).toBe(403);
    expect((await call('PATCH', `/api/rentals/${id}`, { channelFeePct: 0 }, staffCookie)).status).toBe(403);
  });

  it('hợp đồng Mioto: điền chủ xe + khách + xe, giá app, ô trả trước 40% — không in phí sàn', async () => {
    const { doc, xml } = await docXml('contract');
    expect(doc.templateName).toBe('Hợp đồng Mioto');
    for (const s of [
      'MI8K2X/HĐCTXTL',
      'Nguyễn Văn Chủ',
      '5 Trần Hưng Đạo, Q5',
      'Lê Mi Ô Tô',
      '079095004321',
      'Cục Cảnh sát QLHC về TTXH',
      '790987654321',
      'Sở GTVT TP.HCM',
      '51F-468.02',
      'Mitsubishi Xpander',
      '0123456',
      '10/05/2023',
      'Phòng CSGT TP.HCM',
      '04/12/2026',
      '07/12/2026',
      '2.550.000',
      '850.000',
    ]) {
      expect(xml, s).toContain(s);
    }
    expect(xml.match(/☒/g)).toHaveLength(1);
    expect(xml.indexOf('☒')).toBeLessThan(xml.indexOf('thanh toán trướ'));
    expect(xml).not.toContain('Trường hợp Bên thuê xe là tổ chức');
    expect(xml).not.toMatch(/\{[a-z_.0-9]+\}/);
    for (const secret of ['382.500', '637.500']) {
      expect(xml).not.toContain(secret);
      expect(JSON.stringify(doc.data)).not.toContain(secret);
      expect(JSON.stringify(doc.data)).not.toContain(secret.replace('.', ''));
    }
  });

  it('giao xe → biên bản Mioto: phần giao điền đủ, phần hoàn trả để trống', async () => {
    const p = await call('POST', `/api/rentals/${id}/pickup`, {
      at: at('2026-12-04T09:15'),
      odo: 20100,
      fuelLevel: 75,
      damages: [],
      payments: [
        { purpose: 'rent', method: 'transfer', amount: 1_530_000 },
        { purpose: 'deposit', method: 'cash', amount: 5_000_000 },
      ],
      collaterals: [{ kind: 'motorbike', description: 'Honda Vision 59X1-123.45' }],
    });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    const { doc, xml } = await docXml('pickup');
    expect(doc.templateName).toBe('Biên bản bàn giao Mioto (giao xe)');
    for (const s of ['MI8K2X', 'ngày 04 tháng 12 năm 2026', '09 giờ 15', 'Honda Vision 59X1-123.45', '5.000.000 đồng', 'Xpander', '(mức)']) expect(xml, s).toContain(s);
    // Ô vuông theo thứ tự: Bình thường, ODO, xăng, Miễn thế chấp, Có thế chấp, Giống ban đầu, Trả đủ.
    expect(boxes(xml)).toEqual(['X', '20.100', '75%', ' ', 'X', ' ', ' ']);
    expect(xml).not.toMatch(/\{[a-z_.0-9]+\}/);
  });

  it('gia hạn trên app: nhập tổng tiền mới → tiền thuê + phí sàn tính lại, có lịch sử gia hạn', async () => {
    const r = await call('PATCH', `/api/rentals/${id}`, { scheduledEnd: at('2026-12-08T09:00'), channelPrice: 3_400_000 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ channelPrice: 3_400_000, channelFee: 510_000 });
    const d = await detail();
    expect(d.charges.map((c: any) => [c.kind, c.amount])).toEqual([['rental', 3_400_000]]);
    expect(d.extensions.map((e: any) => [e.oldTotal, e.newTotal])).toEqual([[2_550_000, 3_400_000]]);
    expect(await feeEntries()).toEqual([510_000]);
  });

  it('nhận xe + quyết toán → biên bản Mioto điền cả phần hoàn trả', async () => {
    const ret = await call('POST', `/api/rentals/${id}/return`, { at: at('2026-12-08T08:30'), odo: 21000, fuelLevel: 50, damages: [{ zone: 'Cản trước', note: 'trầy 5cm', isNew: true }] });
    expect(ret.status, JSON.stringify(ret.json)).toBe(200);
    expect((await detail()).money.due).toBe(850_000);
    const s = await call('POST', `/api/rentals/${id}/settle`, { offset: 850_000, refundDeposit: { amount: 2_150_000, method: 'cash' }, fineHoldDays: 15 });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    const { doc, xml } = await docXml('return');
    expect(doc.templateName).toBe('Biên bản bàn giao Mioto (nhận xe)');
    for (const s2 of ['08 giờ 30', '08/12/2026', '21.000', 'Cản trước: trầy 5cm', 'Tiền cọc 2.000.000 đ, giữ đến 23/12/2026']) {
      expect(xml, s2).toContain(s2);
    }
    // Quyết toán đã trả xe máy cho khách, chỉ còn giữ cọc chờ phạt nguội.
    expect(xml).not.toContain('Xe máy + cà vẹt:');
    // Có hư hỏng mới → không đánh "Giống ban đầu"; còn giữ cọc → không đánh "Trả đủ".
    expect(boxes(xml).slice(-2)).toEqual([' ', ' ']);
  });

  it('Mioto chuyển tiền về: phí sàn thành số thật; hoàn tác thì quay về 15%', async () => {
    const owed = (await call('GET', `/api/cashflow?p=${month}`)).json.channelOwed;
    expect(owed.map((x: any) => [x.id, x.owed])).toEqual([[id, 510_000]]);
    expect((await call('POST', `/api/rentals/${id}/channel-payout`, { amount: 2_000_000 })).status).toBe(400);
    const r = await call('POST', `/api/rentals/${id}/channel-payout`, { amount: 500_000, at: at('2026-12-10T10:00') });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ channelPayout: 500_000, channelFee: 520_000 });
    expect((await detail()).channelMoney).toEqual({ prepaid: 1_020_000, fee: 520_000, payout: 500_000, owed: 0 });
    expect(await feeEntries()).toEqual([520_000]);
    expect((await call('GET', `/api/cashflow?p=${month}`)).json.channelOwed).toEqual([]);
    expect((await call('POST', `/api/rentals/${id}/channel-payout`, { amount: null })).json).toMatchObject({ channelPayout: null, channelFee: 510_000 });
    expect((await call('POST', `/api/rentals/${id}/channel-payout`, { amount: 500_000, at: at('2026-12-10T10:00') })).status).toBe(200);
  });

  it('báo cáo theo kênh: Mioto trừ phí sàn, lượt trực tiếp chia theo nguồn khách', async () => {
    const direct = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, scheduledStart: at('2026-12-21T09:00'), scheduledEnd: at('2026-12-23T09:00'), source: 'returning' });
    expect(direct.status, JSON.stringify(direct.json)).toBe(200);
    expect(direct.json).toMatchObject({ channel: 'direct', source: 'returning', channelFee: null });
    const pre = await call('POST', '/api/rentals/precheck', { vehicleId: vid, customerId: cust, scheduledStart: at('2027-01-05T09:00'), scheduledEnd: at('2027-01-06T09:00') });
    expect(pre.json.customerRentals).toBe(2);
    const rep = (await call('GET', `/api/cashflow?p=2026-12&v=${vid}`)).json.channels;
    expect(rep.rows.map((r: any) => [r.channel, r.rentals, r.revenue, r.fee, r.net])).toEqual([
      ['mioto', 1, 3_400_000, 520_000, 2_880_000],
      ['direct', 1, 1_800_000, 0, 1_800_000],
    ]);
    expect(rep.sources).toEqual([{ source: 'returning', rentals: 1, revenue: 1_800_000 }]);
    expect(rep.returning).toBe(1);
  });

  it('hủy lượt Mioto: app hoàn tiền trả trước cho khách, phí sàn bỏ', async () => {
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, scheduledStart: at('2027-02-01T09:00'), scheduledEnd: at('2027-02-02T09:00'), channel: 'mioto', channelPrice: 900_000, channelPrepaid: 360_000 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const rid = r.json.id;
    expect(await feeEntries()).toEqual([520_000, 135_000]);
    const c = await call('POST', `/api/rentals/${rid}/cancel`, { reason: 'Khách hủy trên app', keep: 0, refund: null });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    const d = await detail(rid);
    expect(d.payments.filter((p: any) => !p.voidedAt).map((p: any) => [p.direction, p.method, p.amount])).toEqual([
      ['in', 'mioto', 360_000],
      ['out', 'mioto', 360_000],
    ]);
    expect(d.channelMoney).toMatchObject({ prepaid: 0, fee: 0, owed: 0 });
    expect(await feeEntries()).toEqual([520_000]);
  });
  it('giá thỏa thuận theo ngày (khách trả giá): báo giá, đặt xe, gia hạn vẫn giữ giá, sửa giá được', async () => {
    const times = { scheduledStart: at('2027-03-01T09:00'), scheduledEnd: at('2027-03-03T09:00') };
    const pre = await call('POST', '/api/rentals/precheck', { vehicleId: vid, customerId: cust, ...times, priceDay: 750_000 });
    expect(pre.json.quote.total).toBe(1_500_000);
    const r = await call('POST', '/api/rentals', { vehicleId: vid, customerId: cust, ...times, priceDay: 750_000 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const rid = r.json.id;
    expect(JSON.parse(r.json.pricing).priceDay).toBe(750_000);
    expect((await detail(rid)).money.totalCharges).toBe(1_500_000);
    expect((await call('PATCH', `/api/rentals/${rid}`, { scheduledEnd: at('2027-03-04T09:00') })).status).toBe(200);
    expect((await detail(rid)).money.totalCharges).toBe(2_250_000);
    expect((await call('PATCH', `/api/rentals/${rid}`, { priceDay: 700_000 })).status).toBe(200);
    expect((await detail(rid)).money.totalCharges).toBe(2_100_000);
    // Xe vẫn giữ bảng giá gốc cho lượt khác.
    expect((await call('POST', '/api/rentals/precheck', { vehicleId: vid, ...times })).json.quote.total).toBe(1_800_000);
    // Xe để giá cuối tuần bằng giá ngày (không có giá cuối tuần riêng): sửa giá ngày thì T7, CN theo luôn.
    await call('PATCH', `/api/vehicles/${vid}`, { priceWeekendDay: 900_000 });
    const weekend = { scheduledStart: at('2027-03-06T09:00'), scheduledEnd: at('2027-03-08T09:00') };
    expect((await call('POST', '/api/rentals/precheck', { vehicleId: vid, ...weekend, priceDay: 750_000 })).json.quote.total).toBe(1_500_000);
  });
});

describe('sửa một phần (PATCH) chỉ đổi đúng trường được gửi', () => {
  const stable = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'updatedAt'));

  it('xe: sửa một trường không làm mất ODO, giá, cọc, loại chủ xe', async () => {
    const created = await call('POST', '/api/vehicles', {
      plate: '51P-100.01',
      make: 'Honda',
      model: 'City',
      odo: 32150,
      priceDay: 800000,
      priceHour: 100000,
      kmLimitDay: 300,
      overKmFee: 3000,
      overHourFee: 100000,
      depositAmount: 5000000,
      active: false,
      ownerType: 'consigned',
      ownerName: 'Chị Lan',
      ownerSharePct: 70,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const r = await call('PATCH', `/api/vehicles/${created.json.id}`, { color: 'Xám' });
    expect(r.status).toBe(200);
    expect(stable(r.json)).toEqual({ ...stable(created.json), color: 'Xám' });
  });

  it('danh mục phụ kiện: lưu trữ và bỏ lưu trữ giữ nguyên giá trị đền bù', async () => {
    const c = await call('POST', '/api/accessories/catalog', { name: 'Ghế trẻ em thử', category: 'comfort', defaultValue: 2000000, highlight: true, essential: true, evOnly: true });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    const off = await call('PATCH', `/api/accessories/catalog/${c.json.id}`, { archived: true });
    expect(off.status).toBe(200);
    expect(off.json).toMatchObject({ defaultValue: 2000000, highlight: true, essential: true, evOnly: true });
    expect(off.json.archivedAt).toBeTruthy();
    const on = await call('PATCH', `/api/accessories/catalog/${c.json.id}`, { archived: false });
    expect(on.json).toMatchObject({ defaultValue: 2000000, highlight: true, essential: true, evOnly: true, archivedAt: null });
  });

  it('phạt nguội: sửa ghi chú không đưa trạng thái về "mới"', async () => {
    const f = await call('POST', '/api/fines', { plate: '51P-100.01', violatedAt: at('2027-01-05T09:00'), source: 'notice', status: 'notified', location: 'Quận 1' });
    expect(f.status, JSON.stringify(f.json)).toBe(200);
    const r = await call('PATCH', `/api/fines/${f.json.id}`, { notes: 'Đã gọi khách' });
    expect(stable(r.json)).toEqual({ ...stable(f.json), notes: 'Đã gọi khách' });
  });

  it('khoảng tạm ngưng và khách hàng: giữ nguyên các trường không gửi', async () => {
    const v = (await call('POST', '/api/vehicles', { plate: '51P-100.02', priceDay: 500000 })).json;
    const b = (await call('POST', `/api/vehicles/${v.id}/blocks`, { kind: 'maintenance', startAt: at('2027-02-01T09:00'), endAt: at('2027-02-03T09:00'), location: 'Gara A', notes: 'Thay lốp' })).json;
    const p = await call('PATCH', `/api/blocks/${b.id}`, { notes: 'Thay 2 lốp' });
    expect(stable(p.json)).toEqual({ ...stable(b), notes: 'Thay 2 lốp' });
    const c = (await call('POST', '/api/customers', { fullName: 'Khách Thử Sửa', idNumber: '079090777001', phone: '0901000777', address: 'TP HCM' })).json;
    const u = await call('PATCH', `/api/customers/${c.id}`, { notes: 'Khách quen' });
    expect(stable(u.json)).toEqual({ ...stable(c), notes: 'Khách quen' });
  });

  it('trường được gửi rõ là null vẫn xóa được', async () => {
    const v = (await call('POST', '/api/vehicles', { plate: '51P-100.03', priceDay: 500000, color: 'Đỏ' })).json;
    expect((await call('PATCH', `/api/vehicles/${v.id}`, { color: null })).json.color).toBeNull();
  });
});

describe('xe ký gửi', () => {
  const H = 3_600_000;
  const DAY = 24 * H;
  let own = 0;
  let con = 0;
  let cust = 0;
  const conPlate = '51Q-200.02';
  const entry = (body: object, cookie = adminCookie) => call('POST', '/api/cash-entries', { amount: 1_000_000, at: Date.now(), ...body }, cookie);
  const book = async (vehicleId: number, startInHours: number, hours = 24) => {
    const start = Date.now() + startInHours * H;
    const r = await call('POST', '/api/rentals', { vehicleId, customerId: cust, scheduledStart: start, scheduledEnd: start + hours * H, depositRequired: 0 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json as { id: number; code: string; scheduledStart: number; scheduledEnd: number };
  };

  it('bắt buộc có tên chủ xe và tỷ lệ chia, cả khi tạo lẫn khi sửa', async () => {
    const base = { priceDay: 700000 };
    const a = await call('POST', '/api/vehicles', { ...base, plate: '51Q-200.00', ownerType: 'consigned', ownerSharePct: 70 });
    expect(a.status).toBe(400);
    expect(a.json.error).toContain('tên chủ xe');
    const b = await call('POST', '/api/vehicles', { ...base, plate: '51Q-200.00', ownerType: 'consigned', ownerName: 'Chị Lan' });
    expect(b.status).toBe(400);
    expect(b.json.error).toContain('tỷ lệ');

    own = (await call('POST', '/api/vehicles', { ...base, plate: '51Q-200.01' })).json.id;
    expect((await call('PATCH', `/api/vehicles/${own}`, { ownerType: 'consigned' })).status).toBe(400);

    const c = await call('POST', '/api/vehicles', { ...base, plate: conPlate, ownerType: 'consigned', ownerName: 'Chị Lan', ownerPhone: '0900000001', ownerSharePct: 70 });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    con = c.json.id;
    // Đã đủ thông tin thì sửa trường khác không bị đòi lại; xóa tên chủ thì bị chặn.
    expect((await call('PATCH', `/api/vehicles/${con}`, { color: 'Xám' })).status).toBe(200);
    expect((await call('PATCH', `/api/vehicles/${con}`, { ownerName: null })).status).toBe(400);
    cust = (await call('POST', '/api/customers', { fullName: 'Khách Ký Gửi', idNumber: '079099000888', phone: '0909000888' })).json.id;
  });

  it('nhân viên biết xe ký gửi nhưng không thấy tên, SĐT, tỷ lệ của chủ xe', async () => {
    const hidden = (v: Record<string, unknown>) => {
      expect(v.ownerType).toBe('consigned');
      expect(v).not.toHaveProperty('ownerName');
      expect(v).not.toHaveProperty('ownerPhone');
      expect(v).not.toHaveProperty('ownerSharePct');
    };
    hidden((await call('GET', '/api/vehicles', undefined, staffCookie)).json.find((v: any) => v.id === con));
    hidden((await call('GET', `/api/vehicles/${con}`, undefined, staffCookie)).json.vehicle);
    hidden((await call('GET', `/api/fines/lookup?plate=${conPlate}&at=${Date.now()}&preview=1`, undefined, staffCookie)).json.vehicle);
    expect((await call('GET', `/api/vehicles/${con}`)).json.vehicle).toMatchObject({ ownerName: 'Chị Lan', ownerPhone: '0900000001', ownerSharePct: 70 });
  });

  it('nhật ký ghi giá trị cũ và mới, chỉ các trường thực sự đổi', async () => {
    const full = (await call('GET', `/api/vehicles/${con}`)).json.vehicle;
    expect((await call('PATCH', `/api/vehicles/${con}`, { ...full, ownerSharePct: 60 })).status).toBe(200);
    const items = (await call('GET', `/api/system/audit?entity=vehicle&entityId=${con}&limit=5`)).json.items;
    const last = items.find((x: any) => x.action === 'vehicle.update');
    const detail = typeof last.detail === 'string' ? JSON.parse(last.detail) : last.detail;
    expect(detail.changes).toEqual([{ field: 'ownerSharePct', from: 70, to: 60 }]);
  });

  it('khoản trả chủ xe chỉ gắn được với xe ký gửi', async () => {
    expect((await entry({ category: 'owner_payout', vehicleId: null })).status).toBe(400);
    expect((await entry({ category: 'owner_payout', vehicleId: own })).status).toBe(400);
    const ok = await entry({ category: 'owner_payout', vehicleId: con });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    // Sửa phiếu cũng theo quy tắc đó.
    const put = await call('PUT', `/api/cash-entries/${ok.json.entry.id}`, { category: 'owner_payout', amount: 1_000_000, at: Date.now(), vehicleId: own });
    expect(put.status).toBe(400);
  });

  it('xe ký gửi không ghi mua xe, trả góp, bán xe; xe nhà và chi phí chung vẫn ghi được', async () => {
    for (const category of ['purchase', 'loan', 'asset_sale']) {
      expect((await entry({ category, vehicleId: con })).status, category).toBe(400);
      expect((await entry({ category, vehicleId: own })).status, category).toBe(200);
    }
    expect((await entry({ category: 'loan', vehicleId: null })).status).toBe(200);
  });

  it('xe ký gửi: chủ xe tự trả bảo dưỡng, sửa chữa, giấy tờ; cửa hàng vẫn ghi chi phí vận hành', async () => {
    for (const category of ['maintenance', 'repair', 'parts', 'accessory', 'inspection', 'insurance', 'road_fee']) {
      const r = await entry({ category, vehicleId: con });
      expect(r.status, category).toBe(400);
      expect(r.json.error).toContain('chủ xe tự trả');
      expect((await entry({ category, vehicleId: own })).status, category).toBe(200);
    }
    for (const category of ['fuel', 'cleaning', 'parking', 'toll', 'delivery']) expect((await entry({ category, vehicleId: con })).status, category).toBe(200);
  });

  it('đánh dấu đã bảo dưỡng xe ký gửi: ghi lại việc đã làm, không ghi chi phí', async () => {
    const created = await call('POST', `/api/vehicles/${con}/maintenance`, { items: [{ name: 'Thay dầu máy', intervalKm: 5000 }] });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const item = (await call('GET', `/api/vehicles/${con}/maintenance`)).json.items[0].id;
    const date = vnDateKey(Date.now());
    const paid = await call('POST', `/api/vehicles/${con}/maintenance/done`, { itemIds: [item], date, cost: { amount: 500000, method: 'cash' } });
    expect(paid.status).toBe(400);
    expect((await call('POST', `/api/vehicles/${con}/maintenance/done`, { itemIds: [item], date })).status).toBe(200);
  });

  it('khoản định kỳ có từ trước khi xe chuyển sang ký gửi thì ngừng tự ghi', async () => {
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    const now = Date.now();
    const rule = db
      .insert(schema.recurringCosts)
      .values({ category: 'insurance', amount: 500000, vehicleId: con, method: 'cash', dayOfMonth: 1, intervalMonths: 1, startMonth: '2026-01', active: true, createdBy: null, createdAt: now, updatedAt: now })
      .returning()
      .get();
    expect((await call('GET', '/api/cashflow')).status).toBe(200);
    expect(db.select().from(schema.cashEntries).where(eq(schema.cashEntries.recurringId, rule.id)).all()).toHaveLength(0);
    db.update(schema.recurringCosts).set({ active: false }).where(eq(schema.recurringCosts.id, rule.id)).run();
  });

  it('nhắc việc xe ký gửi: quản trị thấy tên và SĐT chủ xe, nhân viên chỉ thấy cần nhắc', async () => {
    const soon = vnDateKey(Date.now() + 5 * DAY);
    expect((await call('PATCH', `/api/vehicles/${con}`, { inspectionExpiry: soon })).status).toBe(200);
    expect((await call('PATCH', `/api/vehicles/${own}`, { inspectionExpiry: soon })).status).toBe(200);
    const alertOf = async (plate: string, cookie = adminCookie) => ((await call('GET', '/api/dashboard', undefined, cookie)).json.alerts as any[]).find((a) => a.kind === 'vehicle_doc' && a.title.includes(plate));

    expect(await alertOf(conPlate)).toMatchObject({ remindOwner: true, ownerName: 'Chị Lan', ownerPhone: '0900000001' });
    const staff = await alertOf(conPlate, staffCookie);
    expect(staff.remindOwner).toBe(true);
    expect(staff).not.toHaveProperty('ownerName');
    expect(staff).not.toHaveProperty('ownerPhone');
    expect((await alertOf('51Q-200.01')).remindOwner).toBeUndefined();

    const { buildDigest } = await import('./services/alerts.js');
    expect(buildDigest()).toContain('Nhắc chủ xe Chị Lan 0900000001');
  });

  it('khoản định kỳ cũng theo quy tắc đó', async () => {
    const rule = { amount: 1_000_000, dayOfMonth: 5, intervalMonths: 1, startMonth: '2030-01' };
    expect((await call('POST', '/api/recurring-costs', { ...rule, category: 'owner_payout', vehicleId: own })).status).toBe(400);
    expect((await call('POST', '/api/recurring-costs', { ...rule, category: 'loan', vehicleId: con })).status).toBe(400);
    expect((await call('POST', '/api/recurring-costs', { ...rule, category: 'owner_payout', vehicleId: con })).status).toBe(200);
  });

  it('nhân viên chỉ ghi được chi phí vận hành', async () => {
    for (const category of ['owner_payout', 'purchase', 'loan']) expect((await entry({ category, vehicleId: con }, staffCookie)).status, category).toBe(403);
    expect((await entry({ category: 'fuel', vehicleId: con }, staffCookie)).status).toBe(200);
  });

  it('tạm ngưng đè lượt khách đã đặt: chặn, chỉ quản trị mới xác nhận được', async () => {
    const r = await book(con, 24 * 10);
    const body = { kind: 'owner_use', startAt: r.scheduledStart, endAt: r.scheduledEnd };
    const staff = await call('POST', `/api/vehicles/${con}/blocks`, body, staffCookie);
    expect(staff.status).toBe(409);
    expect(staff.json).toMatchObject({ code: 'block_overlaps_rental', canForce: false });
    expect(staff.json.error).toContain(r.code);
    expect((await call('POST', `/api/vehicles/${con}/blocks`, { ...body, force: true }, staffCookie)).status).toBe(409);

    const admin = await call('POST', `/api/vehicles/${con}/blocks`, body);
    expect(admin.status).toBe(409);
    expect(admin.json.canForce).toBe(true);
    const forced = await call('POST', `/api/vehicles/${con}/blocks`, { ...body, force: true });
    expect(forced.status, JSON.stringify(forced.json)).toBe(200);
    // Khoảng đã trùng từ trước vẫn kết thúc sớm được.
    expect((await call('PATCH', `/api/blocks/${forced.json.id}`, { endAt: r.scheduledStart + H })).status).toBe(200);

    // Không ngày kết thúc thì đè cả lượt phía sau; khoảng trống thì không sao.
    expect((await call('POST', `/api/vehicles/${con}/blocks`, { kind: 'owner_use', startAt: r.scheduledStart - 5 * DAY }, staffCookie)).status).toBe(409);
    const free = await call('POST', `/api/vehicles/${con}/blocks`, { kind: 'owner_use', startAt: r.scheduledStart - 5 * DAY, endAt: r.scheduledStart - 4 * DAY }, staffCookie);
    expect(free.status, JSON.stringify(free.json)).toBe(200);
    // Kéo dài sang lượt thuê cũng bị chặn.
    expect((await call('PATCH', `/api/blocks/${free.json.id}`, { endAt: r.scheduledEnd }, staffCookie)).status).toBe(409);
  });

  it('hủy tạm ngưng không xóa: vẫn còn trong DB, không còn chặn lịch hay ảnh hưởng tra phạt', async () => {
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    const start = Date.now() + 100 * DAY;
    const b = (await call('POST', `/api/vehicles/${own}/blocks`, { kind: 'owner_use', startAt: start, endAt: start + DAY, notes: 'Ghi nhầm' })).json;
    const conflictBefore = await call('POST', '/api/rentals/precheck', { vehicleId: own, scheduledStart: start, scheduledEnd: start + H, priceDay: 700000 });
    expect(conflictBefore.json.conflicts.length).toBe(1);

    expect((await call('DELETE', `/api/blocks/${b.id}`, undefined, staffCookie)).status).toBe(403);
    expect((await call('DELETE', `/api/blocks/${b.id}`, { reason: 'Ghi nhầm xe' })).status).toBe(200);

    const row = db.select().from(schema.vehicleBlocks).where(eq(schema.vehicleBlocks.id, b.id)).get();
    expect(row?.voidReason).toBe('Ghi nhầm xe');
    expect(row?.voidedAt).toBeTruthy();
    expect((await call('GET', `/api/vehicles/${own}`)).json.blocks.some((x: any) => x.id === b.id)).toBe(false);
    expect((await call('POST', '/api/rentals/precheck', { vehicleId: own, scheduledStart: start, scheduledEnd: start + H, priceDay: 700000 })).json.conflicts.length).toBe(0);
    expect((await call('GET', `/api/fines/lookup?plate=51Q-200.01&at=${start + H}&preview=1`)).json).toMatchObject({ verdict: 'idle', ownerHeld: false });
    expect((await call('PATCH', `/api/blocks/${b.id}`, { notes: 'x' })).status).toBe(404);
  });

  it('không lưu trữ được xe còn lượt đang đặt, chờ quyết toán, đang giữ cọc', async () => {
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    const vid = (await call('POST', '/api/vehicles', { plate: '51Q-200.03', priceDay: 700000 })).json.id;
    const r = await book(vid, 24);
    const setStatus = (status: 'returned' | 'settled' | 'closed') => db.update(schema.rentals).set({ status }).where(eq(schema.rentals.id, r.id)).run();
    const archive = () => call('POST', `/api/vehicles/${vid}/archive`, { archived: true });

    const booked = await archive();
    expect(booked.status).toBe(400);
    expect(booked.json.error).toContain(r.code);
    setStatus('returned');
    expect((await archive()).status).toBe(400);
    setStatus('settled');
    expect((await archive()).status).toBe(400);
    setStatus('closed');
    expect((await archive()).status).toBe(200);
  });

  it('tra phạt lúc chủ xe giữ xe: báo đúng, không gắn cho khách, danh sách phạt ghi rõ', async () => {
    const when = at('2026-01-15T10:00');
    const block = (await call('POST', `/api/vehicles/${con}/blocks`, { kind: 'owner_use', startAt: when - DAY, endAt: when + DAY })).json;
    const look = (await call('GET', `/api/fines/lookup?plate=${conPlate}&at=${when}&preview=1`)).json;
    expect(look).toMatchObject({ verdict: 'blocked', ownerHeld: true });
    const f = await call('POST', '/api/fines', { plate: conPlate, violatedAt: when, violation: 'Vượt đèn đỏ' });
    expect(f.json).toMatchObject({ rentalId: null, customerId: null });
    const item = (await call('GET', '/api/fines?status=all')).json.items.find((x: any) => x.id === f.json.id);
    expect(item.ownerHeld).toBe(true);
    // Hủy khoảng tạm ngưng thì không còn coi là chủ xe giữ.
    await call('DELETE', `/api/blocks/${block.id}`);
    expect((await call('GET', '/api/fines?status=all')).json.items.find((x: any) => x.id === f.json.id).ownerHeld).toBe(false);
  });

  it('vừa có khách vừa có ghi chủ xe dùng: báo cần kiểm tra, không tự quy cho khách', async () => {
    const { db, schema } = await import('./db/index.js');
    const when = at('2026-02-15T10:00');
    const r = await book(own, 24 * 400);
    db.insert(schema.rentalSegments).values({ rentalId: r.id, vehicleId: own, startAt: when - DAY, endAt: when + DAY }).run();
    const plain = (await call('GET', `/api/fines/lookup?plate=51Q-200.01&at=${when}&preview=1`)).json;
    expect(plain).toMatchObject({ verdict: 'rented', ownerHeld: false });
    expect(plain.matches).toHaveLength(1);
    const linked = (await call('POST', '/api/fines', { plate: '51Q-200.01', violatedAt: when })).json;
    expect(linked.rentalId).toBe(r.id);

    await call('POST', `/api/vehicles/${own}/blocks`, { kind: 'owner_use', startAt: when - H, endAt: when + H });
    expect((await call('GET', `/api/fines/lookup?plate=51Q-200.01&at=${when}&preview=1`)).json).toMatchObject({ verdict: 'rented', ownerHeld: true });
    const open = (await call('POST', '/api/fines', { plate: '51Q-200.01', violatedAt: when + 60_000 * 5 })).json;
    expect(open).toMatchObject({ rentalId: null, customerId: null });
    // Chỉ định rõ lượt thuê thì vẫn gắn được: đó là quyết định của người dùng.
    const manual = (await call('POST', '/api/fines', { plate: '51Q-200.01', violatedAt: when + 60_000 * 10, rentalId: r.id })).json;
    expect(manual.rentalId).toBe(r.id);
  });

  it('tự kiểm tra cả đội gồm xe tạm ngưng và xe mới lưu trữ, bỏ xe đã lưu trữ quá lâu', async () => {
    const { db, schema } = await import('./db/index.js');
    const { eq } = await import('drizzle-orm');
    const make = async (plate: string, extra: object = {}) => (await call('POST', '/api/vehicles', { plate, priceDay: 500000, ...extra })).json.id as number;
    await make('51R-300.01', { active: false });
    const recent = await make('51R-300.02');
    const old = await make('51R-300.03');
    expect((await call('POST', `/api/vehicles/${recent}/archive`, { archived: true })).status).toBe(200);
    db.update(schema.vehicles).set({ archivedAt: Date.now() - 100 * DAY, active: false }).where(eq(schema.vehicles.id, old)).run();

    vi.stubGlobal('fetch', async (url: string | URL) => {
      if (!String(url).includes('checkphatnguoi')) throw new Error(`fetch không mong đợi: ${url}`);
      return new Response(JSON.stringify({ status: 0, data: [] }), { status: 200 });
    });
    try {
      const r = (await call('POST', '/api/fines/auto-check/run')).json;
      const plates = r.vehicles.map((v: any) => v.plate);
      expect(plates).toContain('51R-300.01');
      expect(plates).toContain('51R-300.02');
      expect(plates).not.toContain('51R-300.03');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('đối soát chủ xe ký gửi', () => {
  const month = '2028-09';
  let con = 0;
  let own = 0;
  let cust = 0;
  const slot = (day: number) => ({ scheduledStart: at(`${month}-${String(day).padStart(2, '0')}T08:00`), scheduledEnd: at(`${month}-${String(day + 2).padStart(2, '0')}T08:00`) });
  const report = async (p = month) => (await call('GET', `/api/cashflow?p=${p}`)).json;
  const rowOf = async (p = month) => (await report(p)).ownerSettlement.rows.find((x: any) => x.vehicleId === con);
  const book = async (vehicleId: number, day: number, extra: object = {}) => {
    const r = await call('POST', '/api/rentals', { vehicleId, customerId: cust, ...slot(day), depositRequired: 0, ...extra });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.id as number;
  };
  const pickup = async (id: number, day: number, odo: number) => {
    const r = await call('POST', `/api/rentals/${id}/pickup`, { at: at(`${month}-${String(day).padStart(2, '0')}T08:30`), odo, fuelLevel: 100 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  };
  const giveBack = async (id: number, day: number, odo: number, charges: object[]) => {
    const r = await call('POST', `/api/rentals/${id}/return`, { at: at(`${month}-${String(day + 2).padStart(2, '0')}T08:00`), odo, fuelLevel: 100, charges });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  };

  it('chuẩn bị xe ký gửi 70%, xe nhà', async () => {
    con = (await call('POST', '/api/vehicles', { plate: '51S-400.01', priceDay: 1_000_000, kmLimitDay: 0, odo: 100, ownerType: 'consigned', ownerName: 'Chị Lan', ownerPhone: '0900000002', ownerSharePct: 70 })).json.id;
    own = (await call('POST', '/api/vehicles', { plate: '51S-400.02', priceDay: 1_000_000, kmLimitDay: 0, odo: 100 })).json.id;
    cust = (await call('POST', '/api/customers', { fullName: 'Khách Đối Soát', idNumber: '079099000999', phone: '0909000999' })).json.id;
    const row = await rowOf();
    expect(row).toMatchObject({ share: 0, paid: 0, remaining: 0, ownerName: 'Chị Lan' });
  });

  it('lượt mới đặt chưa tính; giao xe mới chốt % và tính phần chủ xe', async () => {
    const id = await book(con, 1);
    expect((await rowOf()).share).toBe(0);
    await pickup(id, 1, 200);
    const row = await rowOf();
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]).toMatchObject({ rentalId: id, pct: 70, rent: 2_000_000, share: 1_400_000, status: 'active' });
    expect(row).toMatchObject({ share: 1_400_000, remaining: 1_400_000 });
  });

  it('vượt km tính vào phần chia; đền bù, bù xăng, cầu đường thì không', async () => {
    const id = (await rowOf()).lines[0].rentalId;
    await giveBack(id, 1, 500, [
      { kind: 'over_km', description: 'Vượt 100 km', amount: 300_000 },
      { kind: 'damage', description: 'Móp cửa', amount: 4_000_000 },
      { kind: 'fuel', description: 'Bù xăng', amount: 200_000 },
      { kind: 'toll', description: 'Cầu đường', amount: 50_000 },
    ]);
    const row = await rowOf();
    expect(row.lines[0]).toMatchObject({ rent: 2_300_000, share: 1_610_000, customerDue: 6_550_000 });
    expect(row.share).toBe(1_610_000);
  });

  it('lãi trừ phần chủ xe ngay tháng phát sinh, chưa cần trả; xe nhà không bị trừ', async () => {
    const r = await report();
    expect(r.totals.ownerShare).toBe(1_610_000);
    expect(r.totals.profit).toBe(r.totals.income - r.totals.expense - 1_610_000);
    const v = r.vehicles.find((x: any) => x.vehicleId === con);
    expect(v).toMatchObject({ ownerShare: 1_610_000, ownerType: 'consigned' });
    expect(r.vehicles.find((x: any) => x.vehicleId === own)).toMatchObject({ ownerShare: 0, ownerType: 'own' });
    expect(r.trend.find((x: any) => x.key === month).ownerShare).toBe(1_610_000);
  });

  it('trả chủ xe tháng sau: ghi đúng tháng phát sinh, không trừ lãi thêm lần nữa', async () => {
    const paidAt = at('2028-10-05T09:00');
    const before = await report('2028-10');
    const e = await call('POST', '/api/cash-entries', { category: 'owner_payout', amount: 1_000_000, at: paidAt, vehicleId: con, method: 'transfer', period: month });
    expect(e.status, JSON.stringify(e.json)).toBe(200);
    expect(e.json.entry.period).toBe(month);

    const row = await rowOf();
    expect(row).toMatchObject({ share: 1_610_000, paid: 1_000_000, remaining: 610_000 });

    const after = await report('2028-10');
    expect(after.totals.expense).toBe(before.totals.expense);
    expect(after.totals.profit).toBe(before.totals.profit);
    expect(after.categories.some((c: any) => c.category === 'owner_payout')).toBe(false);
    expect(after.ledger.some((l: any) => l.kind === 'entry' && l.entry.id === e.json.entry.id)).toBe(true);
    // Tháng trả không phát sinh gì thêm cho chủ xe.
    expect((await rowOf('2028-10'))).toMatchObject({ share: 0, paid: 0, remaining: 0 });

    // Hủy phiếu trả thì số còn phải trả quay lại.
    expect((await call('POST', `/api/cash-entries/${e.json.entry.id}/void`, { reason: 'Ghi nhầm' })).status).toBe(200);
    expect((await rowOf()).remaining).toBe(1_610_000);

    const again = await call('POST', '/api/cash-entries', { category: 'owner_payout', amount: 1_610_000, at: paidAt, vehicleId: con, method: 'transfer', period: month });
    expect(again.status).toBe(200);
    expect((await rowOf()).remaining).toBe(0);
  });

  it('không ghi tháng thì lấy tháng của ngày trả', async () => {
    const r = await call('POST', '/api/cash-entries', { category: 'owner_payout', amount: 10_000, at: at('2028-11-20T09:00'), vehicleId: con, method: 'cash' });
    expect(r.json.entry.period).toBe('2028-11');
    expect((await rowOf('2028-11')).remaining).toBe(-10_000);
    await call('POST', `/api/cash-entries/${r.json.entry.id}/void`, { reason: 'Thử' });
  });

  it('đổi % sau này không làm sai số cũ; lượt giao sau mới áp % mới', async () => {
    const full = (await call('GET', `/api/vehicles/${con}`)).json.vehicle;
    expect((await call('PATCH', `/api/vehicles/${con}`, { ...full, ownerSharePct: 50 })).status).toBe(200);
    expect((await rowOf()).lines[0]).toMatchObject({ pct: 70, share: 1_610_000 });
    const id = await book(con, 10);
    await pickup(id, 10, 600);
    const row = await rowOf();
    expect(row.lines.find((l: any) => l.rentalId === id)).toMatchObject({ pct: 50, rent: 2_000_000, share: 1_000_000 });
    expect(row.share).toBe(2_610_000);
    await giveBack(id, 10, 700, []);
  });

  it('Mioto không cho phép xe ký gửi: chặn đặt mới, đổi kênh, đổi xe và chuyển xe sang ký gửi', async () => {
    const mioto = { channel: 'mioto', channelRef: 'MIDOISOAT', channelPrice: 3_000_000, channelFeePct: 15 };
    const blocked = await call('POST', '/api/rentals', { vehicleId: con, customerId: cust, ...slot(15), depositRequired: 0, ...mioto });
    expect(blocked.status).toBe(400);
    expect(blocked.json.error).toContain('Mioto không cho phép xe ký gửi');

    // Lượt trực tiếp của xe ký gửi không đổi sang Mioto được.
    const direct = await book(con, 15);
    expect((await call('PATCH', `/api/rentals/${direct}`, mioto)).status).toBe(400);
    expect((await call('POST', `/api/rentals/${direct}/cancel`, { reason: 'Thử xong' })).status).toBe(200);

    // Xe nhà vẫn đặt qua Mioto được, nhưng không đổi lượt đó sang xe ký gửi được.
    const home = (await call('POST', '/api/vehicles', { plate: '51S-400.03', priceDay: 1_000_000, kmLimitDay: 0, odo: 100 })).json.id;
    const viaApp = await book(home, 15, mioto);
    expect((await call('PATCH', `/api/rentals/${viaApp}`, { vehicleId: con })).status).toBe(400);

    // Còn lượt Mioto đang mở thì chưa chuyển xe sang ký gửi được; xong lượt đó thì được.
    const full = (await call('GET', `/api/vehicles/${home}`)).json.vehicle;
    const consign = { ...full, ownerType: 'consigned', ownerName: 'Anh Hùng', ownerSharePct: 60 };
    const stop = await call('PATCH', `/api/vehicles/${home}`, consign);
    expect(stop.status).toBe(400);
    expect(stop.json.error).toContain('Mioto');
    expect((await call('GET', `/api/vehicles/${home}`)).json.vehicle.ownerType).toBe('own');
    expect((await call('POST', `/api/rentals/${viaApp}/cancel`, { reason: 'Thử xong' })).status).toBe(200);
    expect((await call('PATCH', `/api/vehicles/${home}`, consign)).status).toBe(200);
  });

  it('xe chuyển từ nhà sang ký gửi: lượt đã giao trước đó không chia', async () => {
    const id = await book(own, 20);
    await pickup(id, 20, 200);
    const full = (await call('GET', `/api/vehicles/${own}`)).json.vehicle;
    expect((await call('PATCH', `/api/vehicles/${own}`, { ...full, ownerType: 'consigned', ownerName: 'Anh Minh', ownerSharePct: 60 })).status).toBe(200);
    const r = await report();
    const row = r.ownerSettlement.rows.find((x: any) => x.vehicleId === own);
    expect(row).toMatchObject({ share: 0, lines: [] });
    await giveBack(id, 20, 300, []);
  });

  it('báo cáo năm và một xe; tổng còn nợ các kỳ; Excel; nhân viên không xem được', async () => {
    const year = await report('2028');
    const y = year.ownerSettlement.rows.find((x: any) => x.vehicleId === con);
    expect(y.share).toBe(1_610_000 + 1_000_000);
    expect(y.paid).toBe(1_610_000);
    const one = (await call('GET', `/api/cashflow?p=${month}&v=${con}`)).json;
    expect(one.totals.ownerShare).toBe(1_610_000 + 1_000_000);
    expect(one.ownerSettlement.rows).toHaveLength(1);
    expect(one.ownerSettlement.owedAllTime).toBe(1_000_000);
    const shared = (await call('GET', `/api/cashflow?p=${month}&v=shared`)).json;
    expect(shared.ownerSettlement.rows).toHaveLength(0);
    expect(shared.totals.ownerShare).toBe(0);

    const file = await call('GET', `/api/cashflow/export?p=${month}`);
    expect(file.status).toBe(200);
    const sheets = new PizZip(file.res.rawPayload).file('xl/workbook.xml')!.asText();
    expect(sheets).toContain('Đối soát chủ xe');

    expect((await call('GET', `/api/cashflow?p=${month}`, undefined, staffCookie)).status).toBe(403);
    const staffRental = await call('GET', `/api/rentals/${(await rowOf()).lines[0].rentalId}`, undefined, staffCookie);
    expect(JSON.stringify(staffRental.json)).not.toContain('ownerSharePct');
  });

  it('trang Tổng quan: lãi tháng cũng đã trừ phần chủ xe', async () => {
    const { cashTotals } = await import('./services/cashflow.js');
    const t = cashTotals(at(`${month}-01T00:00`), at('2028-10-01T00:00'));
    expect(t.ownerShare).toBe(1_610_000 + 1_000_000);
    expect(t.profit).toBe(t.income - t.expense - t.ownerShare);
  });
});
