import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, idParam, parse, requireRole, userId, zDateKey, zMoney, zMs, zOptText } from '../lib/http.js';
import { buildXlsx, type Sheet } from '../lib/xlsx.js';
import {
  cashflowReport,
  createEntry,
  createRecurring,
  listRecurring,
  materializeRecurring,
  updateEntry,
  updateRecurring,
  voidEntry,
  type CashflowReport,
  type VehicleFilter,
} from '../services/cashflow.js';
import { CASH_CATEGORIES, CASH_CATEGORY, CASH_GROUP_LABEL, CASH_METHODS, RECUR_INTERVALS, currentPeriodKey, fmtMonthKey, parsePeriod } from '../shared/cashflow.js';
import { PAYMENT_METHOD_LABEL, RENTAL_STATUS } from '../shared/constants.js';
import { plateKey } from '../shared/text.js';
import { fmtDate, fmtDateTime } from '../shared/time.js';

const zVehicleId = z.coerce
  .number()
  .int()
  .positive()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const zEntry = z.object({
  category: z.enum(CASH_CATEGORIES),
  amount: zMoney.refine((n) => n > 0, 'số tiền phải lớn hơn 0'),
  at: zMs,
  vehicleId: zVehicleId,
  method: z.enum(CASH_METHODS).default('cash'),
  description: zOptText,
  vendor: zOptText,
  odo: z.coerce
    .number()
    .int()
    .min(0)
    .max(9_999_999)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  receiptFileIds: z.array(z.string().uuid()).max(12).default([]),
});

const zRenewal = z.object({
  inspectionExpiry: zDateKey,
  insuranceTndsExpiry: zDateKey,
  insuranceBodyExpiry: zDateKey,
  roadFeeExpiry: zDateKey,
  nextServiceOdo: z.coerce.number().int().min(0).nullable().optional(),
  nextServiceDate: zDateKey,
});

const zMonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'tháng phải dạng YYYY-MM');

const zRecurring = z.object({
  category: z.enum(CASH_CATEGORIES),
  amount: zMoney.refine((n) => n > 0, 'số tiền phải lớn hơn 0'),
  vehicleId: zVehicleId,
  method: z.enum(CASH_METHODS).default('cash'),
  description: zOptText,
  vendor: zOptText,
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  intervalMonths: z.coerce
    .number()
    .int()
    .refine((n) => (RECUR_INTERVALS as readonly number[]).includes(n), 'chu kỳ không hợp lệ'),
  startMonth: zMonthKey,
  endMonth: zMonthKey
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  active: z.boolean().default(true),
});

function parseQuery(q: unknown, now: number): { periodKey: string; filter: VehicleFilter } {
  const { p, v } = parse(z.object({ p: z.string().optional(), v: z.string().default('all') }), q);
  const periodKey = p || currentPeriodKey('month', now);
  let filter: VehicleFilter = null;
  if (v === 'shared') filter = 'shared';
  else if (v !== 'all') {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw badRequest('Xe không hợp lệ');
    filter = n;
  }
  return { periodKey, filter };
}

function report(q: unknown) {
  const now = Date.now();
  const { periodKey, filter } = parseQuery(q, now);
  const period = parsePeriod(periodKey);
  if (!period) throw badRequest('Kỳ báo cáo không hợp lệ');
  materializeRecurring(now);
  return cashflowReport(period, filter, now);
}

