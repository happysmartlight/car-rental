import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Car, Check, CircleAlert, History, Info, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/layout/AppShell';
import { CustomerPicker } from '@/components/CustomerPicker';
import { MultiPhotoInput } from '@/components/images';
import { RentalAccessoriesEditor, useRentalAccessories } from '@/components/RentalAccessories';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { DateTimeInput, Field, Input, MoneyInput, NumberInput, Segmented, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, Notice, Spinner } from '@/components/ui/misc';
import { ApiError, api, fileUrl, qs } from '@/lib/api';
import { clearDraft, loadDraft, useDraftAutosave, type Draft } from '@/lib/draft';
import { useAuth, useDebounced, useSettings } from '@/lib/hooks';
import type { CalendarData, Customer, HandoverAccessory, Precheck, Rental, VehicleWithStatus } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { cancelPolicyText, channelFeeFor, defaultFineHold } from '@shared/money';
import { chargeDays } from '@shared/pricing';
import {
  channelVehicleError,
  COLLATERAL_KINDS,
  COLLATERAL_KIND_LABEL,
  DEFAULT_MIOTO_FEE_PCT,
  RENTAL_SOURCES,
  RENTAL_SOURCE_LABEL,
  type CollateralKind,
  type RentalChannel,
  type RentalSource,
} from '@shared/constants';
import { fmtNumber, fmtVnd } from '@shared/text';
import { DAY_MS, HOUR_MS, addMonthsVn, fmtDateTime, fmtDuration } from '@shared/time';

/** Khách trả trước qua app: 40% / 100% tiền thuê trên app, hoặc số nhập tay. */
type PrepaidMode = '40' | '100' | 'other';

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

/** Đơn đang nhập dở (lưu trên máy) — khách chỉ nhớ mã, mở lại thì tải lại hồ sơ. */
interface RentalDraft {
  customerId: number | null;
  customerName: string | null;
  driverIds: number[];
  vehicleId: number | null;
  start: number | null;
  end: number | null;
  pickupMethod: 'at_shop' | 'delivery';
  pickupLocation: string;
  returnLocation: string;
  deliveryFee: number | null;
  discount: number | null;
  discountNote: string;
  deposit: number | null;
  depositTouched: boolean;
  fineHold: number | null;
  holdDays: number | null;
  payments: PayRow[];
  collaterals: CollRow[];
  notes: string;
  accessories: HandoverAccessory[] | null;
  channel?: RentalChannel;
  channelRef?: string;
  appPrice?: number | null;
  priceDay?: number | null;
  priceWeekend?: number | null;
  priceMonth?: number | null;
  appDayPrice?: number | null;
  prepaidMode?: PrepaidMode;
  prepaidCustom?: number | null;
  feePct?: number | null;
  source?: RentalSource | null;
  sourceTouched?: boolean;
}

const DRAFT_KEY = 'rental-new';
const DRAFT_TTL = 3 * DAY_MS;

function nextHalfHour(ms: number) {
  const step = 30 * 60_000;
  return Math.ceil(ms / step) * step;
}

