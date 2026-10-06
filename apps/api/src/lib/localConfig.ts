// Cấu hình riêng của máy này: data/config/local.json, nằm NGOÀI database.
// Khôi phục backup DB không đụng tới file này → không mất token Telegram,
// mật khẩu mã hóa backup, lịch tự cập nhật.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  url: string;
}

export interface LocalConfig {
  telegram: {
    botToken: string;
    chatId: string;
    notify: boolean;
    dailyDigest: boolean;
    digestHour: number;
  };
  backup: {
    nightlyHour: number;
    keepDaily: number;
    keepMonthly: number;
    passphrase: string;
    telegramEnabled: boolean;
    lastLocalDate?: string;
    lastTelegramDate?: string;
    lastTelegramError?: string;
    filesSyncedUntil?: number;
  };
  update: {
    autoUpdate: boolean;
    autoUpdateHour: number;
    lastCheckAt?: number;
    lastCheckError?: string;
    releases?: ReleaseInfo[];
    lastAutoUpdateDate?: string;
    notifiedVersion?: string;
  };
  digest: {
    lastDate?: string;
  };
}

const DEFAULT: LocalConfig = {
  telegram: { botToken: '', chatId: '', notify: true, dailyDigest: true, digestHour: 8 },
  backup: { nightlyHour: 2, keepDaily: 30, keepMonthly: 12, passphrase: '', telegramEnabled: false },
  update: { autoUpdate: false, autoUpdateHour: 3 },
  digest: {},
};

const file = () => path.join(config.configDir, 'local.json');

let cache: LocalConfig | null = null;

export function getLocalConfig(): LocalConfig {
  if (cache) return cache;
  let parsed: Partial<LocalConfig> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    /* lần đầu chạy */
  }
  cache = {
    telegram: { ...DEFAULT.telegram, ...parsed.telegram },
    backup: { ...DEFAULT.backup, ...parsed.backup },
    update: { ...DEFAULT.update, ...parsed.update },
    digest: { ...DEFAULT.digest, ...parsed.digest },
  };
  return cache;
}

/** Sửa một phần rồi ghi nguyên khối (ghi file tạm rồi rename — mất điện giữa chừng không hỏng file). */
export function updateLocalConfig(mutator: (c: LocalConfig) => void): LocalConfig {
  const c = structuredClone(getLocalConfig());
  mutator(c);
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
  cache = c;
  return c;
}
