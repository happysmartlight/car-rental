import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Car, Check, CircleAlert, Info, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/layout/AppShell';
import { CustomerPicker } from '@/components/CustomerPicker';
import { MultiPhotoInput } from '@/components/images';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { DateTimeInput, Field, Input, MoneyInput, Segmented, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, Notice, Spinner } from '@/components/ui/misc';
import { ApiError, api, fileUrl, qs } from '@/lib/api';
import { useAuth, useSettings } from '@/lib/hooks';
import type { CalendarData, Customer, Precheck, Rental, VehicleWithStatus } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { cancelPolicyText } from '@shared/money';
import { COLLATERAL_KINDS, COLLATERAL_KIND_LABEL, type CollateralKind } from '@shared/constants';
import { fmtNumber, fmtVnd } from '@shared/text';
import { DAY_MS, HOUR_MS, addMonthsVn, fmtDateTime, fmtDuration } from '@shared/time';

interface PayRow {
  purpose: 'rent' | 'deposit';
  method: 'cash' | 'transfer';
  amount: number | null;
}
interface CollRow {
  kind: CollateralKind;
  description: string;
  photoFileIds: string[];
}

function nextHalfHour(ms: number) {
  const step = 30 * 60_000;
  return Math.ceil(ms / step) * step;
}

