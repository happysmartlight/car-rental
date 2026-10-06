// Lưu file tải lên. Ảnh được nén WebP + tạo thumbnail để Pi lưu nhẹ;
// ảnh giao/nhận xe được đóng dấu giờ + biển số ngay trên ảnh.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { FileRow } from '../db/schema.js';
import type { FileKind } from '../shared/constants.js';
import { badRequest, notFound } from './http.js';

const IMAGE_PROFILE: Partial<Record<FileKind, { max: number; quality: number }>> = {
  id_front: { max: 2400, quality: 85 },
  id_back: { max: 2400, quality: 85 },
  license_front: { max: 2400, quality: 85 },
  license_back: { max: 2400, quality: 85 },
  vehicle_doc: { max: 2400, quality: 85 },
  document_scan: { max: 2600, quality: 85 },
  fine_notice: { max: 2400, quality: 85 },
  signature: { max: 1200, quality: 90 },
};
const DEFAULT_PROFILE = { max: 1920, quality: 80 };

function storagePath(id: string, ext: string, suffix = ''): { rel: string; abs: string } {
  const d = new Date();
  const dir = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rel = `${dir}/${id}${suffix}.${ext}`;
  const abs = path.join(config.uploadsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return { rel, abs };
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function stampSvg(width: number, height: number, text: string): Buffer {
  const fontSize = Math.max(16, Math.round(width / 40));
  const pad = Math.round(fontSize * 0.6);
  const boxH = fontSize + pad * 2;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${height - boxH}" width="${width}" height="${boxH}" fill="rgba(0,0,0,0.45)"/>
      <text x="${pad}" y="${height - pad - Math.round(fontSize * 0.15)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" fill="#fff">${escapeXml(text)}</text>
    </svg>`,
  );
}

export interface SaveOptions {
  kind: FileKind;
  originalName?: string | null;
  userId?: number | null;
  /** Dòng chữ đóng lên ảnh (vd "51K-123.45 • 14:30 06/10/2026 • Giao xe"). */
  stamp?: string | null;
}

export async function saveImage(input: Buffer, opts: SaveOptions): Promise<FileRow> {
  const profile = IMAGE_PROFILE[opts.kind] ?? DEFAULT_PROFILE;
  const img = sharp(input, { failOn: 'none' }).rotate().resize({
    width: profile.max,
    height: profile.max,
    fit: 'inside',
    withoutEnlargement: true,
  });
  let meta: OutputInfo;
  let data: Buffer;
  try {
    ({ data, info: meta } = await img.webp({ quality: profile.quality }).toBuffer({ resolveWithObject: true }));
  } catch {
    throw badRequest('File ảnh không đọc được. Nếu là ảnh HEIC từ iPhone, hãy chụp lại bằng nút chụp trong app.');
  }
  if (opts.stamp) {
    data = await sharp(data)
      .composite([{ input: stampSvg(meta.width, meta.height, opts.stamp), top: 0, left: 0 }])
      .webp({ quality: profile.quality })
      .toBuffer();
  }
  const id = crypto.randomUUID();
  const main = storagePath(id, 'webp');
  fs.writeFileSync(main.abs, data);
  const thumb = storagePath(id, 'webp', '_t');
  await sharp(data).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toFile(thumb.abs);

  const row: FileRow = {
    id,
    kind: opts.kind,
    mime: 'image/webp',
    size: data.length,
    width: meta.width,
    height: meta.height,
    path: main.rel,
    thumbPath: thumb.rel,
    originalName: opts.originalName ?? null,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    takenAt: Date.now(),
    createdBy: opts.userId ?? null,
    createdAt: Date.now(),
  };
  db.insert(schema.files).values(row).run();
  return row;
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
};

export function saveBinary(data: Buffer, mime: string, opts: SaveOptions): FileRow {
  const ext = EXT_BY_MIME[mime] ?? 'bin';
  const id = crypto.randomUUID();
  const main = storagePath(id, ext);
  fs.writeFileSync(main.abs, data);
  const row: FileRow = {
    id,
    kind: opts.kind,
    mime,
    size: data.length,
    width: null,
    height: null,
    path: main.rel,
    thumbPath: null,
    originalName: opts.originalName ?? null,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    takenAt: null,
    createdBy: opts.userId ?? null,
    createdAt: Date.now(),
  };
  db.insert(schema.files).values(row).run();
  return row;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function getFileRow(id: string): FileRow {
  const row = db.select().from(schema.files).where(eq(schema.files.id, id)).get();
  if (!row) throw notFound('Không tìm thấy file');
  return row;
}

export function absPath(rel: string): string {
  const abs = path.resolve(config.uploadsDir, rel);
  if (!abs.startsWith(path.resolve(config.uploadsDir))) throw badRequest('Đường dẫn không hợp lệ');
  return abs;
}

export function readFileData(row: FileRow): Buffer {
  return fs.readFileSync(absPath(row.path));
}

export function isImageMime(mime: string): boolean {
  return /^image\/(jpeg|png|webp|gif|heic|heif|avif|tiff)$/.test(mime);
}
