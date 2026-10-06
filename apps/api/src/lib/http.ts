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

export function idParam(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID không hợp lệ');
  return id;
}

export function requireRole(req: FastifyRequest, role: Role): void {
  if (!req.user) throw new HttpError(401, 'Chưa đăng nhập', 'unauthenticated');
  if (role === 'admin' && req.user.role !== 'admin') throw forbidden();
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
