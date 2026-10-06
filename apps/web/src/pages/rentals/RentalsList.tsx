import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { RentalStatusBadge } from '@/components/common';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Card, Empty, Skeleton } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useDebounced, useNow } from '@/lib/hooks';
import type { RentalListItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { fmtVnd } from '@shared/text';
import { fmtDateTime } from '@shared/time';

const TABS = [
  { value: 'open', label: 'Đang mở' },
  { value: 'booked', label: 'Đã đặt' },
  { value: 'active', label: 'Đang thuê' },
  { value: 'returned', label: 'Chờ quyết toán / hoàn cọc' },
  { value: 'closed', label: 'Hoàn tất' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'all', label: 'Tất cả' },
];

export default function RentalsList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const dq = useDebounced(q.trim());
  const now = useNow();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['rentals', status, dq, limit],
    queryFn: () => api.get<{ total: number; items: RentalListItem[] }>(`/api/rentals${qs({ status: dq ? 'all' : status, q: dq, limit })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <Page
      title="Lượt thuê"
      subtitle={data ? `${data.total} lượt` : undefined}
      actions={
        <ButtonLink to="/rentals/new">
          <Plus /> <span className="hidden sm:inline">Đặt xe</span>
        </ButtonLink>
      }
    >
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã HĐ, tên khách, biển số, SĐT…" className="pl-9" />
        </div>
        {!dq && (
          <div className="scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setParams({ status: t.value }, { replace: true })}
                className={cn('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', status === t.value ? 'bg-fg text-bg' : 'bg-surface-2 text-muted hover:text-fg')}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <Card>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <Empty icon={KeyRound} title="Không có lượt thuê" description={dq ? 'Thử từ khóa khác.' : 'Lượt thuê mới sẽ hiện ở đây.'} action={<ButtonLink to="/rentals/new"><Plus /> Đặt xe</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((r) => {
              const overdue = r.status === 'active' && r.scheduledEnd < now;
              return (
                <li key={r.id}>
                  <Link to={`/rentals/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/60 md:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.vehicle.plate}</span>
                        <span className="text-muted">·</span>
                        <span className="truncate font-medium">{r.customer.fullName}</span>
                        <RentalStatusBadge status={r.status} overdue={overdue} />
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                        <span className="tabular">{r.code}</span>
                        <span>·</span>
                        <span>{fmtDateTime(r.actualStart ?? r.scheduledStart)}</span>
                        <ArrowRight className="size-3" />
                        <span className={cn(overdue && 'font-medium text-red-600')}>{fmtDateTime(r.actualEnd ?? r.scheduledEnd)}</span>
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="tabular font-medium">{fmtVnd(r.money.totalCharges)}</p>
                      {r.money.due > 0 && r.status !== 'cancelled' ? (
                        <p className="tabular text-xs text-red-600">Còn {fmtVnd(r.money.due)}</p>
                      ) : r.money.depositHeld > 0 ? (
                        <p className="tabular text-xs text-amber-600">Giữ cọc {fmtVnd(r.money.depositHeld)}</p>
                      ) : (
                        <p className="text-xs text-emerald-600">Đã đủ</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {data && data.total > data.items.length && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" loading={isFetching} onClick={() => setLimit((l) => l + 50)}>
            Xem thêm
          </Button>
        </div>
      )}
    </Page>
  );
}
