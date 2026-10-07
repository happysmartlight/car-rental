import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Camera,
  CheckCircle2,
  Download,
  FileSignature,
  FileText,
  HandCoins,
  History,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  QrCode,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/layout/AppShell';
import { FineStatusBadge, FuelGauge, Money, RentalStatusBadge, VietQr } from '@/components/common';
import { Gallery } from '@/components/images';
import { Button, ButtonLink } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Badge, Card, CardBody, CardHeader, InfoRow, Menu, MenuItem, MenuSeparator, Notice, PageLoader } from '@/components/ui/misc';
import { api, fileUrl, qs } from '@/lib/api';
import { useAction, useAuth, useNow } from '@/lib/hooks';
import type { Handover, RentalDetail as Detail } from '@/lib/types';
import { cn, errorMessage, telLink, zaloLink } from '@/lib/utils';
import { CHARGE_KIND_LABEL, COLLATERAL_KIND_LABEL, PAYMENT_METHOD_LABEL, PHOTO_SLOTS, TEMPLATE_KIND_LABEL, type TemplateKind } from '@shared/constants';
import { fmtNumber, fmtVnd } from '@shared/text';
import { fmtDate, fmtDateTime, fmtDuration } from '@shared/time';
import { CancelDialog, ChargeDialog, CollateralDialog, DriverDialog, EditRentalDialog, PaymentDialog, ReleaseHoldDialog, ScanDialog, SettleDialog } from './RentalDialogs';

type DialogName = 'pay' | 'charge' | 'settle' | 'hold' | 'edit' | 'cancel' | 'collateral' | 'driver' | 'scan' | 'qr' | 'audit' | null;

