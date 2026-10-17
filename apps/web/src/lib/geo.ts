// Vị trí GPS lúc giao / nhận xe để đóng dấu lên ảnh. Cần mở app qua HTTPS (Tailscale) và cho phép vị trí.
// Không lấy từ EXIF: iPhone bỏ tọa độ khỏi ảnh chụp qua trình duyệt.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GeoFix {
  lat: number;
  lng: number;
  /** Sai số (mét). */
  accuracy: number;
  at: number;
}

export type GeoState = { status: 'locating' } | { status: 'ok'; fix: GeoFix } | { status: 'denied' } | { status: 'unavailable' } | { status: 'insecure' };

/** Đứng yên thì máy ít báo vị trí mới → tọa độ lấy trong vòng chừng này vẫn dùng được. */
const MAX_AGE = 10 * 60_000;

export function useGeolocation(enabled: boolean) {
  const [state, setState] = useState<GeoState>({ status: 'locating' });
  const last = useRef<GeoFix | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!window.isSecureContext) return setState({ status: 'insecure' });
    if (!('geolocation' in navigator)) return setState({ status: 'unavailable' });
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
        last.current = fix;
        setState({ status: 'ok', fix });
      },
      (err) => {
        // Đã có vị trí mà lỗi tạm (mất sóng trong hầm xe…) thì giữ vị trí cũ.
        if (last.current && err.code !== err.PERMISSION_DENIED) return;
        last.current = null;
        setState({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  /** Tọa độ để đóng dấu lúc này (null nếu chưa có / quá cũ). */
  const current = useCallback(() => (last.current && Date.now() - last.current.at <= MAX_AGE ? last.current : null), []);
  return { state, current };
}

/** "GPS 10.77689, 106.70081 (±12m)" — cặp số tọa độ dán vào Google Maps là ra chỗ. */
export function fmtGeo(f: GeoFix): string {
  return `GPS ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} (±${Math.round(f.accuracy)}m)`;
}
