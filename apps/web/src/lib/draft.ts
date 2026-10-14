// Nháp form lưu trên chính máy này (localStorage): iPhone hay tải lại trang khi mở camera nhiều lần,
// có cuộc gọi đến hoặc app bị tắt dưới nền — mở lại vẫn còn những gì đang nhập dở.
// Nháp không gửi đi đâu; gửi form thành công thì xóa.

import { useEffect, useRef } from 'react';

const PREFIX = 'draft:';

export interface Draft<T> {
  savedAt: number;
  data: T;
}

/** Đọc nháp; quá hạn thì xóa luôn. Bộ nhớ trình duyệt bị chặn (chế độ riêng tư) → null. */
export function loadDraft<T>(key: string, maxAgeMs: number): Draft<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft<T>;
    if (!d || typeof d.savedAt !== 'number' || Date.now() - d.savedAt > maxAgeMs) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* hết chỗ / bị chặn: bỏ qua, form vẫn chạy bình thường */
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* bỏ qua */
  }
}

/**
 * Tự lưu nháp khi dữ liệu đổi (chờ 300 ms), và lưu ngay khi app bị ẩn (mở camera, chuyển app) —
 * lúc đó iOS có thể tắt trang bất cứ lúc nào.
 */
export function useDraftAutosave<T>(key: string, data: T, enabled: boolean): void {
  const latest = useRef({ key, data, enabled });
  latest.current = { key, data, enabled };
  const json = JSON.stringify(data);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => saveDraft(key, data), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, json, enabled]);

  useEffect(() => {
    const save = () => {
      const l = latest.current;
      if (l.enabled) saveDraft(l.key, l.data);
    };
    const onVisibility = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
    };
  }, []);
}

/** Blob (chữ ký) ↔ data URL để lưu được trong nháp. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}
