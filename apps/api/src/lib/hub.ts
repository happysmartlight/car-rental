// Family Organizer chạy cùng máy chủ là "trung tâm điều khiển" các app tự host trong nhà:
// nó xem và bấm cập nhật Car Rental bằng khóa chung HUB_TOKEN (đặt trong .env của cả hai,
// do setup.sh của liu-homelab sinh). Khóa này thay cho đăng nhập admin, CHỈ với các route
// cập nhật dưới đây — không đọc/sửa được dữ liệu thuê xe. Không đặt khóa = tắt hẳn.

import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

const HUB_ROUTES = new Set(['GET /api/system/update', 'POST /api/system/update/check', 'POST /api/system/update/apply']);

export function isHubRequest(req: FastifyRequest): boolean {
  const token = config.hubToken;
  if (token.length < 32) return false;
  if (!HUB_ROUTES.has(`${req.method} ${req.url.split('?')[0]}`)) return false;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7).trim());
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
