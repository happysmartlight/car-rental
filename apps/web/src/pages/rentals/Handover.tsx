// Giao xe / nhận xe trên điện thoại: ODO, xăng, ảnh theo khung, vết trầy, đồ kèm theo, chữ ký.

import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Check, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/layout/AppShell';
import { FuelGauge, SignaturePad } from '@/components/common';
import { Gallery, PhotoInput } from '@/components/images';
import { AccessoryAdder, handoverItems } from '@/components/RentalAccessories';
import { Button } from '@/components/ui/button';
import { Checkbox, DateTimeInput, Field, Input, MoneyInput, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, Notice, PageLoader } from '@/components/ui/misc';
import { api, uploadFile } from '@/lib/api';
import { useSettings } from '@/lib/hooks';
import type { HandoverAccessory, RentalDetail, VehicleAccessoriesData } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { mergeAccessoryPlan } from '@shared/accessories';
import { CHARGE_KINDS, CHARGE_KIND_LABEL, DAMAGE_ZONES, PHOTO_SLOTS, type ChargeKind } from '@shared/constants';
import { chargeDays, chargingCharge, rentalChargingPolicy, tripChargingText, type VehiclePricing } from '@shared/pricing';
import { fmtNumber, fmtVnd } from '@shared/text';
import { fmtDateTime, fmtDuration } from '@shared/time';
import { useQueryClient } from '@tanstack/react-query';

interface Damage {
  zone: string;
  note: string;
  fileId: string | null;
  isNew?: boolean;
}
interface ChargeRow {
  kind: ChargeKind;
  description: string;
  amount: number | null;
  /** Dòng tự sinh: phụ kiện thiếu ("acc:<tên>", tự gỡ khi tick lại) hoặc sạc pin ("charging"). */
  auto?: string;
}
interface Suggestion {
  kind: ChargeKind;
  description: string;
  amount: number;
}

