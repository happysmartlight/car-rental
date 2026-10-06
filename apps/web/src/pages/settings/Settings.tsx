import { useQueryClient } from '@tanstack/react-query';
import { Bell, Building2, ChevronRight, DatabaseBackup, FileText, KeyRound, type LucideIcon, PackagePlus, Plus, Rocket, Scale, ServerCog, Trash2, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/layout/AppShell';
import { VietQr } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox, DateInput, Field, Input, MoneyInput, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth, useMediaQuery, useSettings } from '@/lib/hooks';
import type { BusinessSettings, RulesSettings } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { WEEKDAY_LONG } from '@shared/time';
import { SettingsAccessories } from './SettingsAccessories';
import { SettingsBackup } from './SettingsBackup';
import { SettingsSystem, SettingsTelegram, SettingsUsers } from './SettingsAdmin';
import { SettingsTemplates } from './SettingsTemplates';
import { SettingsUpdate } from './SettingsUpdate';

interface Section {
  path: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  admin?: boolean;
  element: ReactNode;
}

const SECTIONS: Section[] = [
  { path: 'business', label: 'Cửa hàng', desc: 'Thông tin in lên hợp đồng, tài khoản VietQR', icon: Building2, admin: true, element: <BusinessSection /> },
  { path: 'rules', label: 'Giá & quy định', desc: 'Cuối tuần, lễ Tết, giờ lẻ, giữ cọc phạt nguội', icon: Scale, admin: true, element: <RulesSection /> },
  { path: 'accessories', label: 'Danh mục phụ kiện', desc: 'Tên chuẩn, giá trị đền bù, áp cho cả đội xe', icon: PackagePlus, admin: true, element: <SettingsAccessories /> },
  { path: 'templates', label: 'Mẫu hợp đồng', desc: 'Mẫu Word, danh sách biến', icon: FileText, admin: true, element: <SettingsTemplates /> },
  { path: 'users', label: 'Người dùng', desc: 'Nhân viên, phân quyền', icon: Users, admin: true, element: <SettingsUsers /> },
  { path: 'telegram', label: 'Thông báo Telegram', desc: 'Nhắc trả xe, bản tin sáng', icon: Bell, admin: true, element: <SettingsTelegram /> },
  { path: 'backup', label: 'Sao lưu', desc: 'Hằng đêm, gửi Telegram, khôi phục', icon: DatabaseBackup, admin: true, element: <SettingsBackup /> },
  { path: 'update', label: 'Phiên bản & cập nhật', desc: 'Cập nhật một chạm, quay về bản cũ', icon: Rocket, admin: true, element: <SettingsUpdate /> },
  { path: 'system', label: 'Hệ thống & nhật ký', desc: 'Dung lượng, dịch vụ PDF, nhật ký thao tác', icon: ServerCog, admin: true, element: <SettingsSystem /> },
  { path: 'account', label: 'Tài khoản của tôi', desc: 'Đổi mật khẩu', icon: KeyRound, element: <AccountSection /> },
];

export default function Settings() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const sections = SECTIONS.filter((s) => isAdmin || !s.admin);
  const sub = location.pathname.split('/')[2];
  const current = sections.find((s) => s.path === sub);

  const nav = (
    <nav className="space-y-1">
      {sections.map((s) => (
        <NavLink
          key={s.path}
          to={`/settings/${s.path}`}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors', isActive ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2')}
        >
          <s.icon className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{s.label}</span>
            <span className="block truncate text-xs text-muted">{s.desc}</span>
          </span>
          <ChevronRight className="size-4 text-subtle lg:hidden" />
        </NavLink>
      ))}
    </nav>
  );

  if (!sub) {
    if (isDesktop) return <Navigate to={`/settings/${sections[0].path}`} replace />;
    return (
      <Page title="Cài đặt">
        <Card className="p-2">{nav}</Card>
      </Page>
    );
  }

  return (
    <Page title={current?.label ?? 'Cài đặt'} subtitle={current?.desc} back={isDesktop ? undefined : '/settings'} width="default">
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
        <aside className="hidden lg:block">
          <div className="sticky top-6">{nav}</div>
        </aside>
        <div className="min-w-0">
          <Routes>
            {sections.map((s) => (
              <Route key={s.path} path={s.path} element={s.element} />
            ))}
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Routes>
        </div>
      </div>
    </Page>
  );
}

