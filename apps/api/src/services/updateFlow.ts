import { config } from '../config.js';
import { createLocalBackup, listBackups } from '../lib/backup.js';
import { badRequest } from '../lib/http.js';
import { escapeHtml, notify } from '../lib/telegram.js';
import { compareVersions, readUpdaterState, stageDeployFiles, writeUpdaterRequest } from '../lib/updater.js';

/**
 * Bắt đầu cập nhật/quay về `target`.
 * - Luôn sao lưu DB trước; updater dùng bản này để tự rollback nếu bản mới khởi động lỗi.
 * - `restoreBackup`: (quay về bản cũ kèm dữ liệu) khôi phục bản sao lưu này trước khi chạy `target`.
 */
export async function startUpdate(target: string, opts: { restoreBackup?: string | null; reason: 'manual' | 'auto' | 'rollback' }) {
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(target)) throw badRequest('Phiên bản không hợp lệ');
  const state = readUpdaterState();
  if (!state.alive) throw badRequest('Dịch vụ cập nhật không chạy');
  if (opts.restoreBackup && !listBackups().some((b) => b.name === opts.restoreBackup)) throw badRequest('Không tìm thấy bản sao lưu để khôi phục');

  const backup = await createLocalBackup('pre-update', `v${config.version} → v${target}`);
  const staged = await stageDeployFiles(target);
  const id = writeUpdaterRequest({
    action: 'update',
    target,
    backup: `backups/${backup.name}`,
    ...(opts.restoreBackup ? { restore: `backups/${opts.restoreBackup}` } : {}),
    ...staged,
  });

  const verb = compareVersions(target, config.version) < 0 ? 'Quay về' : 'Cập nhật lên';
  notify(`🔄 <b>${verb} v${escapeHtml(target)}</b> (${opts.reason === 'auto' ? 'tự động' : 'thủ công'})\nĐang chạy v${escapeHtml(config.version)}. Đã sao lưu dữ liệu trước khi cập nhật.`);
  return { requestId: id, backup: backup.name };
}

export function requestRestart() {
  return writeUpdaterRequest({ action: 'restart' });
}
