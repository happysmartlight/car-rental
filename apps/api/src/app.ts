import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { closeDb, openDb } from './db/index.js';
import { loadSession } from './lib/auth.js';
import { HttpError, sendError } from './lib/http.js';
import { accessoryRoutes } from './routes/accessories.js';
import { authRoutes } from './routes/auth.js';
import { cashflowRoutes } from './routes/cashflow.js';
import { customerRoutes } from './routes/customers.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { fileRoutes } from './routes/files.js';
import { fineRoutes } from './routes/fines.js';
import { rentalRoutes } from './routes/rentals.js';
import { settingsRoutes } from './routes/settings.js';
import { systemRoutes } from './routes/system.js';
import { vehicleRoutes } from './routes/vehicles.js';
import { ensureAccessoryCatalog } from './services/accessories.js';
import { ensureBuiltinTemplates } from './services/documents.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  openDb();
  ensureBuiltinTemplates();
  ensureAccessoryCatalog();

  const app = Fastify({
    logger: opts.logger === false ? false : config.isProd ? { level: 'info' } : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  // Đóng DB khi tắt: checkpoint WAL để file db.sqlite đầy đủ, nhả khóa file.
  app.addHook('onClose', async () => closeDb());

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

  const PUBLIC = new Set(['/api/health', '/api/version', '/api/auth/state', '/api/auth/login', '/api/auth/setup']);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = loadSession(req);
    const pathOnly = req.url.split('?')[0];
    if (!req.user && !PUBLIC.has(pathOnly)) {
      return reply.status(401).send({ error: 'Chưa đăng nhập', code: 'unauthenticated' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    if (err instanceof ZodError) return reply.status(400).send({ error: err.issues[0]?.message ?? 'Dữ liệu không hợp lệ', code: 'validation' });
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message, code: e.code });
    req.log.error(err);
    return reply.status(500).send({ error: 'Lỗi máy chủ. Thử lại hoặc xem nhật ký.', code: 'internal' });
  });

  await app.register(authRoutes);
  await app.register(fileRoutes);
  await app.register(customerRoutes);
  await app.register(vehicleRoutes);
  await app.register(accessoryRoutes);
  await app.register(rentalRoutes);
  await app.register(fineRoutes);
  await app.register(settingsRoutes);
  await app.register(dashboardRoutes);
  await app.register(cashflowRoutes);
  await app.register(systemRoutes);

  // Giao diện web (bản build của apps/web). Đường dẫn lạ → index.html (SPA).
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      // Đọc file động (không chốt danh sách lúc khởi động) — file thiếu rơi xuống notFound bên dưới.
      wildcard: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Không tìm thấy API', code: 'not_found' });
      // File JS/CSS của bản cũ đã bị thay sau khi cập nhật → 404 thật (trình duyệt tự tải lại), không trả index.html.
      if (req.url.startsWith('/assets/')) return reply.status(404).type('text/plain').send('Not found');
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`Không thấy giao diện web ở ${config.webDist} — chỉ chạy API (dev: dùng vite).`);
  }

  return app;
}
