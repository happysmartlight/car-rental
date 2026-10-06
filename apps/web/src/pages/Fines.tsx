import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Car, ChevronDown, Clock, ExternalLink, MessageCircle, Phone, Plus, Search, ShieldAlert, UserRound, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { FineStatusBadge, Money } from '@/components/common';
import { PhotoInput } from '@/components/images';
import { OFFICIAL_LOOKUP_URL, ViolationCheck } from '@/components/ViolationCheck';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DateTimeInput, Field, Input, MoneyInput, Segmented, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, Empty, InfoRow, Notice, Spinner } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { FineListItem, FineLookup, TrafficFine, VehicleWithStatus } from '@/lib/types';
import { cn, errorMessage, telLink, zaloLink } from '@/lib/utils';
import { BLOCK_KIND_LABEL, FINE_SOURCES, FINE_SOURCE_LABEL, FINE_STATUS, FINE_STATUSES, type FineSource, type FineStatus } from '@shared/constants';
import { fmtDateTime } from '@shared/time';

interface FineForm {
  id?: number;
  plate: string;
  violatedAt: number | null;
  location: string;
  violation: string;
  amount: number | null;
  source: FineSource;
  noticeFileId: string | null;
  rentalId: number | null;
  status: FineStatus;
  notes: string;
}

const emptyForm = (plate = '', at: number | null = null, rentalId: number | null = null): FineForm => ({ plate, violatedAt: at, location: '', violation: '', amount: null, source: 'csgt', noticeFileId: null, rentalId, status: 'new', notes: '' });

