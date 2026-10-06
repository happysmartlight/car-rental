import { Camera, Download, ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { fileUrl, uploadFile } from '@/lib/api';
import { cn, errorMessage } from '@/lib/utils';
import { Dialog } from './ui/dialog';

/** Thu nhỏ ảnh trên máy trước khi gửi (nhanh hơn qua 4G/Tailscale, đổi luôn HEIC → JPEG). */
export async function compressImage(file: Blob, max = 2400, quality = 0.88): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function Thumb({ fileId, alt = '', className, onClick }: { fileId: string; alt?: string; className?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('group relative overflow-hidden rounded-xl bg-surface-2', className)}>
      <img src={fileUrl(fileId, { thumb: true })} alt={alt} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.03]" />
    </button>
  );
}

/** Lưới ảnh, bấm để xem to. */
export function Gallery({ items, className }: { items: { fileId: string; label?: string }[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return null;
  const cur = open != null ? items[open] : null;
  return (
    <>
      <div className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6', className)}>
        {items.map((it, i) => (
          <div key={it.fileId + i}>
            <Thumb fileId={it.fileId} alt={it.label} className="aspect-[4/3] w-full" onClick={() => setOpen(i)} />
            {it.label && <p className="mt-1 truncate text-xs text-muted">{it.label}</p>}
          </div>
        ))}
      </div>
      <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)} title={cur?.label ?? 'Ảnh'} size="xl">
        {cur && (
          <div className="space-y-3">
            <img src={fileUrl(cur.fileId)} alt={cur.label} className="max-h-[70dvh] w-full rounded-xl bg-surface-2 object-contain" />
            <div className="flex justify-between">
              <div className="flex gap-1">
                {items.map((_, i) => (
                  <button key={i} onClick={() => setOpen(i)} className={cn('size-2 rounded-full', i === open ? 'bg-brand' : 'bg-surface-3')} aria-label={`Ảnh ${i + 1}`} />
                ))}
              </div>
              <a href={fileUrl(cur.fileId, { download: true })} className="flex items-center gap-1.5 text-sm text-brand">
                <Download className="size-4" /> Tải về
              </a>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/**
 * Ô chụp/chọn 1 ảnh → tải lên → trả fileId.
 * `camera` = mở thẳng camera sau (giao/nhận xe); không thì cho chọn cả thư viện.
 */
export function PhotoInput({
  value,
  onChange,
  kind,
  label,
  stamp,
  camera,
  className,
  aspect = 'aspect-[4/3]',
}: {
  value: string | null | undefined;
  onChange: (fileId: string | null) => void;
  kind: string;
  label: string;
  stamp?: string | (() => string);
  camera?: boolean;
  className?: string;
  aspect?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file, kind.startsWith('id_') || kind.startsWith('license_') ? 2600 : 2000);
      const r = await uploadFile(blob, kind, { stamp: typeof stamp === 'function' ? stamp() : stamp, name: 'photo.jpg' });
      onChange(r.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <div className={className}>
      <input ref={ref} type="file" accept="image/*" capture={camera ? 'environment' : undefined} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <div className={cn('relative overflow-hidden rounded-xl border border-border bg-surface-2', aspect)}>
          <img src={fileUrl(value, { thumb: true })} alt={label} className="size-full cursor-zoom-in object-cover" onClick={() => setPreview(true)} />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 pt-6 pb-1.5">
            <span className="truncate text-xs font-medium text-white">{label}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => ref.current?.click()} className="rounded-lg bg-white/20 p-1.5 text-white backdrop-blur hover:bg-white/30" aria-label="Chụp lại">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
              </button>
              <button type="button" onClick={() => onChange(null)} className="rounded-lg bg-white/20 p-1.5 text-white backdrop-blur hover:bg-white/30" aria-label="Bỏ ảnh">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className={cn('flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border-strong bg-surface-2/50 text-muted transition-colors hover:border-brand hover:text-brand', aspect)}
        >
          {busy ? <Loader2 className="size-6 animate-spin" /> : camera ? <Camera className="size-6" /> : <ImagePlus className="size-6" />}
          <span className="px-2 text-center text-xs font-medium">{busy ? 'Đang tải lên…' : label}</span>
        </button>
      )}
      {value && (
        <Dialog open={preview} onOpenChange={setPreview} title={label} size="xl">
          <img src={fileUrl(value)} alt={label} className="max-h-[75dvh] w-full rounded-xl object-contain" />
        </Dialog>
      )}
    </div>
  );
}

/** Nhiều ảnh (ảnh thêm, ảnh tài sản thế chấp…). */
export function MultiPhotoInput({ value, onChange, kind, stamp, camera }: { value: string[]; onChange: (ids: string[]) => void; kind: string; stamp?: () => string; camera?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {value.map((id, i) => (
        <PhotoInput key={id} value={id} kind={kind} label={`Ảnh ${i + 1}`} onChange={(n) => onChange(n ? value.map((x) => (x === id ? n : x)) : value.filter((x) => x !== id))} />
      ))}
      <PhotoInput value={null} kind={kind} label="Thêm ảnh" camera={camera} stamp={stamp} onChange={(n) => n && onChange([...value, n])} />
    </div>
  );
}
