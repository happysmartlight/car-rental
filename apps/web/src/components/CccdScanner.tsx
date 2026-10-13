// Quét mã QR trên CCCD gắn chip / thẻ Căn cước bằng camera điện thoại.
// Giải mã ngay trên máy (WebAssembly), ảnh không gửi đi đâu.

import { ImageUp, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseCccdQr, type CccdData, type CccdOcrData } from '@shared/cccd';
import { grab, readCccdImage, readQr } from '@/lib/cccdPhoto';
import { applyQrFilter, QR_PASSES } from '@/lib/qrImage';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Notice } from './ui/misc';

export function CccdScanner({
  open,
  onOpenChange,
  onResult,
  onOcr,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** `portrait`: ảnh chân dung cắt từ ảnh thẻ (chỉ khi chọn ảnh mặt trước CCCD gắn chip). */
  onResult: (d: CccdData, raw: string, portrait?: Blob | null) => void;
  /** Ảnh chọn không đọc được QR → đọc chữ trên thẻ (OCR). Không truyền thì chỉ đọc QR. */
  onOcr?: (d: CccdOcrData) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;
    const canvas = document.createElement('canvas');
    setError(null);
    setHint(null);

    const scan = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        // Cắt vùng giữa khung hình — nhanh hơn và khớp khung ngắm. Mỗi khung hình thử một cách xử lý ảnh.
        const side = Math.min(v.videoWidth, v.videoHeight) * 0.8;
        const { scale, filter } = QR_PASSES[frame++ % QR_PASSES.length];
        try {
          const img = grab(canvas, v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, scale);
          applyQrFilter(img, filter);
          const res = await readQr(img);
          if (res) {
            const parsed = parseCccdQr(res.text);
            if (parsed) {
              navigator.vibrate?.(80);
              onResult(parsed, res.text);
              onOpenChange(false);
              return;
            }
            setHint('Đọc được mã QR nhưng không phải QR căn cước');
          }
        } catch {
          /* khung hình lỗi, thử khung sau */
        }
      }
      timer = setTimeout(scan, 250);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stopped) return;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        }
        void scan();
      } catch (err) {
        setError(
          window.isSecureContext
            ? 'Không mở được camera. Cho phép quyền camera trong cài đặt trình duyệt, hoặc dùng nút "Chọn ảnh".'
            : 'Camera chỉ hoạt động qua HTTPS. Mở app bằng địa chỉ https://… của Tailscale, hoặc dùng nút "Chọn ảnh".',
        );
        console.warn(err);
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onOpenChange, onResult]);

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    setHint('Đang đọc ảnh…');
    setBusy(true);
    try {
      const r = await readCccdImage(file, { ocr: !!onOcr, onOcrStart: () => setHint('Không đọc được QR — đang đọc chữ trên thẻ…') });
      if (r?.source === 'qr') onResult(r.data, r.text, r.portrait);
      else if (r) onOcr?.(r.data);
      if (r) onOpenChange(false);
      else setHint(onOcr ? 'Không đọc được QR lẫn chữ trên ảnh. Chụp mặt trước thẻ gần, đủ sáng, không lóa.' : 'Không tìm thấy QR căn cước trong ảnh. Chụp gần, rõ góc QR.');
    } catch {
      setHint('Không đọc được ảnh');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Quét QR căn cước" description="Đưa mã QR vào giữa khung — CCCD gắn chip: mặt trước; thẻ Căn cước (từ 7/2024): mặt sau" size="md">
      <div className="space-y-3">
        {error ? (
          <Notice tone="amber">{error}</Notice>
        ) : (
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-black">
            <video ref={video} playsInline muted className="size-full object-cover" />
            <div className="pointer-events-none absolute inset-[10%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]">
              <ScanLine className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 animate-pulse text-white/80" />
            </div>
          </div>
        )}
        {hint && <p className="text-center text-sm text-muted">{hint}</p>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void fromFile(e.target.files?.[0])} />
        <Button variant="outline" className="w-full" loading={busy} onClick={() => fileRef.current?.click()}>
          <ImageUp /> Chụp / chọn ảnh thẻ
        </Button>
        {onOcr && <p className="text-center text-xs text-muted">Không quét được QR? Chụp mặt trước thẻ — app sẽ đọc chữ trên thẻ.</p>}
      </div>
    </Dialog>
  );
}
