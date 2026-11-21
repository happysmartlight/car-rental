// Hộp tóm tắt trước khi chốt giao / nhận xe: ODO, mức xăng-pin, ảnh, giấy tờ, phụ kiện, tiền — xem lại một lượt rồi mới ghi.

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InfoRow, Notice } from '@/components/ui/misc';
import type { HandoverAccessory, RentalDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PAYMENT_METHOD_LABEL } from '@shared/constants';
import { dueAfterDeposit, planSettlement } from '@shared/money';
import { fmtNumber, fmtVnd } from '@shared/text';
import { fmtDateTime, fmtDuration } from '@shared/time';

type Collect = { amount: number | null; method: 'cash' | 'transfer' };

export interface HandoverReviewValues {
  at: number;
  odo: number;
  fuel: number;
  photosTaken: number;
  photoSlots: number;
  extraPhotos: number;
  damages: { zone: string; note: string; isNew?: boolean }[];
  checklist: Record<string, boolean>;
  acc: HandoverAccessory[];
  signed: boolean;
  notes: string;
  /** Giao xe: tiền thuê / tiền cọc thu tại chỗ. */
  collect: Collect;
  collectDeposit: Collect;
  /** Nhận xe: các khoản phụ phí sẽ ghi. */
  charges: { kind: string; description: string; amount: number }[];
  /** Nhận xe: đã tra phí thu phí không dừng (ETC). */
  etcChecked: boolean;
}

/** Chữ nổi màu khi có vấn đề cần nhìn lại. */
const Warn = ({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'red' }) => (
  <span className={tone === 'red' ? 'text-red-600' : 'text-amber-700'}>{children}</span>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      <div className="divide-y divide-border rounded-2xl border border-border px-3.5">{children}</div>
    </section>
  );
}

