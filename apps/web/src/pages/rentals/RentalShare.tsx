// Gửi khách phiếu đặt xe / giao xe / gia hạn / nhận xe / quyết toán (ảnh hoặc tin nhắn Zalo).

import { useEffect, useMemo, useState } from 'react';
import { ShareSheet, useShareOptions } from '@/components/ShareDialog';
import { Checkbox, Segmented } from '@/components/ui/form';
import { useSettings } from '@/lib/hooks';
import { DEFAULT_RENTAL_CARD_OPTIONS, renderRentalCard, type RentalCardOptions } from '@/lib/rentalCard';
import { requirements } from '@/lib/shareCard';
import type { RentalDetail } from '@/lib/types';
import { RENTAL_SHARE_STAGE_LABEL, buildRentalShare, rentalShareStages, rentalShareText, type RentalShareStage } from '@shared/rentalShare';
import { cancelPolicyText, rentalFineHold } from '@shared/money';
import { plateKey } from '@shared/text';

const FILE_PREFIX: Record<RentalShareStage, string> = { book: 'dat-xe', pickup: 'giao-xe', extend: 'gia-han', return: 'nhan-xe', settle: 'quyet-toan' };

/** Giai đoạn gửi được với lượt thuê này (rỗng = chưa giao xe hoặc đã hủy). */
export function rentalShareStagesOf(d: RentalDetail): RentalShareStage[] {
  return rentalShareStages(
    d.rental.status,
    d.handovers.some((h) => h.kind === 'pickup'),
    d.handovers.some((h) => h.kind === 'return'),
    d.extensions.length > 0,
  );
}

export function RentalShareDialog({ d, open, onOpenChange, initialStage }: { d: RentalDetail; open: boolean; onOpenChange: (o: boolean) => void; initialStage?: RentalShareStage }) {
  const { data: settings } = useSettings();
  const [opt, setOption] = useShareOptions<RentalCardOptions>('rental-share-options', DEFAULT_RENTAL_CARD_OPTIONS);
  const stages = rentalShareStagesOf(d);
  const [picked, setPicked] = useState<RentalShareStage | null>(null);
  // Mỗi lần mở: giai đoạn được chỉ định (vd vừa gia hạn), không thì giai đoạn mới nhất.
  useEffect(() => {
    if (open) setPicked(initialStage ?? null);
  }, [open, initialStage]);
  const stage = picked && stages.includes(picked) ? picked : stages[stages.length - 1];

  const biz = settings?.business;
  const bank =
    biz?.bankBin && biz.bankAccount ? { name: settings?.banks.find((b) => b.bin === biz.bankBin)?.name ?? biz.bankName, account: biz.bankAccount, holder: biz.bankAccountName } : null;
  const doc = useMemo(() => {
    if (!stage || !settings) return null;
    return buildRentalShare({
      stage,
      rental: d.rental,
      customerName: d.customer.fullName,
      vehicle: d.vehicle,
      pickup: d.handovers.find((h) => h.kind === 'pickup') ?? null,
      ret: [...d.handovers].reverse().find((h) => h.kind === 'return') ?? null,
      charges: d.charges,
      money: d.money,
      extension: d.extensions.at(-1) ?? null,
      cancelPolicy: cancelPolicyText(settings.rules, d.rental.depositRequired > 0),
      fineHold: d.rental.depositRequired > 0 ? rentalFineHold(d.rental, settings.rules) : null,
      requirements: requirements(settings.rules),
      graceMinutes: settings.rules.graceMinutes,
      shopName: settings.business.name,
      shopAddress: settings.business.address,
    });
  }, [d, stage, settings]);
  const text = doc && biz ? rentalShareText(doc, { name: biz.name, phone: biz.phone, bank: opt.pay ? bank : null }) : '';
  const render = doc && biz ? () => renderRentalCard(doc, biz, bank?.name ?? '', opt) : null;

  return (
    <ShareSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Gửi thông tin cho khách"
      imageTab={stage ? `Ảnh phiếu ${RENTAL_SHARE_STAGE_LABEL[stage].toLowerCase()}` : 'Ảnh phiếu'}
      filename={`${FILE_PREFIX[stage ?? 'pickup']}-${plateKey(d.rental.code).toLowerCase()}.jpg`}
      text={text}
      render={render}
      renderKey={JSON.stringify([doc, opt, biz, bank])}
    >
      {stages.length > 1 && (
        <Segmented value={stage} onChange={setPicked} className="flex w-full" options={stages.map((s) => ({ value: s, label: RENTAL_SHARE_STAGE_LABEL[s] }))} />
      )}
      {doc && (doc.photos.length > 0 || doc.pay) && (
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          {doc.photos.length > 0 && <Checkbox checked={opt.photos} onChange={(v) => setOption('photos', v)} label={`Ảnh xe (${doc.photos.length})`} />}
          {doc.pay && <Checkbox checked={opt.pay} onChange={(v) => setOption('pay', v)} label="Mã QR chuyển khoản" />}
        </div>
      )}
    </ShareSheet>
  );
}
