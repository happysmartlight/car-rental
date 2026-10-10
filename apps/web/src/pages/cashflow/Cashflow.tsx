import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Landmark,
  Lock,
  Paperclip,
  Plus,
  Repeat,
  Table2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CashEntryDialog, type CashDialogState } from '@/components/CashEntryDialog';
import { RentalStatusBadge } from '@/components/common';
import { Page } from '@/components/layout/AppShell';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox, Segmented, Select, Switch } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, Empty, ErrorBox, Notice, PageLoader, Stat } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useAuth, useNow } from '@/lib/hooks';
import type { CashflowReport, LedgerRow, RecurringRow, VehicleCashRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  CASH_CATEGORIES,
  CASH_CATEGORY,
  currentPeriodKey,
  nextRecurringDate,
  pct,
  recurringText,
  shiftPeriod,
  splitEvenly,
  switchPeriodKind,
  fmtMonthKey,
  type CashCategory,
  type PeriodKind,
} from '@shared/cashflow';
import { PAYMENT_METHOD_LABEL } from '@shared/constants';
import { fmtNumber, fmtVnd } from '@shared/text';
import { WEEKDAY_LONG, fmtDate, fmtDateTime, vnDateKey, vnParts } from '@shared/time';
import { CashChart, CashLegend, CashTrendTable } from './CashChart';

const ALLOC_KEY = 'cash.allocateShared';
const VIEW_KEY = 'cash.trendView';

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* bỏ qua */
  }
}

const profitCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : n > 0 ? 'text-emerald-600 dark:text-emerald-400' : '');

