import { useQuery } from '@tanstack/react-query';
import { CloudUpload, Database, Download, Eye, HardDriveUpload, KeyRound, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, InfoRow, Notice, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { errorMessage, fmtBytes } from '@/lib/utils';
import { fmtDateKey, fmtDateTime } from '@shared/time';

interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
  tag: string;
  note: string | null;
  appVersion: string | null;
}
interface BackupData {
  items: BackupInfo[];
  config: {
    nightlyHour: number;
    keepDaily: number;
    keepMonthly: number;
    telegramEnabled: boolean;
    hasPassphrase: boolean;
    lastLocalDate: string | null;
    lastTelegramDate: string | null;
    lastTelegramError: string | null;
    filesSyncedUntil: number | null;
  };
}
interface Stats {
  customers: number;
  vehicles: number;
  rentals: number;
  lastRentalAt: number | null;
}

const TAG: Record<string, { label: string; tone: 'gray' | 'blue' | 'amber' | 'violet' | 'green' }> = {
  nightly: { label: 'Hằng đêm', tone: 'gray' },
  manual: { label: 'Thủ công', tone: 'blue' },
  'pre-update': { label: 'Trước cập nhật', tone: 'violet' },
  'pre-restore': { label: 'Trước khôi phục', tone: 'amber' },
  uploaded: { label: 'Tải lên', tone: 'green' },
};

