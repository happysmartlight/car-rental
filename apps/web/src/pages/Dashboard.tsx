import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Car, CheckCircle2, CircleAlert, Info, KeyRound, PiggyBank, Plus, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Thumb } from '@/components/images';
import { VehicleStateBadge } from '@/components/common';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, Empty, PageLoader, Stat } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth, useNow } from '@/lib/hooks';
import type { Dashboard as DashboardData } from '@/lib/types';
import { cn, relTime } from '@/lib/utils';
import { fmtVnd } from '@shared/text';
import { fmtDateTime, fmtTime, vnDateKey, WEEKDAY_LONG, vnParts, fmtDate } from '@shared/time';

const SEVERITY = {
  danger: { icon: CircleAlert, cls: 'text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400' },
  info: { icon: Info, cls: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400' },
};

export function Dashboard() {
  const { user, isAdmin } = useAuth();
  const now = useNow();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard'), refetchInterval: 60_000 });
  const p = vnParts(now);
  const hello = p.hour < 11 ? 'Chào buổi sáng' : p.hour < 14 ? 'Chào buổi trưa' : p.hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  return (
    <Page
      title={`${hello}, ${user.displayName.split(' ').at(-1)}`}
      subtitle={`${WEEKDAY_LONG[p.weekday]}, ${fmtDate(now)}`}
      actions={
        <ButtonLink to="/rentals/new" className="hidden md:inline-flex">
          <Plus /> Đặt xe
        </ButtonLink>
      }
    >
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          {isAdmin && data.finance ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Doanh thu tháng" value={fmtVnd(data.finance.revenue)} sub={`${data.finance.rentals} lượt thuê`} icon={Wallet} tone="blue" />
              <Stat label="Đã thu tháng" value={fmtVnd(data.finance.received)} icon={CheckCircle2} tone="green" />
              <Stat label="Cọc đang giữ" value={fmtVnd(data.finance.depositsHeld)} sub="Tiền của khách" icon={PiggyBank} tone="amber" />
              <Stat label="Đang cho thuê" value={`${data.counts.active ?? 0}/${data.vehicles.length} xe`} sub={`${data.counts.booked ?? 0} lượt đã đặt`} icon={KeyRound} tone="violet" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Đang thuê" value={data.counts.active ?? 0} />
              <Stat label="Đã đặt" value={data.counts.booked ?? 0} />
              <Stat label="Chờ quyết toán" value={data.counts.returned ?? 0} />
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Việc cần làm" description={data.alerts.length ? `${data.alerts.length} việc` : undefined} />
              {data.alerts.length ? (
                <ul className="divide-y divide-border px-2 pb-2">
                  {data.alerts.map((a, i) => {
                    const S = SEVERITY[a.severity];
                    return (
                      <li key={i}>
                        <Link to={a.link} className="flex items-start gap-3 rounded-xl px-2 py-3 hover:bg-surface-2">
                          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', S.cls)}>
                            <S.icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{a.title}</span>
                            <span className="block text-sm text-muted">{a.detail}</span>
                          </span>
                          {a.at && <span className="shrink-0 pt-0.5 text-xs text-subtle">{relTime(a.at, now)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty icon={CheckCircle2} title="Không có việc gấp" description="Các lượt giao/nhận xe, hạn giấy tờ và cọc cần hoàn sẽ hiện ở đây." />
              )}
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="7 ngày tới" />
              {data.upcoming.length ? (
                <ul className="space-y-1 px-2 pb-2">
                  {data.upcoming.map((u) => (
                    <li key={`${u.kind}${u.id}`}>
                      <Link to={`/rentals/${u.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', u.kind === 'pickup' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40' : 'bg-violet-50 text-violet-600 dark:bg-violet-950/40')}>
                          {u.kind === 'pickup' ? <ArrowUpFromLine className="size-4" /> : <ArrowDownToLine className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {u.kind === 'pickup' ? 'Giao' : 'Nhận'} {u.vehicle.plate} · {u.customer.fullName}
                          </span>
                          <span className={cn('block text-xs', u.at < now ? 'font-medium text-red-600' : 'text-muted')}>
                            {vnDateKey(u.at) === vnDateKey(now) ? `Hôm nay ${fmtTime(u.at)}` : fmtDateTime(u.at)}
                            {u.at < now && ' · đã quá giờ'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="Chưa có lịch" description="Lượt giao và nhận xe trong tuần sẽ hiện ở đây." />
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Đội xe" action={<Link to="/vehicles" className="text-sm text-brand">Tất cả</Link>} />
            {data.vehicles.length ? (
              <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 md:px-5 xl:grid-cols-3">
                {data.vehicles.map((v) => {
                  const util = data.finance?.utilization.find((u) => u.vehicleId === v.id);
                  return (
                    <Link key={v.id} to={`/vehicles/${v.id}`} className="flex gap-3 rounded-2xl border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-2/50">
                      {v.photoFileId ? (
                        <Thumb fileId={v.photoFileId} className="size-16 shrink-0" />
                      ) : (
                        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                          <Car className="size-7 text-subtle" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold tracking-wide">{v.plate}</span>
                          {v.status && <VehicleStateBadge state={v.status.state} blockKind={v.status.block?.kind} />}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {v.make} {v.model}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted">
                          {v.status?.current
                            ? `${v.status.current.customer.fullName} · trả ${fmtDateTime(v.status.current.scheduledEnd)}`
                            : v.status?.next
                              ? `Lượt tới: ${fmtDateTime(v.status.next.start)}`
                              : 'Chưa có lịch'}
                        </span>
                        {util && (
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                              <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, util.pct)}%` }} />
                            </span>
                            <span className="tabular text-[11px] text-subtle">{util.pct}% tháng</span>
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Empty icon={Car} title="Chưa có xe nào" description="Thêm xe đầu tiên để bắt đầu nhận đặt." action={isAdmin && <ButtonLink to="/vehicles/new">Thêm xe</ButtonLink>} />
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
