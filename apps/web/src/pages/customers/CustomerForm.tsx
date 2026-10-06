import { IdCard, ScanLine, UserCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CccdScanner } from '@/components/CccdScanner';
import { PhotoInput } from '@/components/images';
import { Button } from '@/components/ui/button';
import { Checkbox, DateInput, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/hooks';
import type { Customer, Warning } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import type { CccdData } from '@shared/cccd';
import { LICENSE_CLASSES } from '@shared/constants';

type FormState = Partial<Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'>>;

const ID_TYPES = [
  { value: 'cccd_chip', label: 'CCCD gắn chip' },
  { value: 'can_cuoc', label: 'Thẻ Căn cước (từ 7/2024)' },
  { value: 'cccd', label: 'CCCD mã vạch' },
  { value: 'cmnd', label: 'CMND' },
  { value: 'passport', label: 'Hộ chiếu' },
  { value: 'other', label: 'Khác' },
];

function Section({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function CustomerForm({
  initial,
  onSaved,
  onPickExisting,
  autoScan,
  compact,
  submitLabel = 'Lưu khách hàng',
}: {
  initial?: Customer | null;
  onSaved: (c: Customer) => void;
  /** Khi quét trúng khách đã có: chọn luôn khách đó (dùng trong form đặt xe). */
  onPickExisting?: (c: Customer) => void;
  autoScan?: boolean;
  compact?: boolean;
  submitLabel?: string;
}) {
  const { isAdmin } = useAuth();
  const [f, setF] = useState<FormState>(() => initial ?? { idCardType: 'cccd_chip' });
  const [scanOpen, setScanOpen] = useState(!!autoScan);
  const [existing, setExisting] = useState<{ customer: Customer; warnings: Warning[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [noExpiry, setNoExpiry] = useState(!!initial?.licenseNumber && !initial.licenseExpiry);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const text = (k: keyof FormState) => ({ value: (f[k] as string | null | undefined) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  useEffect(() => {
    if (initial) setF(initial);
  }, [initial]);

  const onScan = async (d: CccdData) => {
    setF((s) => ({ ...s, ...d }));
    toast.success(`Đã đọc CCCD: ${d.fullName}`);
    try {
      const r = await api.get<{ customer: Customer | null; warnings: Warning[] }>(`/api/customers/lookup?idNumber=${d.idNumber}`);
      if (r.customer && r.customer.id !== initial?.id) setExisting({ customer: r.customer, warnings: r.warnings });
    } catch {
      /* tra cứu phụ, bỏ qua lỗi */
    }
  };

  const save = async () => {
    if (!f.fullName?.trim()) return toast.error('Nhập họ tên khách');
    setSaving(true);
    try {
      const body = { ...f, licenseExpiry: noExpiry ? null : (f.licenseExpiry ?? null) };
      const c = initial ? await api.patch<Customer>(`/api/customers/${initial.id}`, body) : await api.post<Customer>('/api/customers', body);
      toast.success(initial ? 'Đã lưu thay đổi' : `Đã thêm khách ${c.fullName}`);
      onSaved(c);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate' && err.data?.existingId) {
        const c = await api.get<{ customer: Customer; warnings: Warning[] }>(`/api/customers/${err.data.existingId}`);
        setExisting({ customer: c.customer, warnings: c.warnings });
      }
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const grid = compact ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => setScanOpen(true)}
        className="flex w-full items-center gap-4 rounded-2xl border border-brand/30 bg-brand-soft p-4 text-left transition-colors hover:border-brand"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg">
          <ScanLine className="size-6" />
        </span>
        <span>
          <span className="block font-semibold text-brand">Quét QR trên căn cước</span>
          <span className="block text-sm text-muted">Tự điền số CCCD, họ tên, ngày sinh, địa chỉ, ngày cấp</span>
        </span>
      </button>

      {existing && (
        <Notice tone={existing.customer.blacklisted ? 'red' : 'blue'} icon={UserCheck}>
          <p className="font-medium">
            Khách {existing.customer.fullName} đã có hồ sơ{existing.customer.blacklisted && ' — NẰM TRONG DANH SÁCH ĐEN'}
          </p>
          {existing.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {existing.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {onPickExisting ? (
              <Button size="sm" onClick={() => onPickExisting(existing.customer)}>
                Chọn khách này
              </Button>
            ) : (
              <Link to={`/customers/${existing.customer.id}`} className="text-sm font-medium underline">
                Mở hồ sơ cũ
              </Link>
            )}
          </div>
        </Notice>
      )}

      <Section title="Giấy tờ tùy thân" icon={<IdCard className="size-4" />}>
        <div className={grid}>
          <Field label="Họ và tên" required className="sm:col-span-2 lg:col-span-1">
            <Input {...text('fullName')} placeholder="Nguyễn Văn A" autoCapitalize="words" />
          </Field>
          <Field label="Số CCCD">
            <Input {...text('idNumber')} inputMode="numeric" placeholder="12 số" />
          </Field>
          <Field label="Loại giấy tờ">
            <Select value={f.idCardType ?? ''} onChange={(e) => set('idCardType', (e.target.value || null) as never)}>
              {ID_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ngày sinh">
            <DateInput value={f.dob} onChange={(v) => set('dob', v)} />
          </Field>
          <Field label="Giới tính">
            <Select value={f.gender ?? ''} onChange={(e) => set('gender', e.target.value || null)}>
              <option value="">—</option>
              <option>Nam</option>
              <option>Nữ</option>
            </Select>
          </Field>
          <Field label="Ngày cấp">
            <DateInput value={f.idIssueDate} onChange={(v) => set('idIssueDate', v)} />
          </Field>
          <Field label="Nơi cấp" className="sm:col-span-2">
            <Input {...text('idIssuePlace')} />
          </Field>
          <Field label="Nơi thường trú" className="sm:col-span-2 lg:col-span-3">
            <Input {...text('permanentAddress')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <PhotoInput kind="id_front" label="Mặt trước CCCD" value={f.idFrontFileId} onChange={(v) => set('idFrontFileId', v)} />
          <PhotoInput kind="id_back" label="Mặt sau CCCD" value={f.idBackFileId} onChange={(v) => set('idBackFileId', v)} />
        </div>
      </Section>

      <Section title="Liên hệ">
        <div className={grid}>
          <Field label="Số điện thoại">
            <Input {...text('phone')} type="tel" inputMode="tel" />
          </Field>
          <Field label="Zalo" hint="Để trống nếu trùng SĐT">
            <Input {...text('zalo')} type="tel" inputMode="tel" />
          </Field>
          <Field label="SĐT phụ">
            <Input {...text('phone2')} type="tel" inputMode="tel" />
          </Field>
          <Field label="Chỗ ở hiện tại" className="sm:col-span-2">
            <Input {...text('currentAddress')} placeholder="Nếu khác nơi thường trú" />
          </Field>
          <Field label="Email">
            <Input {...text('email')} type="email" />
          </Field>
          {!compact && (
            <Field label="Nghề nghiệp / nơi làm việc">
              <Input {...text('occupation')} />
            </Field>
          )}
        </div>
      </Section>

      <Section title="Giấy phép lái xe">
        <div className={grid}>
          <Field label="Số GPLX">
            <Input {...text('licenseNumber')} inputMode="numeric" />
          </Field>
          <Field label="Hạng">
            <Select value={f.licenseClass ?? ''} onChange={(e) => set('licenseClass', e.target.value || null)}>
              <option value="">—</option>
              {LICENSE_CLASSES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Có giá trị đến">
            {noExpiry ? <Input value="Không thời hạn" disabled /> : <DateInput value={f.licenseExpiry} onChange={(v) => set('licenseExpiry', v)} />}
            <Checkbox className="mt-2" checked={noExpiry} onChange={setNoExpiry} label="Không thời hạn" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <PhotoInput kind="license_front" label="Mặt trước GPLX" value={f.licenseFrontFileId} onChange={(v) => set('licenseFrontFileId', v)} />
          <PhotoInput kind="license_back" label="Mặt sau GPLX" value={f.licenseBackFileId} onChange={(v) => set('licenseBackFileId', v)} />
        </div>
      </Section>

      {!compact && (
        <Section title="Người liên hệ khẩn cấp">
          <div className={grid}>
            <Field label="Họ tên">
              <Input {...text('emergencyName')} />
            </Field>
            <Field label="Số điện thoại">
              <Input {...text('emergencyPhone')} type="tel" />
            </Field>
            <Field label="Quan hệ">
              <Input {...text('emergencyRelation')} placeholder="vợ, bố, bạn…" />
            </Field>
          </div>
        </Section>
      )}

      <Section title="Khác">
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <Field label="Ghi chú">
            <Textarea {...text('notes')} rows={3} />
          </Field>
          <PhotoInput kind="portrait" label="Ảnh chân dung" value={f.portraitFileId} onChange={(v) => set('portraitFileId', v)} aspect="aspect-square" camera />
        </div>
        {isAdmin && initial && (
          <div className="space-y-2 rounded-2xl border border-border p-4">
            <Switch checked={!!f.blacklisted} onChange={(v) => set('blacklisted', v)} label="Danh sách đen" description="Cảnh báo đỏ mỗi khi khách này đặt xe hoặc được quét CCCD" />
            {f.blacklisted && <Input {...text('blacklistReason')} placeholder="Lý do (bùng phạt nguội, làm hỏng xe…)" />}
          </div>
        )}
      </Section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex justify-end gap-2 rounded-2xl bg-bg/80 p-1 backdrop-blur lg:bottom-4">
        <Button size="lg" onClick={save} loading={saving} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>

      <CccdScanner open={scanOpen} onOpenChange={setScanOpen} onResult={onScan} />
    </div>
  );
}