function Step({ n, title, children, description }: { n: number; title: string; children: ReactNode; description?: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-fg">{n}</span>
            {title}
          </span>
        }
        description={description}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export default function Handover({ kind }: { kind: 'pickup' | 'return' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: d, isLoading } = useQuery({ queryKey: ['rental', id], queryFn: () => api.get<RentalDetail>(`/api/rentals/${id}`) });
  const isPickup = kind === 'pickup';

  const [at, setAt] = useState<number | null>(Date.now());
  const [odo, setOdo] = useState<number | null>(null);
  const [fuel, setFuel] = useState(100);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState<Blob | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [acc, setAcc] = useState<HandoverAccessory[]>([]);
  const [accReady, setAccReady] = useState(false);
  const [chargeSessions, setChargeSessions] = useState<number | null>(null);
  const [collect, setCollect] = useState<{ amount: number | null; method: 'cash' | 'transfer' }>({ amount: null, method: 'transfer' });
  const [collectDeposit, setCollectDeposit] = useState<{ amount: number | null; method: 'cash' | 'transfer' }>({ amount: null, method: 'transfer' });
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const pickupHo = d?.handovers.find((h) => h.kind === 'pickup');
  const { data: vehAcc } = useQuery({
    queryKey: ['vehicle-accessories', d?.vehicle.id],
    queryFn: () => api.get<VehicleAccessoriesData>(`/api/vehicles/${d!.vehicle.id}/accessories`),
    enabled: isPickup && !!d,
  });

  // Phụ kiện cần kiểm: lúc giao lấy theo danh sách thỏa thuận khi đặt xe (chưa chỉnh thì theo xe);
  // lúc nhận lấy đúng danh sách đã có lúc giao.
  useEffect(() => {
    if (accReady || !d) return;
    if (isPickup) {
      if (!vehAcc) return;
      setAcc(mergeAccessoryPlan(d.rental.accessories, handoverItems(vehAcc.items)));
    } else {
      setAcc((pickupHo?.accessories ?? []).filter((a) => a.present).map((a) => ({ ...a, present: true, note: null })));
    }
    setAccReady(true);
  }, [accReady, d, isPickup, vehAcc, pickupHo]);

  // Nhận xe thiếu phụ kiện → tự thêm khoản đền bù (bỏ tick lại thì tự gỡ).
  const missingKey = isPickup ? '' : acc.filter((a) => !a.present).map((a) => a.name).join('|');
  useEffect(() => {
    if (isPickup) return;
    const missing = acc.filter((a) => !a.present);
    setCharges((rows) => {
      const keep = rows.filter((r) => !r.auto?.startsWith('acc:') || missing.some((m) => `acc:${m.name}` === r.auto));
      const add = missing
        .filter((m) => !keep.some((r) => r.auto === `acc:${m.name}`))
        .map((m) => ({ kind: 'accessory' as ChargeKind, description: `Thiếu phụ kiện: ${m.name}${m.quantity > 1 ? ` (×${m.quantity})` : ''}`, amount: m.value ? m.value * m.quantity : null, auto: `acc:${m.name}` }));
      return [...keep, ...add];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, isPickup]);

  useEffect(() => {
    if (!d || !settings || initialized) return;
    setInitialized(true);
    if (isPickup) {
      setOdo(d.vehicle.odo);
      setChecklist(Object.fromEntries(settings.rules.checklist.map((c) => [c, true])));
      setCollect({ amount: Math.max(0, d.money.due) || null, method: 'transfer' });
      setCollectDeposit({ amount: Math.max(0, d.rental.depositRequired - d.money.depositHeld) || null, method: 'transfer' });
    } else {
      setFuel(pickupHo?.fuelLevel ?? 100);
      const atPickup = Object.keys(pickupHo?.checklist ?? {});
      setChecklist(
        atPickup.length ? Object.fromEntries(atPickup.map((c) => [c, !!pickupHo?.checklist[c]])) : Object.fromEntries(settings.rules.checklist.map((c) => [c, true])),
      );
      setDamages((pickupHo?.damages ?? []).map((x) => ({ ...x, fileId: x.fileId ?? null, isNew: false })));
    }
  }, [d, settings, initialized, isPickup, pickupHo]);

  // Gợi ý phụ phí khi nhận xe (trễ giờ, vượt km)
  const { data: preview } = useQuery({
    queryKey: ['return-preview', id, at, odo],
    queryFn: () => api.post<{ suggestions: Suggestion[]; kmDriven: number | null; kmLimit: number }>(`/api/rentals/${id}/return-preview`, { at, odo }),
    enabled: !isPickup && !!at && odo != null && !!pickupHo && odo >= pickupHo.odo,
  });
  const suggestionKey = preview?.suggestions.map((s) => `${s.kind}:${s.amount}`).join('|');
  useEffect(() => {
    if (!preview) return;
    setCharges((rows) => [...rows.filter((r) => r.kind !== 'over_time' && r.kind !== 'over_km'), ...preview.suggestions.map((s) => ({ ...s }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionKey]);

  // Xe điện: sạc quá số lần miễn phí → tự thêm khoản phí sạc theo số lượt nhân viên nhập.
  // Số lượt miễn phí theo số ngày thuê đã đặt (khớp hợp đồng).
  const charging = useMemo(() => {
    if (!d || isPickup || !settings) return null;
    const policy = rentalChargingPolicy(JSON.parse(d.rental.pricing) as VehiclePricing, d.vehicle);
    return policy && { policy, days: chargeDays(d.rental.scheduledStart, d.rental.scheduledEnd, settings.rules.graceMinutes) };
  }, [d, isPickup, settings]);
  useEffect(() => {
    if (!charging) return;
    const line = chargingCharge(chargeSessions ?? 0, charging.policy, charging.days);
    setCharges((rows) => [...rows.filter((r) => r.auto !== 'charging'), ...(line ? [{ ...line, auto: 'charging' }] : [])]);
  }, [chargeSessions, charging]);

  const stamp = useMemo(() => () => `${d?.vehicle.plate ?? ''} • ${fmtDateTime(Date.now())} • ${isPickup ? 'Giao xe' : 'Nhận xe'} ${d?.rental.code ?? ''}`, [d, isPickup]);

  if (isLoading || !d) return <PageLoader />;
  const r = d.rental;
  const wrongStatus = isPickup ? r.status !== 'booked' : r.status !== 'active';
  const missingPhotos = PHOTO_SLOTS.filter((s) => !photos[s.key]).length;
  const extraTotal = charges.reduce((s, c) => s + (c.amount ?? 0), 0);

  const submit = async () => {
    if (!at) return toast.error('Chọn thời điểm');
    if (odo == null) return toast.error('Nhập số ODO');
    setSaving(true);
    try {
      const signatureFileId = signature ? (await uploadFile(signature, 'signature', { name: 'signature.png' })).id : null;
      const body = {
        at,
        odo,
        fuelLevel: fuel,
        checklist,
        photos: [
          ...PHOTO_SLOTS.filter((s) => photos[s.key]).map((s) => ({ slot: s.key, fileId: photos[s.key]! })),
          ...extraPhotos.map((fileId, i) => ({ slot: `extra${i + 1}`, fileId })),
        ],
        damages: damages.filter((x) => x.zone && (x.note || x.fileId)),
        accessories: acc,
        notes: notes || null,
        signatureFileId,
      };
      if (isPickup) {
        await api.post(`/api/rentals/${id}/pickup`, {
          ...body,
          payments: [
            ...(collect.amount ? [{ purpose: 'rent', method: collect.method, amount: collect.amount }] : []),
            ...(collectDeposit.amount ? [{ purpose: 'deposit', method: collectDeposit.method, amount: collectDeposit.amount }] : []),
          ],
        });
        toast.success('Đã giao xe');
        navigate(`/rentals/${id}`, { replace: true });
      } else {
        await api.post(`/api/rentals/${id}/return`, { ...body, charges: charges.filter((c) => c.amount).map((c) => ({ kind: c.kind, description: c.description || CHARGE_KIND_LABEL[c.kind], amount: c.amount })) });
        toast.success('Đã nhận lại xe — tiếp theo: quyết toán');
        navigate(`/rentals/${id}?settle=1`, { replace: true });
      }
      void qc.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title={isPickup ? 'Giao xe' : 'Nhận lại xe'} subtitle={`${r.code} · ${d.vehicle.plate} · ${d.customer.fullName}`} back={`/rentals/${id}`} width="narrow">
      {wrongStatus ? (
        <Notice tone="amber">Lượt thuê này không ở trạng thái {isPickup ? 'chờ giao xe' : 'đang thuê'}.</Notice>
      ) : (
        <div className="space-y-4">
          {isPickup && at && Math.abs(at - r.scheduledStart) > 6 * 3600_000 && (
            <Notice tone="amber">
              Giao xe {at < r.scheduledStart ? 'sớm' : 'trễ'} {fmtDuration(Math.abs(at - r.scheduledStart))} so với lịch hẹn ({fmtDateTime(r.scheduledStart)}). Tiền thuê đang tính theo lịch hẹn — sửa lịch ở trang lượt thuê nếu khách đổi giờ.
            </Notice>
          )}
          {d.warnings.filter((w) => w.severity !== 'info').map((w) => (
            <Notice key={w.code + w.message} tone={w.severity === 'danger' ? 'red' : 'amber'}>
              {w.message}
            </Notice>
          ))}

          <Step n={1} title="Thời điểm & đồng hồ">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={isPickup ? 'Giờ giao xe' : 'Giờ nhận lại xe'} hint={!isPickup && at ? (at > r.scheduledEnd ? `Trễ ${fmtDuration(at - r.scheduledEnd)} so với hẹn` : 'Đúng hẹn') : `Hẹn ${fmtDateTime(isPickup ? r.scheduledStart : r.scheduledEnd)}`}>
                <DateTimeInput value={at} onChange={setAt} />
              </Field>
              <Field label="ODO (km)" hint={isPickup ? `Lần trước: ${fmtNumber(d.vehicle.odo)} km` : pickupHo ? `Lúc giao: ${fmtNumber(pickupHo.odo)} km${preview?.kmDriven != null ? ` · đã đi ${fmtNumber(preview.kmDriven)}/${r.kmLimit ? fmtNumber(r.kmLimit) : '∞'} km` : ''}` : undefined}>
                <NumberInput value={odo} onChange={setOdo} suffix="km" />
              </Field>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium">
                Mức xăng / pin {!isPickup && pickupHo && <span className="font-normal text-muted">(lúc giao {pickupHo.fuelLevel}%)</span>}
              </p>
              <FuelGauge value={fuel} onChange={setFuel} />
            </div>
          </Step>

          <Step n={2} title="Chụp ảnh xe" description={missingPhotos ? `Còn ${missingPhotos} khung chưa chụp — ảnh tự đóng dấu giờ và biển số` : 'Đủ ảnh theo khung'}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PHOTO_SLOTS.map((s) => (
                <PhotoInput key={s.key} kind="handover_photo" label={s.label} camera stamp={stamp} value={photos[s.key]} onChange={(v) => setPhotos({ ...photos, [s.key]: v })} />
              ))}
            </div>
            <p className="mt-4 mb-2 text-sm font-medium">Ảnh thêm</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {extraPhotos.map((fid, i) => (
                <PhotoInput key={fid} kind="handover_photo" label={`Thêm ${i + 1}`} value={fid} onChange={(v) => setExtraPhotos(v ? extraPhotos.map((x) => (x === fid ? v : x)) : extraPhotos.filter((x) => x !== fid))} />
              ))}
              <PhotoInput kind="handover_photo" label="Thêm ảnh" camera stamp={stamp} value={null} onChange={(v) => v && setExtraPhotos([...extraPhotos, v])} />
            </div>
            {!isPickup && pickupHo && pickupHo.photos.length > 0 && (
              <div className="mt-4 rounded-2xl bg-surface-2 p-3">
                <p className="mb-2 text-sm font-medium">Ảnh lúc giao xe (để so sánh)</p>
                <Gallery items={pickupHo.photos.map((p) => ({ fileId: p.fileId, label: PHOTO_SLOTS.find((s) => s.key === p.slot)?.label ?? p.slot }))} />
              </div>
            )}
          </Step>

          <Step n={3} title={isPickup ? 'Vết trầy / hư hỏng có sẵn' : 'Kiểm tra hư hỏng'} description={isPickup ? 'Ghi rõ để không tranh cãi khi nhận lại' : 'Dòng có sẵn từ lúc giao; thêm dòng nếu có hư hỏng mới'}>
            <div className="space-y-3">
              {damages.map((x, i) => (
                <div key={i} className={`grid gap-2 rounded-2xl border p-3 sm:grid-cols-[170px_1fr_110px_auto] ${x.isNew ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : 'border-border'}`}>
                  <Select value={x.zone} onChange={(e) => setDamages(damages.map((y, j) => (j === i ? { ...y, zone: e.target.value } : y)))}>
                    {DAMAGE_ZONES.map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </Select>
                  <Input value={x.note} placeholder="Mô tả: trầy 5cm, móp nhẹ…" onChange={(e) => setDamages(damages.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                  <PhotoInput kind="handover_photo" label="Ảnh" camera stamp={stamp} aspect="aspect-[4/3] sm:aspect-auto sm:h-11" value={x.fileId} onChange={(v) => setDamages(damages.map((y, j) => (j === i ? { ...y, fileId: v } : y)))} />
                  <Button variant="ghost" size="icon" onClick={() => setDamages(damages.filter((_, j) => j !== i))} aria-label="Xóa">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setDamages([...damages, { zone: DAMAGE_ZONES[0], note: '', fileId: null, isNew: !isPickup }])}>
                <Plus /> {isPickup ? 'Ghi vết có sẵn' : 'Thêm hư hỏng mới'}
              </Button>
            </div>
          </Step>

          <Step n={4} title="Giấy tờ & phụ kiện" description={isPickup ? 'Bỏ tick món không có trên xe lúc giao, thêm món giao kèm' : 'Bỏ tick món khách trả thiếu — app tự thêm khoản đền bù'}>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Giấy tờ</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {Object.keys(checklist).map((item) => (
                <Checkbox key={item} checked={checklist[item]} onChange={(v) => setChecklist({ ...checklist, [item]: v })} label={item} />
              ))}
            </div>
            {!Object.keys(checklist).length && <p className="text-sm text-muted">Danh sách giấy tờ cấu hình ở Cài đặt → Giá & quy định.</p>}

            <p className="mt-5 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Phụ kiện trên xe</p>
            {acc.length ? (
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {acc.map((a, i) => {
                  const missing = !isPickup && !a.present;
                  return (
                    <li key={`${a.id}-${a.name}`} className={cn('px-3 py-2.5', missing && 'bg-red-50/70 dark:bg-red-950/20')}>
                      <Checkbox
                        checked={a.present}
                        onChange={(v) => setAcc(acc.map((x, j) => (j === i ? { ...x, present: v } : x)))}
                        label={
                          <span className={cn(missing && 'font-medium text-red-700 dark:text-red-300')}>
                            {a.name}
                            {a.quantity > 1 && <span className="text-muted"> × {a.quantity}</span>}
                          </span>
                        }
                        description={[a.note, a.value ? `đền bù ${fmtNumber(a.value)}đ` : null, missing && 'THIẾU khi nhận xe'].filter(Boolean).join(' · ') || undefined}
                      />
                      {missing && (
                        <Input
                          className="mt-2"
                          value={a.note ?? ''}
                          placeholder="Ghi chú: mất, hỏng, khách hẹn trả sau…"
                          onChange={(e) => setAcc(acc.map((x, j) => (j === i ? { ...x, note: e.target.value || null } : x)))}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {isPickup ? (
                  <>
                    Xe chưa khai báo phụ kiện.{' '}
                    <Link to={`/vehicles/${d.vehicle.id}`} className="text-brand underline">
                      Thêm ở trang xe
                    </Link>{' '}
                    (sạc, camera, lốp dự phòng…) để lần sau tự vào checklist.
                  </>
                ) : (
                  'Lúc giao xe không ghi phụ kiện nào.'
                )}
              </p>
            )}
            {isPickup && accReady && (
              <div className="mt-3">
                <AccessoryAdder items={acc} onChange={setAcc} catalog={vehAcc?.catalog ?? []} />
              </div>
            )}
          </Step>

          {isPickup ? (
            <Step n={5} title="Thu tiền khi giao xe" description={`Còn phải trả ${fmtVnd(Math.max(0, d.money.due))} · cọc đã nhận ${fmtVnd(d.money.depositHeld)}/${fmtVnd(r.depositRequired)}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Thu tiền thuê">
                  <MoneyInput value={collect.amount} onChange={(v) => setCollect({ ...collect, amount: v })} />
                  <Select className="mt-2" value={collect.method} onChange={(e) => setCollect({ ...collect, method: e.target.value as 'cash' | 'transfer' })}>
                    <option value="transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                  </Select>
                </Field>
                <Field label="Thu tiền cọc">
                  <MoneyInput value={collectDeposit.amount} onChange={(v) => setCollectDeposit({ ...collectDeposit, amount: v })} />
                  <Select className="mt-2" value={collectDeposit.method} onChange={(e) => setCollectDeposit({ ...collectDeposit, method: e.target.value as 'cash' | 'transfer' })}>
                    <option value="transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                  </Select>
                </Field>
              </div>
              <p className="mt-2 text-xs text-muted">Để trống nếu chưa thu. Có thể ghi nhận sau ở trang lượt thuê. Tài sản thế chấp thêm ở trang lượt thuê.</p>
            </Step>
          ) : (
            <Step n={5} title="Phụ phí" description={`Tự gợi ý trễ giờ, vượt km${charging ? ', sạc pin' : ''} — sửa được. Thêm xăng, vệ sinh, hư hỏng nếu có.`}>
              {charging && (
                <div className="mb-4 sm:max-w-sm">
                  <Field label="Số lượt sạc pin trong chuyến" hint={`${tripChargingText(charging.policy, charging.days).replace(/^./, (c) => c.toUpperCase())} (xem lịch sử sạc trên app của xe)`}>
                    <NumberInput value={chargeSessions} onChange={setChargeSessions} suffix="lượt" />
                  </Field>
                </div>
              )}
              <div className="space-y-2">
                {charges.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[160px_1fr_140px_auto]">
                    <Select className="col-span-2 sm:col-span-1" value={c.kind} onChange={(e) => setCharges(charges.map((y, j) => (j === i ? { ...y, kind: e.target.value as ChargeKind } : y)))}>
                      {CHARGE_KINDS.filter((k) => k !== 'rental' && k !== 'discount' && k !== 'cancel_fee').map((k) => (
                        <option key={k} value={k}>
                          {CHARGE_KIND_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <Input className="col-span-2 sm:col-span-1" value={c.description} placeholder="Diễn giải" onChange={(e) => setCharges(charges.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                    <MoneyInput value={c.amount} onChange={(v) => setCharges(charges.map((y, j) => (j === i ? { ...y, amount: v } : y)))} />
                    <Button variant="ghost" size="icon" onClick={() => setCharges(charges.filter((_, j) => j !== i))} aria-label="Xóa">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {(['fuel', 'cleaning', 'damage', 'toll'] as ChargeKind[]).map((k) => (
                    <Button key={k} variant="secondary" size="sm" onClick={() => setCharges([...charges, { kind: k, description: CHARGE_KIND_LABEL[k], amount: null }])}>
                      <Plus /> {CHARGE_KIND_LABEL[k]}
                    </Button>
                  ))}
                </div>
                {extraTotal > 0 && <p className="text-right text-sm">Tổng phụ phí: <b className="tabular">{fmtVnd(extraTotal)}</b></p>}
              </div>
            </Step>
          )}

          <Step n={6} title="Ghi chú & chữ ký">
            <Field label="Ghi chú">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isPickup ? 'Khách đi Vũng Tàu, hẹn trả tại nhà…' : 'Xe bẩn, mùi thuốc lá…'} />
            </Field>
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium">Khách ký xác nhận</p>
              <SignaturePad onChange={setSignature} />
            </div>
          </Step>

          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 lg:bottom-4">
            <Button size="lg" className="w-full shadow-pop" onClick={submit} loading={saving}>
              {isPickup ? <ArrowUpFromLine /> : <ArrowDownToLine />} {isPickup ? 'Xác nhận giao xe' : 'Xác nhận nhận xe'}
              {missingPhotos > 0 && <span className="text-xs opacity-80">(thiếu {missingPhotos} ảnh)</span>}
              {missingPhotos === 0 && <Check />}
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}
