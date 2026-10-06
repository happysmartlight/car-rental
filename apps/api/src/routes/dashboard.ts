import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { parse, requireRole } from '../lib/http.js';
import { computeAlerts } from '../services/alerts.js';
import { occupiedRange } from '../services/rentals.js';
import { plateKey, unaccent } from '../shared/text.js';
import { DAY_MS, VN_OFFSET_MS, vnParts } from '../shared/time.js';
import { customerSearchCondition } from './customers.js';
import { vehicleStatuses } from './vehicles.js';

function monthRange(now: number) {
  const p = vnParts(now);
  const start = Date.UTC(p.year, p.month - 1, 1) - VN_OFFSET_MS;
  const end = Date.UTC(p.year, p.month, 1) - VN_OFFSET_MS;
  return { start, end };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    requireRole(req, 'staff');
    const now = Date.now();
    const vehicles = db.select().from(schema.vehicles).where(isNull(schema.vehicles.archivedAt)).orderBy(asc(schema.vehicles.plate)).all();
    const statuses = vehicleStatuses(vehicles, now);

    const counts = Object.fromEntries(
      db
        .select({ status: schema.rentals.status, n: sql<number>`COUNT(*)` })
        .from(schema.rentals)
        .where(inArray(schema.rentals.status, ['booked', 'active', 'returned', 'settled']))
        .groupBy(schema.rentals.status)
        .all()
        .map((x) => [x.status, x.n]),
    );

    const upcoming = db
      .select({ r: schema.rentals, c: { id: schema.customers.id, fullName: schema.customers.fullName }, v: { id: schema.vehicles.id, plate: schema.vehicles.plate } })
      .from(schema.rentals)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
      .where(
        or(
          and(eq(schema.rentals.status, 'booked'), lte(schema.rentals.scheduledStart, now + 7 * DAY_MS)),
          and(eq(schema.rentals.status, 'active'), lte(schema.rentals.scheduledEnd, now + 7 * DAY_MS)),
        ),
      )
      .all()
      .map(({ r, c, v }) => ({ id: r.id, code: r.code, status: r.status, customer: c, vehicle: v, at: r.status === 'booked' ? r.scheduledStart : r.scheduledEnd, kind: r.status === 'booked' ? ('pickup' as const) : ('return' as const) }))
      .sort((a, b) => a.at - b.at);

    let finance = null;
    if (req.user!.role === 'admin') {
      const { start, end } = monthRange(now);
      const revenue =
        db
          .select({ total: sql<number>`COALESCE(SUM(${schema.charges.amount}), 0)` })
          .from(schema.charges)
          .innerJoin(schema.rentals, eq(schema.rentals.id, schema.charges.rentalId))
          .where(and(sql`${schema.rentals.status} != 'cancelled'`, gte(schema.rentals.scheduledStart, start), lt(schema.rentals.scheduledStart, end)))
          .get()?.total ?? 0;
      const pays = db
        .select()
        .from(schema.payments)
        .where(and(isNull(schema.payments.voidedAt), eq(schema.payments.purpose, 'rent'), gte(schema.payments.at, start), lt(schema.payments.at, end)))
        .all();
      const received = pays.reduce((s, p) => s + (p.direction === 'in' ? p.amount : p.direction === 'out' ? -p.amount : 0), 0);
      const depositsHeld =
        db
          .select({
            held: sql<number>`COALESCE(SUM(CASE WHEN ${schema.payments.direction} = 'in' THEN ${schema.payments.amount} ELSE -${schema.payments.amount} END), 0)`,
          })
          .from(schema.payments)
          .where(and(isNull(schema.payments.voidedAt), eq(schema.payments.purpose, 'deposit')))
          .get()?.held ?? 0;
      const monthRentals = db
        .select()
        .from(schema.rentals)
        .where(and(sql`${schema.rentals.status} != 'cancelled'`, lt(sql`COALESCE(${schema.rentals.actualStart}, ${schema.rentals.scheduledStart})`, Math.min(now, end)), or(gte(sql`COALESCE(${schema.rentals.actualEnd}, ${schema.rentals.scheduledEnd})`, start), eq(schema.rentals.status, 'active'))))
        .all()
        .filter((r) => r.actualStart != null);
      const span = Math.max(1, Math.min(now, end) - start);
      const utilization = vehicles.map((v) => {
        const used = monthRentals
          .filter((r) => r.vehicleId === v.id)
          .reduce((s, r) => {
            const o = occupiedRange(r, now);
            return s + Math.max(0, Math.min(o.end, now, end) - Math.max(o.start, start));
          }, 0);
        return { vehicleId: v.id, plate: v.plate, pct: Math.round((used / span) * 100) };
      });
      finance = { monthStart: start, revenue, received, depositsHeld, rentals: monthRentals.length, utilization };
    }

    return {
      alerts: computeAlerts(now),
      vehicles: vehicles.map((v) => ({ id: v.id, plate: v.plate, make: v.make, model: v.model, photoFileId: v.photoFileId, odo: v.odo, status: statuses.get(v.id) })),
      counts,
      upcoming,
      finance,
    };
  });

  /** Tìm nhanh (Ctrl+K): khách, xe, lượt thuê. */
  app.get('/api/search', async (req) => {
    requireRole(req, 'staff');
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
    const term = `%${unaccent(q)}%`;
    const key = plateKey(q);
    const customers = db
      .select({ id: schema.customers.id, fullName: schema.customers.fullName, phone: schema.customers.phone, idNumber: schema.customers.idNumber, blacklisted: schema.customers.blacklisted })
      .from(schema.customers)
      .where(customerSearchCondition(q))
      .limit(6)
      .all();
    const vehicles =
      key.length >= 2
        ? db
            .select({ id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model })
            .from(schema.vehicles)
            .where(or(sql`${schema.vehicles.plateKey} LIKE ${'%' + key + '%'}`, sql`unaccent(${schema.vehicles.make} || ' ' || ${schema.vehicles.model}) LIKE ${term}`))
            .limit(6)
            .all()
        : [];
    const rentals = db
      .select({ id: schema.rentals.id, code: schema.rentals.code, status: schema.rentals.status, customer: schema.customers.fullName, plate: schema.vehicles.plate, start: schema.rentals.scheduledStart })
      .from(schema.rentals)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.rentals.customerId))
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.rentals.vehicleId))
      .where(or(sql`lower(${schema.rentals.code}) LIKE ${term}`, sql`replace(lower(${schema.rentals.code}), '-', '') LIKE ${'%' + term.replace(/[-%]/g, '') + '%'}`))
      .orderBy(sql`${schema.rentals.scheduledStart} DESC`)
      .limit(6)
      .all();
    return { customers, vehicles, rentals };
  });
}
