// Thu lại tiền phạt nguội từ khách: gửi khách thông báo (ảnh / tin nhắn kèm mã QR),
// rồi ghi "khách đã trả lại" — tiền vào sổ của lượt thuê nên Thu chi và công nợ khớp nhau.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useSettings } from '@/lib/hooks';
import { DEFAULT_RENTAL_CARD_OPTIONS, renderRentalCard, type RentalCardOptions } from '@/lib/rentalCard';
import type { RentalDetail, TrafficFine } from '@/lib/types';
import { FINE_DONE_STATUSES } from '@shared/constants';
import { buildFineShare } from '@shared/fineShare';
import { rentalShareText } from '@shared/rentalShare';
import { fmtVnd, plateKey } from '@shared/text';
import { fmtDateTime } from '@shared/time';
import { VietQr } from './common';
import { ShareSheet, useShareOptions } from './ShareDialog';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Checkbox, DateTimeInput, Field, MoneyInput, Segmented } from './ui/form';
import { Notice, Spinner } from './ui/misc';

export type FineLike = Pick<TrafficFine, 'id' | 'plate' | 'violatedAt' | 'location' | 'violation' | 'amount' | 'status' | 'noticeFileId' | 'rentalId'> & { voidedAt?: number | null };

/** Còn phải thu tiền phạt của khách (đã gắn lượt thuê, chưa thu / chưa xong, không phải hồ sơ đã hủy). */
export const fineCollectible = (f: FineLike) => !!f.rentalId && !f.voidedAt && !FINE_DONE_STATUSES.includes(f.status);

function useFineRental(fine: FineLike | null, open: boolean) {
  return useQuery({
    queryKey: ['rental', String(fine?.rentalId)],
    queryFn: () => api.get<RentalDetail>(`/api/rentals/${fine!.rentalId}`),
    enabled: open && !!fine?.rentalId,
  });
}

export function FineShareDialog({ fine, open, onOpenChange }: { fine: FineLike | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: settings } = useSettings();
  const { data: d } = useFineRental(fine, open);
  const [opt, setOption] = useShareOptions<RentalCardOptions>('fine-share-options', DEFAULT_RENTAL_CARD_OPTIONS);
  const biz = settings?.business;
  const bank =
    biz?.bankBin && biz.bankAccount ? { name: settings?.banks.find((b) => b.bin === biz.bankBin)?.name ?? biz.bankName, account: biz.bankAccount, holder: biz.bankAccountName } : null;
  const doc = useMemo(() => {
    if (!fine || !settings || (fine.rentalId && !d)) return null;
    const first = d?.segments[0];
    const last = d?.segments.at(-1);
    return buildFineShare({
      fine,
      rental: d ? { code: d.rental.code, start: first?.startAt ?? d.rental.scheduledStart, end: first ? (last?.endAt ?? null) : d.rental.scheduledEnd } : null,
      customerName: d?.customer.fullName ?? '',
      shopName: settings.business.name,
    });
  }, [fine, settings, d]);
  const text = doc && biz ? rentalShareText(doc, { name: biz.name, phone: biz.phone, bank: opt.pay ? bank : null }) : '';
  const render = doc && biz ? () => renderRentalCard(doc, biz, bank?.name ?? '', opt) : null;
  return (
    <ShareSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Báo khách phạt nguội"
      imageTab="Ảnh thông báo"
      filename={`phat-nguoi-${plateKey(fine?.plate ?? 'xe').toLowerCase()}.jpg`}
      text={text}
      render={render}
      renderKey={JSON.stringify([doc, opt, biz, bank])}
    >
      {doc && (doc.photos.length > 0 || doc.pay) && (
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          {doc.photos.length > 0 && <Checkbox checked={opt.photos} onChange={(v) => setOption('photos', v)} label="Ảnh thông báo vi phạm" />}
          {doc.pay && <Checkbox checked={opt.pay} onChange={(v) => setOption('pay', v)} label="Mã QR chuyển khoản" />}
        </div>
      )}
      {fine && !fine.amount && <Notice tone="amber">Chưa nhập mức phạt — phiếu sẽ ghi "Chờ quyết định xử phạt", không kèm mã QR.</Notice>}
    </ShareSheet>
  );
}

type Method = 'transfer' | 'cash' | 'deposit';

export function FineRecoverDialog({ fine, open, onOpenChange }: { fine: FineLike | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: d, isLoading } = useFineRental(fine, open);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('transfer');
  const [at, setAt] = useState<number | null>(Date.now());
  const holding = d?.rental.status === 'settled' && d.money.depositHeld > 0;
  useEffect(() => {
    if (!open || !fine) return;
    setAmount(fine.amount);
    setAt(Date.now());
    setMethod('transfer');
  }, [open, fine]);
  // Lượt đang giữ cọc chờ phạt nguội → mặc định trừ thẳng vào cọc.
  useEffect(() => {
    if (open && holding) setMethod('deposit');
  }, [open, holding]);
  const save = useAction(() => api.post(`/api/fines/${fine!.id}/recover`, { amount, method, at: method === 'deposit' ? undefined : at }), {
    invalidate: [['fines'], ['rental', String(fine?.rentalId)], ['rentals'], ['dashboard'], ['cashflow']],
    success: method === 'deposit' ? 'Đã trừ tiền phạt vào cọc' : 'Đã ghi khách trả lại tiền phạt',
    onSuccess: () => onOpenChange(false),
  });
  // Cọc không đủ: trừ hết cọc, phần thiếu ghi thành khoản khách còn nợ.
  const shortBy = method === 'deposit' && d ? Math.max(0, (amount ?? 0) - d.money.depositHeld) : 0;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Thu lại tiền phạt"
      description={fine ? `${fine.plate} · ${fmtDateTime(fine.violatedAt)}${fine.violation ? ` · ${fine.violation}` : ''}` : undefined}
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!amount || !d}>
          {method === 'deposit' ? 'Trừ vào cọc' : 'Ghi đã thu'}
        </Button>
      }
    >
      {isLoading || !d ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Ghi vào lượt thuê <b className="text-fg">{d.rental.code}</b> ({d.customer.fullName}): thêm khoản "Phạt nguội" và phiếu thu — trang Thu chi tính đúng tiền đã thu lại.
          </p>
          <Field label="Số tiền phạt">
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Khách trả bằng">
            <Segmented
              value={method}
              onChange={setMethod}
              className="flex w-full"
              options={[
                { value: 'transfer', label: 'Chuyển khoản' },
                { value: 'cash', label: 'Tiền mặt' },
                ...(holding ? [{ value: 'deposit' as const, label: 'Trừ vào cọc' }] : []),
              ]}
            />
          </Field>
          {method === 'deposit' ? (
            <Notice tone={shortBy ? 'amber' : 'blue'}>
              Đang giữ {fmtVnd(d.money.depositHeld)} chờ phạt nguội.{' '}
              {shortBy
                ? `Trừ hết cọc, còn thiếu ${fmtVnd(shortBy)} — ghi thành khoản khách còn nợ, Việc cần làm sẽ nhắc thu.`
                : `Còn giữ ${fmtVnd(d.money.depositHeld - (amount ?? 0))} sau khi trừ.`}
            </Notice>
          ) : (
            <Field label="Thời điểm nhận tiền">
              <DateTimeInput value={at} onChange={setAt} />
            </Field>
          )}
          {method === 'transfer' && !!amount && <VietQr amount={amount} note={`${d.rental.code} PHAT NGUOI`} />}
        </div>
      )}
    </Dialog>
  );
}