export function SaveBar({ onSave, saving, dirty = true }: { onSave: () => void; saving: boolean; dirty?: boolean }) {
  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex justify-end lg:bottom-4">
      <Button size="lg" onClick={onSave} loading={saving} disabled={!dirty} className="w-full shadow-pop sm:w-auto">
        Lưu thay đổi
      </Button>
    </div>
  );
}

// ── Cửa hàng ─────────────────────────────────────────────────────────────────

function BusinessSection() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [f, setF] = useState<BusinessSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data && !f) setF(data.business);
  }, [data, f]);
  if (!f || !data) return <PageLoader />;
  const text = (k: keyof BusinessSettings) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings/business', f);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Đã lưu');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Bên cho thuê" description="In lên hợp đồng (Bên A)" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên cửa hàng / doanh nghiệp" className="sm:col-span-2">
            <Input {...text('name')} placeholder="Xe tự lái An Phát" />
          </Field>
          <Field label="Người đại diện">
            <Input {...text('representative')} />
          </Field>
          <Field label="Chức vụ">
            <Input {...text('position')} placeholder="Chủ hộ kinh doanh" />
          </Field>
          <Field label="Số CCCD người đại diện">
            <Input {...text('idNumber')} inputMode="numeric" />
          </Field>
          <Field label="Ngày cấp">
            <DateInput value={f.idIssueDate || null} onChange={(v) => setF({ ...f, idIssueDate: v ?? '' })} />
          </Field>
          <Field label="Nơi cấp" className="sm:col-span-2">
            <Input {...text('idIssuePlace')} />
          </Field>
          <Field label="Địa chỉ" className="sm:col-span-2">
            <Input {...text('address')} />
          </Field>
          <Field label="Điện thoại">
            <Input {...text('phone')} type="tel" />
          </Field>
          <Field label="Email">
            <Input {...text('email')} type="email" />
          </Field>
          <Field label="Mã số thuế">
            <Input {...text('taxCode')} />
          </Field>
          <Field label="Nơi ký hợp đồng" hint="vd: TP. Hồ Chí Minh">
            <Input {...text('signCity')} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Khi chia sẻ bảng giá cho khách" description="In trên ảnh và tin nhắn bảng giá (mỗi dòng một ý)" />
        <CardBody>
          <Textarea
            value={f.shareNote}
            onChange={(e) => setF({ ...f, shareNote: e.target.value })}
            rows={3}
            placeholder={'Giao xe tận nơi nội thành, miễn phí trong 5 km\nNhận đặt xe 24/7 qua Zalo'}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Tài khoản nhận tiền" description="Dùng để tạo mã VietQR đúng số tiền" />
        <CardBody className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ngân hàng">
              <Select
                value={f.bankBin}
                onChange={(e) => {
                  const b = data.banks.find((x) => x.bin === e.target.value);
                  setF({ ...f, bankBin: e.target.value, bankName: b?.name ?? f.bankName });
                }}
              >
                <option value="">— Chọn —</option>
                {data.banks.map((b) => (
                  <option key={b.bin} value={b.bin}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mã BIN" hint="Tự điền khi chọn ngân hàng">
              <Input {...text('bankBin')} inputMode="numeric" />
            </Field>
            <Field label="Số tài khoản">
              <Input {...text('bankAccount')} inputMode="numeric" />
            </Field>
            <Field label="Chủ tài khoản">
              <Input value={f.bankAccountName} onChange={(e) => setF({ ...f, bankAccountName: e.target.value.toUpperCase() })} placeholder="NGUYEN VAN A" />
            </Field>
          </div>
          {data.business.bankBin && data.business.bankAccount && <VietQr amount={10000} note="TEST" className="scale-90" />}
        </CardBody>
      </Card>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

// ── Giá & quy định ───────────────────────────────────────────────────────────

function RulesSection() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [f, setF] = useState<RulesSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [newItem, setNewItem] = useState('');
  useEffect(() => {
    if (data && !f) setF(data.rules);
  }, [data, f]);
  if (!f) return <PageLoader />;
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings/rules', f);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Đã lưu. Áp dụng cho lượt đặt mới.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Cách tính giá" description="Tính theo khối 24 giờ từ lúc nhận xe" />
        <CardBody className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Ngày tính giá cuối tuần</p>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setF({ ...f, weekendDays: f.weekendDays.includes(d) ? f.weekendDays.filter((x) => x !== d) : [...f.weekendDays, d] })}
                  className={cn('rounded-full border px-3 py-1 text-sm', f.weekendDays.includes(d) ? 'border-brand bg-brand-soft text-brand' : 'border-border')}
                >
                  {WEEKDAY_LONG[d]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Giờ lẻ tối đa tính theo giờ" hint="Vượt quá → tính thêm 1 ngày">
              <NumberInput value={f.hourlyMaxHours} onChange={(v) => setF({ ...f, hourlyMaxHours: v ?? 0 })} suffix="giờ" />
            </Field>
            <Field label="Ân hạn trả xe" hint="Trễ trong khoảng này không tính phí">
              <NumberInput value={f.graceMinutes} onChange={(v) => setF({ ...f, graceMinutes: v ?? 0 })} suffix="phút" />
            </Field>
            <Field label="Đệm giữa 2 lượt thuê" hint="Rửa xe, kiểm tra">
              <NumberInput value={f.bufferMinutes} onChange={(v) => setF({ ...f, bufferMinutes: v ?? 0 })} suffix="phút" />
            </Field>
            <Field label="Phí giao xe tận nơi mặc định">
              <MoneyInput value={f.deliveryFeeDefault} onChange={(v) => setF({ ...f, deliveryFeeDefault: v ?? 0 })} />
            </Field>
            <Field label="Tuổi tối thiểu người lái">
              <NumberInput value={f.minDriverAge} onChange={(v) => setF({ ...f, minDriverAge: v ?? 0 })} suffix="tuổi" />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Phụ thu lễ, Tết" description="Khối ngày bắt đầu trong kỳ lễ được cộng % phụ thu" />
        <CardBody className="space-y-2">
          {f.holidays.map((h, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-2xl border border-border p-3 sm:grid-cols-[1fr_150px_150px_110px_auto] sm:border-0 sm:p-0">
              <Input className="col-span-2 sm:col-span-1" value={h.name} placeholder="Tết Nguyên đán" onChange={(e) => setF({ ...f, holidays: f.holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <DateInput value={h.from} onChange={(v) => setF({ ...f, holidays: f.holidays.map((x, j) => (j === i ? { ...x, from: v ?? '' } : x)) })} />
              <DateInput value={h.to} onChange={(v) => setF({ ...f, holidays: f.holidays.map((x, j) => (j === i ? { ...x, to: v ?? '' } : x)) })} />
              <NumberInput value={h.surchargePct} onChange={(v) => setF({ ...f, holidays: f.holidays.map((x, j) => (j === i ? { ...x, surchargePct: v ?? 0 } : x)) })} suffix="%" />
              <Button variant="ghost" size="icon" onClick={() => setF({ ...f, holidays: f.holidays.filter((_, j) => j !== i) })} aria-label="Xóa">
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setF({ ...f, holidays: [...f.holidays, { name: '', from: '', to: '', surchargePct: 30 }] })}>
            <Plus /> Thêm kỳ lễ
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Cọc chờ phạt nguội" description="Giữ lại một phần cọc sau khi trả xe để đối soát vi phạm" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Số tiền giữ lại">
            <MoneyInput value={f.fineHoldAmount} onChange={(v) => setF({ ...f, fineHoldAmount: v ?? 0 })} />
          </Field>
          <Field label="Thời gian giữ">
            <NumberInput value={f.fineHoldDays} onChange={(v) => setF({ ...f, fineHoldDays: v ?? 0 })} suffix="ngày" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Giấy tờ & đồ đi kèm khi giao xe" description="Danh sách đánh dấu trong biên bản giao xe" />
        <CardBody className="space-y-2">
          {f.checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox checked onChange={() => undefined} label={c} className="flex-1" />
              <Button variant="ghost" size="icon-sm" onClick={() => setF({ ...f, checklist: f.checklist.filter((_, j) => j !== i) })} aria-label="Xóa">
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Thêm mục: Ghế trẻ em…" />
            <Button
              variant="secondary"
              onClick={() => {
                if (!newItem.trim()) return;
                setF({ ...f, checklist: [...f.checklist, newItem.trim()] });
                setNewItem('');
              }}
            >
              <Plus />
            </Button>
          </div>
        </CardBody>
      </Card>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

// ── Tài khoản ────────────────────────────────────────────────────────────────

function AccountSection() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/auth/password', { current, next });
      toast.success('Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.');
      setCurrent('');
      setNext('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader title={user.displayName} description={`Tên đăng nhập: ${user.username}`} />
      <CardBody className="max-w-sm space-y-4">
        <Field label="Mật khẩu hiện tại">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button onClick={save} loading={saving} disabled={!current || next.length < 8}>
          Đổi mật khẩu
        </Button>
      </CardBody>
    </Card>
  );
}
