// Phía app của cơ chế cập nhật.
//
// App KHÔNG tự cập nhật được chính nó (đang chạy trong container). Việc kéo image
// mới / khởi động lại do container `car-rental-updater` làm (deploy/updater.sh).
// Hai bên nói chuyện qua file trong data/update/:
//   request.env  app → updater   (id, action, target, backup, compose, script)
//   state.env    updater → app   (heartbeat, phase, result, message, current…)
//   log.txt      updater → app   (log lần chạy gần nhất)
//   staged/<v>/  file docker-compose.yml + updater.sh của bản sắp cài (app tải về)
//
// Định dạng key=value thay vì JSON để script sh không cần jq.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { conflict } from './http.js';
import { getLocalConfig, updateLocalConfig, type ReleaseInfo } from './localConfig.js';

const reqFile = () => path.join(config.updateDir, 'request.env');
const stateFile = () => path.join(config.updateDir, 'state.env');
const logFile = () => path.join(config.updateDir, 'log.txt');

export interface UpdaterState {
  alive: boolean;
  heartbeat: number | null;
  phase: string;
  requestId: string | null;
  result: string | null;
  message: string | null;
  current: string | null;
  previous: string | null;
  finishedAt: number | null;
  scriptVersion: string | null;
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function readUpdaterState(): UpdaterState {
  let kv: Record<string, string> = {};
  try {
    kv = parseEnv(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    /* chưa có updater */
  }
  const hb = kv.heartbeat ? Number(kv.heartbeat) * 1000 : null;
  return {
    alive: hb != null && Date.now() - hb < 45_000,
    heartbeat: hb,
    phase: kv.phase || 'unknown',
    requestId: kv.request_id || null,
    result: kv.result || null,
    message: kv.message || null,
    current: kv.current || null,
    previous: kv.previous || null,
    finishedAt: kv.finished_at ? Number(kv.finished_at) * 1000 : null,
    scriptVersion: kv.script_version || null,
  };
}

export function readUpdaterLog(maxLines = 200): string {
  try {
    const lines = fs.readFileSync(logFile(), 'utf8').split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

export function pendingRequest(): Record<string, string> | null {
  try {
    return parseEnv(fs.readFileSync(reqFile(), 'utf8'));
  } catch {
    return null;
  }
}

const SAFE = /^[A-Za-z0-9._\-/]+$/;

export interface UpdaterRequest {
  action: 'update' | 'restart';
  target?: string;
  /** Bản sao lưu trước cập nhật — updater khôi phục nếu bản mới khởi động lỗi. */
  backup?: string;
  /** Khôi phục bản sao lưu này TRƯỚC khi chạy bản đích (quay về kèm dữ liệu). */
  restore?: string;
  compose?: string;
  script?: string;
}

export function writeUpdaterRequest(req: UpdaterRequest): string {
  const state = readUpdaterState();
  if (!state.alive) throw conflict('Dịch vụ cập nhật (car-rental-updater) không chạy. Xem hướng dẫn trong trang Cập nhật.', 'updater_down');
  if (pendingRequest()) throw conflict('Đang có một yêu cầu cập nhật chờ xử lý', 'busy');
  if (!['idle', 'done', 'failed', 'rolled_back', 'unknown'].includes(state.phase)) throw conflict('Đang cập nhật, vui lòng chờ', 'busy');
  const id = crypto.randomUUID();
  const lines = [`id=${id}`, `action=${req.action}`];
  for (const [k, v] of Object.entries({ target: req.target, backup: req.backup, restore: req.restore, compose: req.compose, script: req.script })) {
    if (!v) continue;
    if (!SAFE.test(v) || v.includes('..')) throw new Error(`Giá trị không hợp lệ cho ${k}`);
    lines.push(`${k}=${v}`);
  }
  const tmp = `${reqFile()}.tmp`;
  fs.writeFileSync(tmp, `${lines.join('\n')}\n`, { mode: 0o664 });
  fs.renameSync(tmp, reqFile());
  return id;
}

// ── Kiểm tra bản mới trên GitHub Releases ──────────────────────────────────

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

export async function checkReleases(): Promise<ReleaseInfo[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/releases?per_page=30`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'car-rental-app' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(res.status === 404 ? 'Chưa có bản phát hành nào trên GitHub' : `GitHub trả lỗi HTTP ${res.status}`);
    const data = (await res.json()) as { tag_name: string; name: string; body: string; published_at: string; prerelease: boolean; draft: boolean; html_url: string }[];
    const releases = data
      .filter((r) => !r.draft && /^v?\d+\.\d+\.\d+/.test(r.tag_name))
      .map((r) => ({
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        notes: r.body ?? '',
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        url: r.html_url,
      }))
      .sort((a, b) => compareVersions(b.version, a.version));
    updateLocalConfig((c) => {
      c.update.releases = releases;
      c.update.lastCheckAt = Date.now();
      c.update.lastCheckError = undefined;
    });
    return releases;
  } catch (err) {
    updateLocalConfig((c) => {
      c.update.lastCheckAt = Date.now();
      c.update.lastCheckError = (err as Error).message;
    });
    throw err;
  }
}

export function latestRelease(): ReleaseInfo | null {
  const rel = (getLocalConfig().update.releases ?? []).filter((r) => !r.prerelease);
  return rel[0] ?? null;
}

export function updateAvailable(): ReleaseInfo | null {
  const latest = latestRelease();
  return latest && compareVersions(latest.version, config.version) > 0 ? latest : null;
}

/**
 * Tải docker-compose.yml + updater.sh của bản đích về data/update/staged/<v>/.
 * Không tải được (repo riêng tư, mất mạng) → trả null, updater giữ file hiện có.
 */
export async function stageDeployFiles(version: string): Promise<{ compose?: string; script?: string }> {
  const dir = path.join(config.updateDir, 'staged', version);
  fs.mkdirSync(dir, { recursive: true });
  const out: { compose?: string; script?: string } = {};
  const files: [keyof typeof out, string, string][] = [
    ['compose', 'deploy/docker-compose.yml', 'docker-compose.yml'],
    ['script', 'deploy/updater.sh', 'updater.sh'],
  ];
  for (const [key, remote, local] of files) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${config.githubRepo}/v${version}/${remote}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (key === 'compose' && !/services:/.test(text)) continue;
      if (key === 'script' && !text.startsWith('#!/bin/sh')) continue;
      fs.writeFileSync(path.join(dir, local), text);
      out[key] = `update/staged/${version}/${local}`;
    } catch {
      /* bỏ qua, dùng file hiện có */
    }
  }
  return out;
}