const Row = ({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) => (
  <InfoRow label={label} className={cn('py-2.5', strong && 'text-base [&>span:last-child]:font-semibold')}>
    {children}
  </InfoRow>
);

const paid = (c: Collect) => (c.amount ? `${fmtVnd(c.amount)} · ${PAYMENT_METHOD_LABEL[c.method]}` : null);

export function HandoverReview({
  open,
  onOpenChange,
  onConfirm,
  saving,
  kind,
  d,
  advance,
  fineHold,
  v,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  saving: boolean;
  kind: 'pickup' | 'return';
  d: RentalDetail;
  /** Cọc giữ xe (khách gửi trước lúc giao xe) — trừ vào tiền thuê. Cọc thu lúc giao là cọc phạt nguội, không trừ. */
  advance: number;
  /** Mức giữ chờ phạt nguội của lượt (để ước tính cọc hoàn khi nhận xe); null = chưa tải cài đặt. */
  fineHold: number | null;
  v: HandoverReviewValues;
}) {
  const isPickup = kind === 'pickup';
  const r = d.rental;
  const m = d.money;
  const pickupHo = d.handovers.find((h) => h.kind === 'pickup');
  const fuelName = d.vehicle.fuel === 'electric' ? 'Mức pin' : d.vehicle.fuel === 'diesel' ? 'Mức dầu' : 'Mức xăng';

  const missingPhotos = v.photoSlots - v.photosTaken;
  const docsMissing = Object.entries(v.checklist).filter(([, ok]) => !ok).map(([k]) => k);
  const accMissing = v.acc.filter((a) => !a.present);
  const accPresent = v.acc.filter((a) => a.present);
  const newDamages = v.damages.filter((x) => x.isNew);
  const evidence = [missingPhotos > 0 && `${missingPhotos} ảnh theo khung`, !v.signed && 'chữ ký khách'].filter(Boolean) as string[];
  const issues = [
    evidence.length > 0 && `Còn thiếu ${evidence.join(' và ')} — ảnh và chữ ký là bằng chứng khi có tranh chấp.`,
    !isPickup && !v.etcChecked && 'Chưa tra phí ETC của xe trong thời gian thuê — dễ quên thu khách.',
  ].filter(Boolean) as string[];
  const tollTotal = v.charges.filter((c) => c.kind === 'toll').reduce((s, c) => s + c.amount, 0);

  // Giờ so với lịch hẹn (lệch dưới 15 phút coi như đúng hẹn).
  const planned = isPickup ? r.scheduledStart : r.scheduledEnd;
  const drift = v.at - planned;
  const timeNote = Math.abs(drift) < 15 * 60_000 ? 'đúng hẹn' : `${drift < 0 ? 'sớm' : 'trễ'} ${fmtDuration(Math.abs(drift))}`;

  // ── Tiền: còn phải trả = tổng − đã trả − cọc giữ xe; cọc phạt nguội không trừ ──
  const totalNow = (v.collect.amount ?? 0) + (v.collectDeposit.amount ?? 0);
  const cashNow = (v.collect.method === 'cash' ? (v.collect.amount ?? 0) : 0) + (v.collectDeposit.method === 'cash' ? (v.collectDeposit.amount ?? 0) : 0);
  const depositAfter = m.depositHeld + (v.collectDeposit.amount ?? 0);
  const extraTotal = v.charges.reduce((s, c) => s + c.amount, 0);
  const owed = isPickup ? dueAfterDeposit({ due: m.due - (v.collect.amount ?? 0), depositHeld: depositAfter }, advance) : dueAfterDeposit({ due: m.due + extraTotal, depositHeld: m.depositHeld }, advance);
  const plan = !isPickup && fineHold != null ? planSettlement({ ...m, totalCharges: m.totalCharges + extraTotal, due: m.due + extraTotal }, fineHold, advance) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isPickup ? 'Kiểm tra lại trước khi giao xe' : 'Kiểm tra lại trước khi nhận xe'}
      description={`${r.code} · ${d.vehicle.plate} · ${d.customer.fullName}`}
      footer={
        <>
          <Button variant="ghost" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)} disabled={saving}>
            Quay lại sửa
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={onConfirm} loading={saving}>
            {isPickup ? <ArrowUpFromLine /> : <ArrowDownToLine />} {isPickup ? 'Xác nhận giao xe' : 'Xác nhận nhận xe'}
          </Button>
        </>
      }
    >
      {issues.length > 0 && (
        <Notice tone="amber" icon={AlertTriangle} className="mb-4">
          {issues.map((t) => (
            <span key={t} className="block">
              {t}
            </span>
          ))}
          <span className="block text-xs opacity-80">Vẫn xác nhận được.</span>
        </Notice>
      )}

      <Section title="Xe">
        <Row label={isPickup ? 'Giờ giao' : 'Giờ nhận'}>
          {fmtDateTime(v.at)} <span className="font-normal text-muted">· {drift > 15 * 60_000 && !isPickup ? <Warn>{timeNote}</Warn> : timeNote}</span>
        </Row>
        {isPickup ? (
          <Row label="ODO">
            {fmtNumber(v.odo)} km
            {v.odo < d.vehicle.odo - 5 ? (
              <Warn tone="red"> · nhỏ hơn lần trước ({fmtNumber(d.vehicle.odo)})</Warn>
            ) : (
              v.odo !== d.vehicle.odo && <span className="font-normal text-muted"> · lần trước {fmtNumber(d.vehicle.odo)}</span>
            )}
          </Row>
        ) : (
          <>
            <Row label="ODO">
              {pickupHo && <span className="font-normal text-muted">{fmtNumber(pickupHo.odo)} → </span>}
              {fmtNumber(v.odo)} km
            </Row>
            {pickupHo && (
              <Row label="Quãng đường">
                {v.odo < pickupHo.odo ? (
                  <Warn tone="red">ODO nhỏ hơn lúc giao</Warn>
                ) : r.kmLimit && v.odo - pickupHo.odo > r.kmLimit ? (
                  <Warn>
                    {fmtNumber(v.odo - pickupHo.odo)} km · vượt {fmtNumber(v.odo - pickupHo.odo - r.kmLimit)} km
                  </Warn>
                ) : (
                  <>
                    {fmtNumber(v.odo - pickupHo.odo)} km
                    <span className="font-normal text-muted"> / {r.kmLimit ? fmtNumber(r.kmLimit) : 'không giới hạn'}</span>
                  </>
                )}
              </Row>
            )}
          </>
        )}
        <Row label={fuelName}>
          {!isPickup && pickupHo && <span className="font-normal text-muted">{pickupHo.fuelLevel}% → </span>}
          {!isPickup && pickupHo && v.fuel < pickupHo.fuelLevel ? <Warn>{v.fuel}% (thiếu {pickupHo.fuelLevel - v.fuel}%)</Warn> : `${v.fuel}%`}
        </Row>
      </Section>

      <Section title="Biên bản">
        <Row label="Ảnh xe">
          {missingPhotos > 0 ? <Warn>{v.photosTaken}/{v.photoSlots} khung</Warn> : `Đủ ${v.photoSlots} khung`}
          {v.extraPhotos > 0 && <span className="font-normal text-muted"> + {v.extraPhotos} ảnh thêm</span>}
        </Row>
        {isPickup ? (
          <Row label="Vết có sẵn">{v.damages.length ? v.damages.map((x) => x.zone).join(', ') : <span className="font-normal text-muted">Không ghi</span>}</Row>
        ) : (
          <Row label="Hư hỏng mới">{newDamages.length ? <Warn tone="red">{newDamages.map((x) => x.zone).join(', ')}</Warn> : <span className="font-normal text-muted">Không có</span>}</Row>
        )}
        {Object.keys(v.checklist).length > 0 && (
          <Row label="Giấy tờ">{docsMissing.length ? <Warn>{isPickup ? 'Không giao' : 'Thiếu'}: {docsMissing.join(', ')}</Warn> : `Đủ ${Object.keys(v.checklist).length} mục`}</Row>
        )}
        {v.acc.length > 0 && (
          <Row label="Phụ kiện">
            {isPickup ? (
              `${accPresent.length} món`
            ) : accMissing.length ? (
              <Warn tone="red">Thiếu: {accMissing.map((a) => a.name).join(', ')}</Warn>
            ) : (
              `Đủ ${v.acc.length} món`
            )}
          </Row>
        )}
        <Row label="Chữ ký khách">{v.signed ? 'Đã ký' : <Warn>Chưa ký</Warn>}</Row>
        {!isPickup && <Row label="Phí ETC">{v.etcChecked ? (tollTotal > 0 ? `Đã tra · thu ${fmtVnd(tollTotal)}` : 'Đã tra · không có phí') : <Warn>Chưa tra</Warn>}</Row>}
        {v.notes.trim() && <Row label="Ghi chú">{v.notes.trim()}</Row>}
      </Section>

      {isPickup ? (
        <Section title="Tiền">
          <Row label="Tổng tiền thuê">{fmtVnd(m.totalCharges)}</Row>
          {m.rentPaid !== 0 && <Row label="Đã trả trước">{fmtVnd(m.rentPaid)}</Row>}
          <Row label="Thu tiền thuê lúc này">{paid(v.collect) ?? <span className="font-normal text-muted">Chưa thu</span>}</Row>
          <Row label="Thu cọc lúc này">{paid(v.collectDeposit) ?? <span className="font-normal text-muted">Chưa thu</span>}</Row>
          <Row label="Cọc giữ sau khi giao">
            {r.depositRequired > 0 && depositAfter < r.depositRequired ? (
              <Warn>
                {fmtVnd(depositAfter)} / {fmtVnd(r.depositRequired)}
              </Warn>
            ) : (
              fmtVnd(depositAfter)
            )}
          </Row>
          {owed.credit > 0 && <Row label="Trừ cọc giữ xe">−{fmtVnd(owed.credit)}</Row>}
          <Row label={owed.net < 0 ? 'Thu dư' : 'Còn phải trả'}>{owed.net < 0 ? <Warn>{fmtVnd(-owed.net)}</Warn> : fmtVnd(owed.net)}</Row>
          <Row label="Nhận của khách ngay" strong>
            {fmtVnd(totalNow)}
            {totalNow > 0 && (
              <span className="block text-xs font-normal text-muted">
                {cashNow > 0 && `Tiền mặt ${fmtVnd(cashNow)}`}
                {cashNow > 0 && totalNow - cashNow > 0 && ' · '}
                {totalNow - cashNow > 0 && `Chuyển khoản ${fmtVnd(totalNow - cashNow)}`}
              </span>
            )}
          </Row>
        </Section>
      ) : (
        <>
          <Section title="Phụ phí">
            {v.charges.length ? (
              <>
                {v.charges.map((c, i) => (
                  <Row key={i} label={c.description}>
                    {fmtVnd(c.amount)}
                  </Row>
                ))}
                {v.charges.length > 1 && <Row label="Tổng phụ phí">{fmtVnd(extraTotal)}</Row>}
              </>
            ) : (
              <Row label="Phụ phí">
                <span className="font-normal text-muted">Không có</span>
              </Row>
            )}
          </Section>
          <Section title="Tiền">
            <Row label="Tiền thuê & phí">{fmtVnd(m.totalCharges + extraTotal)}</Row>
            <Row label="Đã trả">{fmtVnd(m.rentPaid)}</Row>
            <Row label="Cọc đang giữ">{fmtVnd(m.depositHeld)}</Row>
            {owed.credit > 0 && <Row label="Trừ cọc giữ xe">−{fmtVnd(owed.credit)}</Row>}
            <Row label={owed.net < 0 ? 'Thu thừa, phải hoàn' : 'Còn phải trả'} strong>
              {fmtVnd(Math.abs(owed.net))}
            </Row>
            {plan && plan.keepHold > 0 && <Row label="Giữ chờ phạt nguội">{fmtVnd(plan.keepHold)}</Row>}
            {plan && plan.refundDeposit > 0 && <Row label="Cọc hoàn lại">{fmtVnd(plan.refundDeposit)}</Row>}
          </Section>
          <p className="mt-3 text-xs text-muted">Xác nhận xong sẽ sang bước quyết toán — số tiền ở đó còn chỉnh được.</p>
        </>
      )}
    </Dialog>
  );
}
