import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { eq, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import type { Role } from '../shared/constants.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = 'cr_session';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, got);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(req: FastifyRequest, reply: FastifyReply, userId: number): void {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.insert(schema.sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_DAYS * DAY,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: req.ip,
    })
    .run();
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply): void {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).run();
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Đọc phiên từ cookie; gia hạn trượt mỗi ngày một lần. */
export function loadSession(req: FastifyRequest): SessionUser | undefined {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const hash = sha256(token);
  const row = db
    .select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, hash))
    .get();
  const now = Date.now();
  if (!row || row.s.expiresAt < now || !row.u.active) return undefined;
  if (now - row.s.lastSeenAt > DAY) {
    db.update(schema.sessions)
      .set({ lastSeenAt: now, expiresAt: now + SESSION_DAYS * DAY })
      .where(eq(schema.sessions.tokenHash, hash))
      .run();
  }
  return { id: row.u.id, username: row.u.username, displayName: row.u.displayName, role: row.u.role };
}

export function revokeUserSessions(userId: number, exceptToken?: string): void {
  const all = db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).all();
  const keep = exceptToken ? sha256(exceptToken) : null;
  for (const s of all) {
    if (s.tokenHash !== keep) db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, s.tokenHash)).run();
  }
}

export function purgeExpiredSessions(): void {
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now())).run();
}

// ── Chặn dò mật khẩu: 10 lần sai / 15 phút / IP ───────────────────────────
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60 * 1000;

export function loginBlocked(ip: string): boolean {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW);
  failures.set(ip, list);
  return list.length >= 10;
}

export function recordLoginFailure(ip: string): void {
  const list = failures.get(ip) ?? [];
  list.push(Date.now());
  failures.set(ip, list);
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
