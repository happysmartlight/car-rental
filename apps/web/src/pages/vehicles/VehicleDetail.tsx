import { useQuery } from '@tanstack/react-query';
import { Archive, Car, KeyRound, MoreHorizontal, Pencil, Share2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AccessoryManager } from '@/components/AccessoryManager';
import { Page } from '@/components/layout/AppShell';
import { ShareDialog } from '@/components/ShareDialog';
import { FineStatusBadge, Money, RentalStatusBadge, VehicleStateBadge } from '@/components/common';
import { Gallery } from '@/components/images';
import { Button, ButtonLink } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { DateTimeInput, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, Empty, InfoRow, Menu, MenuItem, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAction, useAuth } from '@/lib/hooks';
import type { VehicleDetail as Detail } from '@/lib/types';
import { BLOCK_KINDS, BLOCK_KIND_LABEL, FUEL_LABEL, TRANSMISSION_LABEL, type BlockKind } from '@shared/constants';
import { CHARGE_BASE_DAYS, vehicleChargingPolicy } from '@shared/pricing';
import { fmtNumber, fmtVnd } from '@shared/text';
import { daysUntil, fmtDateKey, fmtDateTime } from '@shared/time';

function Expiry({ value }: { value: string | null }) {
  if (!value) return <span className="font-normal text-subtle">—</span>;
  const d = daysUntil(value);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {fmtDateKey(value)}
      {d < 0 ? <Badge tone="red">Hết hạn</Badge> : d <= 30 ? <Badge tone="amber">Còn {d} ngày</Badge> : null}
    </span>
  );
}

