// Phụ kiện & tiện nghi của một xe: danh sách, gợi ý thông minh, hộp chọn từ danh mục.

import { useQuery } from '@tanstack/react-query';
import { Check, Copy, PackagePlus, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { CatalogItem, VehicleAccessoriesData, VehicleAccessoryView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABEL, type AccessoryCategory } from '@shared/constants';
import { fmtNumber, fmtVnd, unaccent } from '@shared/text';
import { Button } from './ui/button';
import { Dialog, useConfirm } from './ui/dialog';
import { Field, Input, MoneyInput, NumberInput, Select, Switch, Textarea } from './ui/form';
import { Badge, Card, CardBody, CardHeader, Spinner } from './ui/misc';

const key = (s: string) => unaccent(s).replace(/[^a-z0-9]+/g, ' ').trim();

function matches(c: CatalogItem, q: string): boolean {
  const k = key(q);
  return key(c.name).includes(k) || (!!c.aliases && key(c.aliases).includes(k));
}

export function AccessoryManager({ vehicleId }: { vehicleId: number }) {
  const qk = ['vehicle-accessories', vehicleId];
  const { data, isLoading } = useQuery({ queryKey: qk, queryFn: () => api.get<VehicleAccessoriesData>(`/api/vehicles/${vehicleId}/accessories`) });
  const [picker, setPicker] = useState(false);
  const [edit, setEdit] = useState<VehicleAccessoryView | null>(null);
  const inv = { invalidate: [qk, ['vehicle', String(vehicleId)], ['vehicles']] };
  const quickAdd = useAction((catalogId: number) => api.post<{ added: { name: string }[] }>(`/api/vehicles/${vehicleId}/accessories`, { items: [{ catalogId }] }), {
    ...inv,
    success: (r) => `Đã thêm ${r.added.map((a) => a.name).join(', ')}`,
  });

  const grouped = useMemo(() => {
    const m = new Map<AccessoryCategory, VehicleAccessoryView[]>();
    for (const a of data?.items ?? []) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return ACCESSORY_CATEGORIES.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [data]);

  const total = (data?.items ?? []).reduce((s, a) => s + a.effectiveValue * a.quantity, 0);

  return (
    <Card>
      <CardHeader
        icon={PackagePlus}
        title="Phụ kiện & tiện nghi"
        description={data?.items.length ? `${data.items.length} món · giá trị ${fmtVnd(total)}` : 'Tự vào checklist giao/nhận xe và hợp đồng'}
        action={
          <Button size="sm" onClick={() => setPicker(true)}>
            <Plus /> Thêm
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {isLoading && <Spinner />}
        {grouped.map(([cat, items]) => (
          <div key={cat}>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{ACCESSORY_CATEGORY_LABEL[cat]}</p>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {items.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setEdit(a)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {a.name}
                        {a.quantity > 1 && <span className="text-muted">× {a.quantity}</span>}
                        {a.showInShare && <Sparkles className="size-3.5 text-amber-500" aria-label="Hiện khi chia sẻ" />}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[a.note, a.effectiveValue ? `đền bù ${fmtNumber(a.effectiveValue)}đ` : null, !a.checkOnHandover && 'không kiểm khi giao nhận'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {!!data?.suggestions.length && (
          <div className="rounded-2xl bg-surface-2/70 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-brand" /> Gợi ý cho xe này
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.suggestions.slice(0, data.items.length ? 6 : 10).map((s) => (
                <button
                  key={s.catalogId}
                  onClick={() => quickAdd.mutate(s.catalogId)}
                  disabled={quickAdd.isPending}
                  title={s.reasons.join(' · ')}
                  className="group flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-3 pl-2 text-sm hover:border-brand hover:text-brand"
                >
                  <Plus className="size-3.5 text-muted group-hover:text-brand" />
                  {s.name}
                  <span className="hidden text-xs text-subtle sm:inline">· {s.reasons[0]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardBody>

      {data && <AccessoryPicker open={picker} onOpenChange={setPicker} vehicleId={vehicleId} data={data} />}
      <AccessoryEditDialog item={edit} onClose={() => setEdit(null)} vehicleId={vehicleId} catalog={data?.catalog ?? []} />
    </Card>
  );
}

function AccessoryPicker({ open, onOpenChange, vehicleId, data }: { open: boolean; onOpenChange: (o: boolean) => void; vehicleId: number; data: VehicleAccessoriesData }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [newItems, setNewItems] = useState<{ name: string; category: AccessoryCategory }[]>([]);
  const [newCat, setNewCat] = useState<AccessoryCategory>('other');
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const qk = ['vehicle-accessories', vehicleId];
  const inv = { invalidate: [qk, ['vehicle', String(vehicleId)], ['vehicles']] };
  const have = new Set(data.items.map((a) => a.catalogId));
  const haveKeys = new Set(data.items.map((a) => key(a.name)));

  const reset = () => {
    setQ('');
    setPicked(new Set());
    setNewItems([]);
    setCopyFrom('');
  };
  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };
  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const results = q.trim() ? data.catalog.filter((c) => matches(c, q)) : [];
  const exact = q.trim() && (data.catalog.some((c) => key(c.name) === key(q)) || newItems.some((n) => key(n.name) === key(q)) || haveKeys.has(key(q)));
  const reasons = new Map(data.suggestions.map((s) => [s.catalogId, s.reasons]));

  const addNew = () => {
    const name = q.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return;
    setNewItems([...newItems, { name: name.charAt(0).toUpperCase() + name.slice(1), category: newCat }]);
    setQ('');
  };

  const copy = useAction(() => api.post<{ added: unknown[]; skipped: string[] }>(`/api/vehicles/${vehicleId}/accessories/copy`, { fromVehicleId: copyFrom }), {
    ...inv,
    success: (r) => `Đã chép ${r.added.length} phụ kiện${r.skipped.length ? ` (bỏ qua ${r.skipped.length} món đã có)` : ''}`,
    onSuccess: () => close(false),
  });

  const save = useAction(
    () =>
      api.post<{ added: { name: string }[]; skipped: string[] }>(`/api/vehicles/${vehicleId}/accessories`, {
        items: [...[...picked].map((catalogId) => ({ catalogId })), ...newItems.map((n) => ({ name: n.name, category: n.category }))],
      }),
    { ...inv, success: (r) => `Đã thêm ${r.added.length} phụ kiện`, onSuccess: () => close(false) },
  );

  const count = picked.size + newItems.length;
  const Chip = ({ c }: { c: CatalogItem }) => {
    const owned = have.has(c.id);
    const on = picked.has(c.id);
    return (
      <button
        type="button"
        disabled={owned}
        onClick={() => toggle(c.id)}
        title={reasons.get(c.id)?.join(' · ') ?? (c.aliases ? `Còn gọi: ${c.aliases}` : undefined)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
          owned ? 'border-transparent bg-surface-2 text-subtle' : on ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand',
        )}
      >
        {(owned || on) && <Check className="size-3.5" />}
        {c.name}
        {c.usage > 0 && !owned && !on && <span className="text-xs text-subtle">{c.usage} xe</span>}
      </button>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Thêm phụ kiện"
      description="Chọn nhiều món một lần. Gõ tên mới nếu danh mục chưa có — lần sau xe khác dùng lại được."
      size="lg"
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!count}>
          <Plus /> Thêm {count || ''} phụ kiện
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (results.length === 1 && !have.has(results[0].id)) {
                  toggle(results[0].id);
                  setQ('');
                } else if (!exact) addNew();
              }
            }}
            placeholder="Tìm: sạc, camera, tpms, nước hoa…"
            className="pl-9"
          />
        </div>

        {q.trim() ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {results.map((c) => (
                <Chip key={c.id} c={c} />
              ))}
            </div>
            {!exact && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border-strong p-3">
                <span className="text-sm">
                  Thêm mới <b>“{q.trim()}”</b> vào nhóm
                </span>
                <Select value={newCat} onChange={(e) => setNewCat(e.target.value as AccessoryCategory)} className="w-auto">
                  {ACCESSORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {ACCESSORY_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="secondary" onClick={addNew}>
                  <Plus /> Thêm
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {!!data.suggestions.length && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-4 text-brand" /> Gợi ý cho xe này
                </p>
                <div className="space-y-1">
                  {data.suggestions.map((s) => {
                    const on = picked.has(s.catalogId);
                    return (
                      <button
                        key={s.catalogId}
                        type="button"
                        onClick={() => toggle(s.catalogId)}
                        className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left', on ? 'bg-brand-soft' : 'hover:bg-surface-2')}
                      >
                        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md border', on ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong')}>
                          {on && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{s.name}</span>
                          <span className="block truncate text-xs text-muted">{s.reasons.join(' · ')}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {ACCESSORY_CATEGORIES.map((cat) => {
              const items = data.catalog.filter((c) => c.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat}>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{ACCESSORY_CATEGORY_LABEL[cat]}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((c) => (
                      <Chip key={c.id} c={c} />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {newItems.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Phụ kiện mới (sẽ vào danh mục)</p>
            <div className="flex flex-wrap gap-1.5">
              {newItems.map((n, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-sm text-brand-fg">
                  {n.name}
                  <button onClick={() => setNewItems(newItems.filter((_, j) => j !== i))} aria-label="Bỏ">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {data.copySources.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <Field label="Hoặc chép toàn bộ từ xe khác" className="min-w-56 flex-1">
              <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— Chọn xe —</option>
                {data.copySources.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} · {v.make} {v.model} ({v.n} món)
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="outline" onClick={() => copy.mutate()} disabled={!copyFrom} loading={copy.isPending}>
              <Copy /> Chép
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function AccessoryEditDialog({ item, onClose, vehicleId, catalog }: { item: VehicleAccessoryView | null; onClose: () => void; vehicleId: number; catalog: CatalogItem[] }) {
  const confirm = useConfirm();
  const [f, setF] = useState<VehicleAccessoryView | null>(null);
  if (item && f?.id !== item.id) setF(item);
  const inv = { invalidate: [['vehicle-accessories', vehicleId], ['vehicle', String(vehicleId)], ['vehicles']] };
  const save = useAction(() => api.patch(`/api/vehicle-accessories/${f!.id}`, { quantity: f!.quantity, note: f!.note, value: f!.value, checkOnHandover: f!.checkOnHandover, showInShare: f!.showInShare }), {
    ...inv,
    success: 'Đã lưu',
    onSuccess: onClose,
  });
  const remove = useAction(() => api.del(`/api/vehicle-accessories/${f!.id}`), { ...inv, success: 'Đã bỏ phụ kiện khỏi xe', onSuccess: onClose });
  const catDefault = catalog.find((c) => c.id === f?.catalogId)?.defaultValue ?? 0;
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={f?.name ?? ''}
      description={f ? ACCESSORY_CATEGORY_LABEL[f.category] : undefined}
      footer={
        <>
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={async () => {
              if (await confirm({ title: `Bỏ "${f?.name}" khỏi xe?`, description: 'Biên bản đã lập trước đây vẫn giữ nguyên.', danger: true, confirmText: 'Bỏ' })) remove.mutate();
            }}
          >
            <Trash2 /> Bỏ khỏi xe
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      {f && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Số lượng">
              <NumberInput value={f.quantity} onChange={(v) => setF({ ...f, quantity: Math.max(1, v ?? 1) })} />
            </Field>
            <Field label="Giá trị đền bù khi mất" hint={`Để trống = mặc định ${fmtVnd(catDefault)}`}>
              <MoneyInput value={f.value} onChange={(v) => setF({ ...f, value: v })} placeholder={fmtNumber(catDefault)} />
            </Field>
          </div>
          <Field label="Ghi chú" hint="Hiệu, đời, vị trí để… (in lên biên bản)">
            <Textarea value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value || null })} rows={2} placeholder="vd: Xiaomi 10.000mAh, để hộc trước" />
          </Field>
          <Switch checked={f.checkOnHandover} onChange={(v) => setF({ ...f, checkOnHandover: v })} label="Kiểm khi giao / nhận xe" description="Có trong checklist biên bản và hợp đồng" />
          <Switch checked={f.showInShare} onChange={(v) => setF({ ...f, showInShare: v })} label="Hiện khi chia sẻ cho khách" description="Ghi trong mục Tiện nghi của ảnh bảng giá" />
          {f.checkOnHandover && f.quantity > 0 && <Badge tone="blue">Lúc nhận xe mà thiếu → gợi ý thu {fmtVnd((f.value ?? catDefault) * f.quantity)}</Badge>}
        </div>
      )}
    </Dialog>
  );
}
