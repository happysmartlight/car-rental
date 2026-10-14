// Lịch bảo dưỡng theo hạng mục của một xe: hạn từng mục (km / tháng, cái nào tới trước),
// ghi "đã làm" (kèm chi phí → phiếu chi Bảo dưỡng), thiết lập nhanh từ danh mục gợi ý.

import { useQuery } from '@tanstack/react-query';
import { Archive, CheckCheck, History, Plus, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useAuth } from '@/lib/hooks';
import type { MaintenanceData, MaintenanceItemView, Vehicle } from '@/lib/types';
import { cn } from '@/lib/utils';
import { intervalText, statusText, type MaintenanceState } from '@shared/maintenance';
import { fmtNumber } from '@shared/text';
import { fmtDateKey, vnDateKey } from '@shared/time';
import { Button } from './ui/button';
import { Dialog, useConfirm } from './ui/dialog';
import { Checkbox, DateInput, Field, Input, MoneyInput, NumberInput, Segmented, Textarea } from './ui/form';
import { Badge, Card, CardBody, CardHeader, Notice, Spinner } from './ui/misc';

const STATE: Record<MaintenanceState, { label: string; tone: 'red' | 'amber' | 'green' | 'gray'; bar: string }> = {
  overdue: { label: 'Quá hạn', tone: 'red', bar: 'bg-red-500' },
  soon: { label: 'Sắp đến hạn', tone: 'amber', bar: 'bg-amber-500' },
  ok: { label: 'Còn hạn', tone: 'green', bar: 'bg-emerald-500' },
  unknown: { label: 'Chưa rõ', tone: 'gray', bar: 'bg-surface-3' },
};

/** Đã dùng bao nhiêu % chu kỳ (theo km hoặc theo ngày — lấy cái gần hạn hơn). */
function usedPct(i: MaintenanceItemView, odo: number): number | null {
  const byKm = i.intervalKm && i.lastOdo != null ? (odo - i.lastOdo) / i.intervalKm : null;
  const byDays = i.intervalMonths && i.status.daysLeft != null ? 1 - i.status.daysLeft / (i.intervalMonths * 30.4) : null;
  const p = Math.max(byKm ?? -1, byDays ?? -1);
  return p < 0 ? null : Math.min(1, p);
}

