import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Switch } from '@/components/ui/form';
import { Badge, Card, Notice, PageLoader } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { CatalogItem } from '@/lib/types';
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABEL, type AccessoryCategory } from '@shared/constants';
import { fmtNumber, unaccent } from '@shared/text';

interface Form {
  id?: number;
  name: string;
  aliases: string;
  category: AccessoryCategory;
  defaultValue: number | null;
  highlight: boolean;
  essential: boolean;
  evOnly: boolean;
  archivedAt?: number | null;
  usage?: number;
}

const EMPTY: Form = { name: '', aliases: '', category: 'other', defaultValue: 0, highlight: false, essential: false, evOnly: false };

export function SettingsAccessories() {
  const confirm = useConfirm();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [f, setF] = useState<Form | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['accessory-catalog', archived], queryFn: () => api.get<CatalogItem[]>(`/api/accessories/catalog${qs({ archived: archived ? 1 : 0 })}`) });
  const inv = { invalidate: [['accessory-catalog'], ['vehicle-accessories'], ['vehicles']] };
  const save = useAction(
    () => {
      const body = { name: f!.name, aliases: f!.aliases || null, category: f!.category, defaultValue: f!.defaultValue ?? 0, highlight: f!.highlight, essential: f!.essential, evOnly: f!.evOnly };
      return f!.id ? api.patch(`/api/accessories/catalog/${f!.id}`, body) : api.post('/api/accessories/catalog', body);
    },
    { ...inv, success: 'Đã lưu', onSuccess: () => setF(null) },
  );
  const archive = useAction((on: boolean) => api.patch(`/api/accessories/catalog/${f!.id}`, { archived: on }), { ...inv, success: 'Đã cập nhật', onSuccess: () => setF(null) });
  const applyAll = useAction(() => api.post<{ added: number }>(`/api/accessories/catalog/${f!.id}/apply-all`), {
    ...inv,
    success: (r) => (r.added ? `Đã thêm cho ${r.added} xe` : 'Xe nào cũng đã có'),
  });

  if (isLoading || !data) return <PageLoader />;
  const key = unaccent(q.trim());
  const shown = key ? data.filter((c) => unaccent(`${c.name} ${c.aliases ?? ''}`).includes(key)) : data;
  const all = archived ? shown.filter((c) => c.archivedAt) : shown;

  return (
    <div className="space-y-4">
      <Notice tone="blue" icon={Sparkles}>
        Danh mục dùng chung cho cả đội xe. Nhân viên gõ tên mới khi thêm phụ kiện cho xe thì món đó tự vào đây. <b>Giá trị</b> là mức đền bù gợi ý khi khách làm mất; <b>Nổi bật</b> = hiện trong ảnh chia sẻ bảng giá.
      </Notice>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm phụ kiện…" className="pl-9" />
        </div>
        <Button variant="ghost" onClick={() => setArchived(!archived)}>
          {archived ? 'Đang xem mục đã ẩn' : 'Xem mục đã ẩn'}
        </Button>
        <Button onClick={() => setF(EMPTY)}>
          <Plus /> Thêm
        </Button>
      </div>
      {ACCESSORY_CATEGORIES.map((cat) => {
        const items = all.filter((c) => c.category === cat);
        if (!items.length) return null;
        return (
          <Card key={cat}>
            <p className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase md:px-5">{ACCESSORY_CATEGORY_LABEL[cat]}</p>
            <ul className="divide-y divide-border">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setF({ ...c, aliases: c.aliases ?? '', defaultValue: c.defaultValue })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60 md:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {c.name}
                        {c.highlight && <Badge tone="amber">Nổi bật</Badge>}
                        {c.essential && <Badge tone="blue">Thiết yếu</Badge>}
                        {c.evOnly && <Badge tone="green">Xe điện</Badge>}
                      </span>
                      {c.aliases && <span className="block truncate text-xs text-subtle">Còn gọi: {c.aliases}</span>}
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <span className="tabular block">{c.defaultValue ? `${fmtNumber(c.defaultValue)}đ` : '—'}</span>
                      <span className="block text-xs text-muted">{c.usage ? `${c.usage} xe` : 'chưa xe nào'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Dialog
        open={!!f}
        onOpenChange={(o) => !o && setF(null)}
        title={f?.id ? f.name : 'Thêm vào danh mục'}
        description={f?.id ? `Đang có trên ${f.usage ?? 0} xe` : undefined}
        footer={
          <>
            {f?.id && (
              <Button
                variant="ghost"
                className="mr-auto"
                onClick={async () => {
                  if (f.archivedAt) return archive.mutate(false);
                  if (await confirm({ title: `Ẩn "${f.name}" khỏi danh mục?`, description: 'Không gợi ý cho xe mới nữa. Xe đang có món này giữ nguyên.' })) archive.mutate(true);
                }}
              >
                {f.archivedAt ? 'Hiện lại' : 'Ẩn khỏi danh mục'}
              </Button>
            )}
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f || f.name.trim().length < 2}>
              Lưu
            </Button>
          </>
        }
      >
        {f && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên" required>
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Cảm biến áp suất lốp" />
              </Field>
              <Field label="Nhóm">
                <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as AccessoryCategory })}>
                  {ACCESSORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {ACCESSORY_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tên gọi khác" hint="Để tìm cho nhanh, cách nhau dấu phẩy" className="sm:col-span-2">
                <Input value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} placeholder="tpms, cảm biến lốp" />
              </Field>
              <Field label="Giá trị đền bù mặc định">
                <MoneyInput value={f.defaultValue} onChange={(v) => setF({ ...f, defaultValue: v })} />
              </Field>
            </div>
            <Switch checked={f.highlight} onChange={(v) => setF({ ...f, highlight: v })} label="Nổi bật khi chia sẻ" description="Xe mới thêm món này sẽ tự hiện nó trong mục Tiện nghi của ảnh bảng giá" />
            <Switch checked={f.essential} onChange={(v) => setF({ ...f, essential: v })} label="Thiết yếu" description="Luôn được gợi ý cho xe chưa có" />
            <Switch checked={f.evOnly} onChange={(v) => setF({ ...f, evOnly: v })} label="Chỉ dành cho xe điện" />
            {f.id && !f.archivedAt && (
              <div className="rounded-2xl border border-border p-3">
                <p className="text-sm">Thêm món này cho mọi xe đang hoạt động còn thiếu{f.evOnly ? ' (chỉ xe điện)' : ''}.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => applyAll.mutate()} loading={applyAll.isPending}>
                  Thêm cho tất cả xe
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
