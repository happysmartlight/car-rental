// Xe trống & báo giá nhanh: khách hỏi "ngày này còn xe nào, bao nhiêu?" → chọn ngày giờ,
// thấy ngay xe nào trống kèm tổng tiền, cọc, km; tick vài xe gửi Zalo; bấm một xe để đặt luôn.

import { useQuery } from '@tanstack/react-query';
import { Car, Check, CircleAlert, KeyRound, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { ShareSheet, useShareOptions } from '@/components/ShareDialog';
import { Button } from '@/components/ui/button';
import { Checkbox, DateTimeInput, Field } from '@/components/ui/form';
import { Badge, Card, Empty, Notice, PageLoader } from '@/components/ui/misc';
import { api, fileUrl, qs } from '@/lib/api';
import { useSettings } from '@/lib/hooks';
import { renderRentalCard } from '@/lib/rentalCard';
import type { AvailabilityItem, Vehicle } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { FUEL_LABEL, TRANSMISSION_LABEL } from '@shared/constants';
import { buildQuoteShare, type QuoteShareItem } from '@shared/quoteShare';
import { rentalShareText } from '@shared/rentalShare';
import { fmtNumber, fmtVnd } from '@shared/text';
import { DAY_MS, HOUR_MS, addMonthsVn, fmtDateTime, fmtDuration, vnStartOfDay } from '@shared/time';

const vehicleName = (v: Vehicle) => [v.make, v.model, v.year].filter(Boolean).join(' ');
const vehicleDetails = (v: Vehicle) => [v.seats && `${v.seats} chỗ`, v.transmission && TRANSMISSION_LABEL[v.transmission].toLowerCase(), v.fuel && FUEL_LABEL[v.fuel].toLowerCase()].filter(Boolean).join(' · ');

/** Mặc định: ngày mai, giờ nhận xe mặc định của cửa hàng, thuê 1 ngày. */
function defaultSlot(pickupTime: string) {
  const [h, m] = pickupTime.split(':').map(Number);
  const start = vnStartOfDay(Date.now()) + DAY_MS + (h || 0) * HOUR_MS + (m || 0) * 60_000;
  return { start, end: start + DAY_MS };
}

interface QuoteOptions {
  plate: boolean;
  photos: boolean;
  pay: boolean;
}

export default function Quote() {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  /** null = chọn sẵn mọi xe trống. */
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [opt, setOption] = useShareOptions<QuoteOptions>('quote-share-options', { plate: false, photos: true, pay: false });

  useEffect(() => {
    if (start != null || !settings) return;
    const s = defaultSlot(settings.rules.defaultPickupTime ?? '08:30');
    setStart(s.start);
    setEnd(s.end);
  }, [settings, start]);

  const valid = start != null && end != null && end > start;
  const { data, isFetching, error } = useQuery({
    queryKey: ['availability', start, end],
    queryFn: () => api.post<{ items: AvailabilityItem[] }>('/api/rentals/availability', { scheduledStart: start, scheduledEnd: end }),
    enabled: valid,
    placeholderData: (p) => p,
  });
  // Xe trống lên trước, rẻ trước.
  const items = useMemo(() => [...(data?.items ?? [])].sort((a, b) => Number(b.available) - Number(a.available) || a.quote.total - b.quote.total), [data]);
  const free = items.filter((x) => x.available);
  const selected = free.filter((x) => (picked ? picked.has(x.vehicle.id) : true));
  useEffect(() => setPicked(null), [start, end]);

  const toggle = (id: number) => {
    const next = new Set(picked ?? free.map((x) => x.vehicle.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const setDays = (n: number) => start && setEnd(start + n * DAY_MS);
  const setMonths = (n: number) => start && setEnd(addMonthsVn(start, n));
  const chip = (active: boolean) => cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted hover:bg-surface-2');

  const biz = settings?.business;
  const doc = useMemo(() => {
    if (!valid || !biz || !selected.length) return null;
    const list: QuoteShareItem[] = selected.map((x) => ({
      name: vehicleName(x.vehicle),
      plate: x.vehicle.plate,
      details: vehicleDetails(x.vehicle),
      lines: x.quote.lines,
      total: x.quote.total,
      deposit: x.deposit,
      kmLimit: x.quote.kmLimit,
      photoFileId: x.vehicle.photoFileId,
    }));
    return buildQuoteShare({ start: start!, end: end!, items: list, showPlate: opt.plate, shopName: biz.name });
  }, [valid, biz, selected, start, end, opt.plate]);
  const text = doc && biz ? rentalShareText(doc, { name: biz.name, phone: biz.phone, bank: null }) : '';
  const render = doc && biz ? () => renderRentalCard(doc, biz, '', { photos: opt.photos, pay: false }) : null;

  return (
    <Page title="Xe trống & báo giá" subtitle="Khách hỏi ngày này còn xe nào — xem ngay giá từng xe, gửi Zalo" back="/calendar">
      <div className="space-y-4">
        <Card className="space-y-3 p-4 md:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nhận xe">
              <DateTimeInput
                value={start}
                onChange={(v) => {
                  if (v && start && end) setEnd(v + (end - start));
                  setStart(v);
                }}
              />
            </Field>
            <Field label="Trả xe">
              <DateTimeInput value={end} onChange={setEnd} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 5, 7].map((n) => (
              <button key={n} type="button" onClick={() => setDays(n)} className={chip(!!start && !!end && end - start === n * DAY_MS)}>
                {n === 7 ? '1 tuần' : `${n} ngày`}
              </button>
            ))}
            <button type="button" onClick={() => setMonths(1)} className={chip(!!start && !!end && end === addMonthsVn(start, 1))}>
              1 tháng
            </button>
          </div>
          {valid && (
            <p className="text-sm text-muted">
              {fmtDateTime(start)} → {fmtDateTime(end)} · {fmtDuration(end! - start!)}
              {data && ` · ${free.length}/${items.length} xe trống`}
            </p>
          )}
          {start != null && end != null && end <= start && <Notice tone="red">Giờ trả phải sau giờ nhận.</Notice>}
        </Card>

        {error && <Notice tone="red">{errorMessage(error)}</Notice>}
        {!data && valid && !error ? (
          <PageLoader />
        ) : data && !items.length ? (
          <Empty icon={Car} title="Chưa có xe đang hoạt động" description="Thêm xe trong mục Xe." />
        ) : (
          <div className={cn('grid gap-3 md:grid-cols-2', isFetching && 'opacity-70')}>
            {items.map((x) => {
              const v = x.vehicle;
              const on = x.available && selected.some((s) => s.vehicle.id === v.id);
              return (
                <Card key={v.id} className={cn('flex flex-col gap-3 p-4', !x.available && 'opacity-75')}>
                  <div className="flex items-start gap-3">
                    {v.photoFileId ? (
                      <img src={fileUrl(v.photoFileId, { thumb: true })} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                        <Car className="size-6 text-subtle" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{vehicleName(v)}</p>
                      <p className="text-sm text-muted">{[v.plate, vehicleDetails(v)].filter(Boolean).join(' · ')}</p>
                      {x.available ? (
                        <Badge tone="green" dot>
                          Trống
                        </Badge>
                      ) : (
                        <p className="mt-0.5 flex items-start gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          Bận: {x.conflicts[0]?.label}
                          {x.conflicts[0] && ` (${fmtDateTime(x.conflicts[0].start)} → ${x.conflicts[0].end ? fmtDateTime(x.conflicts[0].end) : '…'})`}
                        </p>
                      )}
                    </div>
                    {x.available && <Checkbox className="-m-2 p-2.5" checked={on} onChange={() => toggle(v.id)} label={<span className="sr-only">Chọn gửi báo giá</span>} />}
                  </div>
                  <div className="rounded-2xl bg-surface-2 p-3 text-sm">
                    {x.quote.lines.map((l, i) => (
                      <div key={i} className="flex justify-between gap-3">
                        <span className="text-muted">{l.description}</span>
                        <span className="tabular shrink-0">{fmtNumber(l.amount)}</span>
                      </div>
                    ))}
                    <div className="mt-1.5 flex items-baseline justify-between border-t border-border pt-1.5">
                      <span className="font-medium">Tổng tiền thuê</span>
                      <span className="tabular text-lg font-semibold">{fmtVnd(x.quote.total)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      Cọc {x.deposit ? fmtVnd(x.deposit) : 'không'} · {x.quote.kmLimit ? `giới hạn ${fmtNumber(x.quote.kmLimit)} km` : 'không giới hạn km'}
                      {x.quote.mode === 'month' && ' · tính theo tháng'}
                    </p>
                  </div>
                  <Button
                    variant={x.available ? 'secondary' : 'outline'}
                    size="sm"
                    className="mt-auto"
                    onClick={() => navigate(`/rentals/new${qs({ vehicleId: v.id, start, end })}`)}
                  >
                    <KeyRound /> Đặt xe này
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {free.length > 0 && (
        <>
          <div className="h-20" />
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-xl lg:bottom-0 lg:left-64">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Đã chọn <b className="text-fg">{selected.length}</b>/{free.length} xe trống
              </p>
              <Button size="lg" onClick={() => setShareOpen(true)} disabled={!selected.length}>
                <Send /> Gửi báo giá
              </Button>
            </div>
          </div>
        </>
      )}

      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Gửi báo giá cho khách"
        imageTab="Ảnh báo giá"
        filename="bao-gia-thue-xe.jpg"
        text={text}
        render={render}
        renderKey={JSON.stringify([doc, opt.photos, biz])}
      >
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          <Checkbox checked={opt.photos} onChange={(v) => setOption('photos', v)} label="Ảnh xe" />
          <Checkbox checked={opt.plate} onChange={(v) => setOption('plate', v)} label="Biển số" />
        </div>
        {selected.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Check className="size-3.5" /> {selected.map((x) => x.vehicle.plate).join(', ')}
          </p>
        )}
      </ShareSheet>
    </Page>
  );
}
