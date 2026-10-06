// Quét mã QR trên CCCD gắn chip / thẻ Căn cước bằng camera điện thoại.
// Giải mã ngay trên máy (WebAssembly), ảnh không gửi đi đâu.

import { ImageUp, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { parseCccdQr, type CccdData } from '@shared/cccd';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Notice } from './ui/misc';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

const OPTS = { formats: ['QRCode' as const], tryHarder: true, maxNumberOfSymbols: 1 };

export function CccdScanner({ open, onOpenChange, onResult }: { open: boolean; onOpenChange: (o: boolean) => void; onResult: (d: CccdData, raw: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    setError(null);
    setHint(null);

    const scan = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        // Cắt vùng giữa khung hình — nhanh hơn và khớp khung ngắm.
        const side = Math.min(v.videoWidth, v.videoHeight) * 0.8;
        canvas.width = side;
        canvas.height = side;
        ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
        try {
          const [res] = await readBarcodes(ctx.getImageData(0, 0, side, side), OPTS);
          if (res?.text) {
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
    setHint('Đang đọc ảnh…');
    try {
      const [res] = await readBarcodes(file, OPTS);
      const parsed = res?.text ? parseCccdQr(res.text) : null;
      if (parsed && res) {
        onResult(parsed, res.text);
        onOpenChange(false);
      } else setHint('Không tìm thấy QR căn cước trong ảnh. Chụp gần, rõ góc QR.');
    } catch {
      setHint('Không đọc được ảnh');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Quét QR căn cước" description="Đưa mã QR ở mặt trước thẻ vào giữa khung" size="md">
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
        <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
          <ImageUp /> Chọn ảnh chụp QR có sẵn
        </Button>
      </div>
    </Dialog>
  );
}
