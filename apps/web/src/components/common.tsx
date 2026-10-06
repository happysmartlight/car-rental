import { Download, Eraser } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { BLOCK_KIND_LABEL, FINE_STATUS, RENTAL_STATUS, type BlockKind, type FineStatus, type RentalStatus } from '@shared/constants';
import { fmtVnd } from '@shared/text';
import { buildVietQrPayload } from '@shared/vietqr';
import { useSettings } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge, Notice } from './ui/misc';

export function RentalStatusBadge({ status, overdue }: { status: RentalStatus; overdue?: boolean }) {
  if (overdue && status === 'active') return <Badge tone="red" dot>Quá hạn trả</Badge>;
  const s = RENTAL_STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function FineStatusBadge({ status }: { status: FineStatus }) {
  const s = FINE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function VehicleStateBadge({ state, blockKind }: { state: 'rented' | 'blocked' | 'available' | 'inactive'; blockKind?: BlockKind }) {
  if (state === 'rented') return <Badge tone="violet" dot>Đang cho thuê</Badge>;
  if (state === 'blocked') return <Badge tone="amber" dot>{blockKind ? BLOCK_KIND_LABEL[blockKind] : 'Tạm ngưng'}</Badge>;
  if (state === 'inactive') return <Badge tone="gray">Ngưng hoạt động</Badge>;
  return <Badge tone="green" dot>Sẵn sàng</Badge>;
}

export function Money({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  return <span className={cn('tabular', signed && value < 0 && 'text-emerald-600 dark:text-emerald-400', className)}>{fmtVnd(value)}</span>;
}

/** QR chuyển khoản đúng số tiền + nội dung, theo tài khoản trong Cài đặt. */
export function VietQr({ amount, note, className }: { amount: number; note: string; className?: string }) {
  const { data } = useSettings();
  const [url, setUrl] = useState<string | null>(null);
  const biz = data?.business;
  const ok = !!(biz?.bankBin && biz.bankAccount);
  useEffect(() => {
    if (!ok || !biz) return;
    const payload = buildVietQrPayload({ bin: biz.bankBin, accountNumber: biz.bankAccount, amount, note });
    QRCode.toDataURL(payload, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setUrl);
  }, [ok, biz, amount, note]);
  if (!ok) return <Notice tone="amber">Chưa có tài khoản ngân hàng. Vào Cài đặt → Cửa hàng để nhập số tài khoản và ngân hàng, app sẽ tự tạo mã VietQR.</Notice>;
  const bank = data?.banks.find((b) => b.bin === biz!.bankBin);
  return (
    <div className={cn('flex flex-col items-center rounded-2xl border border-border bg-white p-4 text-center text-slate-900', className)}>
      {url && <img src={url} alt="Mã VietQR" className="size-56" />}
      <p className="mt-2 text-2xl font-bold tabular">{fmtVnd(amount)}</p>
      <p className="mt-1 text-sm">
        {bank?.name ?? biz!.bankName} · <span className="font-semibold">{biz!.bankAccount}</span>
      </p>
      <p className="text-sm uppercase">{biz!.bankAccountName}</p>
      <p className="mt-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs">{note}</p>
      {url && (
        <a href={url} download={`vietqr-${note}.png`} className="mt-3 flex items-center gap-1.5 text-sm text-blue-600">
          <Download className="size-4" /> Lưu ảnh QR
        </a>
      )}
    </div>
  );
}

/** Khung ký tên bằng ngón tay / bút. Trả về PNG blob. */
export function SignaturePad({ onChange, className }: { onChange: (blob: Blob | null) => void; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0e1420';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    canvas.current!.toBlob((b) => onChange(b), 'image/png');
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className={className}>
      <div className="relative rounded-2xl border-2 border-dashed border-border-strong bg-white">
        <canvas
          ref={canvas}
          className="h-44 w-full touch-none"
          onPointerDown={(e) => {
            drawing.current = true;
            const ctx = canvas.current!.getContext('2d')!;
            const p = pos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            canvas.current!.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext('2d')!;
            const p = pos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            if (empty) setEmpty(false);
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Khách ký vào đây</p>}
      </div>
      <Button variant="ghost" size="sm" className="mt-1" onClick={clear}>
        <Eraser /> Ký lại
      </Button>
    </div>
  );
}

/** Thanh mức xăng / pin theo vạch (8 vạch). */
export function FuelGauge({ value, onChange, readOnly }: { value: number; onChange?: (v: number) => void; readOnly?: boolean }) {
  const bars = 8;
  const filled = Math.round((value / 100) * bars);
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1">
        {Array.from({ length: bars }, (_, i) => (
          <button
            key={i}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(Math.round(((i + 1) / bars) * 100))}
            className={cn('h-8 flex-1 rounded-md transition-colors', i < filled ? (filled <= 2 ? 'bg-red-500' : filled <= 4 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-surface-3', !readOnly && 'hover:opacity-80')}
            aria-label={`${Math.round(((i + 1) / bars) * 100)}%`}
          />
        ))}
      </div>
      <span className="tabular w-12 text-right text-sm font-semibold">{value}%</span>
    </div>
  );
}