export default function VehicleDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [blockOpen, setBlockOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [block, setBlock] = useState<{ kind: BlockKind; startAt: number | null; endAt: number | null; location: string; notes: string }>({ kind: 'maintenance', startAt: Date.now(), endAt: null, location: '', notes: '' });
  const { data, isLoading } = useQuery({ queryKey: ['vehicle', id], queryFn: () => api.get<Detail>(`/api/vehicles/${id}`) });
  const inv = { invalidate: [['vehicle', id], ['vehicles'], ['dashboard'], ['calendar']] };
  const addBlock = useAction(() => api.post(`/api/vehicles/${id}/blocks`, block), { ...inv, success: 'Đã ghi nhận', onSuccess: () => setBlockOpen(false) });
  const endBlock = useAction((blockId: number) => api.patch(`/api/blocks/${blockId}`, { endAt: Date.now() }), { ...inv, success: 'Xe đã sẵn sàng trở lại' });
  const archive = useAction(() => api.post(`/api/vehicles/${id}/archive`, { archived: true }), { invalidate: [['vehicles']], onSuccess: () => navigate('/vehicles') });

  if (isLoading || !data) return <PageLoader />;
  const v = data.vehicle;
  const charging = vehicleChargingPolicy(v);
  const shareVehicles = [{ ...v, highlights: data.accessories.filter((a) => a.showInShare).map((a) => a.name) }];
  const photos = [v.photoFileId && { fileId: v.photoFileId, label: 'Ảnh xe' }, v.registrationFileId && { fileId: v.registrationFileId, label: 'Đăng ký xe' }].filter(Boolean) as { fileId: string; label: string }[];

  return (
    <Page
      title={v.plate}
      subtitle={[v.make, v.model, v.year].filter(Boolean).join(' ')}
      back="/vehicles"
      actions={
        <>
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 /> <span className="hidden sm:inline">Chia sẻ</span>
          </Button>
          <ButtonLink to={`/rentals/new?vehicleId=${v.id}`} className="hidden sm:inline-flex">
            <KeyRound /> Đặt xe này
          </ButtonLink>
          <Menu trigger={<Button variant="outline" size="icon" aria-label="Thêm"><MoreHorizontal /></Button>}>
            <MenuItem icon={KeyRound} onSelect={() => navigate(`/rentals/new?vehicleId=${v.id}`)}>
              Đặt xe này
            </MenuItem>
            <MenuItem icon={Wrench} onSelect={() => setBlockOpen(true)}>
              Đưa vào gara / tạm ngưng
            </MenuItem>
            {isAdmin && (
              <MenuItem icon={Pencil} onSelect={() => navigate(`/vehicles/${v.id}/edit`)}>
                Sửa thông tin & giá
              </MenuItem>
            )}
            {isAdmin && (
              <MenuItem
                icon={Archive}
                danger
                onSelect={async () => {
                  if (await confirm({ title: `Lưu trữ xe ${v.plate}?`, description: 'Xe ẩn khỏi danh sách và lịch. Lịch sử thuê vẫn giữ để tra phạt nguội.', danger: true, confirmText: 'Lưu trữ' })) archive.mutate();
                }}
              >
                Lưu trữ (bán xe / thôi kinh doanh)
              </MenuItem>
            )}
          </Menu>
        </>
      }
    >
      <div className="space-y-4">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-4 pt-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Car className="size-6" />
            </span>
            <div className="min-w-0 flex-[1_1_14rem]">
              {data.status && <VehicleStateBadge state={data.status.state} blockKind={data.status.block?.kind} />}
              <p className="mt-1 text-sm">
                {data.status?.current ? (
                  <Link to={`/rentals/${data.status.current.id}`} className="hover:underline">
                    <b>{data.status.current.customer.fullName}</b> đang giữ xe · hẹn trả {fmtDateTime(data.status.current.scheduledEnd)}
                  </Link>
                ) : data.status?.block ? (
                  <span>
                    {data.status.block.location || data.status.block.notes || 'Tạm ngưng'} · từ {fmtDateTime(data.status.block.startAt)}
                  </span>
                ) : data.status?.next ? (
                  <Link to={`/rentals/${data.status.next.id}`} className="text-muted hover:underline">
                    Lượt tới: {data.status.next.customer.fullName} · {fmtDateTime(data.status.next.start)}
                  </Link>
                ) : (
                  <span className="text-muted">Chưa có lịch đặt</span>
                )}
              </p>
            </div>
            {data.status?.block && (
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => endBlock.mutate(data.status!.block!.id)} loading={endBlock.isPending}>
                Xe đã về, sẵn sàng
              </Button>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader title="Thông tin" />
            <CardBody className="divide-y divide-border">
              <InfoRow label="ODO">{fmtNumber(v.odo)} km</InfoRow>
              <InfoRow label="Số chỗ">{v.seats}</InfoRow>
              <InfoRow label="Hộp số">{v.transmission && TRANSMISSION_LABEL[v.transmission]}</InfoRow>
              <InfoRow label="Nhiên liệu">{v.fuel && FUEL_LABEL[v.fuel]}</InfoRow>
              <InfoRow label="Màu">{v.color}</InfoRow>
              <InfoRow label="Số khung">{v.vin}</InfoRow>
              <InfoRow label="Số máy">{v.engineNo}</InfoRow>
              <InfoRow label="Chủ xe">{v.ownerType === 'own' ? 'Xe nhà' : `${v.ownerName ?? 'Ký gửi'} (${v.ownerSharePct ?? '?'}%)`}</InfoRow>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Bảng giá" />
            <CardBody className="divide-y divide-border">
              <InfoRow label="Ngày">{fmtVnd(v.priceDay)}</InfoRow>
              <InfoRow label="Cuối tuần">{fmtVnd(v.priceWeekendDay || v.priceDay)}</InfoRow>
              <InfoRow label="Giờ lẻ">{fmtVnd(v.priceHour)}</InfoRow>
              <InfoRow label="Giới hạn">{v.kmLimitDay ? `${fmtNumber(v.kmLimitDay)} km/ngày` : 'Không giới hạn'}</InfoRow>
              <InfoRow label="Vượt km">{fmtVnd(v.overKmFee)}/km</InfoRow>
              <InfoRow label="Quá giờ">{fmtVnd(v.overHourFee)}/giờ</InfoRow>
              {!!v.priceMonth && <InfoRow label="Thuê tháng">{fmtVnd(v.priceMonth)}</InfoRow>}
              {!!v.priceMonth && (
                <InfoRow label="Km/tháng">{v.kmLimitMonth ? `${fmtNumber(v.kmLimitMonth)} km` : v.kmLimitDay ? `${fmtNumber(v.kmLimitDay * 30)} km` : 'Không giới hạn'}</InfoRow>
              )}
              {charging && (
                <>
                  <InfoRow label="Sạc miễn phí">{charging.baseFree ? `${charging.baseFree} lượt (≤ ${CHARGE_BASE_DAYS} ngày), +1 lượt/ngày` : 'Không'}</InfoRow>
                  {!!charging.fee && <InfoRow label="Sạc vượt">{fmtVnd(charging.fee)}/lượt</InfoRow>}
                </>
              )}
              <InfoRow label="Cọc mặc định">{fmtVnd(v.depositAmount)}</InfoRow>
              {data.revenue != null && <InfoRow label="Tổng doanh thu">{fmtVnd(data.revenue)}</InfoRow>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Giấy tờ & bảo dưỡng" />
            <CardBody className="divide-y divide-border">
              <InfoRow label="Đăng kiểm">
                <Expiry value={v.inspectionExpiry} />
              </InfoRow>
              <InfoRow label="BH TNDS">
                <Expiry value={v.insuranceTndsExpiry} />
              </InfoRow>
              <InfoRow label="BH thân vỏ">
                <Expiry value={v.insuranceBodyExpiry} />
              </InfoRow>
              <InfoRow label="Phí đường bộ">
                <Expiry value={v.roadFeeExpiry} />
              </InfoRow>
              <InfoRow label="Bảo dưỡng tới">{[v.nextServiceOdo && `${fmtNumber(v.nextServiceOdo)} km`, v.nextServiceDate && fmtDateKey(v.nextServiceDate)].filter(Boolean).join(' / ')}</InfoRow>
            </CardBody>
            {photos.length > 0 && (
              <CardBody>
                <Gallery items={photos} className="grid-cols-2 sm:grid-cols-2 md:grid-cols-2" />
              </CardBody>
            )}
          </Card>
        </div>

        <AccessoryManager vehicleId={v.id} />

        <Card>
          <CardHeader title="Lịch sử cho thuê" description={`${data.rentals.length} lượt`} />
          {data.rentals.length ? (
            <ul className="divide-y divide-border">
              {data.rentals.map((r) => (
                <li key={r.id}>
                  <Link to={`/rentals/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 md:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {r.code} · {r.customer.fullName}
                      </p>
                      <p className="text-sm text-muted">
                        {fmtDateTime(r.actualStart ?? r.scheduledStart)} → {fmtDateTime(r.actualEnd ?? r.scheduledEnd)}
                      </p>
                    </div>
                    <RentalStatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Chưa cho thuê lần nào" />
          )}
        </Card>

        <Card>
          <CardHeader title="Gara / tạm ngưng" action={<Button variant="outline" size="sm" onClick={() => setBlockOpen(true)}><Wrench /> Ghi nhận</Button>} />
          {data.blocks.length ? (
            <ul className="divide-y divide-border">
              {data.blocks.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {BLOCK_KIND_LABEL[b.kind]} {b.location && `· ${b.location}`}
                    </p>
                    <p className="text-sm text-muted">
                      {fmtDateTime(b.startAt)} → {b.endAt ? fmtDateTime(b.endAt) : 'chưa xong'} {b.notes && `· ${b.notes}`}
                    </p>
                  </div>
                  {!b.endAt && (
                    <Button size="sm" variant="outline" onClick={() => endBlock.mutate(b.id)}>
                      Kết thúc
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">Ghi lại các lần xe vào gara hoặc chủ xe dùng — cũng là bằng chứng khi có phạt nguội lúc xe không cho thuê.</p>
            </CardBody>
          )}
        </Card>

        {data.fines.length > 0 && (
          <Card>
            <CardHeader title="Phạt nguội của xe" />
            <ul className="divide-y divide-border">
              {data.fines.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{f.violation ?? 'Vi phạm'}</p>
                    <p className="text-sm text-muted">
                      {fmtDateTime(f.violatedAt)} {f.amount ? <>· <Money value={f.amount} /></> : null}
                    </p>
                  </div>
                  <FineStatusBadge status={f.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} mode="vehicle" vehicles={shareVehicles} />

      <Dialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title="Đưa xe vào gara / tạm ngưng"
        description="Xe không nhận đặt trong khoảng này"
        footer={
          <Button onClick={() => addBlock.mutate()} loading={addBlock.isPending} disabled={!block.startAt}>
            Lưu
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Lý do">
            <Select value={block.kind} onChange={(e) => setBlock({ ...block, kind: e.target.value as BlockKind })}>
              {BLOCK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {BLOCK_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Từ">
              <DateTimeInput value={block.startAt} onChange={(v) => setBlock({ ...block, startAt: v })} />
            </Field>
            <Field label="Đến" hint="Để trống nếu chưa biết">
              <DateTimeInput value={block.endAt} onChange={(v) => setBlock({ ...block, endAt: v })} />
            </Field>
          </div>
          <Field label="Nơi (gara, người dùng…)">
            <Input value={block.location} onChange={(e) => setBlock({ ...block, location: e.target.value })} />
          </Field>
          <Field label="Ghi chú">
            <Textarea value={block.notes} onChange={(e) => setBlock({ ...block, notes: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </Page>
  );
}
