import { asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import {
  clearLoginFailures,
  createSession,
  destroySession,
  hashPassword,
  loginBlocked,
  recordLoginFailure,
  revokeUserSessions,
  SESSION_COOKIE,
  verifyPassword,
} from '../lib/auth.js';
import { badRequest, conflict, HttpError, idParam, notFound, parse, requireRole, userId } from '../lib/http.js';
import { ROLES } from '../shared/constants.js';

const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'tên đăng nhập 3–32 ký tự: chữ thường, số, dấu . _ -');
const zPassword = z.string().min(8, 'mật khẩu tối thiểu 8 ký tự').max(200);

function userCount(): number {
  return db.select({ n: count() }).from(schema.users).get()?.n ?? 0;
}

const publicUser = (u: typeof schema.users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/state', async (req) => ({
    needsSetup: userCount() === 0,
    user: req.user ?? null,
  }));

  /** Lần chạy đầu tiên: tạo tài khoản quản trị. Chỉ hoạt động khi chưa có user nào. */
  app.post('/api/auth/setup', async (req, reply) => {
    if (userCount() > 0) throw conflict('Đã có tài khoản quản trị', 'already_setup');
    const body = parse(z.object({ username: zUsername, displayName: z.string().trim().min(1).max(80), password: zPassword }), req.body);
    const now = Date.now();
    const user = db
      .insert(schema.users)
      .values({ username: body.username, displayName: body.displayName, passwordHash: await hashPassword(body.password), role: 'admin', active: true, createdAt: now, lastLoginAt: now })
      .returning()
      .get();
    createSession(req, reply, user.id);
    req.user = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
    audit(req, 'auth.setup', 'user', user.id);
    return { user: req.user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (loginBlocked(req.ip)) throw new HttpError(429, 'Sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.');
    const body = parse(z.object({ username: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const user = db.select().from(schema.users).where(eq(schema.users.username, body.username)).get();
    if (!user || !user.active || !(await verifyPassword(body.password, user.passwordHash))) {
      recordLoginFailure(req.ip);
      audit(req, 'auth.login_failed', 'user', user?.id ?? null, { username: body.username });
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu', 'bad_credentials');
    }
    clearLoginFailures(req.ip);
    db.update(schema.users).set({ lastLoginAt: Date.now() }).where(eq(schema.users.id, user.id)).run();
    createSession(req, reply, user.id);
    req.user = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
    audit(req, 'auth.login', 'user', user.id);
    return { user: req.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const uid = userId(req);
    const body = parse(z.object({ current: z.string(), next: zPassword }), req.body);
    const user = db.select().from(schema.users).where(eq(schema.users.id, uid)).get();
    if (!user || !(await verifyPassword(body.current, user.passwordHash))) throw badRequest('Mật khẩu hiện tại không đúng');
    db.update(schema.users).set({ passwordHash: await hashPassword(body.next) }).where(eq(schema.users.id, uid)).run();
    revokeUserSessions(uid, req.cookies[SESSION_COOKIE]);
    audit(req, 'auth.password_changed', 'user', uid);
    return { ok: true };
  });

  // ── Quản lý người dùng (admin) ────────────────────────────────────────────

  app.get('/api/users', async (req) => {
    requireRole(req, 'staff');
    const rows = db.select().from(schema.users).orderBy(asc(schema.users.id)).all();
    return rows.map(publicUser);
  });

  app.post('/api/users', async (req) => {
    requireRole(req, 'admin');
    const body = parse(
      z.object({ username: zUsername, displayName: z.string().trim().min(1).max(80), password: zPassword, role: z.enum(ROLES) }),
      req.body,
    );
    if (db.select().from(schema.users).where(eq(schema.users.username, body.username)).get()) throw conflict('Tên đăng nhập đã tồn tại');
    const user = db
      .insert(schema.users)
      .values({ username: body.username, displayName: body.displayName, passwordHash: await hashPassword(body.password), role: body.role, active: true, createdAt: Date.now() })
      .returning()
      .get();
    audit(req, 'user.create', 'user', user.id, { username: user.username, role: user.role });
    return publicUser(user);
  });

  app.patch('/api/users/:id', async (req) => {
    requireRole(req, 'admin');
    const id = idParam(req);
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(80).optional(),
        role: z.enum(ROLES).optional(),
        active: z.boolean().optional(),
        password: zPassword.optional(),
      }),
      req.body,
    );
    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!user) throw notFound('Không tìm thấy người dùng');
    if (id === req.user!.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('Không thể tự khóa hoặc tự hạ quyền chính mình');
    }
    const patch: Partial<typeof user> = {};
    if (body.displayName) patch.displayName = body.displayName;
    if (body.role) patch.role = body.role;
    if (body.active !== undefined) patch.active = body.active;
    if (body.password) patch.passwordHash = await hashPassword(body.password);
    const updated = db.update(schema.users).set(patch).where(eq(schema.users.id, id)).returning().get();
    if (body.password || body.active === false) revokeUserSessions(id);
    audit(req, 'user.update', 'user', id, { ...body, password: body.password ? '***' : undefined });
    return publicUser(updated);
  });
}