export function SettingsBackup() {
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupData>('/api/system/backups') });
  const [preview, setPreview] = useState<{ name: string; backup: Stats; current: Stats } | null>(null);
  const [pass, setPass] = useState('');
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upPass, setUpPass] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inv = { invalidate: [['backups'], ['system-info']] };

  const create = useAction(() => api.post<BackupInfo>('/api/system/backups'), { ...inv, success: 'Đã sao lưu' });
  const remove = useAction((name: string) => api.del(`/api/system/backups/${name}`), { ...inv, success: 'Đã xóa' });
  const restore = useAction((name: string) => api.post<{ stats: Stats }>(`/api/system/backups/${name}/restore`), {
    invalidate: [['backups'], ['dashboard'], ['customers'], ['rentals'], ['vehicles']],
    success: (r) => `Đã khôi phục: ${r.stats.customers} khách, ${r.stats.rentals} lượt thuê`,
    onSuccess: () => setPreview(null),
  });
  const saveCfg = useAction((body: Record<string, unknown>) => api.put('/api/system/backups/config', body), { ...inv, success: 'Đã lưu', onSuccess: () => setPass('') });
  const sendNow = useAction(() => api.post<{ dbBytes: number; files: number; parts: number }>('/api/system/telegram/backup'), {
    ...inv,
    success: (r) => `Đã gửi lên Telegram: dữ liệu ${fmtBytes(r.dbBytes)} + ${r.files} file ảnh/văn bản (${r.parts} gói)`,
  });

  const openPreview = async (name: string) => {
    try {
      const r = await api.get<{ backup: Stats; current: Stats }>(`/api/system/backups/${name}/preview`);
      setPreview({ name, ...r });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const uploadRestore = async () => {
    if (!upFile) return;
    if (!(await confirm({ title: 'Khôi phục từ file?', description: 'Nếu là file dữ liệu, toàn bộ dữ liệu hiện tại được thay bằng file này (bản hiện tại được tự sao lưu trước). Nếu là gói ảnh, ảnh còn thiếu sẽ được chép vào.', danger: true, confirmText: 'Khôi phục' }))) return;
    setUploading(true);
    try {
      const form = new FormData();
      if (upPass) form.append('passphrase', upPass);
      form.append('file', upFile);
      const r = await api.form<{ kind: 'db' | 'files'; stats?: Stats; files?: number; total?: number }>('/api/system/backups/upload', form);
      toast.success(r.kind === 'db' ? `Đã khôi phục dữ liệu: ${r.stats?.rentals} lượt thuê` : `Đã chép ${r.files}/${r.total} file`);
      setUpFile(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  if (isLoading || !data) return <PageLoader />;
  const c = data.config;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={Database} title="Sao lưu trên Pi" description={c.lastLocalDate ? `Bản đêm gần nhất: ${fmtDateKey(c.lastLocalDate)}` : 'Chưa có bản sao lưu đêm nào'} action={<Button size="sm" onClick={() => create.mutate()} loading={create.isPending}>Sao lưu ngay</Button>} />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Giờ sao lưu hằng đêm">
            <Select value={c.nightlyHour} onChange={(e) => saveCfg.mutate({ nightlyHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Giữ bản hằng đêm">
            <NumberInput value={c.keepDaily} onChange={(v) => v && v >= 3 && saveCfg.mutate({ keepDaily: v })} suffix="bản" />
          </Field>
          <Field label="Giữ bản đầu tháng">
            <NumberInput value={c.keepMonthly} onChange={(v) => v != null && saveCfg.mutate({ keepMonthly: v })} suffix="tháng" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={CloudUpload} title="Gửi ra ngoài Pi qua Telegram" description="Pi hỏng / mất thẻ nhớ vẫn còn dữ liệu. File được mã hóa vì chứa thông tin CCCD khách." />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={c.hasPassphrase ? 'Đổi mật khẩu mã hóa' : 'Đặt mật khẩu mã hóa'} className="min-w-60 flex-1" hint="Tối thiểu 8 ký tự">
              <Input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={c.hasPassphrase ? '•••••••• (đã đặt)' : ''} />
            </Field>
            <Button variant="outline" onClick={() => saveCfg.mutate({ passphrase: pass })} disabled={pass.length < 8} loading={saveCfg.isPending}>
              <KeyRound /> Lưu mật khẩu
            </Button>
          </div>
          <Notice tone="amber">Ghi mật khẩu này ra giấy / trình quản lý mật khẩu. Mất mật khẩu = không mở được bản sao lưu trên Telegram.</Notice>
          <Switch checked={c.telegramEnabled} onChange={(v) => saveCfg.mutate({ telegramEnabled: v })} disabled={!c.hasPassphrase} label="Tự gửi mỗi đêm" description="Gửi bản dữ liệu đầy đủ + ảnh, văn bản mới phát sinh (chia gói ≤ 40MB)" />
          <div className="divide-y divide-border rounded-2xl border border-border px-4 py-1">
            <InfoRow label="Lần gửi thành công gần nhất">{c.lastTelegramDate ? fmtDateKey(c.lastTelegramDate) : 'Chưa gửi'}</InfoRow>
            <InfoRow label="Ảnh đã gửi đến">{c.filesSyncedUntil ? fmtDateTime(c.filesSyncedUntil) : '—'}</InfoRow>
            {c.lastTelegramError && <InfoRow label="Lỗi gần nhất"><span className="text-red-600">{c.lastTelegramError}</span></InfoRow>}
          </div>
          <Button variant="outline" onClick={() => sendNow.mutate()} loading={sendNow.isPending} disabled={!c.hasPassphrase}>
            <Send /> Gửi lên Telegram ngay
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Các bản sao lưu" description={`${data.items.length} bản`} />
        <ul className="divide-y divide-border">
          {data.items.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {fmtDateTime(b.createdAt)} <Badge tone={TAG[b.tag]?.tone ?? 'gray'}>{TAG[b.tag]?.label ?? b.tag}</Badge>
                </p>
                <p className="text-xs text-muted">
                  {fmtBytes(b.size)}
                  {b.appVersion && ` · v${b.appVersion}`}
                  {b.note && ` · ${b.note}`}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="icon-sm" variant="ghost" onClick={() => openPreview(b.name)} aria-label="Xem & khôi phục">
                  <Eye />
                </Button>
                <a href={`/api/system/backups/${b.name}/download`} className="flex size-8 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Tải về">
                  <Download className="size-4" />
                </a>
                <Button size="icon-sm" variant="ghost" onClick={async () => (await confirm({ title: 'Xóa bản sao lưu này?', danger: true, confirmText: 'Xóa' })) && remove.mutate(b.name)} aria-label="Xóa">
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader icon={HardDriveUpload} title="Khôi phục từ file" description="File .sqlite.gz tải từ trang này, hoặc file .crbk lấy từ Telegram" />
        <CardBody className="space-y-3">
          <input ref={fileRef} type="file" accept=".gz,.crbk,.sqlite" className="hidden" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} />
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => fileRef.current?.click()}>
            {upFile ? upFile.name : 'Chọn file'}
          </Button>
          {upFile?.name.endsWith('.crbk') && (
            <Field label="Mật khẩu mã hóa" hint="Để trống nếu là mật khẩu đang cài trên máy này">
              <Input type="password" value={upPass} onChange={(e) => setUpPass(e.target.value)} />
            </Field>
          )}
          {upFile && (
            <Button variant="danger" onClick={uploadRestore} loading={uploading}>
              <RotateCcw /> Khôi phục
            </Button>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title="Khôi phục bản sao lưu?"
        description="Dữ liệu hiện tại sẽ được thay bằng bản này. Bản hiện tại được tự sao lưu trước."
        footer={
          <Button variant="danger" onClick={() => preview && restore.mutate(preview.name)} loading={restore.isPending}>
            <RotateCcw /> Khôi phục
          </Button>
        }
      >
        {preview && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(['current', 'backup'] as const).map((k) => (
              <div key={k} className="rounded-2xl border border-border p-3">
                <p className="mb-2 font-medium">{k === 'current' ? 'Đang dùng' : 'Bản sao lưu'}</p>
                <p>{preview[k].customers} khách hàng</p>
                <p>{preview[k].vehicles} xe</p>
                <p>{preview[k].rentals} lượt thuê</p>
                <p className="text-xs text-muted">Lượt gần nhất: {preview[k].lastRentalAt ? fmtDateTime(preview[k].lastRentalAt) : '—'}</p>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}