export default function Cashflow() {
  const { isAdmin } = useAuth();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const period = params.get('p') || currentPeriodKey('month', now);
  const vehicle = params.get('v') || 'all';
  const kind: PeriodKind = /^\d{4}$/.test(period) ? 'year' : 'month';
  const setQuery = (p: string, v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('p', p);
        if (v === 'all') next.delete('v');
        else next.set('v', v);
        return next;
      },
      { replace: true },
    );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['cashflow', period, vehicle],
    queryFn: () => api.get<CashflowReport>(`/api/cashflow${qs({ p: period, v: vehicle })}`),
    placeholderData: keepPreviousData,
    enabled: isAdmin,
  });
  const { data: recurring } = useQuery({ queryKey: ['recurring'], queryFn: () => api.get<RecurringRow[]>('/api/recurring-costs'), enabled: isAdmin });

  const [dialog, setDialog] = useState<CashDialogState | null>(null);
  const [allocate, setAllocate] = useState(() => readPref(ALLOC_KEY, '0') === '1');
  const [view, setView] = useState<'chart' | 'table'>(() => (readPref(VIEW_KEY, 'chart') === 'table' ? 'table' : 'chart'));
  const [ledgerCat, setLedgerCat] = useState<'' | 'rent' | CashCategory>('');
  const ledgerRef = useRef<HTMLDivElement>(null);

  if (!isAdmin) {
    return (
      <Page title="Thu chi">
        <Card>
          <Empty icon={Lock} title="Chỉ quản trị xem được thu chi" description="Bạn vẫn ghi được khoản chi (đổ xăng, rửa xe…) bằng nút + → Ghi chi phí." />
        </Card>
      </Page>
    );
  }

  const vehicleId = /^\d+$/.test(vehicle) ? Number(vehicle) : null;
  const scopeLabel = vehicle === 'all' ? 'Cả đội xe' : vehicle === 'shared' ? 'Chi phí chung' : (data?.vehicleOptions.find((v) => v.id === vehicleId)?.plate ?? 'Một xe');
  const exportUrl = `/api/cashflow/export${qs({ p: period, v: vehicle })}`;
  const isCurrent = period === currentPeriodKey(kind, now);
  const showCategory = (c: '' | 'rent' | CashCategory) => {
    setLedgerCat(c);
    requestAnimationFrame(() => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <Page
      title="Thu chi"
      subtitle={data ? `${data.period.label} · ${scopeLabel}` : 'Dòng tiền theo xe và cả cửa hàng'}
      actions={
        <>
          <a href={exportUrl} download className={cn(buttonVariants({ variant: 'outline' }), 'px-3 sm:px-4')} aria-label="Xuất Excel">
            <Download /> <span className="hidden sm:inline">Excel</span>
          </a>
          <Button onClick={() => setDialog({ mode: 'new', vehicleId })}>
            <Plus /> <span className="hidden sm:inline">Ghi khoản</span>
            <span className="sm:hidden">Ghi</span>
          </Button>
        </>
      }
    >
      {/* Bộ lọc: một hàng, áp cho mọi thứ bên dưới. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={kind}
          onChange={(k) => setQuery(switchPeriodKind(period, k, now), vehicle)}
          options={[
            { value: 'month', label: 'Tháng' },
            { value: 'year', label: 'Năm' },
          ]}
        />
        <div className="flex items-center rounded-xl border border-border bg-surface">
          <Button variant="ghost" size="icon" aria-label="Kỳ trước" onClick={() => setQuery(shiftPeriod(period, -1), vehicle)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[7.5rem] text-center text-sm font-medium tabular">{kind === 'year' ? `Năm ${period}` : fmtMonthKey(period)}</span>
          <Button variant="ghost" size="icon" aria-label="Kỳ sau" onClick={() => setQuery(shiftPeriod(period, 1), vehicle)}>
            <ChevronRight />
          </Button>
        </div>
        {!isCurrent && (
          <Button variant="ghost" size="sm" onClick={() => setQuery(currentPeriodKey(kind, now), vehicle)}>
            {kind === 'year' ? 'Năm nay' : 'Tháng này'}
          </Button>
        )}
        <Select className="w-full sm:ml-auto sm:w-72" value={vehicle} onChange={(e) => setQuery(period, e.target.value)} aria-label="Phạm vi">
          <option value="all">Cả đội xe + chi phí chung</option>
          <option value="shared">Chỉ chi phí chung</option>
          {data && data.vehicleOptions.length > 0 && (
            <optgroup label="Từng xe">
              {data.vehicleOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} · {v.make} {v.model}
                  {v.archived ? ' (đã lưu trữ)' : ''}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>

      {error && <ErrorBox error={error} className="mb-4" />}
      {isLoading || !data ? (
        !error && <PageLoader />
      ) : (
        <div className={cn('space-y-4 transition-opacity', isFetching && 'opacity-60')}>
          <Kpis r={data} />

          {typeof data.filter === 'number' && data.allocation.sharedExpense > 0 && data.allocation.fleet > 0 && (
            <Notice tone="gray" icon={Landmark}>
              Chưa tính chi phí chung {fmtVnd(data.allocation.sharedExpense)} của cửa hàng. Chia đều {data.allocation.fleet} xe ≈{' '}
              <b className="tabular">{fmtVnd(Math.round(data.allocation.sharedExpense / data.allocation.fleet))}</b>/xe → lãi xe này còn khoảng{' '}
              <b className={cn('tabular', profitCls(data.totals.profit - Math.round(data.allocation.sharedExpense / data.allocation.fleet)))}>
                {fmtVnd(data.totals.profit - Math.round(data.allocation.sharedExpense / data.allocation.fleet))}
              </b>
              .
            </Notice>
          )}

          <Card>
            <CardHeader
              title={kind === 'year' ? `Các tháng năm ${period}` : '12 tháng gần nhất'}
              description={<CashLegend className="mt-1" />}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const v = view === 'chart' ? 'table' : 'chart';
                    setView(v);
                    writePref(VIEW_KEY, v);
                  }}
                >
                  {view === 'chart' ? <Table2 /> : <BarChart3 />} {view === 'chart' ? 'Xem bảng' : 'Biểu đồ'}
                </Button>
              }
            />
            <CardBody>
              {data.trend.every((m) => !m.income && !m.expense && !m.capitalIn && !m.capitalOut) ? (
                <Empty title="Chưa có thu chi trong 12 tháng này" description="Tiền thuê khách trả và các khoản bạn ghi sẽ hiện ở đây." className="py-8" />
              ) : view === 'chart' ? (
                <CashChart data={data.trend} selected={kind === 'month' ? period : null} onSelect={(k) => setQuery(k, vehicle)} />
              ) : (
                <CashTrendTable data={data.trend} selected={kind === 'month' ? period : null} onSelect={(k) => setQuery(k, vehicle)} />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-5">
            {data.filter === 'all' && (
              <VehiclesCard
                r={data}
                allocate={allocate}
                onAllocate={(v) => {
                  setAllocate(v);
                  writePref(ALLOC_KEY, v ? '1' : '0');
                }}
                onPick={(v) => setQuery(period, v)}
              />
            )}
            {typeof data.filter === 'number' && <RentalsCard r={data} />}
            <CategoriesCard r={data} className={data.filter === 'shared' ? 'lg:col-span-5' : 'lg:col-span-2'} onPick={showCategory} />
          </div>

          <div ref={ledgerRef} className="scroll-mt-20">
            <LedgerCard r={data} cat={ledgerCat} onCat={setLedgerCat} onOpen={(l) => l.kind === 'entry' && setDialog({ mode: 'edit', entry: l.entry, recurringLabel: l.recurring?.description ?? null })} />
          </div>

          <RecurringCard rows={(recurring ?? []).filter((x) => (typeof data.filter === 'number' ? x.vehicleId === data.filter : data.filter === 'shared' ? x.vehicleId == null : true))} onOpen={(x) => setDialog({ mode: 'recurring', recurring: x })} onAdd={() => setDialog({ mode: 'recurring' })} now={now} />

          <HowItWorks />
        </div>
      )}

      <CashEntryDialog state={dialog} onClose={() => setDialog(null)} />
    </Page>
  );
}

// ── Số tổng ──────────────────────────────────────────────────────────────────

function Kpis({ r }: { r: CashflowReport }) {
  const t = r.totals;
  const rc = r.receivables;
  const margin = pct(t.profit, t.income);
  const sharedPart = r.shared?.expense ?? 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Tổng thu"
          value={fmtVnd(t.income)}
          sub={r.filter === 'shared' ? 'Thu khác không gắn xe' : `Tiền thuê ${fmtVnd(t.rent)}${t.otherIncome ? ` · khác ${fmtVnd(t.otherIncome)}` : ''}`}
          icon={ArrowDownLeft}
          tone="blue"
        />
        <Stat
          label="Chi vận hành"
          value={fmtVnd(t.expense)}
          sub={r.filter === 'all' ? `Theo xe ${fmtVnd(t.expense - sharedPart)} · chung ${fmtVnd(sharedPart)}` : t.income > 0 ? `Bằng ${pct(t.expense, t.income)}% số thu` : 'Chưa có thu trong kỳ'}
          icon={ArrowUpRight}
          tone="amber"
        />
        <Stat
          label="Lãi vận hành"
          value={<span className={profitCls(t.profit)}>{fmtVnd(t.profit)}</span>}
          sub={t.profit < 0 ? 'Chi nhiều hơn thu' : margin != null ? `Biên lãi ${margin}%` : 'Thu − chi vận hành'}
          icon={t.profit < 0 ? TrendingDown : TrendingUp}
          tone={t.profit < 0 ? 'red' : 'green'}
        />
        <Stat
          label="Dòng tiền ròng"
          value={<span className={profitCls(t.net)}>{fmtVnd(t.net)}</span>}
          sub={t.capitalIn || t.capitalOut ? `Sau mua xe, trả góp ${fmtVnd(t.capitalOut)}${t.capitalIn ? ` · bán ${fmtVnd(t.capitalIn)}` : ''}` : 'Không có khoản vốn, trả góp'}
          icon={Wallet}
          tone="violet"
        />
      </div>
      {r.filter !== 'shared' && (
        <Card className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <MiniStat label="Khách còn nợ" value={rc.owed} sub={rc.owedCount ? `${rc.owedCount} lượt đã trả xe` : 'Không ai nợ'} warn={rc.owed > 0} />
          <MiniStat label="Sắp thu" value={rc.upcoming} sub={rc.upcomingCount ? `${rc.upcomingCount} lượt đang thuê/đã đặt` : 'Đã thu đủ'} />
          <MiniStat label="Cọc đang giữ" value={rc.depositsHeld} sub="Tiền của khách" />
        </Card>
      )}
    </>
  );
}

/** Số tại thời điểm hiện tại (không theo kỳ). Điện thoại: một hàng nhãn — số; máy tính: ba cột. */
function MiniStat({ label, value, sub, warn }: { label: string; value: number; sub: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5 sm:flex-col sm:items-start sm:justify-start sm:gap-0 sm:py-3 md:px-5">
      <div className="min-w-0 sm:contents">
        <p className="text-sm text-muted sm:order-1 sm:text-xs">
          {label}
          <span className="hidden sm:inline"> · hiện tại</span>
        </p>
        <p className="max-w-full truncate text-[11px] text-subtle sm:order-3">{sub}</p>
      </div>
      <p className={cn('tabular shrink-0 font-semibold sm:order-2 sm:mt-0.5 sm:text-base', warn && 'text-red-600 dark:text-red-400')}>{fmtVnd(value)}</p>
    </div>
  );
}

// ── Theo xe ──────────────────────────────────────────────────────────────────

function VehiclesCard({ r, allocate, onAllocate, onPick }: { r: CashflowReport; allocate: boolean; onAllocate: (v: boolean) => void; onPick: (v: string) => void }) {
  const shared = r.shared!;
  const active = r.vehicles.filter((v) => !v.archived);
  const shares = useMemo(() => splitEvenly(shared.expense, allocate ? active.length : 0), [shared.expense, allocate, active.length]);
  const shareOf = (v: VehicleCashRow) => {
    if (!allocate || v.archived) return 0;
    return shares[active.findIndex((x) => x.vehicleId === v.vehicleId)] ?? 0;
  };
  const rows = r.vehicles.map((v) => ({ v, share: shareOf(v) }));
  const scale = Math.max(1, ...rows.flatMap(({ v, share }) => [v.income, v.expense + share]));
  const sharedVisible = !allocate || !active.length;

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Theo xe"
        description={allocate ? `Chi phí chung chia đều ${active.length} xe` : 'Bấm vào xe để xem chi tiết'}
        action={<Switch checked={allocate} onChange={onAllocate} label={<span className="text-xs font-normal text-muted">Chia chi phí chung</span>} />}
      />
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map(({ v, share }) => {
            const profit = v.profit - share;
            return (
              <li key={v.vehicleId}>
                <button onClick={() => onPick(String(v.vehicleId))} className="w-full px-4 py-3 text-left hover:bg-surface-2/60 md:px-5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold tracking-wide">{v.plate}</span>
                      <span className="ml-2 text-xs text-muted">
                        {v.make} {v.model}
                        {v.archived && ' · đã lưu trữ'}
                      </span>
                    </span>
                    <span className={cn('tabular shrink-0 font-semibold', profitCls(profit))}>{fmtVnd(profit)}</span>
                  </span>
                  <span className="mt-2 block space-y-1">
                    <Bar value={v.income} scale={scale} cls="bg-chart-in" />
                    <Bar value={v.expense + share} scale={scale} cls="bg-chart-out" />
                  </span>
                  <span className="tabular mt-1.5 block text-xs text-muted">
                    Thu {fmtVnd(v.income)} · Chi {fmtVnd(v.expense)}
                    {share > 0 && ` + chung ${fmtVnd(share)}`}
                    {' · '}
                    {v.rentals} lượt{v.utilization != null && ` · ${v.utilization}% có khách`}
                    {v.capitalOut > 0 && ` · trả góp/đầu tư ${fmtVnd(v.capitalOut)}`}
                  </span>
                </button>
              </li>
            );
          })}
          {sharedVisible && (shared.expense > 0 || shared.otherIncome > 0 || shared.capitalOut > 0) && (
            <li>
              <button onClick={() => onPick('shared')} className="w-full px-4 py-3 text-left hover:bg-surface-2/60 md:px-5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">Chi phí chung</span>
                  <span className={cn('tabular shrink-0 font-semibold', profitCls(shared.profit))}>{fmtVnd(shared.profit)}</span>
                </span>
                <span className="mt-2 block">
                  <Bar value={shared.expense} scale={scale} cls="bg-chart-out" />
                </span>
                <span className="tabular mt-1.5 block text-xs text-muted">
                  Bến bãi, lương, quảng cáo… không gắn xe · Chi {fmtVnd(shared.expense)}
                  {shared.otherIncome > 0 && ` · thu ${fmtVnd(shared.otherIncome)}`}
                </span>
              </button>
            </li>
          )}
          <li className="bg-surface-2/50 px-4 py-3 md:px-5">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold whitespace-nowrap">Tổng cộng</span>
              <b className={cn('tabular', profitCls(r.totals.profit))}>{fmtVnd(r.totals.profit)}</b>
            </span>
            <span className="tabular mt-0.5 block text-xs text-muted">
              Thu {fmtVnd(r.totals.income)} · Chi {fmtVnd(r.totals.expense)}
            </span>
          </li>
        </ul>
      ) : (
        <Empty title="Chưa có xe" />
      )}
    </Card>
  );
}

