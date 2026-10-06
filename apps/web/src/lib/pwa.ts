// PWA: đăng ký service worker + phát hiện bản mới trên máy chủ.
//
// Nguồn phát hiện chính là /api/version: lúc app nạp, nhớ "dấu vân tay" bản
// đang chạy; sau đó định kỳ (và mỗi khi quay lại app) hỏi lại máy chủ. Khác
// nhau → có bản mới → hiện banner "Bấm để tải lại". Không dựa vào SW cache
// vì iOS PWA hay giữ SW cũ rất lâu.

import { useEffect, useState } from 'react';

interface VersionInfo {
  version: string;
  commit: string;
  buildTime: string;
}

const fp = (v: VersionInfo) => `${v.version}|${v.commit}|${v.buildTime}`;

let bootFingerprint: string | null = null;
export let bootVersion: VersionInfo | null = null;

async function fetchVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as VersionInfo) : null;
  } catch {
    return null;
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* không có SW vẫn chạy bình thường */
    });
  });
}

export function useUpdateAvailable(): { available: VersionInfo | null; reload: () => void } {
  const [available, setAvailable] = useState<VersionInfo | null>(null);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      const v = await fetchVersion();
      if (!v || stopped) return;
      if (!bootFingerprint) {
        bootFingerprint = fp(v);
        bootVersion = v;
        return;
      }
      if (fp(v) !== bootFingerprint) setAvailable(v);
    };
    void check();
    const t = setInterval(check, 5 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  return { available, reload: reloadIntoNewVersion };
}

/** Bỏ cache SW cũ rồi tải lại → lấy index.html + asset mới. */
export async function reloadIntoNewVersion() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.update().catch(() => undefined)));
    const keys = await caches?.keys();
    await Promise.all((keys ?? []).map((k) => caches.delete(k)));
  } catch {
    /* bỏ qua */
  }
  window.location.reload();
}

/** Chờ máy chủ chạy bản `target` (dùng sau khi bấm cập nhật). Chịu được lúc máy chủ đang khởi động lại. */
export async function waitForVersion(target: string, onTick?: (msg: string) => void, timeoutMs = 10 * 60_000): Promise<boolean> {
  const start = Date.now();
  let sawDown = false;
  while (Date.now() - start < timeoutMs) {
    const v = await fetchVersion();
    if (!v) {
      sawDown = true;
      onTick?.('Máy chủ đang khởi động lại…');
    } else if (v.version === target) {
      return true;
    } else {
      onTick?.(sawDown ? 'Đang chờ bản mới khởi động…' : 'Đang tải bản mới…');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
