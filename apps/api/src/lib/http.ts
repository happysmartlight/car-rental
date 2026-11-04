import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Role } from '../shared/constants.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code?: string, extra?: Record<string, unknown>) => new HttpError(400, msg, code, extra);
export const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string, code?: string, extra?: Record<string, unknown>) => new HttpError(409, msg, code, extra);
export const forbidden = (msg = 'Bạn không có quyền làm việc này') => new HttpError(403, msg, 'forbidden');

/** Kiểm tra dữ liệu vào; lỗi đầu tiên được trả về bằng tiếng Việt. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue.path.join('.');
  throw badRequest(field ? `${field}: ${issue.message}` : issue.message, 'validation');
}

/**
 * Dữ liệu PATCH: chỉ giữ các trường client thực sự gửi.
 * Zod 4 vẫn chạy .default() và .transform() cho trường vắng mặt trong .partial(), nên parse thẳng
 * sẽ ghi đè dữ liệu cũ bằng giá trị mặc định (ODO về 0, xe ký gửi thành xe nhà…).
 */
export function parsePatch<T extends z.ZodObject>(schema: T, data: unknown): Partial<z.output<T>> {
  const parsed = parse(schema.partial(), data) as Record<string, unknown>;
  const sent = data !== null && typeof data === 'object' ? data : {};
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => Object.hasOwn(sent, k))) as Partial<z.output<T>>;
}

export function idParam(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID không hợp lệ');
  return id;
}

export function requireRole(req: FastifyRequest, role: Role): void {
  if (!req.user) throw new HttpError(401, 'Chưa đăng nhập', 'unauthenticated');
  if (role === 'admin' && req.user.role !== 'admin') throw forbidden();
}

/** Admin đăng nhập, hoặc Family Organizer gọi bằng HUB_TOKEN (chỉ các route trong lib/hub.ts). */
export function requireAdminOrHub(req: FastifyRequest): void {
  if (req.hub) return;
  requireRole(req, 'admin');
}

export function userId(req: FastifyRequest): number {
  if (!req.user) throw new HttpError(401, 'Chưa đăng nhập', 'unauthenticated');
  return req.user.id;
}

export function sendError(reply: FastifyReply, err: HttpError) {
  return reply.status(err.status).send({ error: err.message, code: err.code, ...err.extra });
}

// Bộ kiểm tra hay dùng
export const zMoney = z.coerce.number().int().min(0).max(100_000_000_000);
export const zSignedMoney = z.coerce.number().int().min(-100_000_000_000).max(100_000_000_000);
export const zDateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'ngày phải dạng YYYY-MM-DD')
  .nullable()
  .optional()
  .transform((v) => v || null);
export const zOptText = z
  .string()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => (v == null ? null : v.trim() || null));
export const zMs = z.coerce.number().int().min(0);
export const zFileId = z.string().uuid().nullable().optional().transform((v) => v ?? null);