function LookupResult({ r, onRecord }: { r: FineLookup; onRecord: (rentalId: number | null) => void }) {
  if (r.verdict === 'unknown_vehicle') {
    return <Notice tone="amber" icon={AlertTriangle}>Biển số {r.plateKey} không có trong danh sách xe.</Notice>;
  }
  return (
    <div className="space-y-3">
      {r.verdict === 'rented' &&
        r.matches.map((m) => (
          <div key={m.segment.id} className="rounded-2xl border-2 border-brand/40 bg-brand-soft/50 p-4">
            <p className="text-sm text-muted">Người đang giữ xe {r.vehicle?.plate} lúc {fmtDateTime(r.at)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <UserRound className="size-6 text-brand" />
              <Link to={`/customers/${m.customer.id}`} className="text-xl font-semibold hover:underline">
                {m.customer.fullName}
              </Link>
              {m.customer.blacklisted && <Badge tone="red">Danh sách đen</Badge>}
            </div>
            {m.nearBoundary && (
              <Notice tone="amber" icon={AlertTriangle} className="mt-3">
                Vi phạm sát giờ giao/nhận xe (dưới 2 giờ) — đối chiếu kỹ ảnh và giờ trên biên bản.
              </Notice>
            )}
            <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
              <div className="divide-y divide-border">
                <InfoRow label="CCCD">{m.customer.idNumber}</InfoRow>
                <InfoRow label="GPLX">{m.customer.licenseNumber}</InfoRow>
                <InfoRow label="Điện thoại">{m.customer.phone}</InfoRow>
              </div>
              <div className="divide-y divide-border">
                <InfoRow label="Lượt thuê">
                  <Link to={`/rentals/${m.rental.id}`} className="text-brand hover:underline">
                    {m.rental.code}
                  </Link>
                </InfoRow>
                <InfoRow label="Giao xe">{fmtDateTime(m.segment.startAt)}</InfoRow>
                <InfoRow label="Nhận lại">{m.segment.endAt ? fmtDateTime(m.segment.endAt) : 'Đang thuê'}</InfoRow>
              </div>
            </div>
            {m.drivers.length > 0 && (
              <p className="mt-2 text-sm">
                Lái phụ:{' '}
                {m.drivers.map((x, i) => (
                  <span key={x.id}>
                    {i > 0 && ', '}
                    <Link to={`/customers/${x.id}`} className="font-medium hover:underline">
                      {x.fullName}
                    </Link>{' '}
                    ({x.phone})
                  </span>
                ))}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={telLink(m.customer.phone)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-sm font-medium shadow-card">
                <Phone className="size-4" /> Gọi
              </a>
              <a href={zaloLink(m.customer.zalo || m.customer.phone)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-sm font-medium shadow-card">
                <MessageCircle className="size-4" /> Zalo
              </a>
              <Link to={`/rentals/${m.rental.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-sm font-medium shadow-card">
                Hợp đồng & ảnh giao xe
              </Link>
              <Button size="sm" className="h-9" onClick={() => onRecord(m.rental.id)}>
                <Plus /> Ghi phạt nguội cho khách này
              </Button>
            </div>
          </div>
        ))}
      {r.verdict === 'blocked' &&
        r.blocks.map((b) => (
          <Notice key={b.id} tone="amber" icon={Wrench}>
            Lúc đó xe đang <b>{BLOCK_KIND_LABEL[b.kind].toLowerCase()}</b>
            {b.location && ` tại ${b.location}`} ({fmtDateTime(b.startAt)} → {b.endAt ? fmtDateTime(b.endAt) : 'chưa kết thúc'}). {b.notes}
          </Notice>
        ))}
      {r.verdict === 'idle' && (
        <Notice tone="blue" icon={Car}>
          Không có lượt thuê nào đang giữ xe {r.vehicle?.plate} lúc {fmtDateTime(r.at)} — xe ở bãi theo dữ liệu đã ghi.
        </Notice>
      )}
      {r.scheduledOnly.map((s) => (
        <Notice key={s.rental.id} tone="red" icon={AlertTriangle}>
          Lượt <Link to={`/rentals/${s.rental.id}`} className="font-semibold underline">{s.rental.code}</Link> ({s.customer.fullName}) theo lịch trùng thời điểm này nhưng <b>chưa ghi nhận giao xe</b>. Kiểm tra lại.
        </Notice>
      ))}
      {r.nearby.length > 0 && (
        <div className="rounded-2xl border border-border p-3">
          <p className="mb-1 text-sm font-medium">Lượt thuê kề trước/sau (trong 6 giờ)</p>
          <ul className="space-y-1 text-sm">
            {r.nearby.map((n) => (
              <li key={n.segment.id}>
                <Link to={`/rentals/${n.rental.id}`} className="hover:underline">
                  {n.rental.code} · {n.customer.fullName}: {fmtDateTime(n.segment.startAt)} → {n.segment.endAt ? fmtDateTime(n.segment.endAt) : 'đang thuê'}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.verdict !== 'rented' && (
        <Button variant="outline" size="sm" onClick={() => onRecord(null)}>
          <Plus /> Vẫn ghi nhận vi phạm
        </Button>
      )}
    </div>
  );
}

export default function Fines() {
  const [plate, setPlate] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [result, setResult] = useState<FineLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [form, setForm] = useState<FineForm | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);

  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<VehicleWithStatus[]>('/api/vehicles') });
  const { data: list, isLoading } = useQuery({ queryKey: ['fines', filter], queryFn: () => api.get<{ items: FineListItem[] }>(`/api/fines${qs({ status: filter })}`) });

  const lookup = async () => {
    if (!plate.trim() || !at) return setError('Nhập biển số và thời điểm vi phạm');
    setLooking(true);
    setError(null);
    try {
      setResult(await api.get<FineLookup>(`/api/fines/lookup${qs({ plate, at })}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLooking(false);
    }
  };

  const activeVehicles = (vehicles ?? []).filter((v) => v.active);

  return (
    <Page
      title="Phạt nguội"
      subtitle="Kiểm tra theo biển số — app tự cho biết ai giữ xe lúc vi phạm"
      actions={
        <Button variant="outline" onClick={() => setForm(emptyForm())}>
          <Plus /> <span className="hidden sm:inline">Ghi thủ công</span>
        </Button>
      }
    >
      <div className="space-y-4">
        {vehicles && <ViolationCheck vehicles={activeVehicles} />}

        <Card>
          <button onClick={() => setTimeOpen(!timeOpen)} className="flex w-full items-center gap-3 px-4 py-4 text-left md:px-5">
            <Clock className="size-5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Có thông báo phạt giấy? Tra theo giờ vi phạm</span>
              <span className="block text-sm text-muted">Đã biết giờ vi phạm → xem ai đang giữ xe, hợp đồng, ảnh giao xe</span>
            </span>
            <ChevronDown className={cn('size-5 text-muted transition-transform', timeOpen && 'rotate-180')} />
          </button>
          {timeOpen && (
          <CardBody className="space-y-4 border-t border-border pt-4">
            {!!vehicles?.length && (
              <div className="flex flex-wrap gap-1.5">
                {vehicles.map((v) => (
                  <button key={v.id} onClick={() => setPlate(v.plate)} className={cn('rounded-full border px-3 py-1 text-sm font-medium', plate === v.plate ? 'border-brand bg-brand-soft text-brand' : 'border-border hover:bg-surface-2')}>
                    {v.plate}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Biển số, vd 51K-123.45" autoCapitalize="characters" />
              <DateTimeInput value={at} onChange={setAt} />
              <Button onClick={lookup} loading={looking}>
                <Search /> Tra cứu
              </Button>
            </div>
            {error && <Notice tone="red">{error}</Notice>}
            {looking && <Spinner />}
            {result && !looking && <LookupResult r={result} onRecord={(rentalId) => setForm(emptyForm(result.vehicle?.plate ?? plate, result.at, rentalId))} />}
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Nguồn tra cứu chính thức:</span>
              <a href={OFFICIAL_LOOKUP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand">
                csgt.bocongan.gov.vn <ExternalLink className="size-3" />
              </a>
              <span>Ứng dụng VNeTraffic (Bộ Công an)</span>
            </p>
          </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={ShieldAlert}
            title="Vi phạm đã ghi"
            action={
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'open', label: 'Chưa xong' },
                  { value: 'all', label: 'Tất cả' },
                ]}
              />
            }
          />
          {isLoading ? (
            <CardBody>
              <Spinner />
            </CardBody>
          ) : !list?.items.length ? (
            <Empty title={filter === 'open' ? 'Không có vi phạm chưa xử lý' : 'Chưa ghi vi phạm nào'} />
          ) : (
            <ul className="divide-y divide-border">
              {list.items.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() =>
                      setForm({
                        id: f.id,
                        plate: f.plate,
                        violatedAt: f.violatedAt,
                        location: f.location ?? '',
                        violation: f.violation ?? '',
                        amount: f.amount,
                        source: f.source,
                        noticeFileId: f.noticeFileId,
                        rentalId: f.rentalId,
                        status: f.status,
                        notes: f.notes ?? '',
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 md:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {f.plate} · {f.violation || 'Vi phạm'}
                      </p>
                      <p className="text-sm text-muted">
                        {fmtDateTime(f.violatedAt)}
                        {f.amount ? <> · <Money value={f.amount} /></> : null}
                        {f.customer ? ` · ${f.customer.fullName}` : ' · chưa rõ người giữ xe'}
                        {f.rental && ` · ${f.rental.code}`}
                      </p>
                    </div>
                    <FineStatusBadge status={f.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <FineDialog form={form} onClose={() => setForm(null)} />
    </Page>
  );
}

function FineDialog({ form, onClose }: { form: FineForm | null; onClose: () => void }) {
  const [f, setF] = useState<FineForm | null>(form);
  useEffect(() => setF(form), [form]);
  const save = useAction(
    () => {
      const body = { ...f!, location: f!.location || null, violation: f!.violation || null, notes: f!.notes || null };
      return f!.id ? api.patch<TrafficFine>(`/api/fines/${f!.id}`, body) : api.post<TrafficFine>('/api/fines', body);
    },
    {
      invalidate: [['fines'], ['dashboard']],
      success: (r: TrafficFine) => (form?.id ? 'Đã cập nhật' : r.customerId ? 'Đã ghi và gắn với khách thuê' : 'Đã ghi vi phạm (chưa xác định người giữ xe)'),
      onSuccess: onClose,
    },
  );
  if (!f) return null;
  const set = <K extends keyof FineForm>(k: K, v: FineForm[K]) => setF({ ...f, [k]: v });
  return (
    <Dialog
      open={!!form}
      onOpenChange={(o) => !o && onClose()}
      title={f.id ? 'Vi phạm' : 'Ghi phạt nguội'}
      description={!f.id ? 'App tự gắn với lượt thuê đang giữ xe lúc vi phạm' : undefined}
      footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.plate || !f.violatedAt}>Lưu</Button>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Biển số" required>
          <Input value={f.plate} onChange={(e) => set('plate', e.target.value)} />
        </Field>
        <Field label="Thời điểm vi phạm" required>
          <DateTimeInput value={f.violatedAt} onChange={(v) => set('violatedAt', v)} />
        </Field>
        <Field label="Lỗi vi phạm" className="sm:col-span-2">
          <Input value={f.violation} onChange={(e) => set('violation', e.target.value)} placeholder="Chạy quá tốc độ, vượt đèn đỏ…" />
        </Field>
        <Field label="Địa điểm" className="sm:col-span-2">
          <Input value={f.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Mức phạt">
          <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} />
        </Field>
        <Field label="Nguồn">
          <Select value={f.source} onChange={(e) => set('source', e.target.value as FineSource)}>
            {FINE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {FINE_SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trạng thái" className="sm:col-span-2">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as FineStatus)}>
            {FINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FINE_STATUS[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <PhotoInput kind="fine_notice" label="Ảnh thông báo vi phạm" value={f.noticeFileId} onChange={(v) => set('noticeFileId', v)} className="sm:col-span-2 sm:max-w-56" />
      </div>
    </Dialog>
  );
}
