import { useQuery } from '@tanstack/react-query';
import { Plus, ScanLine, Search, X } from 'lucide-react';
import { useState } from 'react';
import { CustomerForm } from '@/pages/customers/CustomerForm';
import { Avatar } from '@/pages/customers/CustomersList';
import { api, qs } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import type { Customer } from '@/lib/types';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/form';
import { Badge, Spinner } from './ui/misc';

/** Chọn khách: tìm theo tên/SĐT/CCCD, hoặc quét CCCD tạo mới ngay tại chỗ. */
export function CustomerPicker({ value, onChange, placeholder = 'Tìm khách: tên, SĐT, CCCD…', exclude = [] }: { value: Customer | null; onChange: (c: Customer | null) => void; placeholder?: string; exclude?: number[] }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [creating, setCreating] = useState<'scan' | 'manual' | null>(null);
  const dq = useDebounced(q.trim(), 200);
  const { data, isFetching } = useQuery({
    queryKey: ['customers', 'pick', dq],
    queryFn: () => api.get<{ items: Customer[] }>(`/api/customers${qs({ q: dq, limit: 8 })}`),
    enabled: focused && dq.length > 0,
  });
  const items = (data?.items ?? []).filter((c) => !exclude.includes(c.id));

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2/50 p-3">
        <Avatar name={value.fullName} fileId={value.portraitFileId} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-medium">
            {value.fullName} {value.blacklisted && <Badge tone="red">Danh sách đen</Badge>}
          </p>
          <p className="truncate text-sm text-muted">{[value.phone, value.idNumber && `CCCD ${value.idNumber}`].filter(Boolean).join(' · ')}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Đổi khách">
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 200)} placeholder={placeholder} className="pl-9" />
        {isFetching && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
        {focused && dq && (
          <div className="anim-fade absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-border-strong bg-popover p-1 shadow-pop">
            {items.length ? (
              items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(c);
                    setQ('');
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-hover"
                >
                  <Avatar name={c.fullName} fileId={c.portraitFileId} size="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {c.fullName} {c.blacklisted && <span className="text-red-600 dark:text-red-400">· danh sách đen</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{[c.phone, c.idNumber].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-muted">{isFetching ? 'Đang tìm…' : 'Không thấy — thêm khách mới bên dưới'}</p>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setCreating('scan')}>
          <ScanLine /> Quét CCCD
        </Button>
        <Button variant="secondary" onClick={() => setCreating('manual')}>
          <Plus /> Nhập tay
        </Button>
      </div>
      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} title="Thêm khách mới" size="lg">
        {creating && (
          <CustomerForm
            compact
            autoScan={creating === 'scan'}
            submitLabel="Lưu & chọn khách này"
            onPickExisting={(c) => {
              onChange(c);
              setCreating(null);
            }}
            onSaved={(c) => {
              onChange(c);
              setCreating(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
