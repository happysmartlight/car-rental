// Lịch xe dạng timeline: mỗi hàng một xe, mỗi cột một ngày.

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Segmented } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useMediaQuery, useNow, useSettings } from '@/lib/hooks';
import type { CalendarData } from '@/lib/types';
import { cn } from '@/lib/utils';
import { suggestBookingSlot, type BookingSlot } from '@shared/booking';
import { DAY_MS, fmtDate, fmtDateTime, vnParts, vnStartOfDay, WEEKDAY_SHORT } from '@shared/time';

const STYLE: Record<string, string> = {
  booked: 'bg-blue-100 text-blue-900 ring-blue-300 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-800',
  active: 'bg-violet-100 text-violet-900 ring-violet-300 dark:bg-violet-950 dark:text-violet-100 dark:ring-violet-800',
  returned: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800',
  settled: 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900',
  closed: 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900',
  overdue: 'bg-red-100 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-100 dark:ring-red-800',
  block: 'bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_6px,var(--surface-2)_6px_12px)] text-muted ring-border-strong',
};

// Điện thoại: mỗi ngày một cột rộng cố định, vuốt ngang (cột biển số đứng yên); gần hết dải thì nạp thêm.
const DAY_W = 52;
const NAME_W = 100;
const MOBILE_BEFORE = 14;
const MOBILE_DAYS = MOBILE_BEFORE + 42;
const MORE_DAYS = 28;

const startFor = (desktop: boolean) => vnStartOfDay(Date.now()) - (desktop ? 1 : MOBILE_BEFORE) * DAY_MS;

type CalItem = CalendarData['items'][number];

/** Vì sao giờ nhận/trả gợi ý lệch khỏi mặc định — hiện trong form Đặt xe để người dùng biết mà sửa. */
function slotNotes(s: BookingSlot<CalItem>, items: CalItem[], bufferMin: number): string[] {
  const notes: string[] = [];
  const clean = bufferMin ? ` + ${bufferMin} phút dọn xe` : '';
  // Xe quá hạn chỉ bị tính bận tới "bây giờ" — chưa biết khi nào về, nên nhắc riêng.
  const overdue = items.find((i) => i.overdue);
  if (overdue) notes.push(`Xe chưa về: lượt ${overdue.code} (${overdue.label}) quá hạn từ ${fmtDateTime(overdue.scheduledEnd)} — gọi khách trước khi chốt giờ nhận.`);
  const a = s.after;
  if (a && a !== overdue)
    notes.push(
      a.type === 'block'
        ? `Nhận ${fmtDateTime(s.start)}: xe tạm ngưng (${a.label}) tới ${fmtDateTime(a.end)}.`
        : `Nhận ${fmtDateTime(s.start)}: sau khi lượt ${a.code} (${a.label}) trả xe lúc ${fmtDateTime(a.end)}${clean}.`,
    );
  const b = s.before;
  if (b)
    notes.push(
      b.type === 'block'
        ? `Trả ${fmtDateTime(s.end)}: xe tạm ngưng (${b.label}) từ ${fmtDateTime(b.start)}.`
        : `Trả ${fmtDateTime(s.end)}: kịp dọn xe cho lượt ${b.code} (${b.label}) nhận lúc ${fmtDateTime(b.start)}.`,
    );
  return notes;
}

