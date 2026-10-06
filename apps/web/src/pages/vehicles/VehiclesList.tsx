import { useQuery } from '@tanstack/react-query';
import { Car, PackageOpen, Plus, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { VehicleStateBadge } from '@/components/common';
import { ShareDialog } from '@/components/ShareDialog';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, Empty, PageLoader } from '@/components/ui/misc';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/hooks';
import type { VehicleWithStatus } from '@/lib/types';
import { FUEL_LABEL, TRANSMISSION_LABEL } from '@shared/constants';
import { fmtNumber, fmtVnd } from '@shared/text';
import { daysUntil, fmtDateTime } from '@shared/time';

export function docAlerts(v: VehicleWithStatus): string[] {
  const out: string[] = [];
  const check = (key: string | null, label: string) => {
    if (!key) return;
    const d = daysUntil(key);
    if (d < 0) out.push(`${label} hết hạn`);
    else if (d <= 30) out.push(`${label} còn ${d} ngày`);
  };
  check(v.inspectionExpiry, 'Đăng kiểm');
  check(v.insuranceTndsExpiry, 'BH TNDS');
  check(v.insuranceBodyExpiry, 'BH thân vỏ');
  check(v.roadFeeExpiry, 'Phí đường bộ');
  return out;
}

export default function VehiclesList() {
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<VehicleWithStatus[]>('/api/vehicles') });
  const [shareOpen, setShareOpen] = useState(false);
  const shareVehicles = (data ?? []).filter((v) => v.active).map((v) => ({ ...v, highlights: v.highlights ?? [] }));
  return (
    <Page
      title="Xe"
      subtitle={data ? `${data.length} xe` : undefined}
      actions={
        <>
          {!!shareVehicles.length && (
            <Button variant="outline" onClick={() => setShareOpen(true)}>
              <Share2 /> <span className="hidden sm:inline">Chia sẻ bảng giá</span>
            </Button>
          )}
          {isAdmin && (
            <ButtonLink to="/vehicles/new">
              <Plus /> <span className="hidden sm:inline">Thêm xe</span>
            </ButtonLink>
          )}
        </>
      }
    >
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} mode="fleet" vehicles={shareVehicles} />
      {isLoading ? (
        <PageLoader />
      ) : !data?.length ? (
        <Card>
          <Empty icon={Car} title="Chưa có xe nào" description="Thêm xe với bảng giá để bắt đầu nhận đặt." action={isAdmin && <ButtonLink to="/vehicles/new">Thêm xe</ButtonLink>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((v) => {
            const alerts = docAlerts(v);
            return (
              <Link key={v.id} to={`/vehicles/${v.id}`}>
                <Card className="overflow-hidden transition-shadow hover:shadow-pop">
                  <div className="relative aspect-[16/9] bg-surface-2">
                    {v.photoFileId ? (
                      <img src={fileUrl(v.photoFileId, { thumb: true })} alt={v.plate} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <Car className="size-12 text-subtle" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">{v.status && <VehicleStateBadge state={v.status.state} blockKind={v.status.block?.kind} />}</div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-lg font-semibold tracking-wide">{v.plate}</p>
                      <p className="tabular text-sm font-medium">{fmtVnd(v.priceDay)}/ngày</p>
                    </div>
                    <p className="text-sm text-muted">
                      {[v.make, v.model, v.year].filter(Boolean).join(' ')} · {v.seats ? `${v.seats} chỗ` : ''} {v.transmission ? TRANSMISSION_LABEL[v.transmission].toLowerCase() : ''} {v.fuel ? `· ${FUEL_LABEL[v.fuel].toLowerCase()}` : ''}
                    </p>
                    <p className="mt-2 truncate text-sm">
                      {v.status?.current ? (
                        <span>
                          <b>{v.status.current.customer.fullName}</b> · trả {fmtDateTime(v.status.current.scheduledEnd)}
                        </span>
                      ) : v.status?.next ? (
                        <span className="text-muted">Lượt tới {fmtDateTime(v.status.next.start)}</span>
                      ) : (
                        <span className="text-muted">ODO {fmtNumber(v.odo)} km</span>
                      )}
                    </p>
                    {!!v.highlights?.length && <p className="mt-1 truncate text-xs text-muted">✨ {v.highlights.join(' · ')}</p>}
                    {!v.accessoryCount && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-subtle">
                        <PackageOpen className="size-3.5" /> Chưa khai báo phụ kiện
                      </p>
                    )}
                    {alerts.length > 0 && <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">⚠ {alerts.join(' · ')}</p>}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
