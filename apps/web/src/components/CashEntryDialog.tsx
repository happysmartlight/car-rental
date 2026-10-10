// Ghi / sửa một khoản thu chi, hoặc khoản định kỳ (bến bãi, lương, trả góp…).
// Dùng ở trang Thu chi, nút Tạo nhanh và trang xe.

import { useQuery } from '@tanstack/react-query';
import { Ban, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useAuth } from '@/lib/hooks';
import type { CashEntry, RecurringRow, Vehicle, VehicleWithStatus } from '@/lib/types';
import {
  CASH_CATEGORY,
  RECUR_INTERVALS,
  RECUR_INTERVAL_LABEL,
  categoriesOf,
  dateKeyToNoon,
  daysInMonth,
  dueRecurringMonths,
  fmtMonthKey,
  groupedCategories,
  parseMonthKey,
  recurringText,
  type CashCategory,
  type CashDirection,
  type CashMethod,
  type RenewKind,
} from '@shared/cashflow';
import { fmtNumber, fmtVnd } from '@shared/text';
import { addMonthsVn, fmtDateKey, fmtDateTime, vnDateKey, vnDateKeyToMs } from '@shared/time';
import { MultiPhotoInput } from './images';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Checkbox, DateInput, Field, Input, MoneyInput, NumberInput, Segmented, Select, Switch } from './ui/form';
import { Notice } from './ui/misc';

export type CashDialogState =
  | { mode: 'new'; vehicleId?: number | null; category?: CashCategory; repeat?: boolean; amount?: number | null; description?: string }
  | { mode: 'edit'; entry: CashEntry; recurringLabel?: string | null }
  | { mode: 'recurring'; recurring?: RecurringRow };

interface Renew {
  inspectionExpiry: string | null;
  insuranceTndsExpiry: string | null;
  insuranceBodyExpiry: string | null;
  roadFeeExpiry: string | null;
  nextServiceOdo: number | null;
  nextServiceDate: string | null;
}

interface Form {
  category: CashCategory;
  amount: number | null;
  date: string;
  vehicleId: number | null;
  method: CashMethod;
  description: string;
  vendor: string;
  odo: number | null;
  receiptFileIds: string[];
  renew: Renew;
  repeat: boolean;
  intervalMonths: number;
  endMonth: string;
  active: boolean;
}

const NO_RENEW: Renew = { inspectionExpiry: null, insuranceTndsExpiry: null, insuranceBodyExpiry: null, roadFeeExpiry: null, nextServiceOdo: null, nextServiceDate: null };

function initialForm(s: CashDialogState): Form {
  const today = vnDateKey(Date.now());
  const base: Form = {
    category: 'fuel',
    amount: null,
    date: today,
    vehicleId: null,
    method: 'cash',
    description: '',
    vendor: '',
    odo: null,
    receiptFileIds: [],
    renew: NO_RENEW,
    repeat: false,
    intervalMonths: 1,
    endMonth: '',
    active: true,
  };
  if (s.mode === 'edit') {
    const e = s.entry;
    return { ...base, category: e.category, amount: e.amount, date: vnDateKey(e.at), vehicleId: e.vehicleId, method: e.method, description: e.description ?? '', vendor: e.vendor ?? '', odo: e.odo, receiptFileIds: e.receiptFileIds };
  }
  if (s.mode === 'recurring') {
    const r = s.recurring;
    if (!r) return { ...base, category: 'parking', repeat: true };
    const m = parseMonthKey(r.startMonth)!;
    const day = String(Math.min(r.dayOfMonth, daysInMonth(m.year, m.month))).padStart(2, '0');
    return {
      ...base,
      category: r.category,
      amount: r.amount,
      date: `${r.startMonth}-${day}`,
      vehicleId: r.vehicleId,
      method: r.method,
      description: r.description ?? '',
      vendor: r.vendor ?? '',
      repeat: true,
      intervalMonths: r.intervalMonths,
      endMonth: r.endMonth ?? '',
      active: r.active,
    };
  }
  const category = s.category ?? (s.vehicleId ? 'fuel' : 'parking');
  return { ...base, category, vehicleId: s.vehicleId ?? null, repeat: !!s.repeat, amount: s.amount ?? null, description: s.description ?? '' };
}

