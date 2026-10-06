import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, Phone, Plus, ScanLine, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input, Segmented } from '@/components/ui/form';
import { Badge, Card, Empty, Skeleton } from '@/components/ui/misc';
import { api, fileUrl, qs } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import type { Customer } from '@/lib/types';
import { initials } from '@/lib/utils';
import { fmtDate } from '@shared/time';

type Row = Customer & { rentalCount: number; lastRentalAt: number | null };

export const maskId = (id: string | null) => (id && id.length > 6 ? `${id.slice(0, 3)}•••${id.slice(-4)}` : id);

export function Avatar({ name, fileId, size = 'size-10' }: { name: string; fileId?: string | null; size?: string }) {
  return fileId ? (
    <img src={fileUrl(fileId, { thumb: true })} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-semibold text-muted`}>{initials(name)}</span>
  );
}

export default function CustomersList() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'blacklisted' | 'archived'>('all');
  const [limit, setLimit] = useState(50);
  const dq = useDebounced(q.trim());
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['customers', dq, filter, limit],
    queryFn: () => api.get<{ total: number; items: Row[] }>(`/api/customers${qs({ q: dq, filter, limit })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <Page
      title="Khách hàng"
      subtitle={data ? `${data.total} khách` : undefined}
      actions={
        <>
          <ButtonLink to="/customers/new?scan=1" variant="outline" size="icon" aria-label="Quét CCCD" className="sm:hidden">
            <ScanLine />
          </ButtonLink>
          <ButtonLink to="/customers/new?scan=1">
            <Plus /> <span className="hidden sm:inline">Thêm khách</span>
          </ButtonLink>
        </>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên (không dấu cũng được), SĐT, CCCD, GPLX…" className="pl-9" />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'blacklisted', label: 'Danh sách đen' },
            { value: 'archived', label: 'Lưu trữ' },
          ]}
        />
      </div>

      <Card>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <Empty
            icon={Users}
            title={dq ? 'Không tìm thấy khách' : 'Chưa có khách hàng'}
            description={dq ? 'Thử tìm bằng SĐT hoặc số CCCD.' : 'Quét QR trên căn cước để thêm khách trong vài giây.'}
            action={<ButtonLink to="/customers/new?scan=1"><ScanLine /> Quét CCCD</ButtonLink>}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((c) => (
              <li key={c.id}>
                <Link to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 md:px-5">
                  <Avatar name={c.fullName} fileId={c.portraitFileId} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {c.fullName}
                      {c.blacklisted && <Badge tone="red">Danh sách đen</Badge>}
                    </p>
                    <p className="flex items-center gap-3 truncate text-sm text-muted">
                      {c.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" />
                          {c.phone}
                        </span>
                      )}
                      {c.idNumber && <span className="tabular">CCCD {maskId(c.idNumber)}</span>}
                    </p>
                  </div>
                  <div className="hidden text-right text-sm sm:block">
                    <p className="font-medium">{c.rentalCount} lượt</p>
                    <p className="text-xs text-muted">{c.lastRentalAt ? `Gần nhất ${fmtDate(c.lastRentalAt)}` : 'Chưa thuê'}</p>
                  </div>
                  <ChevronRight className="size-4 text-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data && data.total > data.items.length && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" loading={isFetching} onClick={() => setLimit((l) => l + 50)}>
            Xem thêm ({data.total - data.items.length})
          </Button>
        </div>
      )}
    </Page>
  );
}
