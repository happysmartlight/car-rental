// Định dạng file sao lưu mã hóa (.crbk) để gửi ra ngoài Pi (Telegram).
//
//   "CRBK1" | salt(16) | iv(12) | ciphertext | authTag(16)
//   plaintext = gzip( u32 độ dài manifest | manifest JSON | nội dung các file nối tiếp )
//
// AES-256-GCM, khóa sinh từ mật khẩu bằng scrypt. Sai mật khẩu hoặc file bị sửa
// đều bị phát hiện (authTag).

import crypto from 'node:crypto';
import zlib from 'node:zlib';

const MAGIC = Buffer.from('CRBK1');
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface PackEntry {
  path: string;
  data: Buffer;
}

export interface PackManifest {
  kind: 'db' | 'files';
  createdAt: number;
  appVersion: string;
  part?: number;
  entries: { path: string; size: number }[];
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

export function encryptPack(meta: Omit<PackManifest, 'entries'>, entries: PackEntry[], passphrase: string): Buffer {
  if (!passphrase) throw new Error('Chưa đặt mật khẩu mã hóa bản sao lưu');
  const manifest: PackManifest = { ...meta, entries: entries.map((e) => ({ path: e.path, size: e.data.length })) };
  const mjson = Buffer.from(JSON.stringify(manifest), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(mjson.length);
  const plain = zlib.gzipSync(Buffer.concat([len, mjson, ...entries.map((e) => e.data)]), { level: 6 });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, ct, cipher.getAuthTag()]);
}

export function isPack(buf: Buffer): boolean {
  return buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptPack(buf: Buffer, passphrase: string): { manifest: PackManifest; entries: PackEntry[] } {
  if (!isPack(buf)) throw new Error('Không phải file sao lưu .crbk');
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(o, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = zlib.gunzipSync(Buffer.concat([decipher.update(ct), decipher.final()]));
  } catch {
    throw new Error('Sai mật khẩu hoặc file sao lưu bị hỏng');
  }
  const mlen = plain.readUInt32BE(0);
  const manifest = JSON.parse(plain.subarray(4, 4 + mlen).toString('utf8')) as PackManifest;
  let off = 4 + mlen;
  const entries = manifest.entries.map((e) => {
    const data = plain.subarray(off, off + e.size);
    off += e.size;
    return { path: e.path, data };
  });
  return { manifest, entries };
}