function Section({ n, title, children, action, description }: { n: number; title: string; children: ReactNode; action?: ReactNode; description?: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-solid text-xs font-semibold text-brand-fg">{n}</span>
            {title}
          </span>
        }
        description={description}
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
  const location = useLocation();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const { data: settings } = useSettings();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [drivers, setDrivers] = useState<Customer[]>([]);
  const [addingDriver, setAddingDriver] = useState(false);
  const [vehicleId, setVehicleId] = useState<number | null>(params.get('vehicleId') ? Number(params.get('vehicleId')) : null);
  // Mở từ Lịch xe: giờ nhận/trả đã gợi ý theo ô ngày được chọn, kèm lý do nếu phải lùi/kéo giờ
  const [preset] = useState(() => {
    const s = Number(params.get('start'));
    const e = Number(params.get('end'));
    return s > 0 && e > s ? { start: s, end: e, notes: (location.state as { slotNotes?: string[] } | null)?.slotNotes ?? [] } : null;
  });
  const [start, setStart] = useState<number | null>(() => preset?.start ?? nextHalfHour(Date.now() + HOUR_MS));
  const [end, setEnd] = useState<number | null>(() => preset?.end ?? nextHalfHour(Date.now() + HOUR_MS) + DAY_MS);
  const [pickupMethod, setPickupMethod] = useState<'at_shop' | 'delivery'>('at_shop');
  const [pickupLocation, setPickupLocation] = useState('');
  const [returnLocation, setReturnLocation] = useState('');
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [discount, setDiscount] = useState<number | null>(null);
  const [discountNote, setDiscountNote] = useState('');
  const [deposit, setDeposit] = useState<number | null>(null);
  const [depositTouched, setDepositTouched] = useState(false);
  /** null = theo cài đặt (không vượt tiền cọc) cho tới khi người dùng sửa. */
  const [fineHold, setFineHold] = useState<number | null>(null);
  const [holdDays, setHoldDays] = useState<number | null>(null);
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [collaterals, setCollaterals] = useState<CollRow[]>([]);
  const [notes, setNotes] = useState('');
  // Kênh đặt xe: qua Mioto thì giá theo app, hợp đồng/biên bản theo mẫu Mioto.
  const [channel, setChannel] = useState<RentalChannel>('direct');
  const [channelRef, setChannelRef] = useState('');
  const [appPrice, setAppPrice] = useState<number | null>(null);
  const [appDayPrice, setAppDayPrice] = useState<number | null>(null);
  const [prepaidMode, setPrepaidMode] = useState<PrepaidMode>('40');
  const [prepaidCustom, setPrepaidCustom] = useState<number | null>(null);
  /** null = theo cài đặt. Chỉ quản trị thấy/sửa. */
  const [feePct, setFeePct] = useState<number | null>(null);
  const [source, setSource] = useState<RentalSource | null>(null);
  const [sourceTouched, setSourceTouched] = useState(false);
  /** Giá thỏa thuận riêng cho lượt này (khách trả giá); null = theo bảng giá xe. */
  const [priceDay, setPriceDay] = useState<number | null>(null);
  const [priceWeekend, setPriceWeekend] = useState<number | null>(null);
  const [priceMonth, setPriceMonth] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Nháp đơn đang nhập dở lần trước: hỏi nhập tiếp hay bỏ, chưa quyết thì không ghi đè.
  const [pending, setPending] = useState<Draft<RentalDraft> | null>(() => {
    const x = loadDraft<RentalDraft>(DRAFT_KEY, DRAFT_TTL);
    return x && (x.data.customerId || x.data.vehicleId) ? x : null;
  });
  const [touched, setTouched] = useState(false);
  const [pendingAcc, setPendingAcc] = useState<HandoverAccessory[] | null>(null);
  const done = useRef(false);

  // Mở từ hồ sơ khách: chọn sẵn khách
  const presetCustomer = params.get('customerId');
  useEffect(() => {
    if (!presetCustomer) return;
    api.get<{ customer: Customer }>(`/api/customers/${presetCustomer}`).then((r) => setCustomer(r.customer)).catch(() => undefined);
  }, [presetCustomer]);

  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<VehicleWithStatus[]>('/api/vehicles') });
  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null;
  const activeVehicles = (vehicles ?? []).filter((v) => v.active);

  // Mỗi xe một mức cọc: đổi xe thì cọc theo xe mới, trừ khi đã sửa tay.
  useEffect(() => {
    if (vehicle && !depositTouched) setDeposit(vehicle.depositAmount);
  }, [vehicle, depositTouched]);
  const acc = useRentalAccessories(vehicleId, null);
  // Khôi phục nháp: đặt lại phụ kiện đã chỉnh SAU khi danh sách phụ kiện tự làm mới theo xe.
  useEffect(() => {
    if (!pendingAcc) return;
    acc.setItems(pendingAcc);
    setPendingAcc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAcc]);
  const excluded = acc.items.filter((a) => !a.present);
  const added = acc.items.filter((a) => a.id == null && a.present);

  const hasDeposit = (deposit ?? 0) > 0;
  const hold = hasDeposit ? (fineHold ?? (settings ? defaultFineHold(deposit ?? 0, settings.rules) : 0)) : 0;
  const days = holdDays ?? settings?.rules.fineHoldDays ?? 15;
  const holdError = hold > (deposit ?? 0) ? 'Không được lớn hơn tiền cọc' : null;

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
  // Gõ giá thỏa thuận: chờ gõ xong mới báo giá lại.
  const qDay = useDebounced(priceDay, 300);
  const qWeekend = useDebounced(priceWeekend, 300);
  const qMonth = useDebounced(priceMonth, 300);
  const { data: pre, isFetching: checking, error: preError } = useQuery({
    queryKey: ['precheck', vehicleId, customer?.id, driverIds.join(','), start, end, qDay, qWeekend, qMonth],
    queryFn: () =>
      api.post<Precheck>('/api/rentals/precheck', {
        vehicleId,
        customerId: customer?.id ?? null,
        driverIds,
        scheduledStart: start,
        scheduledEnd: end,
        priceDay: qDay,
        priceWeekendDay: qWeekend,
        priceMonth: qMonth,
      }),
    enabled: !!vehicleId && validTime,
    placeholderData: (p) => p,
  });
  // Đổi xe: giá thỏa thuận của xe cũ bỏ đi.
  const pickVehicle = (id: number) => {
    if (id === vehicleId) return;
    setVehicleId(id);
    setPriceDay(null);
    setPriceWeekend(null);
    setPriceMonth(null);
  };
  const hasWeekendPrice = !!vehicle?.priceWeekendDay && vehicle.priceWeekendDay !== vehicle.priceDay;

  // Khách quen (đã từng thuê) → gợi ý sẵn nguồn, cho tới khi người dùng tự chọn.
  const customerRentals = pre?.customerRentals;
  useEffect(() => {
    if (!sourceTouched && customerRentals != null) setSource(customerRentals > 0 ? 'returning' : null);
  }, [customerRentals, sourceTouched]);

  const viaApp = channel !== 'direct';
  const appDays = validTime && settings ? Math.max(1, chargeDays(start!, end!, settings.rules.graceMinutes)) : 1;
  // Lượt Mioto: đơn giá/ngày (mặc định giá xe) × số ngày = tiền thuê trên app; app có giá cuối tuần/khuyến mãi thì sửa tay tổng.
  const appDay = appDayPrice ?? vehicle?.priceDay ?? 0;
  const appTotal = appPrice ?? appDay * appDays;
  const prepaid = !viaApp ? 0 : prepaidMode === 'other' ? (prepaidCustom ?? 0) : Math.round((appTotal * Number(prepaidMode)) / 100);
  const feeRate = feePct ?? settings?.rules.miotoFeePct ?? DEFAULT_MIOTO_FEE_PCT;
  const appFee = channelFeeFor(appTotal, feeRate);
  // Lượt qua app: phí giao xe (nếu có) đã nằm trong tiền thuê trên app, không giảm giá riêng.
  const fee = pickupMethod === 'delivery' && !viaApp ? (deliveryFee ?? settings?.rules.deliveryFeeDefault ?? 0) : 0;
  const total = viaApp ? appTotal : (pre?.quote.total ?? 0) + fee - (discount ?? 0);
  const paidRent = payments.filter((p) => p.purpose === 'rent').reduce((s, p) => s + (p.amount ?? 0), 0);
  const paidDeposit = payments.filter((p) => p.purpose === 'deposit').reduce((s, p) => s + (p.amount ?? 0), 0);
  const dangerWarnings = (pre?.warnings ?? []).filter((w) => w.severity === 'danger');

  const draft: RentalDraft = {
    customerId: customer?.id ?? null,
    customerName: customer?.fullName ?? null,
    driverIds,
    vehicleId,
    start,
    end,
    pickupMethod,
    pickupLocation,
    returnLocation,
    deliveryFee,
    discount,
    discountNote,
    deposit,
    depositTouched,
    fineHold,
    holdDays,
    payments,
    collaterals,
    notes,
    accessories: acc.edited,
    channel,
    channelRef,
    appPrice,
    priceDay,
    priceWeekend,
    priceMonth,
    appDayPrice,
    prepaidMode,
    prepaidCustom,
    feePct,
    source,
    sourceTouched,
  };
  useDraftAutosave(DRAFT_KEY, draft, touched && !pending && !saving && !done.current && !!(customer || vehicleId));
  const touch = () => !touched && setTouched(true);

  const restore = async () => {
    if (!pending) return;
    const x = pending.data;
    setPending(null);
    setTouched(true);
    setVehicleId(x.vehicleId);
    setStart(x.start);
    setEnd(x.end);
    setPickupMethod(x.pickupMethod);
    setPickupLocation(x.pickupLocation);
    setReturnLocation(x.returnLocation);
    setDeliveryFee(x.deliveryFee);
    setDiscount(x.discount);
    setDiscountNote(x.discountNote);
    setDeposit(x.deposit);
    setDepositTouched(x.depositTouched);
    setFineHold(x.fineHold);
    setHoldDays(x.holdDays);
    setPayments(x.payments);
    setCollaterals(x.collaterals);
    setNotes(x.notes);
    setChannel(x.channel ?? 'direct');
    setChannelRef(x.channelRef ?? '');
    setAppPrice(x.appPrice ?? null);
    setPriceDay(x.priceDay ?? null);
    setPriceWeekend(x.priceWeekend ?? null);
    setPriceMonth(x.priceMonth ?? null);
    setAppDayPrice(x.appDayPrice ?? null);
    setPrepaidMode(x.prepaidMode ?? '40');
    setPrepaidCustom(x.prepaidCustom ?? null);
    setFeePct(x.feePct ?? null);
    setSource(x.source ?? null);
    setSourceTouched(!!x.sourceTouched);
    if (x.accessories) setPendingAcc(x.accessories);
    const people = await Promise.all(
      [x.customerId, ...x.driverIds].map((cid) => (cid ? api.get<{ customer: Customer }>(`/api/customers/${cid}`).then((r) => r.customer, () => null) : Promise.resolve(null))),
    );
    setCustomer(people[0]);
    setDrivers(people.slice(1).filter((c): c is Customer => !!c));
  };
  const discard = () => {
    clearDraft(DRAFT_KEY);
    setPending(null);
  };

  const setDays = (n: number) => start && setEnd(start + n * DAY_MS);
  const setMonths = (n: number) => start && setEnd(addMonthsVn(start, n));
  const chip = (active: boolean) =>
    cn('min-h-10 rounded-full border px-3.5 text-sm font-medium lg:min-h-0 lg:px-3 lg:py-1 lg:text-xs', active ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted hover:bg-surface-2');

  const submit = async (force = false) => {
    if (!customer) return toast.error('Chọn khách thuê');
    if (!vehicleId) return toast.error('Chọn xe');
    if (!validTime) return toast.error('Kiểm tra lại giờ nhận / trả');
    if (holdError) return toast.error(`Tiền giữ chờ phạt nguội: ${holdError.toLowerCase()}`);
    if (viaApp && !(appTotal > 0)) return toast.error('Nhập tiền thuê đúng như trên app Mioto');
    setSaving(true);
    try {
      const r = await api.post<Rental>('/api/rentals', {
        customerId: customer.id,
        vehicleId,
        scheduledStart: start,
        scheduledEnd: end,
        channel,
        ...(viaApp
          ? { channelRef: channelRef.trim() || null, channelPrice: appTotal, channelDayPrice: appDay, channelPrepaid: prepaid, ...(isAdmin && feePct != null ? { channelFeePct: feePct } : {}) }
          : { source, priceDay, priceWeekendDay: priceWeekend, priceMonth }),
        pickupMethod,
        pickupLocation: pickupLocation || null,
        returnLocation: returnLocation || null,
        deliveryFee: fee,
        discount: viaApp ? 0 : (discount ?? 0),
        discountNote: discountNote || null,
        depositRequired: deposit ?? 0,
        fineHoldRequired: hold,
        fineHoldDays: days,
        accessories: acc.edited,
        driverIds,
        notes: notes || null,
        payments: payments.filter((p) => p.amount && p.amount > 0),
        collaterals: collaterals.filter((c) => c.description.trim()),
        allowConflict: force,
        allowBlacklisted: force && isAdmin,
      });
      done.current = true;
      clearDraft(DRAFT_KEY);
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
            {viaApp ? (
              <div className="space-y-1.5 border-t border-border pt-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Tiền thuê trên app Mioto</span>
                  <span className="tabular shrink-0">{appTotal ? fmtNumber(appTotal) : '—'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Khách đã trả qua app</span>
                  <span className="tabular shrink-0">{fmtNumber(prepaid)}</span>
                </div>
                <div className="flex justify-between gap-3 font-medium">
                  <span>Thu khi giao xe</span>
                  <span className="tabular shrink-0">{fmtNumber(Math.max(0, appTotal - prepaid))}</span>
                </div>
                {isAdmin && appTotal > 0 && (
                  <div className="mt-2 space-y-1 rounded-xl bg-surface-2 px-3 py-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">Phí Mioto {feeRate}% (không in)</span>
                      <span className="tabular">−{fmtNumber(appFee)}</span>
                    </div>
                    <div className="flex justify-between gap-3 font-medium">
                      <span>Thực nhận</span>
                      <span className="tabular">{fmtNumber(appTotal - appFee)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
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
                  <div className="flex justify-between gap-3 text-emerald-700">
                    <span>{discountNote || 'Giảm giá'}</span>
                    <span className="tabular">-{fmtNumber(discount)}</span>
                  </div>
                )}
              </div>
            )}
            {!viaApp && pre?.quote.mode === 'month' && <Notice tone="violet">Tính theo tháng — rẻ hơn tính theo ngày ({fmtVnd(vehicle.priceMonth ?? 0)}/tháng).</Notice>}
            {(excluded.length > 0 || added.length > 0) && (
              <div className="space-y-0.5 text-sm">
                {excluded.length > 0 && <p className="text-amber-700">Không kèm: {excluded.map((a) => a.name).join(', ')}</p>}
                {added.length > 0 && <p className="text-muted">Thêm: {added.map((a) => a.name).join(', ')}</p>}
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-3">
              <span className="font-medium">Tổng tiền thuê</span>
              <span className="tabular text-xl font-semibold">{fmtVnd(total)}</span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Cọc thỏa thuận</span>
                <span className="tabular">{fmtVnd(deposit ?? 0)}</span>
              </div>
              {hold > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Giữ chờ phạt nguội</span>
                  <span className="tabular">
                    {fmtVnd(hold)} · {days} ngày
                  </span>
                </div>
              )}
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
      {pending && (
        <Notice tone="blue" icon={History} className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Có đơn đặt xe đang nhập dở (lưu lúc {fmtDateTime(pending.savedAt)}):{' '}
              <b>
                {[
                  pending.data.customerName,
                  vehicles?.find((v) => v.id === pending.data.vehicleId)?.plate,
                  pending.data.start && pending.data.end ? `${fmtDateTime(pending.data.start)} → ${fmtDateTime(pending.data.end)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </b>
            </span>
            <div className="flex gap-2">
              <Button size="sm" onClick={restore}>
                Nhập tiếp
              </Button>
              <Button size="sm" variant="ghost" onClick={discard}>
                Bỏ
              </Button>
            </div>
          </div>
        </Notice>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]" onPointerDownCapture={touch} onChangeCapture={touch} onKeyDownCapture={touch}>
        <div className="space-y-4">
          <Section n={1} title="Khách thuê">
            <Segmented
              className="mb-3 flex w-full"
              value={channel}
              onChange={setChannel}
              options={[
                { value: 'direct', label: 'Khách trực tiếp' },
                { value: 'mioto', label: 'Đặt qua Mioto', disabled: vehicle?.ownerType === 'consigned' },
              ]}
            />
            {vehicle?.ownerType === 'consigned' && <p className="mb-3 text-xs text-muted">Xe ký gửi chỉ nhận khách trực tiếp vì Mioto không cho phép.</p>}
            {viaApp && (
              <Field label="Mã chuyến Mioto" hint="In làm số hợp đồng Mioto; tìm lượt thuê theo mã này" className="mb-3">
                <Input value={channelRef} onChange={(e) => setChannelRef(e.target.value.toUpperCase())} placeholder="Mã trên app Mioto" autoCapitalize="characters" />
              </Field>
            )}
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
            {customer && !viaApp && (
              <div className="mt-3">
                <p className="mb-1.5 text-sm font-medium">Khách biết tới qua</p>
                <div className="flex flex-wrap gap-1.5">
                  {RENTAL_SOURCES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={chip(source === s)}
                      onClick={() => {
                        setSource(source === s ? null : s);
                        setSourceTouched(true);
                      }}
                    >
                      {RENTAL_SOURCE_LABEL[s]}
                    </button>
                  ))}
                </div>
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
            {!!preset?.notes.length && start === preset.start && end === preset.end && (
              <Notice tone="blue" icon={Info} className="mt-3">
                {preset.notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </Notice>
            )}
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
            {viaApp && activeVehicles.some((v) => v.ownerType === 'consigned') && <p className="mt-3 text-xs text-muted">Không hiện xe ký gửi vì Mioto không cho phép.</p>}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {activeVehicles.filter((v) => !channelVehicleError(channel, v)).map((v) => {
                const isBusy = busy.has(v.id);
                const selected = v.id === vehicleId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => pickVehicle(v.id)}
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
                      <span className={cn('block text-xs font-medium', isBusy ? 'text-red-600' : 'text-emerald-700')}>{isBusy ? 'Trùng lịch' : validTime ? 'Trống' : ''}</span>
                    </span>
                    {selected && <Check className="size-5 text-brand" />}
                  </button>
                );
              })}
              {!activeVehicles.length && <p className="text-sm text-muted">Chưa có xe. Thêm xe trong mục Xe.</p>}
            </div>
          </Section>

          {vehicle && (
            <Section n={3} title="Phụ kiện & tiện nghi kèm xe" description="Bỏ tick món đang thiếu, thêm món khách cần — chỉ áp dụng cho lượt này, in vào hợp đồng và biên bản giao xe">
              <RentalAccessoriesEditor items={acc.items} onChange={acc.setItems} catalog={acc.catalog} loading={acc.loading} />
            </Section>
          )}

          <Section n={vehicle ? 4 : 3} title="Giao nhận xe">
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
                {viaApp ? (
                  <p className="self-end pb-2 text-sm text-muted">Phí giao xe (nếu có) đã tính trong tiền thuê trên app.</p>
                ) : (
                  <Field label="Phí giao/nhận">
                    <MoneyInput value={deliveryFee ?? settings?.rules.deliveryFeeDefault ?? 0} onChange={setDeliveryFee} />
                  </Field>
                )}
              </div>
            )}
          </Section>

          <Section n={vehicle ? 5 : 4} title="Giá, cọc & thanh toán">
            {!viaApp && vehicle && (
              <div className="mb-5 grid gap-4 sm:grid-cols-2">
                <Field
                  label={hasWeekendPrice ? 'Giá ngày thường' : 'Giá thuê/ngày'}
                  hint={priceDay != null && priceDay !== vehicle.priceDay ? `Giá xe ${fmtVnd(vehicle.priceDay)} — giá này chỉ áp cho lượt này` : 'Khách trả giá thì sửa ở đây — chỉ áp cho lượt này'}
                >
                  <MoneyInput value={priceDay ?? vehicle.priceDay} onChange={setPriceDay} />
                </Field>
                {hasWeekendPrice && (
                  <Field label="Giá ngày cuối tuần" hint={priceWeekend != null && priceWeekend !== vehicle.priceWeekendDay ? `Giá xe ${fmtVnd(vehicle.priceWeekendDay ?? 0)}` : undefined}>
                    <MoneyInput value={priceWeekend ?? vehicle.priceWeekendDay} onChange={setPriceWeekend} />
                  </Field>
                )}
                {pre?.quote.mode === 'month' && !!vehicle.priceMonth && (
                  <Field label="Giá thuê tháng" hint={priceMonth != null && priceMonth !== vehicle.priceMonth ? `Giá xe ${fmtVnd(vehicle.priceMonth)}` : 'Lượt này tính theo tháng'}>
                    <MoneyInput value={priceMonth ?? vehicle.priceMonth} onChange={setPriceMonth} />
                  </Field>
                )}
              </div>
            )}
            {viaApp && (
              <div className="mb-5 grid gap-4 sm:grid-cols-2">
                <Field label="Đơn giá/ngày trên app" hint={appDayPrice != null && vehicle && appDayPrice !== vehicle.priceDay ? `Giá xe ${fmtVnd(vehicle.priceDay)}` : 'Như trên app Mioto; khách trả giá thì sửa ở đây'}>
                  <MoneyInput value={appDay || null} onChange={setAppDayPrice} />
                </Field>
                <Field
                  label="Tiền thuê trên app Mioto"
                  required
                  hint={
                    appPrice == null ? (
                      `= ${fmtVnd(appDay)} × ${appDays} ngày · in vào hợp đồng là giá trị hợp đồng`
                    ) : (
                      <>
                        Đã sửa theo app ·{' '}
                        <button type="button" className="font-medium text-brand" onClick={() => setAppPrice(null)}>
                          tính lại = đơn giá × {appDays} ngày
                        </button>
                      </>
                    )
                  }
                >
                  <MoneyInput value={appTotal || null} onChange={setAppPrice} />
                </Field>
                <Field label="Khách đã trả trước qua app" hint="Ghi thành phiếu thu “Qua app Mioto”; phần còn lại thu khi giao xe">
                  <div className="flex items-center gap-3">
                    <Segmented
                      value={prepaidMode}
                      onChange={setPrepaidMode}
                      options={[
                        { value: '40', label: '40%' },
                        { value: '100', label: '100%' },
                        { value: 'other', label: 'Số khác' },
                      ]}
                    />
                    {prepaidMode !== 'other' && <span className="tabular text-sm font-medium">{fmtVnd(prepaid)}</span>}
                  </div>
                  {prepaidMode === 'other' && (
                    <div className="mt-2">
                      <MoneyInput value={prepaidCustom} onChange={setPrepaidCustom} />
                    </div>
                  )}
                </Field>
                {isAdmin && (
                  <Field label="Phí Mioto — chỉ quản lý thấy, không in" hint={appTotal ? `≈ ${fmtVnd(appFee)} · Mioto chuyển về ≈ ${fmtVnd(Math.max(0, prepaid - appFee))}` : 'Ghi vào Thu chi để tính lãi thật'}>
                    <NumberInput value={feeRate} onChange={setFeePct} suffix="%" />
                  </Field>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {!viaApp && (
                <>
                  <Field label="Giảm giá">
                    <MoneyInput value={discount} onChange={setDiscount} />
                  </Field>
                  <Field label="Lý do giảm">
                    <Input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="Khách quen, thuê dài ngày…" />
                  </Field>
                </>
              )}
              <Field label="Tiền cọc thỏa thuận" hint={vehicle ? `Mặc định của xe: ${fmtVnd(vehicle.depositAmount)}` : undefined}>
                <MoneyInput
                  value={deposit}
                  onChange={(v) => {
                    setDeposit(v);
                    setDepositTouched(true);
                  }}
                />
              </Field>
              {hasDeposit ? (
                <Field label="Giữ lại chờ phạt nguội" error={holdError} hint="Sau khi trả xe, giữ lại trong số tiền cọc — in vào hợp đồng">
                  <div className="grid grid-cols-[1fr_7rem] gap-2">
                    <MoneyInput value={hold} onChange={(v) => setFineHold(v ?? 0)} />
                    <NumberInput value={days} onChange={setHoldDays} suffix="ngày" />
                  </div>
                </Field>
              ) : (
                <p className="self-end pb-2 text-sm text-muted">Không cọc → hợp đồng ghi không đặt cọc, không giữ tiền chờ phạt nguội.</p>
              )}
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium">Tiền nhận ngay (cọc giữ chỗ, trả trước)</p>
              {settings && <p className="text-xs text-muted">Chính sách hủy: {cancelPolicyText(settings.rules, hasDeposit)}</p>}
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

          <Section n={vehicle ? 6 : 5} title="Ghi chú">
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
