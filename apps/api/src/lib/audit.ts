import type { FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';

/** Ghi nhật ký thao tác. Không bao giờ làm hỏng request chính nếu ghi lỗi. */
export function audit(
  req: FastifyRequest | null,
  action: string,
  entity?: string | null,
  entityId?: string | number | null,
  detail?: unknown,
): void {
  try {
    db.insert(schema.auditLog)
      .values({
        at: Date.now(),
        userId: req?.user?.id ?? null,
        action,
        entity: entity ?? null,
        entityId: entityId == null ? null : String(entityId),
        detail: detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
        ip: req?.ip ?? null,
      })
      .run();
  } catch (err) {
    console.error('audit failed', err);
  }
}
