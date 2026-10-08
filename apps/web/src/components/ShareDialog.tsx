// Hộp chia sẻ gửi khách: xem trước ảnh, chọn thông tin hiển thị, gửi ảnh hoặc tin nhắn.
// `ShareSheet` là khung chung (bảng giá xe, phiếu giao/nhận xe, quyết toán).

import { Copy, Download, ImageIcon, MessageSquareText, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth, useSettings } from '@/lib/hooks';
import {
  DEFAULT_SHARE_OPTIONS,
  downloadBlob,
  fleetShareText,
  renderFleetCard,
  renderVehicleCard,
  shareImage,
  shareText,
  vehicleShareText,
  type ShareOptions,
  type ShareVehicle,
} from '@/lib/shareCard';
import { errorMessage } from '@/lib/utils';
import { vehicleChargingPolicy } from '@shared/pricing';
import { plateKey } from '@shared/text';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Checkbox, Segmented } from './ui/form';
import { Notice, Spinner } from './ui/misc';

/** Tùy chọn hiển thị nhớ theo máy (localStorage), mỗi loại phiếu một khóa. */
export function useShareOptions<T extends object>(key: string, defaults: T) {
  const [opt, setOpt] = useState<T>(() => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
    } catch {
      return defaults;
    }
  });
  const setOption = (k: keyof T, v: boolean) => {
    const next = { ...opt, [k]: v };
    setOpt(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* bỏ qua */
    }
  };
  return [opt, setOption] as const;
}

export function ShareSheet({
  open,
  onOpenChange,
  title,
  description = 'Gửi khách qua Zalo, Messenger… Khách không cần vào app.',
  imageTab = 'Ảnh',
  filename,
  text,
  render,
  renderKey,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  imageTab?: string;
  filename: string;
  text: string;
  /** null = chưa đủ dữ liệu để vẽ. */
  render: (() => Promise<Blob>) | null;
  /** Vẽ lại ảnh khi khóa này đổi (trang cha tạo hàm mới mỗi lần render). */
  renderKey: string;
  /** Tùy chọn hiển thị (ô tick, chọn giai đoạn…). */
  children?: ReactNode;
}) {
  const { data: settings } = useSettings();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'image' | 'text'>('image');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renderRef = useRef(render);
  renderRef.current = render;
  const ready = !!render;

  useEffect(() => {
    const draw = renderRef.current;
    if (!open || !draw) return;
    let cancelled = false;
    setRendering(true);
    setError(null);
    draw()
      .then((b) => {
        if (cancelled) return;
        setBlob(b);
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(b);
        });
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
    };
  }, [open, ready, renderKey]);

  const sendImage = async () => {
    if (!blob) return;
    const r = await shareImage(blob, filename);
    if (r === 'downloaded') toast.success('Đã tải ảnh về máy — gửi qua Zalo/Messenger như ảnh thường');
  };
  const sendText = async () => {
    try {
      const r = await shareText(text);
      if (r === 'copied') toast.success('Đã chép tin nhắn — dán vào Zalo');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Đã chép tin nhắn — dán vào Zalo');
    } catch {
      toast.error('Trình duyệt không cho chép. Chọn chữ rồi chép tay.');
    }
  };

  const biz = settings?.business;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      footer={
        tab === 'image' ? (
          <>
            <Button variant="outline" onClick={() => blob && downloadBlob(blob, filename)} disabled={!blob}>
              <Download /> Tải ảnh
            </Button>
            <Button onClick={sendImage} disabled={!blob}>
              <Share2 /> Gửi ảnh
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={copyText} disabled={!text}>
              <Copy /> Chép
            </Button>
            <Button onClick={sendText} disabled={!text}>
              <Share2 /> Gửi tin nhắn
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <Segmented
          value={tab}
          onChange={setTab}
          className="flex w-full"
          options={[
            { value: 'image', label: <span className="flex items-center justify-center gap-1.5"><ImageIcon className="size-4" /> {imageTab}</span> },
            { value: 'text', label: <span className="flex items-center justify-center gap-1.5"><MessageSquareText className="size-4" /> Tin nhắn chữ</span> },
          ]}
        />
        {children}
        {biz && !biz.phone && (
          <Notice tone="amber">
            Chưa có số điện thoại cửa hàng để khách liên hệ.{' '}
            {isAdmin ? (
              <Link to="/settings/business" className="font-medium underline">
                Nhập ở Cài đặt → Cửa hàng
              </Link>
            ) : (
              'Nhờ quản trị nhập ở Cài đặt → Cửa hàng.'
            )}
          </Notice>
        )}
        {tab === 'image' ? (
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-2">
            {url && <img src={url} alt={imageTab} className={rendering ? 'opacity-50' : ''} />}
            {(rendering || !url) && !error && (
              <div className="flex min-h-60 items-center justify-center">
                <Spinner className="size-7" />
              </div>
            )}
            {error && <Notice tone="red">{error}</Notice>}
          </div>
        ) : (
          <pre className="rounded-2xl border border-border bg-surface-2 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{text}</pre>
        )}
      </div>
    </Dialog>
  );
}

export function ShareDialog({ open, onOpenChange, vehicles, mode }: { open: boolean; onOpenChange: (o: boolean) => void; vehicles: ShareVehicle[]; mode: 'vehicle' | 'fleet' }) {
  const { data: settings } = useSettings();
  const [opt, setOption] = useShareOptions<ShareOptions>('share-options', DEFAULT_SHARE_OPTIONS);
  const hasCharging = vehicles.some((v) => vehicleChargingPolicy(v));
  const biz = settings?.business;
  const rules = settings?.rules;
  // So theo nội dung: trang cha tạo mảng mới mỗi lần render, không cần vẽ lại ảnh.
  const vkey = JSON.stringify(vehicles);
  const text = useMemo(() => {
    if (!biz || !rules || !vehicles.length) return '';
    return mode === 'vehicle' ? vehicleShareText(vehicles[0], biz, rules, opt) : fleetShareText(vehicles, biz, rules, opt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biz, rules, vkey, opt, mode]);
  const render =
    biz && rules && vehicles.length ? () => (mode === 'vehicle' ? renderVehicleCard(vehicles[0], biz, rules, opt) : renderFleetCard(vehicles, biz, rules, opt)) : null;

  return (
    <ShareSheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'vehicle' ? 'Chia sẻ thông tin xe' : 'Chia sẻ bảng giá cả đội xe'}
      imageTab="Ảnh bảng giá"
      filename={mode === 'vehicle' ? `bang-gia-${plateKey(vehicles[0]?.plate ?? 'xe').toLowerCase()}.jpg` : 'bang-gia-thue-xe.jpg'}
      text={text}
      render={render}
      renderKey={JSON.stringify([vkey, opt, mode, biz, rules])}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Checkbox checked={opt.extras} onChange={(v) => setOption('extras', v)} label="Giờ lẻ, km, trễ giờ" />
        <Checkbox checked={opt.deposit} onChange={(v) => setOption('deposit', v)} label="Tiền cọc" />
        <Checkbox checked={opt.highlights} onChange={(v) => setOption('highlights', v)} label="Tiện nghi" />
        <Checkbox checked={opt.note} onChange={(v) => setOption('note', v)} label="Ghi chú cửa hàng" />
        <Checkbox checked={opt.plate} onChange={(v) => setOption('plate', v)} label="Biển số" />
        {hasCharging && <Checkbox checked={opt.charging} onChange={(v) => setOption('charging', v)} label="Phí sạc (xe điện)" />}
      </div>
    </ShareSheet>
  );
}
