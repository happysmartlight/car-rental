// Lịch xe dạng timeline: mỗi hàng một xe, mỗi cột một ngày.

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Segmented } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useMediaQuery, useNow } from '@/lib/hooks';
import type { CalendarData } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DAY_MS, fmtDateTime, vnParts, vnStartOfDay, WEEKDAY_SHORT } from '@shared/time';

const STYLE: Record<string, string> = {
  booked: 'bg-blue-100 text-blue-900 ring-blue-300 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-800',
  active: 'bg-violet-100 text-violet-900 ring-violet-300 dark:bg-violet-950 dark:text-violet-100 dark:ring-violet-800',
  returned: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800',
  settled: 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900',
  closed: 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900',
  overdue: 'bg-red-100 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-100 dark:ring-red-800',
  block: 'bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_6px,var(--surface-2)_6px_12px)] text-muted ring-border-strong',
};

export default function Calendar() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [span, setSpan] = useState<'7' | '14' | '30'>('14');
  const days = isDesktop ? Number(span) : Math.min(Number(span), 7);
  const now = useNow();
  const [from, setFrom] = useState(() => vnStartOfDay(Date.now()) - DAY_MS);
  const to = from + days * DAY_MS;
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['calendar', from, to], queryFn: () => api.get<CalendarData>(`/api/calendar${qs({ from, to })}`) });

  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => from + i * DAY_MS), [from, days]);
  const pct = (ms: number) => ((Math.min(Math.max(ms, from), to) - from) / (to - from)) * 100;
  const todayStart = vnStartOfDay(now);

  return (
    <Page
      title="Lịch xe"
      width="wide"
      actions={
        <ButtonLink to="/rentals/new">
          <Plus /> <span className="hidden sm:inline">Đặt xe</span>
        </ButtonLink>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setFrom(from - days * DAY_MS)} aria-label="Trước">
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setFrom(vnStartOfDay(Date.now()) - DAY_MS)}>
            Hôm nay
          </Button>
          <Button variant="outline" size="icon" onClick={() => setFrom(from + days * DAY_MS)} aria-label="Sau">
            <ChevronRight />
          </Button>
        </div>
        {isDesktop && (
          <Segmented
            value={span}
            onChange={setSpan}
            options={[
              { value: '7', label: '7 ngày' },
              { value: '14', label: '14 ngày' },
              { value: '30', label: '30 ngày' },
            ]}
          />
        )}
        <div className="ml-auto hidden items-center gap-3 text-xs text-muted md:flex">
          {[
            ['booked', 'Đã đặt'],
            ['active', 'Đang thuê'],
            ['overdue', 'Quá hạn'],
            ['returned', 'Đã trả'],
            ['block', 'Gara / ngưng'],
          ].map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn('size-3 rounded ring-1 ring-inset', STYLE[k])} /> {l}
            </span>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[88px_1fr] md:grid-cols-[150px_1fr]">
            <div className="border-r border-b border-border bg-surface-2/50" />
            <div className="grid border-b border-border" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
              {dayList.map((d) => {
                const p = vnParts(d);
                const today = d === todayStart;
                const weekend = p.weekday === 0 || p.weekday === 6;
                return (
                  <div key={d} className={cn('border-l border-border py-2 text-center first:border-l-0', today && 'bg-brand-soft', weekend && !today && 'bg-surface-2/50')}>
                    <p className={cn('text-[11px]', today ? 'font-semibold text-brand' : 'text-muted')}>{WEEKDAY_SHORT[p.weekday]}</p>
                    <p className={cn('tabular text-sm font-semibold', today && 'text-brand')}>{days > 14 ? p.day : `${p.day}/${p.month}`}</p>
                  </div>
                );
              })}
            </div>

            {data.vehicles.map((v) => {
              // Xếp làn: thanh nào chồng thời gian với thanh trước thì xuống làn dưới.
              const items = data.items.filter((i) => i.vehicleId === v.id && i.end > from && i.start < to).sort((a, b) => a.start - b.start);
              const laneEnds: number[] = [];
              const lanes = items.map((i) => {
                let lane = laneEnds.findIndex((e) => e <= i.start);
                if (lane < 0) lane = laneEnds.length;
                laneEnds[lane] = i.end;
                return lane;
              });
              const laneCount = Math.max(1, laneEnds.length);
              const LANE = 48;
              return (
                <div key={v.id} className="contents">
                  <Link to={`/vehicles/${v.id}`} className="flex flex-col justify-center border-r border-b border-border px-2 py-3 hover:bg-surface-2 md:px-3">
                    <span className="text-[13px] font-semibold whitespace-nowrap md:text-sm">{v.plate}</span>
                    <span className="truncate text-xs text-muted">{v.model}</span>
                  </Link>
                  <div className="relative border-b border-border" style={{ minHeight: 16 + laneCount * LANE }}>
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
                      {dayList.map((d) => (
                        <button
                          key={d}
                          className={cn('border-l border-border first:border-l-0 hover:bg-brand-soft/60', d === todayStart && 'bg-brand-soft/40')}
                          onClick={() => navigate(`/rentals/new?vehicleId=${v.id}`)}
                          aria-label="Đặt xe ngày này"
                        />
                      ))}
                    </div>
                    {now >= from && now <= to && <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500" style={{ left: `${pct(now)}%` }} />}
                    {items.map((i, idx) => {
                      const left = pct(i.start);
                      const top = 8 + lanes[idx] * LANE;
                      const width = Math.max(pct(i.end) - left, 1.5);
                      const style = i.type === 'block' ? STYLE.block : i.overdue ? STYLE.overdue : (STYLE[i.status] ?? STYLE.closed);
                      const content = (
                        <>
                          <span className="block truncate text-xs font-semibold">{i.label}</span>
                          <span className="block truncate text-[11px] opacity-75">{i.type === 'rental' ? `${i.code} · trả ${fmtDateTime(i.scheduledEnd)}` : 'Tạm ngưng'}</span>
                        </>
                      );
                      return i.type === 'rental' ? (
                        <Link
                          key={`r${i.id}`}
                          to={`/rentals/${i.id}`}
                          title={`${i.code} · ${i.label}\n${fmtDateTime(i.start)} → ${fmtDateTime(i.end)}`}
                          className={cn('absolute z-[5] overflow-hidden rounded-lg px-2 py-1 ring-1 ring-inset transition-shadow hover:shadow-pop', style)}
                          style={{ left: `${left}%`, width: `${width}%`, top, height: LANE - 6 }}
                        >
                          {content}
                        </Link>
                      ) : (
                        <Link
                          key={`b${i.id}`}
                          to={`/vehicles/${v.id}`}
                          title={i.label}
                          className={cn('absolute z-[5] overflow-hidden rounded-lg px-2 py-1 ring-1 ring-inset', style)}
                          style={{ left: `${left}%`, width: `${width}%`, top, height: LANE - 6 }}
                        >
                          {content}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {!data.vehicles.length && <p className="p-6 text-center text-sm text-muted">Chưa có xe.</p>}
        </Card>
      )}
    </Page>
  );
}
