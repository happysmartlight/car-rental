import { useQuery } from '@tanstack/react-query';
import { Car, Flame, Handshake, House, PackageOpen, Plus, Share2, Trophy, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { VehicleStateBadge } from '@/components/common';
import { ShareDialog } from '@/components/ShareDialog';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, Empty, PageLoader } from '@/components/ui/misc';
import { api, fileUrl, qs } from '@/lib/api';
import { useAuth } from '@/lib/hooks';
import type { CashflowReport, VehicleWithStatus } from '@/lib/types';
import { currentPeriodKey, fleetLeaders, fmtCompactVnd, fmtMonthKey } from '@shared/cashflow';
import { FUEL_LABEL, TRANSMISSION_LABEL } from '@shared/constants';
import { fmtNumber, fmtVnd } from '@shared/text';
import { daysUntil, fmtDateTime } from '@shared/time';

const OWNER_GROUPS: { type: VehicleWithStatus['ownerType']; label: string; icon: LucideIcon }[] = [
  { type: 'own', label: 'Xe nhà', icon: House },
  { type: 'consigned', label: 'Xe ký gửi', icon: Handshake },
];

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

  // Cùng khóa với trang Thu chi. Chỉ quản trị mới xem được doanh thu, nên nhân viên không có badge dẫn đầu.
  const period = currentPeriodKey('month');
  const { data: report } = useQuery({
    queryKey: ['cashflow', period, 'all'],
    queryFn: () => api.get<CashflowReport>(`/api/cashflow${qs({ p: period, v: 'all' })}`),
    enabled: isAdmin,
  });
  const leaders = report ? fleetLeaders(report.vehicles) : null;

  const groups = OWNER_GROUPS.map((g) => ({ ...g, vehicles: (data ?? []).filter((v) => v.ownerType === g.type) })).filter((g) => g.vehicles.length);
  const summary = groups.length > 1 ? ` · ${groups.map((g) => `${g.vehicles.length} ${g.label.toLowerCase()}`).join(' · ')}` : '';

  return (
    <Page
      title="Xe"
      subtitle={data ? `${data.length} xe${summary}` : undefined}
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
        <div className="space-y-6">
          {(leaders?.revenue || leaders?.rentals) && <p className="text-xs text-muted">Xe dẫn đầu tính theo {fmtMonthKey(period).toLowerCase()}.</p>}
          {groups.map((g) => (
            <section key={g.type} className="space-y-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <g.icon className="size-5 text-muted" />
                {g.label}
                <span className="text-sm font-normal text-muted">{g.vehicles.length} xe</span>
              </h2>
              <div className="anim-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {g.vehicles.map((v) => (
                  <VehicleCard
                    key={v.id}
                    v={v}
                    topRevenue={leaders?.revenue?.ids.includes(v.id) ? leaders.revenue.value : null}
                    topRentals={leaders?.rentals?.ids.includes(v.id) ? leaders.rentals.value : null}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function VehicleCard({ v, topRevenue, topRentals }: { v: VehicleWithStatus; topRevenue: number | null; topRentals: number | null }) {
  const alerts = docAlerts(v);
  return (
    <Link to={`/vehicles/${v.id}`} className="press block rounded-2xl">
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
          {(topRevenue != null || topRentals != null) && (
            <div className="absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5">
              {topRevenue != null && <LeaderBadge icon={Trophy}>Top doanh thu · {fmtCompactVnd(topRevenue)}</LeaderBadge>}
              {topRentals != null && <LeaderBadge icon={Flame}>Top lượt thuê · {topRentals} lượt</LeaderBadge>}
            </div>
          )}
        </div>
        <div className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-lg font-semibold tracking-wide">{v.plate}</p>
            <p className="tabular text-right text-sm font-medium">
              {fmtVnd(v.priceDay)}/ngày
              {!!v.priceMonth && <span className="block text-xs font-normal text-muted">{fmtVnd(v.priceMonth)}/tháng</span>}
            </p>
          </div>
          <p className="text-sm text-muted">
            {[v.make, v.model, v.year].filter(Boolean).join(' ')} · {v.seats ? `${v.seats} chỗ` : ''} {v.transmission ? TRANSMISSION_LABEL[v.transmission].toLowerCase() : ''} {v.fuel ? `· ${FUEL_LABEL[v.fuel].toLowerCase()}` : ''}
          </p>
          {v.ownerType === 'consigned' && v.ownerName && <p className="mt-1 truncate text-sm text-muted">Chủ xe: {v.ownerName}</p>}
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
          {alerts.length > 0 && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {alerts.join(' · ')}</p>}
        </div>
      </Card>
    </Link>
  );
}

function LeaderBadge({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <Badge className="bg-brand-solid text-brand-fg shadow-card ring-transparent">
      <Icon className="size-3.5" />
      {children}
    </Badge>
  );
}
