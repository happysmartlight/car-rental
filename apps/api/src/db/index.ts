import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import { unaccent } from '../shared/text.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let current: Db | null = null;

export function openDb(file = config.dbFile): void {
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('busy_timeout = 5000');
  // Tìm kiếm không dấu: WHERE unaccent(full_name) LIKE '%nguyen%'
  conn.function('unaccent', { deterministic: true }, (s: unknown) => (s == null ? null : unaccent(String(s))));
  const d = drizzle(conn, { schema });
  migrate(d, { migrationsFolder: config.migrationsDir });
  sqlite = conn;
  current = d;
}

export function closeDb(): void {
  if (sqlite) {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
  }
  sqlite = null;
  current = null;
}

/** Kết nối thô (VACUUM INTO, pragma…). */
export function rawDb(): Database.Database {
  if (!sqlite) throw new Error('Database chưa mở');
  return sqlite;
}

/**
 * Proxy để khôi phục backup có thể đóng/mở lại DB mà các module đã import `db`
 * không giữ tham chiếu cũ.
 */
export const db: Db = new Proxy({} as Db, {
  get(_t, key) {
    if (!current) throw new Error('Database chưa mở');
    const v = (current as unknown as Record<string | symbol, unknown>)[key];
    return typeof v === 'function' ? v.bind(current) : v;
  },
});

export function dbFileExists(): boolean {
  return fs.existsSync(config.dbFile);
}

export { schema };
