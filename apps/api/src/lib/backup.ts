// Sao lưu & khôi phục.
//
// Local:   data/backups/db-YYYYMMDD-HHmmss-<tag>.sqlite.gz (VACUUM INTO → gzip).
//          Không mã hóa vì nằm cùng ổ với DB gốc; chỉ admin tải được.
// Offsite: Telegram, file .crbk mã hóa (xem pack.ts). DB gửi nguyên bản mỗi đêm;
//          ảnh/văn bản gửi phần mới phát sinh, chia gói ≤ 40MB.

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { asc, gt } from 'drizzle-orm';
import { config } from '../config.js';
import { closeDb, db, openDb, rawDb, schema } from '../db/index.js';
import { vnDateKey, vnParts } from '../shared/time.js';
import { absPath } from './files.js';
import { badRequest, notFound } from './http.js';
import { getLocalConfig, updateLocalConfig } from './localConfig.js';
import { decryptPack, encryptPack } from './pack.js';
import { escapeHtml, notify, sendTelegramDocument, telegramConfigured } from './telegram.js';

export type BackupTag = 'nightly' | 'manual' | 'pre-update' | 'pre-restore' | 'uploaded';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
  tag: BackupTag;
  note: string | null;
  appVersion: string | null;
}

const NAME_RE = /^db-(\d{8})-(\d{6})-([a-z-]+)\.sqlite\.gz$/;

