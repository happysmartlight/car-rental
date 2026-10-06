import fs from 'node:fs';
import path from 'node:path';

// apps/api — dù chạy từ src/ (tsx) hay dist/ (node) đều lùi 1 cấp là tới.
const apiRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');

function readPkgVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, 'data'));

export const config = {
  port: Number(process.env.PORT ?? 3002),
  host: process.env.HOST ?? '0.0.0.0',
  isProd: process.env.NODE_ENV === 'production',
  dataDir,
  dbFile: path.join(dataDir, 'db.sqlite'),
  uploadsDir: path.join(dataDir, 'uploads'),
  backupsDir: path.join(dataDir, 'backups'),
  updateDir: path.join(dataDir, 'update'),
  configDir: path.join(dataDir, 'config'),
  tmpDir: path.join(dataDir, 'tmp'),
  webDist: process.env.WEB_DIST ?? path.join(repoRoot, 'apps/web/dist'),
  migrationsDir: process.env.MIGRATIONS_DIR ?? path.join(apiRoot, 'drizzle'),
  assetsDir: path.join(apiRoot, 'assets'),
  gotenbergUrl: (process.env.GOTENBERG_URL ?? '').replace(/\/$/, ''),
  githubRepo: process.env.GITHUB_REPO ?? 'happysmartlight/car-rental',
  version: process.env.APP_VERSION || readPkgVersion(),
  commit: process.env.GIT_SHA ?? '',
  buildTime: process.env.BUILD_TIME ?? '',
  publicUrl: process.env.PUBLIC_URL ?? '',
};

for (const dir of [config.dataDir, config.uploadsDir, config.backupsDir, config.updateDir, config.configDir, config.tmpDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