function HandoverCard({ h, title, prev }: { h: Handover; title: string; prev?: Handover }) {
  const photos = h.photos.map((p) => ({ fileId: p.fileId, label: PHOTO_SLOTS.find((s) => s.key === p.slot)?.label ?? p.slot }));
  const damagePhotos = h.damages.filter((x) => x.fileId).map((x) => ({ fileId: x.fileId!, label: x.zone }));
  return (
    <Card>
      <CardHeader icon={h.kind === 'pickup' ? ArrowUpFromLine : ArrowDownToLine} title={title} description={fmtDateTime(h.at)} />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted">ODO</p>
            <p className="tabular text-lg font-semibold">
              {fmtNumber(h.odo)} km {prev && <span className="text-sm font-normal text-muted">(đi {fmtNumber(h.odo - prev.odo)} km)</span>}
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm text-muted">Xăng / pin</p>
            <FuelGauge value={h.fuelLevel} readOnly />
          </div>
        </div>
        {photos.length > 0 && <Gallery items={photos} />}
        {h.damages.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">{h.kind === 'pickup' ? 'Hiện trạng có sẵn' : 'Hư hỏng ghi nhận'}</p>
            <ul className="space-y-1 text-sm">
              {h.damages.map((x, i) => (
                <li key={i} className="flex gap-2">
                  {x.isNew ? <Badge tone="red">Mới</Badge> : <Badge>Có sẵn</Badge>}
                  <span>
                    <b>{x.zone}</b>: {x.note}
                  </span>
                </li>
              ))}
            </ul>
            {damagePhotos.length > 0 && <Gallery items={damagePhotos} className="mt-2" />}
          </div>
        )}
        {h.accessories?.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Phụ kiện</p>
            <div className="flex flex-wrap gap-1.5">
              {h.accessories.map((a, i) => (
                <Badge key={i} tone={a.present ? 'green' : 'red'}>
                  {a.present ? '✓' : '✗'} {a.name}
                  {a.quantity > 1 && ` ×${a.quantity}`}
                  {!a.present && a.note && ` — ${a.note}`}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {Object.keys(h.checklist).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(h.checklist).map(([k, v]) => (
              <Badge key={k} tone={v ? 'green' : 'gray'}>
                {v ? '✓' : '✗'} {k}
              </Badge>
            ))}
          </div>
        )}
        {h.notes && <p className="text-sm">{h.notes}</p>}
        {h.signatureFileId && (
          <div>
            <p className="mb-1 text-sm text-muted">Chữ ký khách</p>
            <img src={fileUrl(h.signatureFileId)} alt="Chữ ký" className="h-20 rounded-lg border border-border bg-white" />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function RentalDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const now = useNow();
  const [dialog, setDialog] = useState<DialogName>(params.get('settle') === '1' ? 'settle' : null);
  const [payPreset, setPayPreset] = useState<'rent_in' | 'deposit_in' | 'deposit_out' | 'rent_out'>('rent_in');
  const [scanDoc, setScanDoc] = useState<number | null>(null);
  const [generating, setGenerating] = useState<TemplateKind | null>(null);
  const { data: d, isLoading } = useQuery({ queryKey: ['rental', id], queryFn: () => api.get<Detail>(`/api/rentals/${id}`) });
  const { data: audit } = useQuery({
    queryKey: ['audit', 'rental', id],
    queryFn: () => api.get<{ items: { id: number; at: number; action: string; userId: number | null; detail: string | null }[]; users: { id: number; displayName: string }[] }>(`/api/system/audit${qs({ entity: 'rental', entityId: id })}`),
    enabled: isAdmin && dialog === 'audit',
  });
  const inv = { invalidate: [['rental', id], ['rentals'], ['dashboard']] };
  const voidPayment = useAction((pid: number) => api.post(`/api/payments/${pid}/void`, { reason: 'Nhập nhầm' }), { ...inv, success: 'Đã hủy phiếu' });
  const delCharge = useAction((cid: number) => api.del(`/api/charges/${cid}`), { ...inv, success: 'Đã xóa khoản' });
  const delDriver = useAction((cid: number) => api.del(`/api/rentals/${id}/drivers/${cid}`), { ...inv });
  const toggleCollateral = useAction(({ cid, returned }: { cid: number; returned: boolean }) => api.patch(`/api/collaterals/${cid}`, { returned }), inv);
  const retryPdf = useAction((docId: number) => api.post(`/api/documents/${docId}/pdf`), { ...inv, success: 'Đã tạo PDF' });

  if (isLoading || !d) return <PageLoader />;
  const r = d.rental;
  const m = d.money;
  const cancelFee = d.charges.filter((c) => c.kind === 'cancel_fee').reduce((s, c) => s + c.amount, 0);
  const overdue = r.status === 'active' && r.scheduledEnd < now;
  const pickupHo = d.handovers.find((h) => h.kind === 'pickup');
  const returnHo = [...d.handovers].reverse().find((h) => h.kind === 'return');
  const userName = (uid: number | null) => d.users.find((u) => u.id === uid)?.displayName ?? '—';

  const generate = async (kind: TemplateKind) => {
    setGenerating(kind);
    try {
      const res = await api.post<{ document: { pdfFileId: string | null; docxFileId: string }; pdfError: string | null }>(`/api/rentals/${r.id}/documents`, { kind });
      void qc.invalidateQueries({ queryKey: ['rental', id] });
      // Mở file qua nút trong toast (một cú chạm thật) — trình duyệt chặn window.open sau await.
      const url = fileUrl(res.document.pdfFileId ?? res.document.docxFileId, { download: !res.document.pdfFileId });
      const action = { label: res.document.pdfFileId ? 'Mở PDF' : 'Tải Word', onClick: () => window.open(url, '_blank') };
      if (res.pdfError) toast.warning(`Đã tạo file Word. Chưa tạo được PDF: ${res.pdfError}`, { action, duration: 10_000 });
      else toast.success('Đã tạo văn bản', { action, duration: 10_000 });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGenerating(null);
    }
  };

  const openPay = (preset: typeof payPreset) => {
    setPayPreset(preset);
    setDialog('pay');
  };

  const primary =
    r.status === 'booked' ? (
      <ButtonLink to={`/rentals/${r.id}/pickup`} size="lg">
        <ArrowUpFromLine /> Giao xe
      </ButtonLink>
    ) : r.status === 'active' ? (
      <ButtonLink to={`/rentals/${r.id}/return`} size="lg" variant={overdue ? 'danger' : 'primary'}>
        <ArrowDownToLine /> Nhận xe
      </ButtonLink>
    ) : r.status === 'returned' ? (
      <Button size="lg" onClick={() => setDialog('settle')}>
        <HandCoins /> Quyết toán
      </Button>
    ) : r.status === 'settled' ? (
      <Button size="lg" onClick={() => setDialog('hold')} variant={r.fineHoldUntil && r.fineHoldUntil < now ? 'primary' : 'outline'}>
        <ShieldCheck /> Hoàn cọc
      </Button>
    ) : null;

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          {r.code} <RentalStatusBadge status={r.status} overdue={overdue} />
        </span>
      }
      subtitle={`${d.vehicle.plate} · ${d.customer.fullName}`}
      back="/rentals"
      actions={
        <>
          <span className="hidden sm:inline-flex">{primary}</span>
          <Menu trigger={<Button variant="outline" size="icon" aria-label="Thêm"><MoreHorizontal /></Button>}>
            {['booked', 'active'].includes(r.status) && (
              <MenuItem icon={Pencil} onSelect={() => setDialog('edit')}>
                {r.status === 'active' ? 'Gia hạn / sửa' : 'Sửa lịch, đổi xe'}
              </MenuItem>
            )}
            <MenuItem icon={FileSignature} onSelect={() => generate('contract')}>
              In hợp đồng
            </MenuItem>
            <MenuItem icon={QrCode} onSelect={() => setDialog('qr')}>
              Mã QR chuyển khoản
            </MenuItem>
            <MenuItem icon={UserPlus} onSelect={() => setDialog('driver')}>
              Thêm lái phụ
            </MenuItem>
            {isAdmin && (
              <MenuItem icon={History} onSelect={() => setDialog('audit')}>
                Nhật ký thay đổi
              </MenuItem>
            )}
            {r.status === 'booked' && (
              <>
                <MenuSeparator />
                <MenuItem icon={Ban} danger onSelect={() => setDialog('cancel')}>
                  Hủy lượt thuê
                </MenuItem>
              </>
            )}
          </Menu>
        </>
      }
    >
      <div className="space-y-4">
        {params.get('created') === '1' && (
          <Notice tone="green" icon={CheckCircle2}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Đã tạo lượt thuê. In hợp đồng để hai bên ký khi giao xe.</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => generate('contract')} loading={generating === 'contract'}>
                  <FileSignature /> In hợp đồng
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
                  <X />
                </Button>
              </div>
            </div>
          </Notice>
        )}
        {overdue && (
          <Notice tone="red">
            Quá hạn trả xe {fmtDuration(now - r.scheduledEnd)}. Gọi khách: <a href={telLink(d.customer.phone)} className="font-semibold underline">{d.customer.phone}</a>
          </Notice>
        )}
        {r.status === 'settled' && r.fineHoldUntil && (
          <Notice tone="amber" icon={ShieldCheck}>
            Đang giữ {fmtVnd(m.depositHeld)} chờ phạt nguội đến {fmtDate(r.fineHoldUntil)}
            {r.fineHoldUntil < now ? ' — đã đến hạn hoàn.' : '.'}
          </Notice>
        )}
        {r.status === 'cancelled' && (
          <Notice tone="gray">
            Đã hủy: {r.cancelReason}
            {cancelFee > 0 && ` · khách mất ${fmtVnd(cancelFee)} tiền cọc`}
          </Notice>
        )}
        {d.warnings.map((w) => (
          <Notice key={w.code + w.message} tone={w.severity === 'danger' ? 'red' : w.severity === 'warn' ? 'amber' : 'blue'}>
            {w.message}
          </Notice>
        ))}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader title="Khách thuê" action={<Link to={`/customers/${d.customer.id}`} className="text-sm text-brand">Hồ sơ</Link>} />
            <CardBody>
              <p className="text-lg font-semibold">{d.customer.fullName}</p>
              <div className="mt-2 flex gap-2">
                <a href={telLink(d.customer.phone)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 py-2 text-sm font-medium">
                  <Phone className="size-4 text-brand" /> {d.customer.phone ?? 'Gọi'}
                </a>
                <a href={zaloLink(d.customer.zalo || d.customer.phone)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium">
                  <MessageCircle className="size-4 text-brand" /> Zalo
                </a>
              </div>
              <div className="mt-3 divide-y divide-border">
                <InfoRow label="CCCD">{d.customer.idNumber}</InfoRow>
                <InfoRow label="GPLX">{[d.customer.licenseNumber, d.customer.licenseClass].filter(Boolean).join(' · ')}</InfoRow>
              </div>
              {d.drivers.map((x) => (
                <div key={x.id} className="mt-2 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <Link to={`/customers/${x.id}`} className="flex-1">
                    Lái phụ: <b>{x.fullName}</b>
                  </Link>
                  {r.status === 'booked' && (
                    <button onClick={() => delDriver.mutate(x.id)} aria-label="Bỏ lái phụ">
                      <X className="size-4 text-muted" />
                    </button>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Xe & thời gian" action={<Link to={`/vehicles/${d.vehicle.id}`} className="text-sm text-brand">Xe</Link>} />
            <CardBody className="divide-y divide-border">
              <InfoRow label="Xe">
                {d.vehicle.plate} · {d.vehicle.make} {d.vehicle.model}
              </InfoRow>
              <InfoRow label="Hẹn nhận">{fmtDateTime(r.scheduledStart)}</InfoRow>
              <InfoRow label="Hẹn trả">{fmtDateTime(r.scheduledEnd)}</InfoRow>
              {r.actualStart && <InfoRow label="Giao thực tế">{fmtDateTime(r.actualStart)}</InfoRow>}
              {r.actualEnd && <InfoRow label="Nhận lại thực tế">{fmtDateTime(r.actualEnd)}</InfoRow>}
              <InfoRow label="Thời gian">{fmtDuration(r.scheduledEnd - r.scheduledStart)}</InfoRow>
              <InfoRow label="Giới hạn km">{r.kmLimit ? `${fmtNumber(r.kmLimit)} km` : 'Không giới hạn'}</InfoRow>
              <InfoRow label="Giao nhận">{r.pickupMethod === 'delivery' ? `Giao tận nơi: ${r.pickupLocation ?? ''}` : 'Khách tới lấy'}</InfoRow>
              {r.notes && <InfoRow label="Ghi chú">{r.notes}</InfoRow>}
              <InfoRow label="Người tạo">{userName(r.createdBy)}</InfoRow>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Tiền" action={<Button variant="ghost" size="sm" onClick={() => openPay('rent_in')}><Plus /> Thu/chi</Button>} />
            <CardBody>
              <div className="rounded-2xl bg-surface-2 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted">Tổng phải trả</span>
                  <span className="tabular text-xl font-semibold">{fmtVnd(m.totalCharges)}</span>
                </div>
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-muted">Đã trả</span>
                  <span className="tabular">{fmtVnd(m.rentPaid)}</span>
                </div>
                <div className={cn('flex justify-between text-sm font-semibold', m.due > 0 ? 'text-red-600' : m.due < 0 ? 'text-emerald-600' : '')}>
                  <span>{m.due >= 0 ? 'Còn phải trả' : 'Thu thừa'}</span>
                  <span className="tabular">{fmtVnd(Math.abs(m.due))}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-border pt-1 text-sm">
                  <span className="text-muted">Cọc đang giữ</span>
                  <span className="tabular">
                    {fmtVnd(m.depositHeld)} {['booked', 'active'].includes(r.status) && r.depositRequired > m.depositHeld && <span className="text-xs text-amber-600">/ {fmtNumber(r.depositRequired)}</span>}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {m.due > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => openPay('rent_in')}>
                    Thu tiền thuê
                  </Button>
                )}
                {r.depositRequired > m.depositHeld && ['booked', 'active'].includes(r.status) && (
                  <Button size="sm" variant="secondary" onClick={() => openPay('deposit_in')}>
                    Thu cọc
                  </Button>
                )}
                {m.depositHeld > 0 && ['cancelled', 'closed'].includes(r.status) && (
                  <Button size="sm" variant="secondary" onClick={() => openPay('deposit_out')}>
                    Hoàn cọc
                  </Button>
                )}
                {m.due < 0 && r.status === 'cancelled' && (
                  <Button size="sm" variant="secondary" onClick={() => openPay('rent_out')}>
                    Hoàn tiền thuê
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="sm:hidden">{primary && <div className="[&>*]:w-full">{primary}</div>}</div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader icon={Receipt} title="Các khoản tiền" action={<Button variant="ghost" size="sm" onClick={() => setDialog('charge')}><Plus /> Thêm</Button>} />
            <ul className="divide-y divide-border">
              {d.charges.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 md:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.description}</p>
                    <p className="text-xs text-muted">{CHARGE_KIND_LABEL[c.kind]}</p>
                  </div>
                  <Money value={c.amount} signed className="text-sm font-medium" />
                  {!c.auto && (['booked', 'active', 'returned'].includes(r.status) || isAdmin) && (
                    <button
                      onClick={async () => (await confirm({ title: 'Xóa khoản này?', description: c.description, danger: true, confirmText: 'Xóa' })) && delCharge.mutate(c.id)}
                      className="text-subtle hover:text-red-600"
                      aria-label="Xóa"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader icon={HandCoins} title="Thu / chi" />
            {d.payments.length ? (
              <ul className="divide-y divide-border">
                {d.payments.map((p) => (
                  <li key={p.id} className={cn('flex items-center gap-3 px-4 py-2.5 md:px-5', p.voidedAt && 'opacity-50')}>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm font-medium', p.voidedAt && 'line-through')}>
                        {p.direction === 'offset' ? 'Cấn trừ cọc → tiền thuê' : `${p.direction === 'in' ? 'Nhận' : 'Trả'} ${p.purpose === 'deposit' ? 'cọc' : 'tiền thuê'}`}
                      </p>
                      <p className="text-xs text-muted">
                        {fmtDateTime(p.at)} · {PAYMENT_METHOD_LABEL[p.method]}
                        {p.note && ` · ${p.note}`}
                        {p.voidedAt && ` · đã hủy: ${p.voidReason}`}
                      </p>
                    </div>
                    <span className={cn('tabular text-sm font-medium', p.direction === 'in' ? 'text-emerald-600' : p.direction === 'out' ? 'text-red-600' : 'text-muted')}>
                      {p.direction === 'in' ? '+' : p.direction === 'out' ? '−' : ''}
                      {fmtNumber(p.amount)}
                    </span>
                    {isAdmin && !p.voidedAt && (
                      <button
                        onClick={async () => (await confirm({ title: 'Hủy phiếu này?', description: 'Phiếu vẫn được giữ trong lịch sử (gạch ngang).', danger: true, confirmText: 'Hủy phiếu' })) && voidPayment.mutate(p.id)}
                        className="text-subtle hover:text-red-600"
                        aria-label="Hủy phiếu"
                      >
                        <RotateCcw className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-sm text-muted">Chưa ghi nhận khoản thu nào.</p>
              </CardBody>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader icon={FileText} title="Hợp đồng & biên bản" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(['contract', 'pickup', 'return'] as TemplateKind[]).map((k) => (
                <Button key={k} variant="outline" size="sm" onClick={() => generate(k)} loading={generating === k} disabled={k === 'return' && !returnHo}>
                  <Plus /> {TEMPLATE_KIND_LABEL[k]}
                </Button>
              ))}
            </div>
            {d.documents.length > 0 && (
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {d.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <FileText className="size-5 shrink-0 text-muted" />
                    <div className="min-w-0 flex-[1_1_14rem]">
                      <p className="text-sm font-medium">{doc.templateName}</p>
                      <p className="text-xs text-muted">
                        {fmtDateTime(doc.createdAt)} · mẫu v{doc.templateVersion}
                        {doc.scanFileIds.length > 0 && ` · đã lưu ${doc.scanFileIds.length} trang bản ký`}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {doc.pdfFileId ? (
                        <a href={fileUrl(doc.pdfFileId)} target="_blank" rel="noreferrer" className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-surface-3">
                          PDF
                        </a>
                      ) : (
                        <button onClick={() => retryPdf.mutate(doc.id)} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-surface-3">
                          Tạo PDF
                        </button>
                      )}
                      <a href={fileUrl(doc.docxFileId, { download: true })} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-surface-3">
                        <Download className="size-3" /> Word
                      </a>
                      <button
                        onClick={() => {
                          setScanDoc(doc.id);
                          setDialog('scan');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-surface-3"
                      >
                        <Camera className="size-3" /> Bản đã ký
                      </button>
                    </div>
                    {doc.scanFileIds.length > 0 && <Gallery items={doc.scanFileIds.map((f, i) => ({ fileId: f, label: `Trang ${i + 1}` }))} className="w-full" />}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {(pickupHo || returnHo) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {pickupHo && <HandoverCard h={pickupHo} title={`Giao xe · ${userName(pickupHo.staffUserId)}`} />}
            {returnHo && <HandoverCard h={returnHo} prev={pickupHo} title={`Nhận xe · ${userName(returnHo.staffUserId)}`} />}
          </div>
        )}

        <Card>
          <CardHeader title="Tài sản thế chấp" action={<Button variant="ghost" size="sm" onClick={() => setDialog('collateral')}><Plus /> Thêm</Button>} />
          {d.collaterals.length ? (
            <ul className="divide-y divide-border">
              {d.collaterals.map((c) => (
                <li key={c.id} className="space-y-2 px-4 py-3 md:px-5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{c.description}</p>
                      <p className="text-xs text-muted">
                        {COLLATERAL_KIND_LABEL[c.kind]} · nhận {fmtDateTime(c.receivedAt)}
                        {c.returnedAt && ` · đã trả ${fmtDateTime(c.returnedAt)}`}
                      </p>
                    </div>
                    <Button size="sm" variant={c.returnedAt ? 'ghost' : 'outline'} onClick={() => toggleCollateral.mutate({ cid: c.id, returned: !c.returnedAt })}>
                      {c.returnedAt ? 'Hoàn tác' : 'Đã trả khách'}
                    </Button>
                  </div>
                  {c.photoFileIds.length > 0 && <Gallery items={c.photoFileIds.map((f) => ({ fileId: f }))} />}
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">Không có.</p>
            </CardBody>
          )}
        </Card>

        {d.fines.length > 0 && (
          <Card>
            <CardHeader title="Phạt nguội trong lượt thuê này" />
            <ul className="divide-y divide-border">
              {d.fines.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{f.violation ?? 'Vi phạm'}</p>
                    <p className="text-xs text-muted">
                      {fmtDateTime(f.violatedAt)} · {f.location} {f.amount ? `· ${fmtVnd(f.amount)}` : ''}
                    </p>
                  </div>
                  <FineStatusBadge status={f.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <PaymentDialog d={d} open={dialog === 'pay'} onOpenChange={(o) => setDialog(o ? 'pay' : null)} preset={payPreset} />
      <ChargeDialog d={d} open={dialog === 'charge'} onOpenChange={(o) => setDialog(o ? 'charge' : null)} />
      <SettleDialog
        d={d}
        open={dialog === 'settle'}
        onOpenChange={(o) => {
          setDialog(o ? 'settle' : null);
          if (!o && params.get('settle')) setParams({}, { replace: true });
        }}
      />
      <ReleaseHoldDialog d={d} open={dialog === 'hold'} onOpenChange={(o) => setDialog(o ? 'hold' : null)} />
      <EditRentalDialog d={d} open={dialog === 'edit'} onOpenChange={(o) => setDialog(o ? 'edit' : null)} />
      <CancelDialog d={d} open={dialog === 'cancel'} onOpenChange={(o) => setDialog(o ? 'cancel' : null)} />
      <CollateralDialog d={d} open={dialog === 'collateral'} onOpenChange={(o) => setDialog(o ? 'collateral' : null)} />
      <DriverDialog d={d} open={dialog === 'driver'} onOpenChange={(o) => setDialog(o ? 'driver' : null)} />
      <ScanDialog d={d} documentId={scanDoc} open={dialog === 'scan'} onOpenChange={(o) => setDialog(o ? 'scan' : null)} />
      <Dialog open={dialog === 'qr'} onOpenChange={(o) => setDialog(o ? 'qr' : null)} title="Chuyển khoản" description={m.due > 0 ? 'Số tiền còn phải trả' : 'Tiền cọc'} size="sm">
        <VietQr amount={m.due > 0 ? m.due : Math.max(0, r.depositRequired - m.depositHeld)} note={r.code} />
      </Dialog>
      <Dialog open={dialog === 'audit'} onOpenChange={(o) => setDialog(o ? 'audit' : null)} title="Nhật ký thay đổi" size="lg">
        <ul className="space-y-2 text-sm">
          {audit?.items.map((a) => (
            <li key={a.id} className="rounded-xl bg-surface-2 px-3 py-2">
              <p>
                <b>{audit.users.find((u) => u.id === a.userId)?.displayName ?? 'Hệ thống'}</b> · {a.action} · <span className="text-muted">{fmtDateTime(a.at)}</span>
              </p>
              {a.detail && <p className="mt-1 font-mono text-xs break-all text-muted">{a.detail.slice(0, 400)}</p>}
            </li>
          ))}
        </ul>
      </Dialog>
    </Page>
  );
}