function stamp(ms = Date.now()): string {
  const p = vnParts(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = new Date(ms).getUTCSeconds();
  return `${p.year}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}${pad(s)}`;
}

function tmpFile(prefix: string): string {
  return path.join(config.tmpDir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

/** Ảnh chụp nhất quán của DB đang chạy (không khóa ghi). */
function snapshotTo(file: string): void {
  rawDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

export async function createLocalBackup(tag: BackupTag, note: string | null = null): Promise<BackupInfo> {
  const createdAt = Date.now();
  const name = `db-${stamp(createdAt)}-${tag}.sqlite.gz`;
  const tmp = tmpFile('snap');
  try {
    snapshotTo(tmp);
    await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(path.join(config.backupsDir, name)));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const meta = { tag, note, appVersion: config.version, createdAt };
  fs.writeFileSync(path.join(config.backupsDir, `${name}.json`), JSON.stringify(meta));
  const size = fs.statSync(path.join(config.backupsDir, name)).size;
  return { name, size, createdAt, tag, note, appVersion: config.version };
}

export function listBackups(): BackupInfo[] {
  const out: BackupInfo[] = [];
  for (const f of fs.readdirSync(config.backupsDir)) {
    const m = NAME_RE.exec(f);
    if (!m) continue;
    const full = path.join(config.backupsDir, f);
    let meta: Partial<BackupInfo> = {};
    try {
      meta = JSON.parse(fs.readFileSync(`${full}.json`, 'utf8'));
    } catch {
      /* bản không có meta */
    }
    const st = fs.statSync(full);
    out.push({
      name: f,
      size: st.size,
      createdAt: meta.createdAt ?? st.mtimeMs,
      tag: (meta.tag ?? m[3]) as BackupTag,
      note: meta.note ?? null,
      appVersion: meta.appVersion ?? null,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(name: string): string {
  if (!NAME_RE.test(name)) throw badRequest('Tên bản sao lưu không hợp lệ');
  const p = path.join(config.backupsDir, name);
  if (!fs.existsSync(p)) throw notFound('Không tìm thấy bản sao lưu');
  return p;
}

export function deleteBackup(name: string): void {
  const p = backupPath(name);
  fs.rmSync(p, { force: true });
  fs.rmSync(`${p}.json`, { force: true });
}

/** Giữ: N bản đêm gần nhất + bản đêm đầu tiên của mỗi tháng (M tháng) + 10 bản trước cập nhật/khôi phục + 20 bản thủ công. */
export function pruneBackups(): void {
  const { keepDaily, keepMonthly } = getLocalConfig().backup;
  const all = listBackups();
  const keep = new Set<string>();
  const nightly = all.filter((b) => b.tag === 'nightly');
  nightly.slice(0, keepDaily).forEach((b) => keep.add(b.name));
  const firstOfMonth = new Map<string, BackupInfo>();
  for (const b of [...nightly].reverse()) {
    const k = vnDateKey(b.createdAt).slice(0, 7);
    if (!firstOfMonth.has(k)) firstOfMonth.set(k, b);
  }
  [...firstOfMonth.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, keepMonthly).forEach((b) => keep.add(b.name));
  all.filter((b) => b.tag === 'pre-update' || b.tag === 'pre-restore').slice(0, 10).forEach((b) => keep.add(b.name));
  all.filter((b) => b.tag === 'manual' || b.tag === 'uploaded').slice(0, 20).forEach((b) => keep.add(b.name));
  for (const b of all) if (!keep.has(b.name)) deleteBackup(b.name);
}

async function gunzipTo(src: string, dest: string): Promise<void> {
  await pipeline(fs.createReadStream(src), zlib.createGunzip(), fs.createWriteStream(dest));
}

export interface DbStats {
  customers: number;
  vehicles: number;
  rentals: number;
  lastRentalAt: number | null;
}

function statsOf(file: string): DbStats {
  const conn = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const ok = conn.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw badRequest('File database bị hỏng (integrity_check thất bại)');
    const hasRentals = conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rentals'").get();
    if (!hasRentals) throw badRequest('File không phải database của app cho thuê xe');
    const count = (t: string) => (conn.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const last = conn.prepare('SELECT MAX(created_at) AS m FROM rentals').get() as { m: number | null };
    return { customers: count('customers'), vehicles: count('vehicles'), rentals: count('rentals'), lastRentalAt: last.m };
  } finally {
    conn.close();
  }
}

export async function previewBackup(name: string): Promise<DbStats> {
  const tmp = tmpFile('preview');
  try {
    await gunzipTo(backupPath(name), tmp);
    return statsOf(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function currentStats(): DbStats {
  const conn = rawDb();
  const count = (t: string) => (conn.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const last = conn.prepare('SELECT MAX(created_at) AS m FROM rentals').get() as { m: number | null };
  return { customers: count('customers'), vehicles: count('vehicles'), rentals: count('rentals'), lastRentalAt: last.m };
}

/** Thay DB đang chạy bằng file `sqliteFile`. Luôn sao lưu bản hiện tại trước. */
export async function restoreDatabaseFile(sqliteFile: string): Promise<DbStats> {
  const stats = statsOf(sqliteFile);
  await createLocalBackup('pre-restore', 'Tự động trước khi khôi phục');
  closeDb();
  try {
    for (const suffix of ['-wal', '-shm']) fs.rmSync(config.dbFile + suffix, { force: true });
    fs.copyFileSync(sqliteFile, config.dbFile);
  } finally {
    openDb();
  }
  return stats;
}

export async function restoreBackup(name: string): Promise<DbStats> {
  const tmp = tmpFile('restore');
  try {
    await gunzipTo(backupPath(name), tmp);
    return await restoreDatabaseFile(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Khôi phục từ file người dùng tải lên: .sqlite.gz (local) hoặc .crbk (Telegram, cần mật khẩu). */
export async function restoreUploaded(data: Buffer, fileName: string, passphrase: string | null) {
  if (fileName.endsWith('.crbk')) {
    const { manifest, entries } = decryptPack(data, passphrase || getLocalConfig().backup.passphrase);
    if (manifest.kind === 'files') {
      let written = 0;
      for (const e of entries) {
        const dest = absPath(e.path);
        if (fs.existsSync(dest)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, e.data);
        written++;
      }
      return { kind: 'files' as const, files: written, total: entries.length };
    }
    const tmp = tmpFile('upload');
    try {
      fs.writeFileSync(tmp, entries[0].data);
      return { kind: 'db' as const, stats: await restoreDatabaseFile(tmp) };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  const tmp = tmpFile('upload');
  try {
    fs.writeFileSync(tmp, fileName.endsWith('.gz') ? zlib.gunzipSync(data) : data);
    return { kind: 'db' as const, stats: await restoreDatabaseFile(tmp) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ── Gửi ra ngoài qua Telegram ───────────────────────────────────────────────

const PART_LIMIT = 40 * 1024 * 1024;

export async function sendDbToTelegram(): Promise<number> {
  const pass = getLocalConfig().backup.passphrase;
  const tmp = tmpFile('tg');
  try {
    snapshotTo(tmp);
    const now = Date.now();
    const pack = encryptPack({ kind: 'db', createdAt: now, appVersion: config.version }, [{ path: 'db.sqlite', data: fs.readFileSync(tmp) }], pass);
    await sendTelegramDocument(pack, `car-rental-db-${stamp(now)}.crbk`, `🗄 Sao lưu dữ liệu ${vnDateKey(now)} · ${(pack.length / 1024 / 1024).toFixed(1)}MB (mã hóa)`);
    return pack.length;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Gửi các file (ảnh, hợp đồng) phát sinh kể từ lần gửi trước. */
export async function sendNewFilesToTelegram(): Promise<{ files: number; parts: number }> {
  const cfg = getLocalConfig().backup;
  const since = cfg.filesSyncedUntil ?? 0;
  const rows = db.select().from(schema.files).where(gt(schema.files.createdAt, since)).orderBy(asc(schema.files.createdAt)).all();
  let parts = 0;
  let files = 0;
  let batch: { path: string; data: Buffer; createdAt: number }[] = [];
  let batchSize = 0;

  const flush = async () => {
    if (!batch.length) return;
    parts++;
    const now = Date.now();
    const pack = encryptPack({ kind: 'files', createdAt: now, appVersion: config.version, part: parts }, batch, cfg.passphrase);
    await sendTelegramDocument(pack, `car-rental-files-${stamp(now)}-p${parts}.crbk`, `🖼 Ảnh & văn bản mới · ${batch.length} file · gói ${parts}`);
    files += batch.length;
    const last = batch[batch.length - 1].createdAt;
    updateLocalConfig((c) => {
      c.backup.filesSyncedUntil = last;
    });
    batch = [];
    batchSize = 0;
  };

  for (const r of rows) {
    const rels = [r.path, r.thumbPath].filter((x): x is string => !!x);
    for (const rel of rels) {
      let data: Buffer;
      try {
        data = fs.readFileSync(absPath(rel));
      } catch {
        continue;
      }
      if (data.length > PART_LIMIT) continue;
      if (batchSize + data.length > PART_LIMIT) await flush();
      batch.push({ path: rel, data, createdAt: r.createdAt });
      batchSize += data.length;
    }
  }
  await flush();
  return { files, parts };
}

export async function runOffsiteBackup(): Promise<{ dbBytes: number; files: number; parts: number }> {
  if (!telegramConfigured()) throw new Error('Chưa cấu hình Telegram');
  if (!getLocalConfig().backup.passphrase) throw new Error('Chưa đặt mật khẩu mã hóa bản sao lưu');
  const dbBytes = await sendDbToTelegram();
  const { files, parts } = await sendNewFilesToTelegram();
  updateLocalConfig((c) => {
    c.backup.lastTelegramDate = vnDateKey(Date.now());
    c.backup.lastTelegramError = undefined;
  });
  return { dbBytes, files, parts };
}

let nightlyRunning = false;

export async function runNightlyBackup(): Promise<void> {
  if (nightlyRunning) return;
  nightlyRunning = true;
  try {
    await createLocalBackup('nightly');
    pruneBackups();
    updateLocalConfig((c) => {
      c.backup.lastLocalDate = vnDateKey(Date.now());
    });
    if (getLocalConfig().backup.telegramEnabled) {
      try {
        await runOffsiteBackup();
      } catch (err) {
        const msg = (err as Error).message;
        updateLocalConfig((c) => {
          c.backup.lastTelegramError = msg;
        });
        notify(`⚠️ <b>Sao lưu lên Telegram thất bại</b>\n${escapeHtml(msg)}`);
      }
    }
  } catch (err) {
    console.error('nightly backup failed', err);
    notify(`⚠️ <b>Sao lưu hằng đêm thất bại</b>\n${escapeHtml((err as Error).message)}`);
  } finally {
    nightlyRunning = false;
  }
}
