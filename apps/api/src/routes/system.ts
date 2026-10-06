// Hệ thống (admin): thông tin máy, sao lưu, Telegram, cập nhật, nhật ký.

import fs from 'node:fs';
import { count, desc, eq, inArray, lt, type SQL, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import {
  backupPath,
  createLocalBackup,
  currentStats,
  deleteBackup,
  listBackups,
  previewBackup,
  restoreBackup,
  restoreUploaded,
  runOffsiteBackup,
} from '../lib/backup.js';
import { badRequest, parse, requireRole } from '../lib/http.js';
import { getLocalConfig, updateLocalConfig } from '../lib/localConfig.js';
import { sendTelegram } from '../lib/telegram.js';
import { checkReleases, compareVersions, pendingRequest, readUpdaterLog, readUpdaterState, updateAvailable } from '../lib/updater.js';
import { pdfServiceStatus } from '../services/documents.js';
import { requestRestart, startUpdate } from '../services/updateFlow.js';

function dirSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

const mask = (s: string) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : '');

export async function systemRoutes(app: FastifyInstance) {
  // Health check chạy 30s/lần (Docker) và trang web hỏi version liên tục → không ghi log.
  app.get('/api/health', { logLevel: 'warn' }, async () => ({ ok: true, version: config.version }));

  app.get('/api/version', { logLevel: 'warn' }, async () => ({ version: config.version, commit: config.commit, buildTime: config.buildTime }));

  app.get('/api/system/info', async (req) => {
    requireRole(req, 'admin');
    let disk: { free: number; total: number } | null = null;
    try {
      const s = fs.statfsSync(config.dataDir);
      disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      /* không hỗ trợ */
    }
    return {
      version: config.version,
      commit: config.commit,
      buildTime: config.buildTime,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      dataDir: config.dataDir,
      sizes: {
        db: fs.existsSync(config.dbFile) ? fs.statSync(config.dbFile).size : 0,
        uploads: dirSize(config.uploadsDir),
        backups: dirSize(config.backupsDir),
      },
      disk,
      stats: currentStats(),
      pdfService: await pdfServiceStatus(),
    };
  });

  // ── Sao lưu ───────────────────────────────────────────────────────────────

  app.get('/api/system/backups', async (req) => {
    requireRole(req, 'admin');
    const lc = getLocalConfig().backup;
    return {
      items: listBackups(),
      config: {
        nightlyHour: lc.nightlyHour,
        keepDaily: lc.keepDaily,
        keepMonthly: lc.keepMonthly,
        telegramEnabled: lc.telegramEnabled,
        hasPassphrase: !!lc.passphrase,
        lastLocalDate: lc.lastLocalDate ?? null,
        lastTelegramDate: lc.lastTelegramDate ?? null,
        lastTelegramError: lc.lastTelegramError ?? null,
        filesSyncedUntil: lc.filesSyncedUntil ?? null,
      },
    };
  });

  app.put('/api/system/backups/config', async (req) => {
    requireRole(req, 'admin');
    const body = parse(
      z.object({
        nightlyHour: z.coerce.number().int().min(0).max(23).optional(),
        keepDaily: z.coerce.number().int().min(3).max(365).optional(),
        keepMonthly: z.coerce.number().int().min(0).max(120).optional(),
        telegramEnabled: z.boolean().optional(),
        passphrase: z.string().min(8, 'mật khẩu mã hóa tối thiểu 8 ký tự').max(200).optional(),
      }),
      req.body,
    );
    if (body.telegramEnabled && !body.passphrase && !getLocalConfig().backup.passphrase) {
      throw badRequest('Đặt mật khẩu mã hóa trước khi bật sao lưu lên Telegram');
    }
    updateLocalConfig((c) => {
      Object.assign(c.backup, body);
    });
    audit(req, 'backup.config', 'system', null, { ...body, passphrase: body.passphrase ? '***' : undefined });
    return { ok: true };
  });

  app.post('/api/system/backups', async (req) => {
    requireRole(req, 'admin');
    const b = await createLocalBackup('manual', req.user!.displayName);
    audit(req, 'backup.create', 'system', b.name);
    return b;
  });

  app.get('/api/system/backups/:name/preview', async (req) => {
    requireRole(req, 'admin');
    const { name } = req.params as { name: string };
    return { backup: await previewBackup(name), current: currentStats() };
  });

  app.get('/api/system/backups/:name/download', async (req, reply) => {
    requireRole(req, 'admin');
    const { name } = req.params as { name: string };
    const p = backupPath(name);
    audit(req, 'backup.download', 'system', name);
    reply.header('content-type', 'application/gzip');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(fs.createReadStream(p));
  });

  app.post('/api/system/backups/:name/restore', async (req) => {
    requireRole(req, 'admin');
    const { name } = req.params as { name: string };
    const stats = await restoreBackup(name);
    audit(req, 'backup.restore', 'system', name, stats);
    return { ok: true, stats };
  });

  app.delete('/api/system/backups/:name', async (req) => {
    requireRole(req, 'admin');
    const { name } = req.params as { name: string };
    deleteBackup(name);
    audit(req, 'backup.delete', 'system', name);
    return { ok: true };
  });

  /** Khôi phục từ file tải lên (.sqlite.gz hoặc .crbk từ Telegram). */
  app.post('/api/system/backups/upload', async (req) => {
    requireRole(req, 'admin');
    const part = await req.file({ limits: { fileSize: 200 * 1024 * 1024 } });
    if (!part) throw badRequest('Chưa chọn file');
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    const buf = await part.toBuffer();
    const result = await restoreUploaded(buf, part.filename, fields.passphrase?.value ?? null).catch((err: Error) => {
      throw badRequest(err.message);
    });
    audit(req, 'backup.restore_upload', 'system', part.filename, result);
    return result;
  });

  // ── Telegram ─────────────────────────────────────────────────────────────

  app.get('/api/system/telegram', async (req) => {
    requireRole(req, 'admin');
    const t = getLocalConfig().telegram;
    return { configured: !!(t.botToken && t.chatId), maskedToken: mask(t.botToken), chatId: t.chatId, notify: t.notify, dailyDigest: t.dailyDigest, digestHour: t.digestHour };
  });

  app.put('/api/system/telegram', async (req) => {
    requireRole(req, 'admin');
    const body = parse(
      z.object({
        botToken: z.string().trim().regex(/^\d+:[\w-]{20,}$/, 'token dạng 123456:ABC…').optional(),
        chatId: z.string().trim().regex(/^-?\d+$/, 'chat ID là số').optional(),
        notify: z.boolean().optional(),
        dailyDigest: z.boolean().optional(),
        digestHour: z.coerce.number().int().min(0).max(23).optional(),
      }),
      req.body,
    );
    updateLocalConfig((c) => {
      Object.assign(c.telegram, body);
    });
    audit(req, 'telegram.config', 'system', null, { ...body, botToken: body.botToken ? '***' : undefined });
    return { ok: true };
  });

  app.post('/api/system/telegram/test', async (req) => {
    requireRole(req, 'admin');
    await sendTelegram(`✅ Kết nối thành công với app cho thuê xe (v${config.version}).`).catch((err: Error) => {
      throw badRequest(err.message);
    });
    return { ok: true };
  });

  app.post('/api/system/telegram/backup', async (req) => {
    requireRole(req, 'admin');
    const r = await runOffsiteBackup().catch((err: Error) => {
      updateLocalConfig((c) => {
        c.backup.lastTelegramError = err.message;
      });
      throw badRequest(err.message);
    });
    audit(req, 'backup.telegram', 'system', null, r);
    return r;
  });

  // ── Cập nhật ─────────────────────────────────────────────────────────────

  app.get('/api/system/update', async (req) => {
    requireRole(req, 'admin');
    const lc = getLocalConfig().update;
    const releases = lc.releases ?? [];
    return {
      current: { version: config.version, commit: config.commit, buildTime: config.buildTime },
      updater: readUpdaterState(),
      pending: pendingRequest(),
      log: readUpdaterLog(),
      available: updateAvailable(),
      releases: releases.map((r) => ({ ...r, isCurrent: r.version === config.version, isNewer: compareVersions(r.version, config.version) > 0 })),
      lastCheckAt: lc.lastCheckAt ?? null,
      lastCheckError: lc.lastCheckError ?? null,
      autoUpdate: lc.autoUpdate,
      autoUpdateHour: lc.autoUpdateHour,
      repo: config.githubRepo,
      preUpdateBackups: listBackups().filter((b) => b.tag === 'pre-update'),
    };
  });

  app.post('/api/system/update/check', async (req) => {
    requireRole(req, 'admin');
    try {
      await checkReleases();
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    return { available: updateAvailable() };
  });

  app.put('/api/system/update/config', async (req) => {
    requireRole(req, 'admin');
    const body = parse(z.object({ autoUpdate: z.boolean(), autoUpdateHour: z.coerce.number().int().min(0).max(23) }), req.body);
    updateLocalConfig((c) => {
      c.update.autoUpdate = body.autoUpdate;
      c.update.autoUpdateHour = body.autoUpdateHour;
    });
    audit(req, 'update.config', 'system', null, body);
    return { ok: true };
  });

  app.post('/api/system/update/apply', async (req) => {
    requireRole(req, 'admin');
    const body = parse(z.object({ version: z.string(), restoreBackup: z.string().nullable().optional() }), req.body);
    const r = await startUpdate(body.version, { restoreBackup: body.restoreBackup ?? null, reason: compareVersions(body.version, config.version) < 0 ? 'rollback' : 'manual' });
    audit(req, 'update.apply', 'system', body.version, { from: config.version, ...r, restoreBackup: body.restoreBackup ?? null });
    return r;
  });

  app.post('/api/system/restart', async (req) => {
    requireRole(req, 'admin');
    const id = requestRestart();
    audit(req, 'system.restart', 'system');
    return { requestId: id };
  });

  // ── Nhật ký ──────────────────────────────────────────────────────────────

  app.get('/api/system/audit', async (req) => {
    requireRole(req, 'admin');
    const q = parse(
      z.object({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        before: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }),
      req.query,
    );
    const conds: SQL[] = [];
    if (q.entity) conds.push(eq(schema.auditLog.entity, q.entity));
    if (q.entityId) conds.push(eq(schema.auditLog.entityId, q.entityId));
    if (q.before) conds.push(lt(schema.auditLog.id, q.before));
    const rows = db.select().from(schema.auditLog).where(and(...conds)).orderBy(desc(schema.auditLog.id)).limit(q.limit).all();
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is number => x != null))];
    const users = userIds.length ? db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, userIds)).all() : [];
    const total = db.select({ n: count() }).from(schema.auditLog).get()?.n ?? 0;
    return { items: rows, users, total };
  });
}
