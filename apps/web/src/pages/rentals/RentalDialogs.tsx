import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { VietQr } from '@/components/common';
import { CustomerPicker } from '@/components/CustomerPicker';
import { MultiPhotoInput } from '@/components/images';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DateTimeInput, Field, Input, MoneyInput, NumberInput, Segmented, Select, Textarea } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAction, useSettings } from '@/lib/hooks';
import type { Customer, Precheck, RentalDetail, VehicleWithStatus } from '@/lib/types';
import { CHARGE_KINDS, CHARGE_KIND_LABEL, COLLATERAL_KINDS, COLLATERAL_KIND_LABEL, type ChargeKind, type CollateralKind } from '@shared/constants';
import { planSettlement } from '@shared/money';
import { fmtNumber, fmtVnd } from '@shared/text';
import { DAY_MS, fmtDate, fmtDateTime } from '@shared/time';

type DialogProps = { d: RentalDetail; open: boolean; onOpenChange: (o: boolean) => void };
const inv = (id: number) => ({ invalidate: [['rental', String(id)], ['rentals'], ['dashboard'], ['calendar']] });

// ── Thu / chi tiền ────────────────────────────────────────────────────────────

type PayPreset = 'rent_in' | 'deposit_in' | 'deposit_out' | 'rent_out';
const PRESETS: Record<PayPreset, { label: string; direction: 'in' | 'out'; purpose: 'rent' | 'deposit' }> = {
  rent_in: { label: 'Khách trả tiền thuê', direction: 'in', purpose: 'rent' },
  deposit_in: { label: 'Khách đặt cọc', direction: 'in', purpose: 'deposit' },
  deposit_out: { label: 'Hoàn cọc cho khách', direction: 'out', purpose: 'deposit' },
  rent_out: { label: 'Hoàn tiền thuê thừa', direction: 'out', purpose: 'rent' },
};