function Section({ n, title, children, action }: { n: number; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-fg">{n}</span>
            {title}
          </span>
        }
        action={action}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

const SEV = { danger: { tone: 'red', icon: CircleAlert }, warn: { tone: 'amber', icon: AlertTriangle }, info: { tone: 'blue', icon: Info } } as const;

export default function RentalNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const { data: settings } = useSettings();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [drivers, setDrivers] = useState<Customer[]>([]);
  const [addingDriver, setAddingDriver] = useState(false);
  const [vehicleId, setVehicleId] = useState<number | null>(params.get('vehicleId') ? Number(params.get('vehicleId')) : null);
  const [start, setStart] = useState<number | null>(() => nextHalfHour(Date.now() + HOUR_MS));
  const [end, setEnd] = useState<number | null>(() => nextHalfHour(Date.now() + HOUR_MS) + DAY_MS);
  const [pickupMethod, setPickupMethod] = useState<'at_shop' | 'delivery'>('at_shop');
  const [pickupLocation, setPickupLocation] = useState('');
  const [returnLocation, setReturnLocation] = useState('');
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [discount, setDiscount] = useState<number | null>(null);
  const [discountNote, setDiscountNote] = useState('');
  const [deposit, setDeposit] = useState<number | null>(null);
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [collaterals, setCollaterals] = useState<CollRow[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Mở từ hồ sơ khách: chọn sẵn khách
  const presetCustomer = params.get('customerId');
  useEffect(() => {
    if (!presetCustomer) return;
    api.get<{ customer: Customer }>(`/api/customers/${presetCustomer}`).then((r) => setCustomer(r.customer)).catch(() => undefined);
  }, [presetCustomer]);

  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<VehicleWithStatus[]>('/api/vehicles') });
  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null;
  const activeVehicles = (vehicles ?? []).filter((v) => v.active);

  useEffect(() => {
    if (vehicle && deposit == null) setDeposit(vehicle.depositAmount);
  }, [vehicle, deposit]);

  const validTime = start != null && end != null && end > start;
  const { data: cal } = useQuery({
    queryKey: ['calendar', 'busy', start, end],
    queryFn: () => api.get<CalendarData>(`/api/calendar${qs({ from: start! - DAY_MS, to: end! + DAY_MS })}`),
    enabled: validTime,
  });
  // Cùng luật với máy chủ: tính cả khoảng đệm giữa 2 lượt (rửa xe); xe quá hạn chưa trả coi như bận tới hiện tại.
  const buffer = (settings?.rules.bufferMinutes ?? 0) * 60_000;
  const busy = useMemo(
    () => new Set((cal?.items ?? []).filter((i) => (i.type === 'block' ? i.start < end! && i.end > start! : i.start < end! + buffer && i.end + buffer > start!)).map((i) => i.vehicleId)),
    [cal, start, end, buffer],
  );

  const driverIds = drivers.map((d) => d.id);
  const { data: pre, isFetching: checking, error: preError } = useQuery({
    queryKey: ['precheck', vehicleId, customer?.id, driverIds.join(','), start, end],
    queryFn: () => api.post<Precheck>('/api/rentals/precheck', { vehicleId, customerId: customer?.id ?? null, driverIds, scheduledStart: start, scheduledEnd: end }),
    enabled: !!vehicleId && validTime,
    placeholderData: (p) => p,
  });

  const fee = pickupMethod === 'delivery' ? (deliveryFee ?? settings?.rules.deliveryFeeDefault ?? 0) : 0;
  const total = (pre?.quote.total ?? 0) + fee - (discount ?? 0);
  const paidRent = payments.filter((p) => p.purpose === 'rent').reduce((s, p) => s + (p.amount ?? 0), 0);
  const paidDeposit = payments.filter((p) => p.purpose === 'deposit').reduce((s, p) => s + (p.amount ?? 0), 0);
  const dangerWarnings = (pre?.warnings ?? []).filter((w) => w.severity === 'danger');

  const setDays = (n: number) => start && setEnd(start + n * DAY_MS);
  const setMonths = (n: number) => start && setEnd(addMonthsVn(start, n));
  const chip = (active: boolean) =>
    cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted hover:bg-surface-2');

  const submit = async (force = false) => {
    if (!customer) return toast.error('Chọn khách thuê');
    if (!vehicleId) return toast.error('Chọn xe');
    if (!validTime) return toast.error('Kiểm tra lại giờ nhận / trả');
    setSaving(true);
    try {
      const r = await api.post<Rental>('/api/rentals', {
        customerId: customer.id,
        vehicleId,
        scheduledStart: start,
        scheduledEnd: end,
        pickupMethod,
        pickupLocation: pickupLocation || null,
        returnLocation: returnLocation || null,
        deliveryFee: fee,
        discount: discount ?? 0,
        discountNote: discountNote || null,
        depositRequired: deposit ?? 0,
        driverIds,
        notes: notes || null,
        payments: payments.filter((p) => p.amount && p.amount > 0),
        collaterals: collaterals.filter((c) => c.description.trim()),
        allowConflict: force,
        allowBlacklisted: force && isAdmin,
      });
      toast.success(`Đã tạo ${r.code}`);
      navigate(`/rentals/${r.id}?created=1`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'conflict' || err.code === 'blacklisted')) {
        const desc = err.code === 'conflict' ? (err.data?.conflicts as { label: string }[] | undefined)?.map((c) => c.label).join('\n') : 'Chỉ quản trị mới đặt được cho khách trong danh sách đen.';
        if (err.code === 'blacklisted' && !isAdmin) return toast.error(err.message);
        if (await confirm({ title: err.message, description: `${desc}\n\nVẫn tạo lượt thuê?`, confirmText: 'Vẫn tạo', danger: true })) return submit(true);
      } else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const summary = (
    <Card className="xl:sticky xl:top-6">
      <CardHeader title="Tóm tắt" action={checking && <Spinner className="size-4" />} />
      <CardBody className="space-y-3">
        {vehicle && validTime ? (
          <>
            <div className="text-sm">
              <p className="font-medium">
                {vehicle.plate} · {vehicle.make} {vehicle.model}
              </p>
              <p className="text-muted">
                {fmtDateTime(start)} → {fmtDateTime(end)}
              </p>
              <p className="text-muted">
                {fmtDuration(end! - start!)}
                {pre?.quote.kmLimit ? ` · giới hạn ${fmtNumber(pre.quote.kmLimit)} km` : ''}
              </p>
            </div>
            <div className="space-y-1.5 border-t border-border pt-3 text-sm">
              {pre?.quote.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="text-muted">{l.description}</span>
                  <span className="tabular shrink-0">{fmtNumber(l.amount)}</span>
                </div>
              ))}
              {fee > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Giao/nhận tận nơi</span>
                  <span className="tabular">{fmtNumber(fee)}</span>
                </div>
              )}
              {!!discount && (
                <div className="flex justify-between gap-3 text-emerald-600">
                  <span>{discountNote || 'Giảm giá'}</span>
                  <span className="tabular">-{fmtNumber(discount)}</span>
                </div>
              )}
            </div>
            {pre?.quote.mode === 'month' && <Notice tone="violet">Tính theo tháng — rẻ hơn tính theo ngày ({fmtVnd(vehicle.priceMonth ?? 0)}/tháng).</Notice>}
            <div className="flex items-baseline justify-between border-t border-border pt-3">
              <span className="font-medium">Tổng tiền thuê</span>
              <span className="tabular text-xl font-semibold">{fmtVnd(total)}</span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Cọc thỏa thuận</span>
                <span className="tabular">{fmtVnd(deposit ?? 0)}</span>
              </div>
              {(paidRent > 0 || paidDeposit > 0) && (
                <div className="flex justify-between">
                  <span className="text-muted">Thu ngay</span>
                  <span className="tabular">{fmtVnd(paidRent + paidDeposit)}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Chọn xe và thời gian để xem giá.</p>
        )}
        {pre?.conflicts.map((c) => (
          <Notice key={`${c.type}${c.id}`} tone="red" icon={CircleAlert}>
            Trùng lịch: {c.label} ({fmtDateTime(c.start)} → {c.end ? fmtDateTime(c.end) : '…'})
          </Notice>
        ))}
        {pre?.warnings.map((w) => {
          const s = SEV[w.severity];
          return (
            <Notice key={w.code + w.message} tone={s.tone} icon={s.icon}>
              {w.message}
            </Notice>
          );
        })}
        {preError && <Notice tone="red">{errorMessage(preError)}</Notice>}
        <Button size="lg" className="hidden w-full lg:flex" onClick={() => submit()} loading={saving}>
          <Check /> Tạo lượt thuê
        </Button>
      </CardBody>
    </Card>
  );

  return (
    <Page title="Đặt xe mới" back width="default">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Section n={1} title="Khách thuê">
            <CustomerPicker value={customer} onChange={setCustomer} />
            {customer && (
              <div className="mt-3 space-y-2">
                {drivers.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                    <span className="flex-1">
                      Lái phụ: <b>{d.fullName}</b> {d.phone && `· ${d.phone}`}
                    </span>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDrivers(drivers.filter((x) => x.id !== d.id))} aria-label="Bỏ">
                      <X />
                    </Button>
                  </div>
                ))}
                {addingDriver ? (
                  <CustomerPicker
                    value={null}
                    exclude={[customer.id, ...driverIds]}
                    placeholder="Tìm người lái phụ…"
                    onChange={(c) => {
                      if (c) setDrivers([...drivers, c]);
                      setAddingDriver(false);
                    }}
                  />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setAddingDriver(true)}>
                    <UserPlus /> Thêm người lái phụ
                  </Button>
                )}
              </div>
            )}
          </Section>

          <Section n={2} title="Thời gian & xe">
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
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[1, 2, 3, 5, 7].map((n) => (
                <button key={n} type="button" onClick={() => setDays(n)} className={chip(!!start && !!end && end - start === n * DAY_MS)}>
                  {n === 7 ? '1 tuần' : `${n} ngày`}
                </button>
              ))}
              {[1, 3, 6].map((n) => (
                <button key={`m${n}`} type="button" onClick={() => setMonths(n)} className={chip(!!start && !!end && end === addMonthsVn(start, n))}>
                  {n} tháng
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {activeVehicles.map((v) => {
                const isBusy = busy.has(v.id);
                const selected = v.id === vehicleId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVehicleId(v.id)}
                    className={cn('flex items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors', selected ? 'border-brand bg-brand-soft ring-2 ring-brand/30' : 'border-border hover:bg-surface-2')}
                  >
                    {v.photoFileId ? (
                      <img src={fileUrl(v.photoFileId, { thumb: true })} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                        <Car className="size-5 text-subtle" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{v.plate}</span>
                      <span className="block text-xs text-muted">
                        {v.make} {v.model} · {fmtVnd(v.priceDay)}/ngày{v.priceMonth ? ` · ${fmtVnd(v.priceMonth)}/tháng` : ''}
                      </span>
                      <span className={cn('block text-xs font-medium', isBusy ? 'text-red-600' : 'text-emerald-600')}>{isBusy ? 'Trùng lịch' : validTime ? 'Trống' : ''}</span>
                    </span>
                    {selected && <Check className="size-5 text-brand" />}
                  </button>
                );
              })}
              {!activeVehicles.length && <p className="text-sm text-muted">Chưa có xe. Thêm xe trong mục Xe.</p>}
            </div>
          </Section>

          <Section n={3} title="Giao nhận xe">
            <Segmented
              value={pickupMethod}
              onChange={setPickupMethod}
              options={[
                { value: 'at_shop', label: 'Khách tới lấy' },
                { value: 'delivery', label: 'Giao tận nơi' },
              ]}
            />
            {pickupMethod === 'delivery' && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Địa chỉ giao xe">
                  <Input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} />
                </Field>
                <Field label="Địa chỉ nhận lại" hint="Để trống = như nơi giao">
                  <Input value={returnLocation} onChange={(e) => setReturnLocation(e.target.value)} />
                </Field>
                <Field label="Phí giao/nhận">
                  <MoneyInput value={deliveryFee ?? settings?.rules.deliveryFeeDefault ?? 0} onChange={setDeliveryFee} />
                </Field>
              </div>
            )}
          </Section>

          <Section n={4} title="Giá, cọc & thanh toán">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Giảm giá">
                <MoneyInput value={discount} onChange={setDiscount} />
              </Field>
              <Field label="Lý do giảm">
                <Input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="Khách quen, thuê dài ngày…" />
              </Field>
              <Field label="Tiền cọc thỏa thuận" hint={vehicle ? `Mặc định của xe: ${fmtVnd(vehicle.depositAmount)}` : undefined}>
                <MoneyInput value={deposit} onChange={setDeposit} />
              </Field>
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium">Tiền nhận ngay (cọc giữ chỗ, trả trước)</p>
              {settings && <p className="text-xs text-muted">Chính sách hủy: {cancelPolicyText(settings.rules)}</p>}
              {payments.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[140px_140px_1fr_auto]">
                  <Select value={p.purpose} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, purpose: e.target.value as PayRow['purpose'] } : x)))}>
                    <option value="deposit">Tiền cọc</option>
                    <option value="rent">Tiền thuê</option>
                  </Select>
                  <Select value={p.method} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, method: e.target.value as PayRow['method'] } : x)))}>
                    <option value="transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                  </Select>
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                    <MoneyInput value={p.amount} onChange={(v) => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setPayments(payments.filter((_, j) => j !== i))} aria-label="Xóa">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setPayments([...payments, { purpose: payments.length ? 'rent' : 'deposit', method: 'transfer', amount: payments.length ? null : deposit }])}>
                <Plus /> Thêm khoản đã nhận
              </Button>
            </div>

            <div className="mt-5 space-y-3">
              <p className="text-sm font-medium">Tài sản thế chấp</p>
              {collaterals.map((c, i) => (
                <div key={i} className="space-y-2 rounded-2xl border border-border p-3">
                  <div className="flex gap-2">
                    <Select className="w-44" value={c.kind} onChange={(e) => setCollaterals(collaterals.map((x, j) => (j === i ? { ...x, kind: e.target.value as CollateralKind } : x)))}>
                      {COLLATERAL_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {COLLATERAL_KIND_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <Input value={c.description} placeholder="vd: Honda Vision 59X1-123.45 + cà vẹt" onChange={(e) => setCollaterals(collaterals.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <Button variant="ghost" size="icon" onClick={() => setCollaterals(collaterals.filter((_, j) => j !== i))} aria-label="Xóa">
                      <Trash2 />
                    </Button>
                  </div>
                  <MultiPhotoInput kind="collateral_photo" value={c.photoFileIds} onChange={(ids) => setCollaterals(collaterals.map((x, j) => (j === i ? { ...x, photoFileIds: ids } : x)))} />
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setCollaterals([...collaterals, { kind: 'motorbike', description: '', photoFileIds: [] }])}>
                <Plus /> Thêm tài sản thế chấp
              </Button>
            </div>
          </Section>

          <Section n={5} title="Ghi chú">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Yêu cầu riêng, ghế trẻ em, đi tỉnh…" />
          </Section>
        </div>

        <div>{summary}</div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-xl lg:bottom-0 lg:left-64 xl:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">Tổng tiền thuê</p>
            <p className="tabular truncate text-lg font-semibold">{fmtVnd(total)}</p>
          </div>
          <Button size="lg" onClick={() => submit()} loading={saving} variant={dangerWarnings.length || pre?.conflicts.length ? 'danger' : 'primary'}>
            <Check /> Tạo lượt thuê
          </Button>
        </div>
      </div>
      <div className="h-20 xl:hidden" />
    </Page>
  );
}