/** "YYYY-MM-DD" + n tháng. */
const plusMonths = (key: string, n: number) => vnDateKey(addMonthsVn(vnDateKeyToMs(key), n));
const later = (a: string | null, b: string) => (a && a > b ? a : b);

export function CashEntryDialog({ state, onClose }: { state: CashDialogState | null; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [f, setF] = useState<Form>(() => initialForm(state ?? { mode: 'new' }));
  const [voiding, setVoiding] = useState<string | null>(null);
  const open = !!state;
  useEffect(() => {
    if (state) {
      setF(initialForm(state));
      setVoiding(null);
    }
  }, [state]);

  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<VehicleWithStatus[]>('/api/vehicles'), enabled: open });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRenew = (patch: Partial<Renew>) => setF((x) => ({ ...x, renew: { ...x.renew, ...patch } }));

  const cat = CASH_CATEGORY[f.category];
  const dir: CashDirection = cat.dir;
  const vehicle: Vehicle | undefined = vehicles?.find((v) => v.id === f.vehicleId);
  const mode = state?.mode ?? 'new';
  const entry = state?.mode === 'edit' ? state.entry : null;
  const recurring = state?.mode === 'recurring' ? state.recurring : undefined;
  const isTemplate = mode === 'recurring' || (mode === 'new' && f.repeat);
  const voided = !!entry?.voidedAt;

  const changeDir = (d: CashDirection) => {
    if (d === dir) return;
    set('category', categoriesOf(d)[0]);
  };
  const changeCategory = (c: CashCategory) => {
    setF((x) => ({ ...x, category: c, vehicleId: CASH_CATEGORY[c].shared && mode === 'new' && !(state?.mode === 'new' && state.vehicleId) ? null : x.vehicleId, renew: NO_RENEW }));
  };

  const inv = { invalidate: [['cashflow'], ['recurring'], ['dashboard'], ['vehicle']] };
  const done = () => onClose();

  const entryBody = () => {
    const sameDay = entry && vnDateKey(entry.at) === f.date;
    const at = sameDay ? entry.at : f.date === vnDateKey(Date.now()) ? Date.now() : dateKeyToNoon(f.date);
    return {
      category: f.category,
      amount: f.amount,
      at,
      vehicleId: f.vehicleId,
      method: f.method,
      description: f.description,
      vendor: f.vendor,
      odo: cat.odo && f.vehicleId ? f.odo : null,
      receiptFileIds: f.receiptFileIds,
    };
  };
  const templateBody = () => ({
    category: f.category,
    amount: f.amount,
    vehicleId: f.vehicleId,
    method: f.method,
    description: f.description,
    vendor: f.vendor,
    dayOfMonth: Number(f.date.slice(8, 10)),
    intervalMonths: f.intervalMonths,
    startMonth: f.date.slice(0, 7),
    endMonth: f.endMonth || null,
    active: f.active,
  });
  const renewal = () => {
    if (!isAdmin || !f.vehicleId || !cat.renew) return undefined;
    const r = Object.fromEntries(Object.entries(f.renew).filter(([, v]) => v != null && v !== ''));
    return Object.keys(r).length ? r : undefined;
  };

  const save = useAction(
    async () => {
      if (!f.amount || f.amount <= 0) throw new Error('Nhập số tiền');
      if (!f.date) throw new Error('Chọn ngày');
      if (isTemplate) {
        if (f.endMonth && f.endMonth < f.date.slice(0, 7)) throw new Error('Tháng kết thúc phải từ tháng bắt đầu trở đi');
        const r = recurring
          ? await api.put<{ created: number }>(`/api/recurring-costs/${recurring.id}`, templateBody())
          : await api.post<{ created: number }>('/api/recurring-costs', templateBody());
        return `${recurring ? 'Đã lưu khoản định kỳ' : 'Đã tạo khoản định kỳ'}${r.created ? ` · ghi ${r.created} kỳ vào sổ` : ''}`;
      }
      if (entry) {
        await api.put(`/api/cash-entries/${entry.id}`, entryBody());
        return 'Đã lưu';
      }
      const r = await api.post<{ renewed: Record<string, unknown> }>('/api/cash-entries', { ...entryBody(), renewal: renewal() });
      const renewed = Object.keys(r.renewed).length ? ' · đã cập nhật hạn cho xe' : '';
      return `Đã ghi ${dir === 'out' ? 'khoản chi' : 'khoản thu'} ${fmtVnd(f.amount)}${renewed}`;
    },
    { ...inv, success: (m) => m, onSuccess: done },
  );
  const doVoid = useAction(() => api.post(`/api/cash-entries/${entry!.id}/void`, { reason: voiding }), { ...inv, success: 'Đã hủy phiếu', onSuccess: done });

  const title =
    mode === 'recurring' ? (recurring ? 'Sửa khoản định kỳ' : 'Thêm khoản định kỳ') : entry ? (voided ? 'Phiếu đã hủy' : `Sửa khoản ${dir === 'out' ? 'chi' : 'thu'}`) : `Ghi khoản ${dir === 'out' ? 'chi' : 'thu'}`;
  const pastCount = isTemplate && f.date && !recurring ? dueRecurringMonths({ startMonth: f.date.slice(0, 7), endMonth: f.endMonth || null, intervalMonths: f.intervalMonths, dayOfMonth: Number(f.date.slice(8, 10)) }).length : 0;
  const readOnly = voided;
  const vehicleOptions = vehicles ?? [];
  const missingVehicle = f.vehicleId != null && vehicles && !vehicle;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={mode === 'recurring' || f.repeat ? 'App tự ghi vào sổ mỗi khi đến kỳ' : entry ? `Ghi lúc ${fmtDateTime(entry.createdAt)}` : undefined}
      footer={
        readOnly ? (
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        ) : voiding != null ? (
          <>
            <Button variant="ghost" onClick={() => setVoiding(null)}>
              Thôi
            </Button>
            <Button variant="danger" onClick={() => doVoid.mutate()} loading={doVoid.isPending} disabled={voiding.trim().length < 2}>
              Hủy phiếu
            </Button>
          </>
        ) : (
          <>
            {entry && isAdmin && (
              <Button variant="danger-ghost" className="mr-auto" onClick={() => setVoiding('')}>
                <Ban /> Hủy phiếu
              </Button>
            )}
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              {isTemplate ? (recurring ? 'Lưu' : 'Tạo khoản định kỳ') : entry ? 'Lưu' : 'Ghi sổ'}
            </Button>
          </>
        )
      }
    >
      {voiding != null ? (
        <div className="space-y-4">
          <Notice tone="amber">
            Phiếu bị hủy vẫn giữ trong sổ (gạch đi) để đối chiếu, nhưng không còn tính vào thu chi. Khoản {fmtVnd(entry!.amount)} · {CASH_CATEGORY[entry!.category].label}.
          </Notice>
          <Field label="Lý do hủy" required>
            <Input autoFocus value={voiding} onChange={(e) => setVoiding(e.target.value)} placeholder="Ghi nhầm số tiền, ghi trùng…" />
          </Field>
        </div>
      ) : (
        <fieldset disabled={readOnly} className="min-w-0 space-y-4">
          {voided && (
            <Notice tone="red">
              Đã hủy lúc {fmtDateTime(entry!.voidedAt)} · {entry!.voidReason}
            </Notice>
          )}
          {state?.mode === 'edit' && state.recurringLabel !== undefined && entry?.recurringId != null && !voided && (
            <Notice tone="blue" icon={Repeat}>
              Khoản tự ghi từ khoản định kỳ{state.recurringLabel ? ` «${state.recurringLabel}»` : ''}. Sửa ở đây chỉ đổi kỳ này; đổi số tiền các kỳ sau ở mục Khoản định kỳ.
            </Notice>
          )}

          {isAdmin && (
            <Segmented
              className="w-full"
              value={dir}
              onChange={changeDir}
              options={[
                { value: 'out', label: 'Khoản chi' },
                { value: 'in', label: 'Khoản thu' },
              ]}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hạng mục" required>
              <Select value={f.category} onChange={(e) => changeCategory(e.target.value as CashCategory)}>
                {groupedCategories(dir).map((g) => (
                  <optgroup key={g.group} label={g.label}>
                    {g.items.map((c) => (
                      <option key={c} value={c}>
                        {CASH_CATEGORY[c].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Số tiền" required>
              <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} />
            </Field>
          </div>

          {cat.capital && (
            <Notice tone="gray">
              {dir === 'out' ? 'Mua xe, trả góp' : 'Bán xe, thanh lý'} tính riêng vào <b>dòng tiền ròng</b>, không làm sai lãi vận hành của tháng.
            </Notice>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Xe" hint={f.vehicleId == null ? 'Chi phí chung — xem báo cáo có thể chia đều cho các xe' : undefined}>
              <Select value={f.vehicleId ?? ''} onChange={(e) => set('vehicleId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Chung — không gắn xe</option>
                {vehicleOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} · {v.make} {v.model}
                  </option>
                ))}
                {missingVehicle && <option value={f.vehicleId!}>Xe đã lưu trữ (#{f.vehicleId})</option>}
              </Select>
            </Field>
            <Field label={isTemplate ? 'Bắt đầu từ ngày' : 'Ngày'} required hint={isTemplate && f.date ? `Ghi vào ngày ${Number(f.date.slice(8, 10))} mỗi kỳ` : undefined}>
              <DateInput value={f.date} onChange={(v) => set('date', v ?? '')} />
            </Field>
          </div>

          <Field label="Nội dung">
            <Input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={cat.placeholder ?? 'Ghi chú ngắn'} maxLength={300} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={dir === 'out' ? 'Nơi chi / người nhận' : 'Người trả / nguồn thu'}>
              <Input value={f.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder={dir === 'out' ? 'Gara, cây xăng, chủ bãi…' : 'Công ty bảo hiểm…'} maxLength={120} />
            </Field>
            <Field label="Hình thức">
              <Segmented
                className="flex w-full"
                value={f.method}
                onChange={(v) => set('method', v)}
                options={[
                  { value: 'cash', label: 'Tiền mặt' },
                  { value: 'transfer', label: 'Chuyển khoản' },
                ]}
              />
            </Field>
          </div>

          {!isTemplate && cat.odo && f.vehicleId != null && (
            <Field label="ODO lúc làm" hint={vehicle ? `ODO hiện tại của xe: ${fmtNumber(vehicle.odo)} km` : undefined}>
              <NumberInput value={f.odo} onChange={(v) => set('odo', v)} suffix="km" placeholder={vehicle ? fmtNumber(vehicle.odo) : undefined} />
            </Field>
          )}

          {mode === 'new' && !f.repeat && isAdmin && cat.renew && vehicle && <RenewFields kind={cat.renew} vehicle={vehicle} date={f.date} odo={f.odo} renew={f.renew} onChange={setRenew} />}

          {!isTemplate && (
            <Field label="Ảnh hóa đơn / biên lai">
              <MultiPhotoInput value={f.receiptFileIds} onChange={(ids) => set('receiptFileIds', ids)} kind="receipt" camera />
            </Field>
          )}

          {mode === 'new' && isAdmin && (
            <div className="rounded-2xl border border-border p-3">
              <Checkbox checked={f.repeat} onChange={(v) => set('repeat', v)} label="Lặp lại định kỳ" description="App tự ghi khoản này mỗi kỳ — bến bãi, lương, trả góp, bảo hiểm năm…" />
            </div>
          )}

          {isTemplate && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Chu kỳ">
                  <Select value={f.intervalMonths} onChange={(e) => set('intervalMonths', Number(e.target.value))}>
                    {RECUR_INTERVALS.map((n) => (
                      <option key={n} value={n}>
                        {RECUR_INTERVAL_LABEL[n]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Đến tháng" hint="Để trống nếu không có hạn">
                  <Input type="month" value={f.endMonth} min={f.date.slice(0, 7)} onChange={(e) => set('endMonth', e.target.value)} />
                </Field>
              </div>
              {mode === 'recurring' && recurring && <Switch checked={f.active} onChange={(v) => set('active', v)} label="Đang chạy" description="Tắt để ngưng tự ghi (các kỳ đã ghi vẫn giữ)" />}
              {f.date && f.amount ? (
                <Notice tone="blue" icon={Repeat}>
                  {recurringText({ intervalMonths: f.intervalMonths, dayOfMonth: Number(f.date.slice(8, 10)) })}: {fmtVnd(f.amount)} từ {fmtDateKey(f.date)}
                  {f.endMonth && ` đến ${fmtMonthKey(f.endMonth).toLowerCase()}`}.
                  {pastCount > 0 && <b> Ghi ngay {pastCount} kỳ đã đến hạn.</b>}
                </Notice>
              ) : null}
            </div>
          )}
        </fieldset>
      )}
    </Dialog>
  );
}

/** Ghi chi phí đăng kiểm / bảo hiểm / bảo dưỡng xong thì gia hạn luôn cho xe (hết nhắc hạn). */
function RenewFields({ kind, vehicle: v, date, odo, renew, onChange }: { kind: RenewKind; vehicle: Vehicle; date: string; odo: number | null; renew: Renew; onChange: (p: Partial<Renew>) => void }) {
  const cur = (k: string | null) => (k ? `Hiện tại: ${fmtDateKey(k)}` : 'Chưa có hạn');
  const chips = (items: { label: string; apply: () => void }[]) => (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((c) => (
        <button key={c.label} type="button" onClick={c.apply} className="rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg">
          {c.label}
        </button>
      ))}
    </div>
  );
  const base = date || vnDateKey(Date.now());
  return (
    <div className="space-y-3 rounded-2xl bg-surface-2/60 p-3">
      <p className="text-sm font-medium">Cập nhật luôn cho xe {v.plate} (không bắt buộc)</p>
      {kind === 'inspection' && (
        <Field label="Hạn đăng kiểm mới" hint={cur(v.inspectionExpiry)}>
          <DateInput value={renew.inspectionExpiry} onChange={(x) => onChange({ inspectionExpiry: x })} />
          {chips([12, 18, 24].map((n) => ({ label: `+${n} tháng`, apply: () => onChange({ inspectionExpiry: plusMonths(base, n) }) })))}
        </Field>
      )}
      {kind === 'insurance' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hạn BH TNDS mới" hint={cur(v.insuranceTndsExpiry)}>
            <DateInput value={renew.insuranceTndsExpiry} onChange={(x) => onChange({ insuranceTndsExpiry: x })} />
            {chips([{ label: '+1 năm', apply: () => onChange({ insuranceTndsExpiry: plusMonths(later(v.insuranceTndsExpiry, base), 12) }) }])}
          </Field>
          <Field label="Hạn BH thân vỏ mới" hint={cur(v.insuranceBodyExpiry)}>
            <DateInput value={renew.insuranceBodyExpiry} onChange={(x) => onChange({ insuranceBodyExpiry: x })} />
            {chips([{ label: '+1 năm', apply: () => onChange({ insuranceBodyExpiry: plusMonths(later(v.insuranceBodyExpiry, base), 12) }) }])}
          </Field>
        </div>
      )}
      {kind === 'road_fee' && (
        <Field label="Hạn phí đường bộ mới" hint={cur(v.roadFeeExpiry)}>
          <DateInput value={renew.roadFeeExpiry} onChange={(x) => onChange({ roadFeeExpiry: x })} />
          {chips([6, 12].map((n) => ({ label: `+${n} tháng`, apply: () => onChange({ roadFeeExpiry: plusMonths(later(v.roadFeeExpiry, base), n) }) })))}
        </Field>
      )}
      {kind === 'service' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bảo dưỡng lần tới (km)" hint={v.nextServiceOdo ? `Mốc cũ: ${fmtNumber(v.nextServiceOdo)} km` : undefined}>
            <NumberInput value={renew.nextServiceOdo} onChange={(x) => onChange({ nextServiceOdo: x })} suffix="km" />
            {chips([5000, 10000].map((n) => ({ label: `+${fmtNumber(n)} km`, apply: () => onChange({ nextServiceOdo: (odo ?? v.odo) + n }) })))}
          </Field>
          <Field label="hoặc trước ngày" hint={v.nextServiceDate ? `Mốc cũ: ${fmtDateKey(v.nextServiceDate)}` : undefined}>
            <DateInput value={renew.nextServiceDate} onChange={(x) => onChange({ nextServiceDate: x })} />
            {chips([6, 12].map((n) => ({ label: `+${n} tháng`, apply: () => onChange({ nextServiceDate: plusMonths(base, n) }) })))}
          </Field>
        </div>
      )}
    </div>
  );
}
