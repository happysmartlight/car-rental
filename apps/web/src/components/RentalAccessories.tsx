// Phụ kiện kèm một lượt thuê: bỏ tick món đang thiếu, thêm món riêng cho lượt (ghế trẻ em…).
// Chỉ đổi cho lượt này — danh sách gốc của xe sửa ở trang Xe.

import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { CatalogItem, HandoverAccessory, VehicleAccessoriesData, VehicleAccessoryView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { mergeAccessoryPlan } from '@shared/accessories';
import { fmtNumber, unaccent } from '@shared/text';
import { Button } from './ui/button';
import { Checkbox, Input } from './ui/form';
import { Spinner } from './ui/misc';

const key = (s: string) => unaccent(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Phụ kiện của xe đưa vào checklist giao/nhận (món tắt "kiểm khi giao nhận" thì bỏ). */
export function handoverItems(items: VehicleAccessoryView[]): HandoverAccessory[] {
  return items.filter((a) => a.checkOnHandover).map((a) => ({ id: a.id, name: a.name, quantity: a.quantity, value: a.effectiveValue, present: true, note: a.note }));
}

/**
 * Danh sách phụ kiện của lượt đang soạn. `edited` = null khi chưa đụng tới — gửi null để lượt
 * theo danh sách của xe (món thêm vào xe sau này tự có).
 */
export function useRentalAccessories(vehicleId: number | null, saved: HandoverAccessory[] | null | undefined, enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ['vehicle-accessories', vehicleId],
    queryFn: () => api.get<VehicleAccessoriesData>(`/api/vehicles/${vehicleId}/accessories`),
    enabled: enabled && !!vehicleId,
  });
  const [edited, setEdited] = useState<HandoverAccessory[] | null>(null);
  useEffect(() => setEdited(null), [vehicleId]);
  const items = useMemo(() => edited ?? mergeAccessoryPlan(saved, handoverItems(data?.items ?? [])), [edited, saved, data]);
  return { items, edited, setItems: setEdited, reset: () => setEdited(null), catalog: data?.catalog ?? [], loading: isLoading };
}

/** Ô thêm món: gợi ý theo danh mục, gõ tên mới cũng được. Món đã có mà đang bỏ tick thì tick lại. */
export function AccessoryAdder({ items, onChange, catalog }: { items: HandoverAccessory[]; onChange: (v: HandoverAccessory[]) => void; catalog: CatalogItem[] }) {
  const listId = useId();
  const [name, setName] = useState('');
  const add = () => {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) return;
    setName('');
    const k = key(clean);
    const i = items.findIndex((a) => key(a.name) === k);
    if (i >= 0) return onChange(items.map((a, j) => (j === i ? { ...a, present: true } : a)));
    const c = catalog.find((x) => key(x.name) === k || (x.aliases ?? '').split(',').some((al) => key(al) === k));
    onChange([...items, { id: null, name: c?.name ?? clean.charAt(0).toUpperCase() + clean.slice(1), quantity: 1, value: c?.defaultValue ?? 0, present: true, note: null }]);
  };
  return (
    <div className="flex gap-2">
      <Input
        list={listId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Thêm món: ghế trẻ em, áo mưa…"
      />
      <datalist id={listId}>
        {catalog
          .filter((c) => !items.some((a) => key(a.name) === key(c.name)))
          .map((c) => (
            <option key={c.id} value={c.name} />
          ))}
      </datalist>
      <Button variant="secondary" onClick={add} disabled={name.trim().length < 2}>
        <Plus /> Thêm
      </Button>
    </div>
  );
}

export function RentalAccessoriesEditor({ items, onChange, catalog, loading }: { items: HandoverAccessory[]; onChange: (v: HandoverAccessory[]) => void; catalog: CatalogItem[]; loading?: boolean }) {
  return (
    <div className="space-y-3">
      {loading ? (
        <Spinner />
      ) : items.length ? (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {items.map((a, i) => (
            <li key={`${a.id ?? 'x'}-${a.name}`} className="flex items-center gap-2 px-3 py-2.5">
              <Checkbox
                className="flex-1"
                checked={a.present}
                onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, present: v } : x)))}
                label={
                  <span className={cn(!a.present && 'text-muted line-through')}>
                    {a.name}
                    {a.quantity > 1 && <span className="text-muted"> × {a.quantity}</span>}
                  </span>
                }
                description={[a.id == null && 'Thêm riêng lượt này', !a.present && 'Không kèm lượt này', a.value ? `đền bù ${fmtNumber(a.value)}đ` : null].filter(Boolean).join(' · ') || undefined}
              />
              {a.id == null && (
                <Button variant="ghost" size="icon-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Bỏ ${a.name}`}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Xe chưa khai báo phụ kiện. Thêm ở trang Xe để các lượt sau tự có.</p>
      )}
      <AccessoryAdder items={items} onChange={onChange} catalog={catalog} />
    </div>
  );
}