export default function Calendar() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [span, setSpan] = useState<'7' | '14' | '30'>('14');
  const [mobileDays, setMobileDays] = useState(MOBILE_DAYS);
  const days = isDesktop ? Number(span) : mobileDays;
  const now = useNow();
  const [from, setFrom] = useState(() => startFor(isDesktop));
  const to = from + days * DAY_MS;
  const navigate = useNavigate();
  // Giữ dữ liệu cũ khi nạp thêm ngày: không hiện lại vòng chờ (mất vị trí đang vuốt).
  const { data, isLoading } = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<CalendarData>(`/api/calendar${qs({ from, to })}`),
    placeholderData: (p) => p,
  });

  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => from + i * DAY_MS), [from, days]);
  const pct = (ms: number) => ((Math.min(Math.max(ms, from), to) - from) / (to - from)) * 100;
  const todayStart = vnStartOfDay(now);

  const scroller = useRef<HTMLDivElement>(null);
  const placed = useRef(false); // đã cuộn tới hôm nay lần đầu
  const anchor = useRef<number | null>(null); // thời điểm đang ở mép trái lúc chèn thêm ngày phía trước
  const growing = useRef(false);
  const mode = useRef(isDesktop);

  // Xoay máy qua lại mốc máy tính/điện thoại: về hôm nay.
  useEffect(() => {
    if (mode.current === isDesktop) return;
    mode.current = isDesktop;
    placed.current = false;
    setFrom(startFor(isDesktop));
    setMobileDays(MOBILE_DAYS);
  }, [isDesktop]);

  const ready = !!data;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (isDesktop || !el || !ready || placed.current) return;
    el.scrollLeft = (Math.round((todayStart - from) / DAY_MS) - 1) * DAY_W; // hôm qua ở mép trái
    placed.current = true;
  }, [isDesktop, ready, from, todayStart]);

  // Đặt lại đúng vị trí tuyệt đối (không cộng dồn): trình duyệt có thể đã tự bám lại cột ngày đang snap.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current != null) el.scrollLeft = ((anchor.current - from) / DAY_MS) * DAY_W;
    anchor.current = null;
    growing.current = false;
  }, [from, mobileDays]);

  const onScroll = () => {
    const el = scroller.current;
    if (isDesktop || !el || !placed.current || anchor.current != null || growing.current) return;
    const edge = 7 * DAY_W;
    if (el.scrollLeft < edge) {
      anchor.current = from + (el.scrollLeft / DAY_W) * DAY_MS;
      setFrom((f) => f - MORE_DAYS * DAY_MS);
      setMobileDays((d) => d + MORE_DAYS);
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - edge) {
      growing.current = true;
      setMobileDays((d) => d + MORE_DAYS);
    }
  };

  // Bấm ô ngày → Đặt xe với giờ nhận/trả gợi ý sẵn. Máy tính: giữ chuột kéo ngang để chọn nhiều ngày.
  const { data: settings } = useSettings();
  const [sel, setSel] = useState<{ vehicleId: number; a: number; b: number } | null>(null);
  const book = (vehicleId: number, firstDay: number, lastDay: number) => {
    const bufferMin = settings?.rules.bufferMinutes ?? 0;
    const items = (data?.items ?? []).filter((i) => i.vehicleId === vehicleId);
    const s = suggestBookingSlot({ firstDay, lastDay, items, bufferMs: bufferMin * 60_000, now: Date.now(), pickupTime: settings?.rules.defaultPickupTime });
    navigate(`/rentals/new${qs({ vehicleId, start: s.start, end: s.end })}`, { state: { slotNotes: slotNotes(s, items, bufferMin) } });
  };
  useEffect(() => {
    if (!sel) return;
    const up = () => {
      setSel(null);
      // Một ô (a = b) thì để onClick của ô xử lý — chung đường với chạm/bàn phím.
      if (sel.a !== sel.b) book(sel.vehicleId, Math.min(sel.a, sel.b), Math.max(sel.a, sel.b));
    };
    const cancel = () => setSel(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc);
    };
  });
  const dayAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const idx = Math.min(days - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * days)));
    return Math.max(todayStart, from + idx * DAY_MS);
  };

  const step = (dir: 1 | -1) => {
    if (isDesktop) setFrom(from + dir * days * DAY_MS);
    else scroller.current?.scrollBy({ left: dir * 7 * DAY_W, behavior: 'smooth' });
  };
  const goToday = () => {
    if (isDesktop) setFrom(startFor(true));
    else
      scroller.current?.scrollTo({
        left: (Math.round((todayStart - from) / DAY_MS) - 1) * DAY_W,
        behavior: 'smooth',
      });
  };
  const cols = isDesktop ? `repeat(${days}, minmax(0, 1fr))` : `repeat(${days}, ${DAY_W}px)`;

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
          <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Trước">
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={goToday}>
            Hôm nay
          </Button>
          <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Sau">
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
          <div
            ref={scroller}
            onScroll={onScroll}
            className={cn(!isDesktop && 'scrollbar-thin snap-x snap-mandatory overflow-x-auto overscroll-x-contain')}
            style={isDesktop ? undefined : { scrollPaddingLeft: NAME_W, overflowAnchor: 'none' }}
          >
            <div className={cn('grid', isDesktop ? 'grid-cols-[150px_1fr]' : 'w-max')} style={isDesktop ? undefined : { gridTemplateColumns: `${NAME_W}px ${days * DAY_W}px` }}>
              <div className="sticky left-0 z-20 border-r border-b border-border bg-surface-2" />
              <div className="grid border-b border-border" style={{ gridTemplateColumns: cols }}>
                {dayList.map((d) => {
                  const p = vnParts(d);
                  const today = d === todayStart;
                  const weekend = p.weekday === 0 || p.weekday === 6;
                  return (
                    <div key={d} className={cn('snap-start border-l border-border py-2 text-center first:border-l-0', today && 'bg-brand-soft', weekend && !today && 'bg-surface-2/50')}>
                      <p className={cn('text-[11px]', today ? 'font-semibold text-brand' : 'text-muted')}>{WEEKDAY_SHORT[p.weekday]}</p>
                      <p className={cn('tabular text-sm font-semibold', today && 'text-brand')}>{isDesktop && days > 14 ? p.day : `${p.day}/${p.month}`}</p>
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
                    <Link to={`/vehicles/${v.id}`} className="sticky left-0 z-20 flex min-w-0 flex-col justify-center border-r border-b border-border bg-surface px-2 py-3 hover:bg-surface-2 md:px-3">
                      <span className="text-[13px] font-semibold md:text-sm md:whitespace-nowrap">{v.plate}</span>
                      <span className="truncate text-xs text-muted">{v.model}</span>
                    </Link>
                    <div
                      className={cn('relative border-b border-border', sel && 'select-none')}
                      style={{ minHeight: 16 + laneCount * LANE }}
                      onPointerMove={(e) => {
                        if (sel?.vehicleId !== v.id) return;
                        const b = dayAt(e.currentTarget, e.clientX);
                        if (b !== sel.b) setSel({ ...sel, b });
                      }}
                    >
                      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                        {dayList.map((d) =>
                          d < todayStart ? (
                            <div key={d} className="border-l border-border first:border-l-0" />
                          ) : (
                            <button
                              key={d}
                              className={cn('cursor-pointer border-l border-border first:border-l-0 hover:bg-brand-soft/60', d === todayStart && 'bg-brand-soft/40')}
                              onPointerDown={(e) => {
                                if (e.pointerType !== 'mouse' || e.button !== 0) return;
                                e.preventDefault(); // không bôi đen chữ khi kéo
                                setSel({ vehicleId: v.id, a: d, b: d });
                              }}
                              onClick={() => book(v.id, d, d)}
                              title={isDesktop ? `Đặt ${v.plate} từ ${fmtDate(d)} — giữ chuột kéo ngang để chọn nhiều ngày` : undefined}
                              aria-label={`Đặt xe ${v.plate} ngày ${fmtDate(d)}`}
                            />
                          ),
                        )}
                      </div>
                      {sel?.vehicleId === v.id && sel.a !== sel.b && (
                        <div
                          className="pointer-events-none absolute inset-y-1 z-[6] flex items-center justify-center rounded-lg bg-brand/15 text-xs font-semibold text-brand ring-2 ring-brand ring-inset"
                          style={{ left: `${pct(Math.min(sel.a, sel.b))}%`, width: `${pct(Math.max(sel.a, sel.b) + DAY_MS) - pct(Math.min(sel.a, sel.b))}%` }}
                        >
                          <span className="rounded-md bg-surface px-1.5 py-0.5 shadow-pop">{Math.abs(sel.b - sel.a) / DAY_MS + 1} ngày</span>
                        </div>
                      )}
                      {now >= from && now <= to && <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500" style={{ left: `${pct(now)}%` }} />}
                      {items.map((i, idx) => {
                        const left = pct(i.start);
                        const top = 8 + lanes[idx] * LANE;
                        // Tối thiểu 28px (bấm được) — không tính theo % vì dải ngày trên điện thoại dài dần khi vuốt.
                        const width = `max(${pct(i.end) - left}%, 28px)`;
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
                            style={{
                              left: `${left}%`,
                              width,
                              top,
                              height: LANE - 6,
                            }}
                          >
                            {content}
                          </Link>
                        ) : (
                          <Link
                            key={`b${i.id}`}
                            to={`/vehicles/${v.id}`}
                            title={i.label}
                            className={cn('absolute z-[5] overflow-hidden rounded-lg px-2 py-1 ring-1 ring-inset', style)}
                            style={{
                              left: `${left}%`,
                              width,
                              top,
                              height: LANE - 6,
                            }}
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
          </div>
          {!data.vehicles.length && <p className="p-6 text-center text-sm text-muted">Chưa có xe.</p>}
        </Card>
      )}
    </Page>
  );
}
