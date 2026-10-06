import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { absPath, getFileRow, isImageMime, saveBinary, saveImage } from '../lib/files.js';
import { badRequest, requireRole, userId } from '../lib/http.js';
import { FILE_KINDS, SENSITIVE_FILE_KINDS, type FileKind } from '../shared/constants.js';

export async function fileRoutes(app: FastifyInstance) {
  /** Tải 1 file lên (multipart: file + kind + stamp?). Ảnh được nén; PDF giữ nguyên. */
  app.post('/api/files', async (req) => {
    requireRole(req, 'staff');
    const part = await req.file({ limits: { fileSize: 30 * 1024 * 1024 } });
    if (!part) throw badRequest('Không có file');
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    const kind = (fields.kind?.value ?? 'other') as FileKind;
    if (!FILE_KINDS.includes(kind)) throw badRequest('Loại file không hợp lệ');
    const stamp = fields.stamp?.value?.slice(0, 200) || null;
    const buf = await part.toBuffer();
    if (part.file.truncated) throw badRequest('File quá lớn (tối đa 30MB)');
    const uid = userId(req);
    const row =
      part.mimetype === 'application/pdf'
        ? saveBinary(buf, 'application/pdf', { kind, originalName: part.filename, userId: uid })
        : isImageMime(part.mimetype) || part.mimetype === 'application/octet-stream'
          ? await saveImage(buf, { kind, originalName: part.filename, userId: uid, stamp })
          : (() => {
              throw badRequest('Chỉ nhận ảnh hoặc PDF');
            })();
    return { id: row.id, kind: row.kind, mime: row.mime, size: row.size, width: row.width, height: row.height };
  });

  app.get('/api/files/:id', async (req, reply) => {
    requireRole(req, 'staff');
    const { id } = req.params as { id: string };
    const q = req.query as { thumb?: string; download?: string };
    const row = getFileRow(id);
    const useThumb = q.thumb === '1' && row.thumbPath;
    const rel = useThumb ? row.thumbPath! : row.path;
    if (SENSITIVE_FILE_KINDS.includes(row.kind) && !useThumb) audit(req, 'file.view', 'file', row.id, { kind: row.kind });
    const abs = absPath(rel);
    if (!fs.existsSync(abs)) return reply.status(404).send({ error: 'File không còn trên đĩa' });
    reply.header('content-type', row.mime);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    if (q.download === '1') {
      const name = row.originalName ?? `${row.id}`;
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    } else if (row.mime === 'application/pdf') {
      reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.originalName ?? 'document.pdf')}`);
    }
    return reply.send(fs.createReadStream(abs));
  });
}
