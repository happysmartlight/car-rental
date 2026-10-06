import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, KeyRound, MessageCircle, MoreHorizontal, Pencil, Phone, ShieldAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/layout/AppShell';
import { FineStatusBadge, Money, RentalStatusBadge } from '@/components/common';
import { Gallery } from '@/components/images';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Badge, Card, CardBody, CardHeader, Empty, InfoRow, Menu, MenuItem, Notice, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAction, useAuth } from '@/lib/hooks';
import type { CustomerDetail as Detail } from '@/lib/types';
import { telLink, zaloLink } from '@/lib/utils';
import { fmtVnd } from '@shared/text';
import { daysUntil, fmtDate, fmtDateKey, fmtDateTime } from '@shared/time';
import { Avatar } from './CustomersList';

export default function CustomerDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Detail>(`/api/customers/${id}`) });
  const archive = useAction((archived: boolean) => api.post(`/api/customers/${id}/archive`, { archived }), { invalidate: [['customer', id], ['customers']], success: 'Đã cập nhật' });

  if (isLoading || !data) return <PageLoader />;
  const c = data.customer;
  const photos = [
    c.idFrontFileId && { fileId: c.idFrontFileId, label: 'CCCD mặt trước' },
    c.idBackFileId && { fileId: c.idBackFileId, label: 'CCCD mặt sau' },
    c.licenseFrontFileId && { fileId: c.licenseFrontFileId, label: 'GPLX mặt trước' },
    c.licenseBackFileId && { fileId: c.licenseBackFileId, label: 'GPLX mặt sau' },
    c.portraitFileId && { fileId: c.portraitFileId, label: 'Chân dung' },
  ].filter(Boolean) as { fileId: string; label: string }[];
  const licenseDays = c.licenseExpiry ? daysUntil(c.licenseExpiry) : null;
  const history = [...data.rentals, ...data.asDriver].sort((a, b) => b.scheduledStart - a.scheduledStart);

  return (
    <Page
      title={c.fullName}
      subtitle={c.archivedAt ? 'Đã lưu trữ' : c.phone}
      back="/customers"
      actions={
        <>
          <ButtonLink to={`/rentals/new?customerId=${c.id}`} className="hidden sm:inline-flex">
            <KeyRound /> Đặt xe
          </ButtonLink>
          <Menu trigger={<Button variant="outline" size="icon" aria-label="Thêm"><MoreHorizontal /></Button>}>
            <MenuItem icon={Pencil} onSelect={() => navigate(`/customers/${c.id}/edit`)}>
              Sửa thông tin
            </MenuItem>
            <MenuItem icon={KeyRound} onSelect={() => navigate(`/rentals/new?customerId=${c.id}`)}>
              Đặt xe cho khách này
            </MenuItem>
            {isAdmin && (
              <MenuItem
                icon={c.archivedAt ? ArchiveRestore : Archive}
                onSelect={async () => {
                  if (!c.archivedAt && !(await confirm({ title: 'Lưu trữ khách này?', description: 'Khách ẩn khỏi danh sách nhưng lịch sử thuê vẫn giữ nguyên để tra phạt nguội.' }))) return;
                  archive.mutate(!c.archivedAt);
                }}
              >
                {c.archivedAt ? 'Bỏ lưu trữ' : 'Lưu trữ'}
              </MenuItem>
            )}
          </Menu>
        </>
      }
    >
      <div className="space-y-4">
        {c.blacklisted && (
          <Notice tone="red" icon={ShieldAlert}>
            <b>Danh sách đen.</b> {c.blacklistReason}
          </Notice>
        )}
        {data.warnings.filter((w) => w.code !== 'blacklisted').map((w) => (
          <Notice key={w.code} tone={w.severity === 'danger' ? 'red' : w.severity === 'warn' ? 'amber' : 'blue'}>
            {w.message}
          </Notice>
        ))}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardBody className="pt-5">
              <div className="flex items-center gap-3">
                <Avatar name={c.fullName} fileId={c.portraitFileId} size="size-14" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{c.fullName}</p>
                  <p className="text-sm text-muted">
                    {history.length} lượt thuê{isAdmin && ` · ${fmtVnd(data.totalSpent)}`}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <a href={telLink(c.phone)} className="flex flex-col items-center gap-1 rounded-xl bg-surface-2 py-2.5 text-xs font-medium hover:bg-surface-3">
                  <Phone className="size-4 text-brand" /> Gọi
                </a>
                <a href={zaloLink(c.zalo || c.phone)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl bg-surface-2 py-2.5 text-xs font-medium hover:bg-surface-3">
                  <MessageCircle className="size-4 text-brand" /> Zalo
                </a>
                <Link to={`/rentals/new?customerId=${c.id}`} className="flex flex-col items-center gap-1 rounded-xl bg-surface-2 py-2.5 text-xs font-medium hover:bg-surface-3">
                  <KeyRound className="size-4 text-brand" /> Đặt xe
                </Link>
              </div>
              <div className="mt-4 divide-y divide-border">
                <InfoRow label="Điện thoại">{c.phone}</InfoRow>
                {c.phone2 && <InfoRow label="SĐT phụ">{c.phone2}</InfoRow>}
                <InfoRow label="Email">{c.email}</InfoRow>
                <InfoRow label="Chỗ ở">{c.currentAddress}</InfoRow>
                <InfoRow label="Khẩn cấp">{[c.emergencyName, c.emergencyRelation && `(${c.emergencyRelation})`, c.emergencyPhone].filter(Boolean).join(' ')}</InfoRow>
                {c.notes && <InfoRow label="Ghi chú">{c.notes}</InfoRow>}
              </div>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Giấy tờ" />
            <CardBody>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div className="divide-y divide-border">
                  <InfoRow label="Số CCCD">
                    <span className="tabular">{c.idNumber}</span>
                  </InfoRow>
                  <InfoRow label="Ngày sinh">{fmtDateKey(c.dob)}</InfoRow>
                  <InfoRow label="Giới tính">{c.gender}</InfoRow>
                  <InfoRow label="Cấp ngày">{fmtDateKey(c.idIssueDate)}</InfoRow>
                  <InfoRow label="Nơi cấp">{c.idIssuePlace}</InfoRow>
                </div>
                <div className="divide-y divide-border">
                  <InfoRow label="Số GPLX">
                    <span className="tabular">{c.licenseNumber}</span>
                  </InfoRow>
                  <InfoRow label="Hạng">{c.licenseClass}</InfoRow>
                  <InfoRow label="Hạn GPLX">
                    {c.licenseExpiry ? (
                      <span className={licenseDays != null && licenseDays < 0 ? 'text-red-600' : undefined}>
                        {fmtDateKey(c.licenseExpiry)} {licenseDays != null && licenseDays < 0 && '(hết hạn)'}
                      </span>
                    ) : (
                      c.licenseNumber && 'Không thời hạn'
                    )}
                  </InfoRow>
                  <InfoRow label="Thường trú">{c.permanentAddress}</InfoRow>
                </div>
              </div>
              {photos.length > 0 && <Gallery items={photos} className="mt-4" />}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Lịch sử thuê" description="Dùng để đối chiếu khi có phạt nguội" />
          {history.length ? (
            <ul className="divide-y divide-border">
              {history.map((r) => (
                <li key={`${r.role}${r.id}`}>
                  <Link to={`/rentals/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 md:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {r.code} · {r.vehicle.plate}
                        {r.role === 'driver' && <Badge>Lái phụ</Badge>}
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
            <Empty title="Chưa thuê lần nào" action={<ButtonLink to={`/rentals/new?customerId=${c.id}`}>Đặt xe</ButtonLink>} />
          )}
        </Card>

        {data.fines.length > 0 && (
          <Card>
            <CardHeader title="Phạt nguội" />
            <ul className="divide-y divide-border">
              {data.fines.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {f.plate} · {f.violation ?? 'Vi phạm'}
                    </p>
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
        <p className="text-center text-xs text-subtle">Tạo hồ sơ {fmtDate(c.createdAt)} · cập nhật {fmtDate(c.updatedAt)}</p>
      </div>
    </Page>
  );
}
