import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { Car, KeyRound, Search, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { RENTAL_STATUS, type RentalStatus } from '@shared/constants';
import { fmtDate } from '@shared/time';
import { api, qs } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';

interface SearchResult {
  customers: { id: number; fullName: string; phone: string | null; idNumber: string | null; blacklisted: boolean }[];
  vehicles: { id: number; plate: string; make: string; model: string }[];
  rentals: { id: number; code: string; status: RentalStatus; customer: string; plate: string; start: number }[];
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return { open, setOpen };
}

const PAGES = [
  { label: 'Đặt xe mới', to: '/rentals/new' },
  { label: 'Thêm khách (quét CCCD)', to: '/customers/new?scan=1' },
  { label: 'Tra phạt nguội', to: '/fines' },
  { label: 'Lịch xe', to: '/calendar' },
  { label: 'Danh sách xe', to: '/vehicles' },
  { label: 'Cài đặt', to: '/settings' },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['search', dq],
    queryFn: () => api.get<SearchResult>(`/api/search${qs({ q: dq })}`),
    enabled: open && dq.length >= 1,
    placeholderData: (prev) => prev,
  });
  const go = (to: string) => {
    onOpenChange(false);
    setQ('');
    navigate(to);
  };
  const item = 'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm data-[selected=true]:bg-surface-2';
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content className="anim-zoom fixed inset-x-3 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-pop md:top-[12vh]">
          <D.Title className="sr-only">Tìm nhanh</D.Title>
          <D.Description className="sr-only">Tìm khách, xe, lượt thuê</D.Description>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-muted" />
              <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Tên khách, SĐT, CCCD, biển số, mã HĐ…" className="h-13 flex-1 bg-transparent py-3 outline-none placeholder:text-subtle" />
            </div>
            <Command.List className="max-h-[60dvh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">{dq ? 'Không tìm thấy' : 'Gõ để tìm'}</Command.Empty>
              {!dq && (
                <Command.Group heading="Đi tới" className="text-xs text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {PAGES.map((p) => (
                    <Command.Item key={p.to} value={p.to} onSelect={() => go(p.to)} className={item}>
                      <span className="text-fg">{p.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!data?.customers.length && dq && (
                <Command.Group heading="Khách hàng" className="text-xs text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {data.customers.map((c) => (
                    <Command.Item key={`c${c.id}`} value={`c${c.id}`} onSelect={() => go(`/customers/${c.id}`)} className={item}>
                      <User className="size-4 text-muted" />
                      <span className="flex-1 text-fg">
                        {c.fullName} {c.blacklisted && <span className="text-red-600">· danh sách đen</span>}
                      </span>
                      <span className="text-xs text-muted">{c.phone ?? c.idNumber}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!data?.vehicles.length && dq && (
                <Command.Group heading="Xe" className="text-xs text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {data.vehicles.map((v) => (
                    <Command.Item key={`v${v.id}`} value={`v${v.id}`} onSelect={() => go(`/vehicles/${v.id}`)} className={item}>
                      <Car className="size-4 text-muted" />
                      <span className="flex-1 font-medium text-fg">{v.plate}</span>
                      <span className="text-xs text-muted">
                        {v.make} {v.model}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!data?.rentals.length && dq && (
                <Command.Group heading="Lượt thuê" className="text-xs text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {data.rentals.map((r) => (
                    <Command.Item key={`r${r.id}`} value={`r${r.id}`} onSelect={() => go(`/rentals/${r.id}`)} className={item}>
                      <KeyRound className="size-4 text-muted" />
                      <span className="flex-1 text-fg">
                        {r.code} · {r.customer}
                      </span>
                      <span className="text-xs text-muted">
                        {r.plate} · {fmtDate(r.start)} · {RENTAL_STATUS[r.status].label}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