function Bar({ value, scale, cls }: { value: number; scale: number; cls: string }) {
  const w = value > 0 ? Math.max(1.5, (value / scale) * 100) : 0;
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
      <span className={cn('block h-full rounded-full', cls)} style={{ width: `${w}%` }} />
    </span>
  );
}

// ── Lượt thuê của một xe ─────────────────────────────────────────────────────

const OPEN_STATUSES = ['booked', 'active'];

function RentalsCard({ r }: { r: CashflowReport }) {
  const due = r.rentals.filter((x) => !OPEN_STATUSES.includes(x.status)).reduce((s, x) => s + Math.max(0, x.due), 0);
  return (
    <Card className="lg:col-span-3">
      <CardHeader title="Lượt thuê nhận xe trong kỳ" description={`${r.rentals.length} lượt · tổng ${fmtVnd(r.rentals.reduce((s, x) => s + x.total, 0))}${due ? ` · còn nợ ${fmtVnd(due)}` : ''}`} />
      {r.rentals.length ? (
        <ul className="divide-y divide-border">
          {r.rentals.map((x) => (
            <li key={x.id}>
              <Link to={`/rentals/${x.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 md:px-5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {x.code} · {x.customerName}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {fmtDateTime(x.start)} → {fmtDateTime(x.end)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular block text-sm font-semibold">{fmtVnd(x.total)}</span>
                  {x.due > 0 && OPEN_STATUSES.includes(x.status) ? (
                    <span className="tabular block text-xs text-muted">chưa thu {fmtVnd(x.due)}</span>
                  ) : x.due > 0 ? (
                    <span className="tabular block text-xs text-red-600 dark:text-red-400">còn nợ {fmtVnd(x.due)}</span>
                  ) : (
                    <RentalStatusBadge status={x.status} />
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Không có lượt thuê nào trong kỳ" className="py-8" />
      )}
    </Card>
  );
}

// ── Theo hạng mục ────────────────────────────────────────────────────────────

function CategoriesCard({ r, className, onPick }: { r: CashflowReport; className?: string; onPick: (c: 'rent' | CashCategory) => void }) {
  const out = r.categories.filter((c) => CASH_CATEGORY[c.category].dir === 'out');
  const inc = r.categories.filter((c) => CASH_CATEGORY[c.category].dir === 'in');
  const outTotal = out.reduce((s, c) => s + c.amount, 0);
  const incomeRows: { key: 'rent' | CashCategory; label: string; amount: number; count?: number; capital?: boolean }[] = [
    ...(r.filter !== 'shared' && r.totals.rent !== 0 ? [{ key: 'rent' as const, label: 'Tiền thuê thực nhận', amount: r.totals.rent }] : []),
    ...inc.map((c) => ({ key: c.category, label: CASH_CATEGORY[c.category].label, amount: c.amount, count: c.count, capital: CASH_CATEGORY[c.category].capital })),
  ];
  const max = Math.max(1, ...out.map((c) => c.amount), ...incomeRows.map((c) => c.amount));
  return (
    <Card className={className}>
      <CardHeader title="Theo hạng mục" description="Bấm để lọc sổ thu chi" />
      {out.length || incomeRows.length ? (
        <CardBody className="space-y-4">
          {out.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Chi · {fmtVnd(outTotal)}</p>
              <ul>
                {out.map((c) => (
                  <CatRow key={c.category} label={CASH_CATEGORY[c.category].label} amount={c.amount} count={c.count} share={pct(c.amount, outTotal)} max={max} cls="bg-chart-out" capital={CASH_CATEGORY[c.category].capital} onClick={() => onPick(c.category)} />
                ))}
              </ul>
            </div>
          )}
          {incomeRows.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Thu · {fmtVnd(incomeRows.reduce((s, c) => s + c.amount, 0))}</p>
              <ul>
                {incomeRows.map((c) => (
                  <CatRow key={c.key} label={c.label} amount={c.amount} count={c.count} max={max} cls="bg-chart-in" capital={c.capital} onClick={() => onPick(c.key)} />
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      ) : (
        <Empty title="Chưa có khoản nào" description="Ghi chi phí bằng nút Ghi khoản." className="py-8" />
      )}
    </Card>
  );
}

function CatRow({ label, amount, count, share, max, cls, capital, onClick }: { label: string; amount: number; count?: number; share?: number | null; max: number; cls: string; capital?: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left hover:bg-surface-2/60">
        <span className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">
            {label}
            {count != null && <span className="ml-1.5 text-xs text-subtle">{count} khoản</span>}
            {capital && (
              <Badge tone="violet" className="ml-1.5 align-middle">
                vốn
              </Badge>
            )}
          </span>
          <span className="tabular shrink-0 font-medium">
            {fmtVnd(amount)}
            {share != null && <span className="ml-1.5 text-xs font-normal text-subtle">{share}%</span>}
          </span>
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
          <span className={cn('block h-full rounded-full', cls)} style={{ width: `${Math.max(1.5, (Math.abs(amount) / max) * 100)}%` }} />
        </span>
      </button>
    </li>
  );
}

// ── Sổ thu chi ───────────────────────────────────────────────────────────────

const PAGE = 60;

function LedgerCard({ r, cat, onCat, onOpen }: { r: CashflowReport; cat: '' | 'rent' | CashCategory; onCat: (c: '' | 'rent' | CashCategory) => void; onOpen: (l: LedgerRow) => void }) {
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const [showVoided, setShowVoided] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const voidedCount = r.ledger.filter((l) => l.kind === 'entry' && l.entry.voidedAt).length;
  const rows = r.ledger.filter((l) => {
    if (!showVoided && l.kind === 'entry' && l.entry.voidedAt) return false;
    if (dir !== 'all' && l.direction !== dir) return false;
    if (cat === 'rent') return l.kind === 'rent';
    if (cat) return l.kind === 'entry' && l.entry.category === cat;
    return true;
  });
  const live = rows.filter((l) => !(l.kind === 'entry' && l.entry.voidedAt));
  const sumIn = live.filter((l) => l.direction === 'in').reduce((s, l) => s + l.amount, 0);
  const sumOut = live.filter((l) => l.direction === 'out').reduce((s, l) => s + l.amount, 0);
  const shown = rows.slice(0, limit);
  const days: { key: string; at: number; items: LedgerRow[] }[] = [];
  for (const l of shown) {
    const key = vnDateKey(l.at);
    const last = days.at(-1);
    if (last?.key === key) last.items.push(l);
    else days.push({ key, at: l.at, items: [l] });
  }
  const usedCats = [...new Set(r.ledger.filter((l): l is Extract<LedgerRow, { kind: 'entry' }> => l.kind === 'entry').map((l) => l.entry.category))];

  return (
    <Card>
      <CardHeader title="Sổ thu chi" description={`${live.length} khoản · thu ${fmtVnd(sumIn)} · chi ${fmtVnd(sumOut)}`} />
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-5">
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'in', label: 'Thu' },
            { value: 'out', label: 'Chi' },
          ]}
        />
        <Select className="w-auto min-w-0 flex-1 sm:max-w-64 sm:flex-none" value={cat} onChange={(e) => onCat(e.target.value as typeof cat)} aria-label="Hạng mục">
          <option value="">Mọi hạng mục</option>
          {r.filter !== 'shared' && <option value="rent">Tiền thuê</option>}
          {CASH_CATEGORIES.filter((c) => usedCats.includes(c) || c === cat).map((c) => (
            <option key={c} value={c}>
              {CASH_CATEGORY[c].label}
            </option>
          ))}
        </Select>
        {voidedCount > 0 && <Checkbox className="sm:ml-auto" checked={showVoided} onChange={setShowVoided} label={`Hiện ${voidedCount} phiếu đã hủy`} />}
      </div>
      {days.length ? (
        <div className="border-t border-border">
          {days.map((d) => {
            const p = vnParts(d.at);
            return (
              <div key={d.key}>
                <p className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-[1] bg-surface-2/90 px-4 py-1.5 text-xs font-medium text-muted backdrop-blur md:static md:px-5">
                  {WEEKDAY_LONG[p.weekday]}, {fmtDate(d.at)}
                </p>
                <ul className="divide-y divide-border">
                  {d.items.map((l) => (
                    <LedgerItem key={l.key} l={l} onOpen={onOpen} />
                  ))}
                </ul>
              </div>
            );
          })}
          {rows.length > limit && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>
                Xem thêm {Math.min(PAGE, rows.length - limit)} khoản
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Empty title={cat || dir !== 'all' ? 'Không có khoản nào khớp bộ lọc' : 'Chưa có khoản thu chi nào trong kỳ'} className="py-8" />
      )}
    </Card>
  );
}

function LedgerItem({ l, onOpen }: { l: LedgerRow; onOpen: (l: LedgerRow) => void }) {
  const isIn = l.direction === 'in';
  const icon = (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', isIn ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400' : 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400')}>
      {isIn ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
    </span>
  );
  const amount = (voided?: boolean) => (
    <span className={cn('tabular shrink-0 text-right font-semibold whitespace-nowrap', isIn && 'text-emerald-600 dark:text-emerald-400', voided && 'text-subtle line-through')}>
      {isIn ? '+' : '−'}
      {fmtVnd(l.amount)}
    </span>
  );
  const cls = 'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 md:px-5';

  if (l.kind === 'rent') {
    const f = l.flow;
    const title = f.direction === 'out' ? 'Hoàn tiền thuê' : f.direction === 'offset' ? 'Cọc cấn trừ sang tiền thuê' : 'Tiền thuê';
    return (
      <li>
        <Link to={`/rentals/${f.rentalId}`} className={cls}>
          {icon}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 font-medium">
              {title} · <span className="whitespace-nowrap">{f.code}</span>
            </span>
            <span className="line-clamp-2 text-sm text-muted">{[l.plate, f.customerName, f.direction === 'offset' ? null : PAYMENT_METHOD_LABEL[f.method], f.note].filter(Boolean).join(' · ')}</span>
          </span>
          {amount()}
        </Link>
      </li>
    );
  }
  const e = l.entry;
  const c = CASH_CATEGORY[e.category];
  const voided = !!e.voidedAt;
  return (
    <li>
      <button onClick={() => onOpen(l)} className={cn(cls, voided && 'opacity-70')}>
        {icon}
        <span className="min-w-0 flex-1">
          <span className={cn('line-clamp-2 font-medium', voided && 'line-through')}>
            {e.description || c?.label}
            {l.recurring && <Repeat className="ml-1.5 inline size-3.5 align-[-2px] text-subtle" aria-label="Khoản định kỳ" />}
            {e.receiptFileIds.length > 0 && <Paperclip className="ml-1.5 inline size-3.5 align-[-2px] text-subtle" aria-label="Có ảnh hóa đơn" />}
          </span>
          <span className="line-clamp-2 text-sm text-muted">
            {voided ? (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                <Ban className="size-3" /> Đã hủy · {e.voidReason}
              </span>
            ) : (
              [l.plate ?? 'Chung', e.description ? c?.label : null, e.vendor, PAYMENT_METHOD_LABEL[e.method], e.odo ? `ODO ${fmtNumber(e.odo)}` : null].filter(Boolean).join(' · ')
            )}
          </span>
        </span>
        {amount(voided)}
      </button>
    </li>
  );
}

// ── Khoản định kỳ ────────────────────────────────────────────────────────────

function RecurringCard({ rows, onOpen, onAdd, now }: { rows: RecurringRow[]; onOpen: (r: RecurringRow) => void; onAdd: () => void; now: number }) {
  const monthly = rows.filter((r) => r.active).reduce((s, r) => s + r.amount / r.intervalMonths, 0);
  return (
    <Card>
      <CardHeader
        title="Khoản định kỳ"
        description={rows.length ? `Khoảng ${fmtVnd(Math.round(monthly))}/tháng · app tự ghi vào sổ khi đến kỳ` : 'Bến bãi, lương, trả góp, bảo hiểm năm… thêm một lần, app tự ghi mỗi kỳ'}
        icon={Repeat}
        action={
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus /> Thêm
          </Button>
        }
      />
      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const next = r.active ? nextRecurringDate(r, now) : null;
            return (
              <li key={r.id}>
                <button onClick={() => onOpen(r)} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 md:px-5', !r.active && 'opacity-60')}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{r.description || CASH_CATEGORY[r.category].label}</span>
                    <span className="block text-sm text-muted">
                      {[recurringText(r), r.plate ?? 'Chung', r.endMonth ? `đến ${fmtMonthKey(r.endMonth).toLowerCase()}` : null, next ? `kỳ tới ${fmtDate(next)}` : r.active ? 'đã hết hạn' : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block font-semibold">{fmtVnd(r.amount)}</span>
                    {!r.active && <Badge>Tạm ngưng</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function HowItWorks() {
  const items: ReactNode[] = [
    <>
      <b>Thu tiền thuê</b> tính theo ngày nhận tiền: tiền khách trả, phần cọc cấn trừ sang tiền thuê, phí hủy giữ lại — trừ tiền hoàn cho khách. <b>Cọc đang giữ</b> là tiền của khách, chưa tính là thu.
    </>,
    <>
      <b>Doanh thu</b> ở trang Tổng quan là giá trị các lượt thuê nhận xe trong tháng (kể cả phần khách chưa trả), nên có thể khác số thu ở đây.
    </>,
    <>
      <b>Lãi vận hành</b> = Tổng thu − Chi vận hành. Mua xe, trả góp, bán xe chỉ tính vào <b>Dòng tiền ròng</b> để không làm sai lãi của tháng.
    </>,
    <>
      <b>Chi phí chung</b> (bến bãi, lương, quảng cáo…) không gắn xe nào. Bật "Chia chi phí chung" để chia đều cho các xe đang chạy khi so lãi từng xe.
    </>,
    <>Ghi nhầm: bấm vào khoản đó → <b>Hủy phiếu</b>. Phiếu hủy vẫn lưu để đối chiếu, không tính vào tổng.</>,
  ];
  return (
    <details className="group rounded-2xl border border-border bg-surface px-4 py-3 text-sm md:px-5">
      <summary className="cursor-pointer font-medium text-muted select-none group-open:mb-2">Cách tính các con số</summary>
      <ul className="list-disc space-y-1.5 pl-5 text-muted">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </details>
  );
}