export async function cashflowRoutes(app: FastifyInstance) {
  app.get('/api/cashflow', async (req) => {
    requireRole(req, 'admin');
    return report(req.query);
  });

  app.get('/api/cashflow/export', async (req, reply) => {
    requireRole(req, 'admin');
    const r = report(req.query);
    const buf = buildXlsx(workbook(r));
    const scope = r.filter === 'all' ? '' : r.filter === 'shared' ? '-chi-phi-chung' : `-${plateKey(r.vehicleOptions.find((v) => v.id === r.filter)?.plate ?? String(r.filter))}`;
    audit(req, 'cashflow.export', 'cashflow', null, { period: r.period.key, filter: r.filter });
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="thu-chi-${r.period.key}${scope}.xlsx"`);
    return reply.send(buf);
  });

  // ── Ghi sổ ───────────────────────────────────────────────────────────────

  app.post('/api/cash-entries', async (req) => {
    requireRole(req, 'staff');
    const body = parse(zEntry.extend({ renewal: zRenewal.optional() }), req.body);
    const { renewal, ...input } = body;
    // Nhân viên chỉ ghi được khoản chi (đổ xăng, rửa xe…); thu khác và gia hạn giấy tờ xe do quản trị làm.
    if (req.user!.role !== 'admin' && (CASH_CATEGORY[input.category].dir !== 'out' || renewal)) throw forbidden();
    const { entry, renewed } = createEntry(input, userId(req), renewal);
    audit(req, 'cash.create', 'cash_entry', entry.id, { ...input, renewed });
    if (Object.keys(renewed).length) audit(req, 'vehicle.renew', 'vehicle', entry.vehicleId, { fromCashEntry: entry.id, ...renewed });
    return { entry, renewed };
  });

  app.put('/api/cash-entries/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parse(zEntry, req.body);
    const before = db.select().from(schema.cashEntries).where(eq(schema.cashEntries.id, id)).get();
    const entry = updateEntry(id, body);
    audit(req, 'cash.update', 'cash_entry', id, { before, after: body });
    return entry;
  });

  app.post('/api/cash-entries/:id/void', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(2, 'nhập lý do').max(300) }), req.body);
    const entry = voidEntry(id, reason);
    audit(req, 'cash.void', 'cash_entry', id, { reason, amount: entry.amount, category: entry.category });
    return entry;
  });

  // ── Khoản định kỳ ────────────────────────────────────────────────────────

  app.get('/api/recurring-costs', async (req) => {
    requireRole(req, 'admin');
    return listRecurring();
  });

  app.post('/api/recurring-costs', async (req) => {
    requireRole(req, 'admin');
    const body = parse(zRecurring, req.body);
    const r = createRecurring(body, userId(req));
    audit(req, 'cash.recurring_create', 'recurring_cost', r.recurring.id, { ...body, created: r.created });
    return r;
  });

  app.put('/api/recurring-costs/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parse(zRecurring, req.body);
    const r = updateRecurring(id, body);
    audit(req, 'cash.recurring_update', 'recurring_cost', id, { ...body, created: r.created });
    return r;
  });
}

// ── File Excel ───────────────────────────────────────────────────────────────

function workbook(r: CashflowReport): Sheet[] {
  const t = r.totals;
  const scope =
    r.filter === 'all'
      ? 'Cả đội xe + chi phí chung'
      : r.filter === 'shared'
        ? 'Chi phí chung (không gắn xe)'
        : `Xe ${r.vehicleOptions.find((v) => v.id === r.filter)?.plate ?? r.filter}`;
  const intro = [
    `Báo cáo thu chi — ${r.period.label}`,
    `Phạm vi: ${scope} · Xuất lúc ${fmtDateTime(Date.now())}`,
    'Thu tiền thuê tính theo ngày nhận tiền (gồm phần cọc cấn trừ sang tiền thuê). Cọc đang giữ là tiền của khách, không tính là thu.',
  ];
  const sheets: Sheet[] = [];

  if (r.filter === 'all') {
    const money = (h: string) => ({ header: h, width: 16, money: true });
    const row = (name: string, model: string, x: typeof t & { rentals?: number; utilization?: number | null }) => [
      name,
      model,
      x.rentals ?? null,
      x.utilization ?? null,
      x.rent,
      x.otherIncome,
      x.expense,
      x.profit,
      x.capitalIn,
      x.capitalOut,
      x.net,
    ];
    sheets.push({
      name: 'Tổng hợp theo xe',
      intro,
      columns: [{ header: 'Xe', width: 14 }, { header: 'Dòng xe', width: 24 }, { header: 'Lượt thuê', width: 10 }, { header: 'Sử dụng (%)', width: 11 }, money('Thu tiền thuê'), money('Thu khác'), money('Chi vận hành'), money('Lãi vận hành'), money('Bán xe, thanh lý'), money('Mua xe, trả góp'), money('Dòng tiền ròng')],
      rows: [...r.vehicles.map((v) => row(v.plate, `${v.make} ${v.model}`.trim() + (v.archived ? ' (đã lưu trữ)' : ''), v)), ...(r.shared ? [row('Chi phí chung', 'Không gắn xe', r.shared)] : [])],
      total: row('Tổng cộng', '', { ...t, rentals: r.vehicles.reduce((s, v) => s + v.rentals, 0), utilization: null }),
    });
  } else {
    const rc = r.receivables;
    sheets.push({
      name: 'Tổng hợp',
      intro,
      columns: [
        { header: 'Khoản', width: 36 },
        { header: 'Số tiền', width: 18, money: true },
      ],
      rows: [
        ['Tiền thuê thực nhận', t.rent],
        ['Thu khác', t.otherIncome],
        ['Tổng thu', t.income],
        ['Chi vận hành', t.expense],
        ['Lãi vận hành', t.profit],
        ['Bán xe, thanh lý', t.capitalIn],
        ['Mua xe, trả góp', t.capitalOut],
        ['Dòng tiền ròng', t.net],
        [],
        ['Hiện tại: khách còn nợ', rc.owed],
        ['Hiện tại: sắp thu (đang thuê, đã đặt)', rc.upcoming],
        ['Hiện tại: cọc đang giữ', rc.depositsHeld],
      ],
    });
  }

  const ledger = [...r.ledger].filter((l) => !(l.kind === 'entry' && l.entry.voidedAt)).sort((a, b) => a.at - b.at);
  const rentLabel = (d: string) => (d === 'out' ? 'Hoàn tiền thuê' : d === 'offset' ? 'Cấn trừ cọc sang tiền thuê' : 'Tiền thuê');
  sheets.push({
    name: 'Sổ thu chi',
    intro: [`Sổ thu chi — ${r.period.label} · ${scope}`],
    columns: [
      { header: 'Ngày', width: 11 },
      { header: 'Loại', width: 6 },
      { header: 'Hạng mục', width: 26 },
      { header: 'Xe', width: 13 },
      { header: 'Nội dung', width: 40 },
      { header: 'Nơi chi / khách', width: 22 },
      { header: 'Hình thức', width: 14 },
      { header: 'Thu', width: 15, money: true },
      { header: 'Chi', width: 15, money: true },
    ],
    rows: ledger.map((l) =>
      l.kind === 'rent'
        ? [fmtDate(l.at), l.direction === 'in' ? 'Thu' : 'Chi', rentLabel(l.flow.direction), l.plate, [l.flow.code, l.flow.note].filter(Boolean).join(' · '), l.flow.customerName, PAYMENT_METHOD_LABEL[l.flow.method], l.direction === 'in' ? l.amount : null, l.direction === 'out' ? l.amount : null]
        : [
            fmtDate(l.at),
            l.direction === 'in' ? 'Thu' : 'Chi',
            CASH_CATEGORY[l.entry.category]?.label ?? l.entry.category,
            l.plate ?? 'Chung',
            [l.entry.description, l.entry.odo ? `ODO ${l.entry.odo}` : null, l.recurring ? 'định kỳ' : null].filter(Boolean).join(' · '),
            l.entry.vendor,
            PAYMENT_METHOD_LABEL[l.entry.method],
            l.direction === 'in' ? l.amount : null,
            l.direction === 'out' ? l.amount : null,
          ],
    ),
    total: ['', '', 'Cộng', '', '', '', '', ledger.filter((l) => l.direction === 'in').reduce((s, l) => s + l.amount, 0), ledger.filter((l) => l.direction === 'out').reduce((s, l) => s + l.amount, 0)],
  });

  sheets.push({
    name: 'Theo hạng mục',
    intro: [`Thu chi theo hạng mục — ${r.period.label} · ${scope}`],
    columns: [
      { header: 'Hạng mục', width: 30 },
      { header: 'Nhóm', width: 24 },
      { header: 'Số khoản', width: 10 },
      { header: 'Số tiền', width: 16, money: true },
    ],
    rows: [
      ...(r.filter === 'shared' ? [] : [['Tiền thuê thực nhận', 'Thu tiền thuê', ledger.filter((l) => l.kind === 'rent').length, t.rent]]),
      ...r.categories.map((c) => [CASH_CATEGORY[c.category]?.label ?? c.category, CASH_GROUP_LABEL[CASH_CATEGORY[c.category]?.group ?? 'overhead'], c.count, CASH_CATEGORY[c.category]?.dir === 'out' ? -c.amount : c.amount]),
    ],
  });

  sheets.push({
    name: 'Theo tháng',
    intro: [`Thu chi 12 tháng · ${scope}`],
    columns: [
      { header: 'Tháng', width: 14 },
      { header: 'Tổng thu', width: 16, money: true },
      { header: 'Chi vận hành', width: 16, money: true },
      { header: 'Lãi vận hành', width: 16, money: true },
      { header: 'Bán xe, thanh lý', width: 16, money: true },
      { header: 'Mua xe, trả góp', width: 16, money: true },
      { header: 'Dòng tiền ròng', width: 16, money: true },
    ],
    rows: r.trend.map((m) => [fmtMonthKey(m.key), m.income, m.expense, m.profit, m.capitalIn, m.capitalOut, m.net]),
    total: ['Cộng', ...(['income', 'expense', 'profit', 'capitalIn', 'capitalOut', 'net'] as const).map((k) => r.trend.reduce((s, m) => s + m[k], 0))],
  });

  if (r.rentals.length) {
    sheets.push({
      name: 'Lượt thuê',
      intro: [`Lượt thuê nhận xe trong ${r.period.label.toLowerCase()} · ${scope}`],
      columns: [
        { header: 'Mã', width: 14 },
        { header: 'Khách', width: 24 },
        { header: 'Nhận xe', width: 17 },
        { header: 'Trả xe', width: 17 },
        { header: 'Trạng thái', width: 14 },
        { header: 'Tổng tiền', width: 15, money: true },
        { header: 'Đã trả', width: 15, money: true },
        { header: 'Còn nợ', width: 15, money: true },
      ],
      rows: r.rentals.map((x) => [x.code, x.customerName, fmtDateTime(x.start), fmtDateTime(x.end), RENTAL_STATUS[x.status].label, x.total, x.paid, x.due]),
    });
  }
  return sheets;
}