export function PaymentDialog({ d, open, onOpenChange, preset = 'rent_in' }: DialogProps & { preset?: PayPreset }) {
  const [kind, setKind] = useState<PayPreset>(preset);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  const [at, setAt] = useState<number | null>(Date.now());
  const [note, setNote] = useState('');
  const suggested = useMemo(() => {
    const m = d.money;
    return { rent_in: Math.max(0, m.due), deposit_in: Math.max(0, d.rental.depositRequired - m.depositHeld), deposit_out: Math.max(0, m.depositHeld), rent_out: Math.max(0, -m.due) }[kind];
  }, [d, kind]);
  useEffect(() => {
    if (open) {
      setKind(preset);
      setAt(Date.now());
      setNote('');
    }
  }, [open, preset]);
  useEffect(() => setAmount(suggested || null), [suggested]);
  const save = useAction(() => api.post(`/api/rentals/${d.rental.id}/payments`, { ...PRESETS[kind], method, amount, at, note: note || null }), {
    ...inv(d.rental.id),
    success: 'Đã ghi nhận',
    onSuccess: () => onOpenChange(false),
  });
  const p = PRESETS[kind];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ghi nhận tiền" footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!amount}>Lưu</Button>}>
      <div className="space-y-4">
        <Select value={kind} onChange={(e) => setKind(e.target.value as PayPreset)}>
          {Object.entries(PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Số tiền" hint={suggested ? `Gợi ý: ${fmtVnd(suggested)}` : undefined}>
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Hình thức">
            <Segmented value={method} onChange={setMethod} className="flex w-full" options={[{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} />
          </Field>
          <Field label="Thời điểm">
            <DateTimeInput value={at} onChange={setAt} />
          </Field>
          <Field label="Ghi chú">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {p.direction === 'in' && method === 'transfer' && !!amount && <VietQr amount={amount} note={d.rental.code} />}
      </div>
    </Dialog>
  );
}

// ── Thêm khoản phí / giảm giá ─────────────────────────────────────────────────

export function ChargeDialog({ d, open, onOpenChange }: DialogProps) {
  const [kind, setKind] = useState<ChargeKind>('other');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setKind('other');
      setDescription('');
      setAmount(null);
    }
  }, [open]);
  const save = useAction(
    () => api.post(`/api/rentals/${d.rental.id}/charges`, { kind, description: description || CHARGE_KIND_LABEL[kind], amount: kind === 'discount' ? -(amount ?? 0) : amount }),
    { ...inv(d.rental.id), success: 'Đã thêm khoản', onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Thêm khoản tiền" description="Phụ phí, bồi thường, giảm giá…" footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!amount}>Thêm</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loại">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ChargeKind)}>
            {CHARGE_KINDS.filter((k) => k !== 'rental').map((k) => (
              <option key={k} value={k}>
                {CHARGE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={kind === 'discount' ? 'Số tiền giảm' : 'Số tiền'}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Diễn giải" className="sm:col-span-2">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={CHARGE_KIND_LABEL[kind]} />
        </Field>
      </div>
    </Dialog>
  );
}

// ── Quyết toán khi trả xe ─────────────────────────────────────────────────────

export function SettleDialog({ d, open, onOpenChange }: DialogProps) {
  const { data: settings } = useSettings();
  const rules = settings?.rules;
  const m = d.money;
  const plan = planSettlement(m, rules?.fineHoldAmount ?? 0);
  const [offset, setOffset] = useState<number | null>(plan.offset);
  const [keep, setKeep] = useState<number | null>(plan.keepHold);
  const [days, setDays] = useState<number | null>(rules?.fineHoldDays ?? 15);
  const [collectMethod, setCollectMethod] = useState<'cash' | 'transfer'>('transfer');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'transfer'>('transfer');
  useEffect(() => {
    if (!open) return;
    const p = planSettlement(d.money, rules?.fineHoldAmount ?? 0);
    setOffset(p.offset);
    setKeep(p.keepHold);
    setDays(rules?.fineHoldDays ?? 15);
  }, [open, d.money, rules]);

  const off = Math.min(offset ?? 0, Math.max(0, m.depositHeld), Math.max(0, m.due));
  const collect = Math.max(0, m.due - off);
  const refundRent = m.due < 0 ? -m.due : 0;
  const keepHold = Math.min(keep ?? 0, Math.max(0, m.depositHeld - off));
  const refundDeposit = Math.max(0, m.depositHeld - off - keepHold);

  const save = useAction(
    () =>
      api.post(`/api/rentals/${d.rental.id}/settle`, {
        offset: off,
        collect: collect > 0 ? { amount: collect, method: collectMethod } : null,
        refundRent: refundRent > 0 ? { amount: refundRent, method: refundMethod } : null,
        refundDeposit: refundDeposit > 0 ? { amount: refundDeposit, method: refundMethod } : null,
        fineHoldDays: days ?? 0,
        returnCollaterals: true,
      }),
    { ...inv(d.rental.id), success: 'Đã quyết toán', onSuccess: () => onOpenChange(false) },
  );

  const Row = ({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: string }) => (
    <div className={`flex justify-between py-1.5 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span className={`tabular ${tone ?? ''}`}>{fmtVnd(value)}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Quyết toán" description={`${d.rental.code} · ${d.customer.fullName}`} size="lg" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>Xác nhận quyết toán</Button>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="divide-y divide-border rounded-2xl border border-border px-4 py-2">
            <Row label="Tổng phải trả" value={m.totalCharges} />
            <Row label="Đã trả tiền thuê" value={m.rentPaid} />
            <Row label="Còn phải trả" value={Math.max(0, m.due)} strong />
            <Row label="Cọc đang giữ" value={m.depositHeld} />
          </div>
          <div className="mt-4 space-y-4">
            <Field label="Cấn trừ từ cọc" hint="Lấy tiền cọc trả phần còn thiếu">
              <MoneyInput value={offset} onChange={setOffset} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Giữ lại chờ phạt nguội">
                <MoneyInput value={keep} onChange={setKeep} />
              </Field>
              <Field label="Trong">
                <NumberInput value={days} onChange={setDays} suffix="ngày" />
              </Field>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="divide-y divide-border rounded-2xl bg-surface-2 px-4 py-2">
            <Row label="Khách trả thêm" value={collect} strong tone={collect ? 'text-red-600' : ''} />
            {refundRent > 0 && <Row label="Hoàn tiền thuê thừa" value={refundRent} strong />}
            <Row label="Hoàn cọc ngay" value={refundDeposit} strong tone={refundDeposit ? 'text-emerald-600' : ''} />
            <Row label="Giữ lại chờ phạt nguội" value={keepHold} />
          </div>
          {keepHold > 0 && days ? <p className="text-sm text-muted">Hạn hoàn phần giữ lại: {fmtDate((d.rental.actualEnd ?? Date.now()) + days * DAY_MS)}. App sẽ nhắc.</p> : null}
          {collect > 0 && (
            <Field label="Khách trả bằng">
              <Segmented value={collectMethod} onChange={setCollectMethod} className="flex w-full" options={[{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} />
            </Field>
          )}
          {(refundDeposit > 0 || refundRent > 0) && (
            <Field label="Hoàn cho khách bằng">
              <Segmented value={refundMethod} onChange={setRefundMethod} className="flex w-full" options={[{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} />
            </Field>
          )}
          {collect > 0 && collectMethod === 'transfer' && <VietQr amount={collect} note={d.rental.code} />}
          {d.collaterals.some((c) => !c.returnedAt) && <Notice tone="blue">Tài sản thế chấp sẽ được đánh dấu đã trả lại cho khách.</Notice>}
        </div>
      </div>
    </Dialog>
  );
}

// ── Hết hạn giữ cọc: trừ phạt nguội + hoàn ───────────────────────────────────

export function ReleaseHoldDialog({ d, open, onOpenChange }: DialogProps) {
  const [rows, setRows] = useState<{ description: string; amount: number | null }[]>([]);
  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  useEffect(() => {
    if (open) setRows(d.fines.filter((f) => f.amount && f.status !== 'customer_paid' && f.status !== 'recovered').map((f) => ({ description: `Phạt nguội ${fmtDateTime(f.violatedAt)}: ${f.violation ?? ''}`.trim(), amount: f.amount })));
  }, [open, d.fines]);
  const deducted = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const refund = d.money.depositHeld - deducted;
  const save = useAction(
    () =>
      api.post(`/api/rentals/${d.rental.id}/release-hold`, {
        deductions: rows.filter((r) => r.amount).map((r) => ({ kind: 'fine', description: r.description || 'Phạt nguội', amount: r.amount })),
        refund: refund > 0 ? { method } : null,
      }),
    { ...inv(d.rental.id), success: 'Đã hoàn tất lượt thuê', onSuccess: () => onOpenChange(false) },
  );
  const seg = d.segments[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Hoàn cọc giữ lại" description={`Đang giữ ${fmtVnd(d.money.depositHeld)} · hạn ${d.rental.fineHoldUntil ? fmtDate(d.rental.fineHoldUntil) : '—'}`} footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={refund < 0}>Xác nhận</Button>}>
      <div className="space-y-4">
        <Notice tone="amber">
          Tra phạt nguội biển <b>{d.vehicle.plate}</b> trên csgt.vn hoặc ứng dụng VNeTraffic cho khoảng {seg ? `${fmtDateTime(seg.startAt)} → ${fmtDateTime(seg.endAt)}` : 'thời gian thuê'} trước khi hoàn.
          <div className="mt-2 flex flex-wrap gap-3">
            <a href="https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
              Mở csgt.vn <ExternalLink className="size-3" />
            </a>
            <Link to="/fines" className="font-medium underline">
              Ghi phạt nguội vào app
            </Link>
          </div>
        </Notice>
        <div className="space-y-2">
          <p className="text-sm font-medium">Khoản trừ vào cọc</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_130px_auto] gap-2">
              <Input value={r.description} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Phạt nguội…" />
              <MoneyInput value={r.amount} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              <Button variant="ghost" size="icon" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Xóa">
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { description: '', amount: null }])}>
            <Plus /> Thêm khoản trừ
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
          <span className="font-medium">Hoàn lại khách</span>
          <span className={`tabular text-lg font-semibold ${refund < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtVnd(refund)}</span>
        </div>
        {refund < 0 && <Notice tone="red">Khoản trừ vượt tiền cọc đang giữ. Ghi phần vượt thành khoản phí rồi thu thêm của khách.</Notice>}
        {refund > 0 && <Segmented value={method} onChange={setMethod} className="flex w-full" options={[{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} />}
      </div>
    </Dialog>
  );
}

// ── Sửa lịch / gia hạn ───────────────────────────────────────────────────────

export function EditRentalDialog({ d, open, onOpenChange }: DialogProps) {
  const r = d.rental;
  const booked = r.status === 'booked';
  const [vehicleId, setVehicleId] = useState(r.vehicleId);
  const [start, setStart] = useState<number | null>(r.scheduledStart);
  const [end, setEnd] = useState<number | null>(r.scheduledEnd);
  const [deposit, setDeposit] = useState<number | null>(r.depositRequired);
  const [pickupLocation, setPickupLocation] = useState(r.pickupLocation ?? '');
  const [returnLocation, setReturnLocation] = useState(r.returnLocation ?? '');
  const [notes, setNotes] = useState(r.notes ?? '');
  useEffect(() => {
    if (!open) return;
    setVehicleId(r.vehicleId);
    setStart(r.scheduledStart);
    setEnd(r.scheduledEnd);
    setDeposit(r.depositRequired);
    setPickupLocation(r.pickupLocation ?? '');
    setReturnLocation(r.returnLocation ?? '');
    setNotes(r.notes ?? '');
  }, [open, r]);
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<VehicleWithStatus[]>('/api/vehicles'), enabled: open && booked });
  const valid = start != null && end != null && end > start;
  const { data: pre } = useQuery({
    queryKey: ['precheck', 'edit', r.id, vehicleId, start, end],
    queryFn: () => api.post<Precheck>('/api/rentals/precheck', { vehicleId, customerId: r.customerId, scheduledStart: start, scheduledEnd: end, excludeRentalId: r.id }),
    enabled: open && valid && ['booked', 'active'].includes(r.status),
  });
  const save = useAction(
    (allowConflict: boolean) =>
      api.patch(`/api/rentals/${r.id}`, {
        ...(booked ? { vehicleId, scheduledStart: start } : {}),
        ...(['booked', 'active'].includes(r.status) ? { scheduledEnd: end } : {}),
        depositRequired: deposit ?? 0,
        pickupLocation: pickupLocation || null,
        returnLocation: returnLocation || null,
        notes: notes || null,
        allowConflict,
      }),
    { ...inv(r.id), success: 'Đã lưu', onSuccess: () => onOpenChange(false) },
  );
  const oldRental = d.charges.filter((c) => c.auto).reduce((s, c) => s + c.amount, 0);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={r.status === 'active' ? 'Gia hạn / sửa thông tin' : 'Sửa lượt thuê'}
      footer={
        <Button onClick={() => save.mutate(!!pre?.conflicts.length)} loading={save.isPending} disabled={!valid} variant={pre?.conflicts.length ? 'danger' : 'primary'}>
          {pre?.conflicts.length ? 'Vẫn lưu (trùng lịch)' : 'Lưu'}
        </Button>
      }
    >
      <div className="space-y-4">
        {booked && (
          <Field label="Xe">
            <Select value={vehicleId} onChange={(e) => setVehicleId(Number(e.target.value))}>
              {(vehicles ?? []).filter((v) => v.active).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} · {v.make} {v.model}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nhận xe">
            <DateTimeInput value={start} onChange={setStart} disabled={!booked} />
          </Field>
          <Field label="Trả xe">
            <DateTimeInput value={end} onChange={setEnd} disabled={!['booked', 'active'].includes(r.status)} />
          </Field>
        </div>
        {pre && (end !== r.scheduledEnd || start !== r.scheduledStart || vehicleId !== r.vehicleId) && (
          <Notice tone="blue">
            Tiền thuê tính lại: {fmtVnd(oldRental)} → <b>{fmtVnd(pre.quote.total)}</b> ({pre.quote.lines.map((l) => l.description).join(', ')})
          </Notice>
        )}
        {pre?.conflicts.map((c) => (
          <Notice key={c.id} tone="red">
            Trùng lịch: {c.label}
          </Notice>
        ))}
        <Field label="Tiền cọc thỏa thuận">
          <MoneyInput value={deposit} onChange={setDeposit} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nơi giao xe">
            <Input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} />
          </Field>
          <Field label="Nơi trả xe">
            <Input value={returnLocation} onChange={(e) => setReturnLocation(e.target.value)} />
          </Field>
        </div>
        <Field label="Ghi chú">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function CancelDialog({ d, open, onOpenChange }: DialogProps) {
  const [reason, setReason] = useState('');
  const save = useAction(() => api.post(`/api/rentals/${d.rental.id}/cancel`, { reason }), { ...inv(d.rental.id), success: 'Đã hủy lượt thuê', onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Hủy ${d.rental.code}?`} size="sm" footer={<Button variant="danger" onClick={() => save.mutate()} loading={save.isPending} disabled={reason.trim().length < 2}>Hủy lượt thuê</Button>}>
      <div className="space-y-3">
        <Field label="Lý do">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Khách đổi kế hoạch…" />
        </Field>
        {d.money.depositHeld > 0 && <Notice tone="amber">Đang giữ cọc {fmtVnd(d.money.depositHeld)}. Sau khi hủy, ghi nhận hoàn cọc (hoặc giữ lại theo thỏa thuận) ở mục Tiền.</Notice>}
      </div>
    </Dialog>
  );
}

export function CollateralDialog({ d, open, onOpenChange }: DialogProps) {
  const [kind, setKind] = useState<CollateralKind>('motorbike');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setDescription('');
      setPhotos([]);
    }
  }, [open]);
  const save = useAction(() => api.post(`/api/rentals/${d.rental.id}/collaterals`, { kind, description, photoFileIds: photos }), { ...inv(d.rental.id), success: 'Đã thêm', onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Thêm tài sản thế chấp" footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!description.trim()}>Lưu</Button>}>
      <div className="space-y-4">
        <Field label="Loại">
          <Select value={kind} onChange={(e) => setKind(e.target.value as CollateralKind)}>
            {COLLATERAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {COLLATERAL_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mô tả">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Honda Vision 59X1-123.45 + cà vẹt" />
        </Field>
        <MultiPhotoInput kind="collateral_photo" value={photos} onChange={setPhotos} />
      </div>
    </Dialog>
  );
}

export function DriverDialog({ d, open, onOpenChange }: DialogProps) {
  const [c, setC] = useState<Customer | null>(null);
  useEffect(() => {
    if (open) setC(null);
  }, [open]);
  const save = useAction(() => api.post(`/api/rentals/${d.rental.id}/drivers`, { customerId: c!.id }), { ...inv(d.rental.id), success: 'Đã thêm lái phụ', onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Thêm người lái phụ" footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!c}>Thêm</Button>}>
      <CustomerPicker value={c} onChange={setC} exclude={[d.customer.id, ...d.drivers.map((x) => x.id)]} />
    </Dialog>
  );
}

export function ScanDialog({ d, documentId, open, onOpenChange }: DialogProps & { documentId: number | null }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (open) setIds([]);
  }, [open]);
  const save = useAction(() => api.post(`/api/documents/${documentId}/scans`, { fileIds: ids }), { ...inv(d.rental.id), success: 'Đã lưu bản ký', onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Lưu ảnh bản đã ký" description="Chụp từng trang hợp đồng giấy có chữ ký hai bên" footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ids.length}>Lưu {ids.length} trang</Button>}>
      <MultiPhotoInput kind="document_scan" value={ids} onChange={setIds} camera />
      <p className="mt-3 text-xs text-muted">{fmtNumber(ids.length)} trang</p>
    </Dialog>
  );
}