export function MaintenanceSchedule({ vehicle }: { vehicle: Vehicle }) {
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['maintenance', vehicle.id], queryFn: () => api.get<MaintenanceData>(`/api/vehicles/${vehicle.id}/maintenance`) });
  const [setupOpen, setSetupOpen] = useState(false);
  const [edit, setEdit] = useState<MaintenanceItemView | 'new' | null>(null);
  const [done, setDone] = useState<number[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const items = data?.items ?? [];
  const due = items.filter((i) => i.status.state === 'overdue' || i.status.state === 'soon');
  const names = new Map(items.map((i) => [i.id, i.name]));

  return (
    <Card>
      <CardHeader
        icon={Wrench}
        title="Lịch bảo dưỡng"
        description={items.length ? `ODO hiện ${fmtNumber(vehicle.odo)} km${due.length ? ` · ${due.length} mục cần làm` : ''}` : 'Mỗi hạng mục một chu kỳ km / tháng — app nhắc khi gần đến hạn'}
        action={
          items.length > 0 && (
            <Button size="sm" onClick={() => setDone(due.map((i) => i.id))}>
              <CheckCheck /> Ghi đã làm
            </Button>
          )
        }
      />
      {isLoading ? (
        <CardBody>
          <Spinner />
        </CardBody>
      ) : !items.length ? (
        <CardBody className="space-y-3">
          <p className="text-sm text-muted">Chưa có lịch. Thiết lập nhanh từ danh mục gợi ý (thay dầu, lọc gió, má phanh, lốp…) theo loại xe, rồi chỉnh chu kỳ theo sổ bảo dưỡng của hãng.</p>
          {isAdmin ? (
            <Button variant="secondary" onClick={() => setSetupOpen(true)}>
              <Plus /> Thiết lập lịch bảo dưỡng
            </Button>
          ) : (
            <p className="text-sm text-muted">Nhờ quản trị thiết lập.</p>
          )}
        </CardBody>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {items.map((i) => {
              const st = STATE[i.status.state];
              const pct = usedPct(i, vehicle.odo);
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (isAdmin ? setEdit(i) : setDone([i.id]))}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{i.name}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </span>
                    <span className="block text-xs text-muted">
                      {intervalText(i)}
                      {i.lastDate || i.lastOdo != null ? ` · lần trước ${[i.lastOdo != null && `${fmtNumber(i.lastOdo)} km`, i.lastDate && fmtDateKey(i.lastDate)].filter(Boolean).join(', ')}` : ''}
                    </span>
                    <span className={cn('block text-xs', i.status.state === 'overdue' ? 'font-medium text-red-600 dark:text-red-400' : i.status.state === 'soon' ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}>
                      {statusText(i.status)}
                      {i.status.state !== 'unknown' && ` (${[i.status.nextOdo != null && `mốc ${fmtNumber(i.status.nextOdo)} km`, i.status.nextDate && `hạn ${fmtDateKey(i.status.nextDate)}`].filter(Boolean).join(' · ')})`}
                    </span>
                    {pct != null && (
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <span className={cn('block h-full rounded-full', st.bar)} style={{ width: `${Math.max(4, pct * 100)}%` }} />
                      </span>
                    )}
                  </button>
                  <Button size="sm" variant="outline" onClick={() => setDone([i.id])} aria-label={`Ghi đã làm ${i.name}`}>
                    Đã làm
                  </Button>
                </li>
              );
            })}
          </ul>
          <CardBody className="flex flex-wrap gap-2 border-t border-border pt-3">
            {isAdmin && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEdit('new')}>
                  <Plus /> Thêm hạng mục
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSetupOpen(true)}>
                  <Plus /> Thêm từ gợi ý
                </Button>
              </>
            )}
            {!!data?.records.length && (
              <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
                <History /> {showHistory ? 'Ẩn lịch sử' : `Lịch sử (${data.records.length} lần)`}
              </Button>
            )}
          </CardBody>
          {showHistory && data && (
            <ul className="divide-y divide-border border-t border-border text-sm">
              {data.records.map((r) => (
                <li key={r.id} className="flex gap-3 px-4 py-2 md:px-5">
                  <span className="w-24 shrink-0 text-muted">{fmtDateKey(r.doneDate)}</span>
                  <span className="min-w-0 flex-1">
                    {names.get(r.itemId) ?? 'Hạng mục đã bỏ'}
                    {r.notes && <span className="block truncate text-xs text-muted">{r.notes}</span>}
                  </span>
                  {r.odo != null && <span className="tabular shrink-0 text-muted">{fmtNumber(r.odo)} km</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {data && <SetupDialog vehicle={vehicle} data={data} open={setupOpen} onOpenChange={setSetupOpen} />}
      <ItemDialog vehicle={vehicle} item={edit} onClose={() => setEdit(null)} />
      {data && <DoneDialog vehicle={vehicle} items={items} preset={done} onClose={() => setDone(null)} />}
    </Card>
  );
}

const inv = (vehicleId: number) => ({ invalidate: [['maintenance', vehicleId], ['vehicle', String(vehicleId)], ['vehicles'], ['dashboard'], ['cashflow']] });

/** Thiết lập nhanh: tick các hạng mục gợi ý, nhập một lần "lần bảo dưỡng gần nhất". */
function SetupDialog({ vehicle, data, open, onOpenChange }: { vehicle: Vehicle; data: MaintenanceData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const have = new Set(data.items.map((i) => i.preset).filter(Boolean));
  const options = data.presets.filter((p) => !have.has(p.key));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [known, setKnown] = useState(true);
  const [date, setDate] = useState<string | null>(vnDateKey(Date.now()));
  const [odo, setOdo] = useState<number | null>(vehicle.odo);
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(options.filter((p) => p.common).map((p) => p.key)));
    setKnown(true);
    setDate(vnDateKey(Date.now()));
    setOdo(vehicle.odo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useAction(
    () =>
      api.post(`/api/vehicles/${vehicle.id}/maintenance`, {
        items: options
          .filter((p) => picked.has(p.key))
          .map((p) => ({ name: p.name, preset: p.key, intervalKm: p.km, intervalMonths: p.months, lastOdo: known ? odo : null, lastDate: known ? date : null })),
      }),
    { ...inv(vehicle.id), success: 'Đã thiết lập lịch bảo dưỡng', onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Thiết lập lịch bảo dưỡng"
      description={`${vehicle.plate} · chu kỳ phổ biến — chỉnh từng mục sau theo sổ bảo dưỡng của hãng`}
      size="lg"
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!picked.size}>
          Thêm {picked.size} hạng mục
        </Button>
      }
    >
      <div className="space-y-4">
        {options.length ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {options.map((p) => (
              <Checkbox
                key={p.key}
                checked={picked.has(p.key)}
                onChange={(v) => {
                  const next = new Set(picked);
                  if (v) next.add(p.key);
                  else next.delete(p.key);
                  setPicked(next);
                }}
                label={p.name}
                description={intervalText({ intervalKm: p.km, intervalMonths: p.months })}
              />
            ))}
          </div>
        ) : (
          <Notice tone="gray">Đã có đủ các hạng mục gợi ý. Thêm hạng mục riêng bằng nút "Thêm hạng mục".</Notice>
        )}
        <div className="space-y-3 rounded-2xl bg-surface-2/60 p-3">
          <Checkbox checked={known} onChange={setKnown} label="Biết lần bảo dưỡng gần nhất" description="Áp cho các mục vừa chọn — vừa bảo dưỡng tổng thể thì để hôm nay và ODO hiện tại" />
          {known && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ngày làm">
                <DateInput value={date} onChange={setDate} />
              </Field>
              <Field label="ODO lúc làm">
                <NumberInput value={odo} onChange={setOdo} suffix="km" />
              </Field>
            </div>
          )}
          {!known && <p className="text-xs text-muted">Các mục sẽ ở trạng thái "Chưa rõ" cho tới khi ghi lần làm đầu tiên.</p>}
        </div>
      </div>
    </Dialog>
  );
}

/** Thêm / sửa một hạng mục (quản trị). */
function ItemDialog({ vehicle, item, onClose }: { vehicle: Vehicle; item: MaintenanceItemView | 'new' | null; onClose: () => void }) {
  const confirm = useConfirm();
  const isNew = item === 'new';
  const cur = item && item !== 'new' ? item : null;
  const [name, setName] = useState('');
  const [km, setKm] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(null);
  const [lastOdo, setLastOdo] = useState<number | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!item) return;
    setName(cur?.name ?? '');
    setKm(cur?.intervalKm ?? null);
    setMonths(cur?.intervalMonths ?? null);
    setLastOdo(cur?.lastOdo ?? null);
    setLastDate(cur?.lastDate ?? null);
    setNotes(cur?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const body = { name, intervalKm: km || null, intervalMonths: months || null, lastOdo, lastDate, notes: notes || null };
  const save = useAction(() => (isNew ? api.post(`/api/vehicles/${vehicle.id}/maintenance`, { items: [body] }) : api.patch(`/api/maintenance/${cur!.id}`, body)), {
    ...inv(vehicle.id),
    success: isNew ? 'Đã thêm hạng mục' : 'Đã lưu',
    onSuccess: onClose,
  });
  const archive = useAction(() => api.post(`/api/maintenance/${cur!.id}/archive`), { ...inv(vehicle.id), success: 'Đã bỏ khỏi lịch', onSuccess: onClose });
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Thêm hạng mục bảo dưỡng' : 'Sửa hạng mục'}
      description={vehicle.plate}
      footer={
        <>
          {cur && (
            <Button
              variant="danger-ghost"
              className="mr-auto"
              onClick={async () => {
                if (await confirm({ title: `Bỏ "${cur.name}" khỏi lịch?`, description: 'App thôi nhắc mục này. Lịch sử các lần đã làm vẫn giữ.', confirmText: 'Bỏ khỏi lịch', danger: true })) archive.mutate();
              }}
            >
              <Archive /> Bỏ
            </Button>
          )}
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2 || (!km && !months)}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Hạng mục" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Thay dầu máy, đảo lốp…" maxLength={80} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Chu kỳ km">
            <NumberInput value={km} onChange={setKm} suffix="km" />
          </Field>
          <Field label="hoặc tháng">
            <NumberInput value={months} onChange={setMonths} suffix="tháng" plain />
          </Field>
        </div>
        {!km && !months && <p className="text-xs text-amber-700 dark:text-amber-400">Nhập ít nhất một chu kỳ — theo km, theo tháng hoặc cả hai (cái nào tới trước).</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lần làm gần nhất — ODO">
            <NumberInput value={lastOdo} onChange={setLastOdo} suffix="km" />
          </Field>
          <Field label="Ngày">
            <DateInput value={lastDate} onChange={setLastDate} />
          </Field>
        </div>
        <Field label="Ghi chú">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Loại dầu, mã lọc, gara quen…" />
        </Field>
      </div>
    </Dialog>
  );
}

/** Ghi đã làm: tick các mục, ngày, ODO; có chi phí thì ghi luôn phiếu chi "Bảo dưỡng định kỳ". */
function DoneDialog({ vehicle, items, preset, onClose }: { vehicle: Vehicle; items: MaintenanceItemView[]; preset: number[] | null; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [date, setDate] = useState<string | null>(vnDateKey(Date.now()));
  const [odo, setOdo] = useState<number | null>(vehicle.odo);
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [vendor, setVendor] = useState('');
  useEffect(() => {
    if (!preset) return;
    setPicked(new Set(preset));
    setDate(vnDateKey(Date.now()));
    setOdo(vehicle.odo);
    setNotes('');
    setCost(null);
    setVendor('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  const chosen = useMemo(() => items.filter((i) => picked.has(i.id)), [items, picked]);
  const save = useAction(
    () =>
      api.post<{ done: number; entry: unknown }>(`/api/vehicles/${vehicle.id}/maintenance/done`, {
        itemIds: [...picked],
        date,
        odo,
        notes: notes || null,
        cost: cost ? { amount: cost, method, vendor: vendor || null } : null,
      }),
    { ...inv(vehicle.id), success: (r) => `Đã ghi ${r.done} hạng mục${r.entry ? ` · ghi chi ${fmtNumber(cost ?? 0)}đ vào Thu chi` : ''}`, onSuccess: onClose },
  );
  return (
    <Dialog
      open={!!preset}
      onOpenChange={(o) => !o && onClose()}
      title="Ghi đã làm bảo dưỡng"
      description={vehicle.plate}
      size="lg"
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!picked.size || !date}>
          {picked.size ? `Ghi ${picked.size} hạng mục` : 'Chọn hạng mục đã làm'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {items.map((i) => (
            <Checkbox
              key={i.id}
              checked={picked.has(i.id)}
              onChange={(v) => {
                const next = new Set(picked);
                if (v) next.add(i.id);
                else next.delete(i.id);
                setPicked(next);
              }}
              label={i.name}
              description={statusText(i.status)}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày làm" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="ODO lúc làm" hint={`Hiện tại: ${fmtNumber(vehicle.odo)} km`}>
            <NumberInput value={odo} onChange={setOdo} suffix="km" />
          </Field>
        </div>
        <Field label="Ghi chú">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dầu 5W-30, thay 2 lốp trước…" maxLength={200} />
        </Field>
        <div className="space-y-3 rounded-2xl bg-surface-2/60 p-3">
          <Field label="Chi phí (không bắt buộc)" hint="Nhập để ghi luôn khoản chi Bảo dưỡng định kỳ vào Thu chi của xe">
            <MoneyInput value={cost} onChange={setCost} />
          </Field>
          {!!cost && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nơi làm">
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Gara, đại lý…" maxLength={120} />
              </Field>
              <Field label="Hình thức">
                <Segmented value={method} onChange={setMethod} className="flex w-full" options={[{ value: 'cash', label: 'Tiền mặt' }, { value: 'transfer', label: 'Chuyển khoản' }]} />
              </Field>
            </div>
          )}
        </div>
        {chosen.some((i) => i.status.state === 'unknown') && <p className="text-xs text-muted">Mục "Chưa rõ" sẽ bắt đầu tính hạn từ lần ghi này.</p>}
      </div>
    </Dialog>
  );
}
