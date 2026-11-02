import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Plus, ScanLine, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CustomerForm } from '@/pages/customers/CustomerForm';
import { Avatar } from '@/pages/customers/CustomersList';
import { api, qs } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import type { Customer } from '@/lib/types';
import { cn } from '@/lib/utils';
import { unaccent } from '@shared/text';
import { fmtDate } from '@shared/time';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input, Segmented } from './ui/form';
import { Badge, Spinner } from './ui/misc';

type ListedCustomer = Customer & { rentalCount: number; lastRentalAt: number | null };

/** Danh bạ lấy tối đa chừng này khách (sửa gần nhất trước); nhiều hơn thì gõ tên để tìm. */
const BOOK_LIMIT = 200;

/** Tên gọi (chữ cuối của họ tên) — danh bạ điện thoại Việt xếp theo tên, không theo họ. */
const givenName = (fullName: string) => fullName.trim().split(/\s+/).pop() ?? fullName;

/** Chữ cái nhóm trong danh bạ: bỏ dấu, riêng Đ giữ nguyên. */
function letterOf(fullName: string): string {
  const ch = givenName(fullName).charAt(0).toUpperCase();
  return ch === 'Đ' ? 'Đ' : ch.normalize('NFD').replace(/[̀-ͯ]/g, '') || '#';
}

function CustomerRow({ c, sub, onPick }: { c: Customer; sub: string; onPick: () => void }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onPick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-hover">
      <Avatar name={c.fullName} fileId={c.portraitFileId} size="size-8" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {c.fullName} {c.blacklisted && <span className="text-red-600 dark:text-red-400">· danh sách đen</span>}
        </span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
    </button>
  );
}

/** Chọn khách: tìm theo tên/SĐT/CCCD, lướt danh bạ khách, hoặc quét CCCD tạo mới ngay tại chỗ. */
export function CustomerPicker({ value, onChange, placeholder = 'Tìm khách: tên, SĐT, CCCD…', exclude = [] }: { value: Customer | null; onChange: (c: Customer | null) => void; placeholder?: string; exclude?: number[] }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [creating, setCreating] = useState<'scan' | 'manual' | null>(null);
  // Danh bạ: nhiều khi không nhớ tên khách, lướt qua là nhận ra.
  const [book, setBook] = useState(false);
  const [order, setOrder] = useState<'az' | 'recent'>('az');
  const dq = useDebounced(q.trim(), 200);
  const { data, isFetching } = useQuery({
    queryKey: ['customers', 'pick', dq],
    queryFn: () => api.get<{ items: Customer[] }>(`/api/customers${qs({ q: dq, limit: 8 })}`),
    enabled: focused && !book && dq.length > 0,
  });
  const items = (data?.items ?? []).filter((c) => !exclude.includes(c.id));
  const { data: all, isFetching: loadingBook } = useQuery({
    queryKey: ['customers', 'book'],
    queryFn: () => api.get<{ total: number; items: ListedCustomer[] }>(`/api/customers${qs({ limit: BOOK_LIMIT })}`),
    enabled: book,
    staleTime: 60_000,
  });
  const groups = useMemo(() => {
    const term = unaccent(q.trim());
    const list = (all?.items ?? []).filter((c) => !exclude.includes(c.id) && (!term || unaccent(`${c.fullName} ${c.phone ?? ''} ${c.idNumber ?? ''}`).includes(term)));
    if (order === 'recent') {
      list.sort((a, b) => (b.lastRentalAt ?? 0) - (a.lastRentalAt ?? 0));
      return [{ key: '', items: list }];
    }
    list.sort((a, b) => givenName(a.fullName).localeCompare(givenName(b.fullName), 'vi') || a.fullName.localeCompare(b.fullName, 'vi'));
    const out: { key: string; items: ListedCustomer[] }[] = [];
    for (const c of list) {
      const key = letterOf(c.fullName);
      if (out.at(-1)?.key !== key) out.push({ key, items: [] });
      out.at(-1)!.items.push(c);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, order, exclude.join(',')]);
  const pick = (c: Customer) => {
    onChange(c);
    setQ('');
    setBook(false);
  };

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

  const shown = groups.reduce((s, g) => s + g.items.length, 0);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 200)} placeholder={placeholder} className="pl-9" />
          {(isFetching || loadingBook) && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
          {focused && !book && dq && (
            <div className="anim-fade absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-border-strong bg-popover p-1 shadow-pop">
              {items.length ? (
                items.map((c) => <CustomerRow key={c.id} c={c} sub={[c.phone, c.idNumber].filter(Boolean).join(' · ')} onPick={() => pick(c)} />)
              ) : (
                <p className="px-3 py-3 text-sm text-muted">{isFetching ? 'Đang tìm…' : 'Không thấy — thêm khách mới bên dưới'}</p>
              )}
            </div>
          )}
        </div>
        <Button variant={book ? 'primary' : 'secondary'} size="icon" className="size-11 shrink-0 md:size-10" onClick={() => setBook(!book)} aria-label="Danh sách khách" aria-expanded={book}>
          <ChevronDown className={cn('transition-transform', book && 'rotate-180')} />
        </Button>
      </div>
      {book && (
        <div className="anim-fade overflow-hidden rounded-2xl border border-border-strong bg-popover shadow-pop">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs text-muted">{all ? `${shown} khách${q.trim() ? ` khớp "${q.trim()}"` : ''}` : 'Đang tải…'}</span>
            <Segmented
              value={order}
              onChange={setOrder}
              options={[
                { value: 'az', label: 'A–Z' },
                { value: 'recent', label: 'Thuê gần đây' },
              ]}
            />
          </div>
          <div className="max-h-80 overflow-y-auto overscroll-contain p-1">
            {groups.map((g) => (
              <div key={g.key || 'all'}>
                {g.key && <p className="sticky top-0 z-10 bg-popover px-3 pt-2 pb-1 text-xs font-semibold text-muted">{g.key}</p>}
                {g.items.map((c) => (
                  <CustomerRow
                    key={c.id}
                    c={c}
                    sub={[c.phone, c.rentalCount ? `${c.rentalCount} lượt` : 'Chưa thuê', c.lastRentalAt && `gần nhất ${fmtDate(c.lastRentalAt)}`].filter(Boolean).join(' · ')}
                    onPick={() => pick(c)}
                  />
                ))}
              </div>
            ))}
            {all && !shown && <p className="px-3 py-3 text-sm text-muted">Không có khách nào — thêm khách mới bên dưới</p>}
            {all && all.total > BOOK_LIMIT && <p className="px-3 py-2 text-xs text-subtle">Danh sách gồm {BOOK_LIMIT} khách cập nhật gần nhất — gõ tên để tìm khách cũ hơn.</p>}
          </div>
        </div>
      )}
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
