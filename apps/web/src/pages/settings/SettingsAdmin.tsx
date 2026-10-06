import { useQuery } from '@tanstack/react-query';
import { Bell, HardDrive, Plus, Send, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, InfoRow, Notice, PageLoader } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useAction, useAuth } from '@/lib/hooks';
import type { UserRow } from '@/lib/types';
import { fmtBytes } from '@/lib/utils';
import { ROLE_LABEL, type Role } from '@shared/constants';
import { fmtDateTime } from '@shared/time';

// ── Người dùng ───────────────────────────────────────────────────────────────

export function SettingsUsers() {
  const { user: me } = useAuth();
  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/api/users') });
  const [edit, setEdit] = useState<{ id?: number; username: string; displayName: string; role: Role; password: string; active: boolean } | null>(null);
  const save = useAction(
    () =>
      edit!.id
        ? api.patch(`/api/users/${edit!.id}`, { displayName: edit!.displayName, role: edit!.role, active: edit!.active, ...(edit!.password ? { password: edit!.password } : {}) })
        : api.post('/api/users', { username: edit!.username, displayName: edit!.displayName, role: edit!.role, password: edit!.password }),
    { invalidate: [['users']], success: 'Đã lưu', onSuccess: () => setEdit(null) },
  );
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <Notice tone="blue">
        Nhân viên giao xe dùng được: đặt xe, giao/nhận xe, thu tiền, thêm khách, tra phạt nguội. Không xem được báo cáo doanh thu, cài đặt, sao lưu. Điện thoại nhân viên cần cài Tailscale và được mời vào mạng.
      </Notice>
      <Card>
        <CardHeader title="Tài khoản" action={<Button size="sm" onClick={() => setEdit({ username: '', displayName: '', role: 'staff', password: '', active: true })}><Plus /> Thêm</Button>} />
        <ul className="divide-y divide-border">
          {data.map((u) => (
            <li key={u.id}>
              <button onClick={() => setEdit({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, password: '', active: u.active })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 md:px-5">
                <UserRound className="size-5 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {u.displayName} {u.id === me.id && <span className="text-xs text-muted">(bạn)</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {u.username} · {u.lastLoginAt ? `đăng nhập ${fmtDateTime(u.lastLoginAt)}` : 'chưa đăng nhập'}
                  </p>
                </div>
                <Badge tone={u.role === 'admin' ? 'violet' : 'gray'}>{ROLE_LABEL[u.role]}</Badge>
                {!u.active && <Badge tone="red">Đã khóa</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? 'Sửa tài khoản' : 'Thêm tài khoản'} footer={<Button onClick={() => save.mutate()} loading={save.isPending}>Lưu</Button>}>
        {edit && (
          <div className="space-y-4">
            {!edit.id && (
              <Field label="Tên đăng nhập" hint="Chữ thường không dấu">
                <Input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} autoCapitalize="none" />
              </Field>
            )}
            <Field label="Tên hiển thị">
              <Input value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />
            </Field>
            <Field label="Quyền">
              <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })} disabled={edit.id === me.id}>
                <option value="staff">Nhân viên</option>
                <option value="admin">Quản trị</option>
              </Select>
            </Field>
            <Field label={edit.id ? 'Đặt lại mật khẩu' : 'Mật khẩu'} hint={edit.id ? 'Để trống nếu không đổi' : 'Tối thiểu 8 ký tự'}>
              <Input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
            {edit.id && edit.id !== me.id && <Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Cho phép đăng nhập" description="Tắt khi nhân viên nghỉ việc" />}
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ── Telegram ─────────────────────────────────────────────────────────────────

interface TelegramState {
  configured: boolean;
  maskedToken: string;
  chatId: string;
  notify: boolean;
  dailyDigest: boolean;
  digestHour: number;
}

export function SettingsTelegram() {
  const { data } = useQuery({ queryKey: ['telegram'], queryFn: () => api.get<TelegramState>('/api/system/telegram') });
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  useEffect(() => {
    if (data) setChatId(data.chatId);
  }, [data]);
  const save = useAction((body: Record<string, unknown>) => api.put('/api/system/telegram', body), { invalidate: [['telegram']], success: 'Đã lưu', onSuccess: () => setToken('') });
  const test = useAction(() => api.post('/api/system/telegram/test'), { success: 'Đã gửi tin thử — kiểm tra Telegram' });
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={Bell} title="Kết nối bot" description={data.configured ? `Đã kết nối · token ${data.maskedToken}` : 'Chưa kết nối'} />
        <CardBody className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Mở Telegram, chat với <b>@BotFather</b> → <code>/newbot</code> → nhận token.
            </li>
            <li>Nhắn một tin bất kỳ cho bot vừa tạo.</li>
            <li>
              Lấy chat ID của bạn từ <b>@userinfobot</b> (hoặc ID nhóm nếu muốn gửi vào nhóm).
            </li>
          </ol>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bot token" hint={data.configured ? 'Để trống nếu giữ token cũ' : undefined}>
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF…" />
            </Field>
            <Field label="Chat ID">
              <Input value={chatId} onChange={(e) => setChatId(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate({ ...(token ? { botToken: token } : {}), chatId })} loading={save.isPending}>
              Lưu
            </Button>
            <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={!data.configured}>
              <Send /> Gửi tin thử
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Nhận thông báo gì" />
        <CardBody className="space-y-4">
          <Switch checked={data.notify} onChange={(v) => save.mutate({ notify: v })} label="Sự kiện" description="Đặt xe mới, giao/nhận xe, sắp đến giờ trả, quá hạn trả, phạt nguội mới, có bản cập nhật" />
          <Switch checked={data.dailyDigest} onChange={(v) => save.mutate({ dailyDigest: v })} label="Bản tin buổi sáng" description="Việc trong ngày, giấy tờ xe sắp hết hạn, cọc đến hạn hoàn" />
          {data.dailyDigest && (
            <Field label="Giờ gửi bản tin" className="max-w-40">
              <Select value={data.digestHour} onChange={(e) => save.mutate({ digestHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardBody>
      </Card>
      <p className="text-xs text-muted">Sao lưu qua Telegram cấu hình ở mục Sao lưu.</p>
    </div>
  );
}

// ── Hệ thống & nhật ký ───────────────────────────────────────────────────────

interface SystemInfo {
  version: string;
  commit: string;
  buildTime: string;
  uptimeSec: number;
  node: string;
  dataDir: string;
  sizes: { db: number; uploads: number; backups: number };
  disk: { free: number; total: number } | null;
  stats: { customers: number; vehicles: number; rentals: number };
  pdfService: 'ok' | 'down' | 'disabled';
}

interface AuditItem {
  id: number;
  at: number;
  userId: number | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
  ip: string | null;
}

export function SettingsSystem() {
  const { data: info } = useQuery({ queryKey: ['system-info'], queryFn: () => api.get<SystemInfo>('/api/system/info') });
  const [before, setBefore] = useState<number | undefined>();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [users, setUsers] = useState<{ id: number; displayName: string }[]>([]);
  const { data: audit, isFetching } = useQuery({
    queryKey: ['audit', before],
    queryFn: () => api.get<{ items: AuditItem[]; users: { id: number; displayName: string }[] }>(`/api/system/audit${qs({ before, limit: 50 })}`),
  });
  useEffect(() => {
    if (!audit) return;
    setItems((cur) => (before ? [...cur, ...audit.items.filter((a) => !cur.some((c) => c.id === a.id))] : audit.items));
    setUsers((cur) => [...cur, ...audit.users.filter((u) => !cur.some((c) => c.id === u.id))]);
  }, [audit, before]);
  if (!info) return <PageLoader />;
  const up = info.uptimeSec;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={HardDrive} title="Máy chủ" />
        <CardBody className="grid gap-x-8 sm:grid-cols-2">
          <div className="divide-y divide-border">
            <InfoRow label="Phiên bản">
              v{info.version} {info.commit && <span className="font-mono text-xs text-muted">({info.commit.slice(0, 7)})</span>}
            </InfoRow>
            <InfoRow label="Đã chạy">{up > 86400 ? `${Math.floor(up / 86400)} ngày` : `${Math.floor(up / 3600)} giờ ${Math.floor((up % 3600) / 60)} phút`}</InfoRow>
            <InfoRow label="Dịch vụ PDF">
              <Badge tone={info.pdfService === 'ok' ? 'green' : info.pdfService === 'down' ? 'red' : 'gray'}>{info.pdfService === 'ok' ? 'Hoạt động' : info.pdfService === 'down' ? 'Không phản hồi' : 'Chưa cấu hình'}</Badge>
            </InfoRow>
            <InfoRow label="Dữ liệu">
              {info.stats.customers} khách · {info.stats.vehicles} xe · {info.stats.rentals} lượt thuê
            </InfoRow>
          </div>
          <div className="divide-y divide-border">
            <InfoRow label="Database">{fmtBytes(info.sizes.db)}</InfoRow>
            <InfoRow label="Ảnh & văn bản">{fmtBytes(info.sizes.uploads)}</InfoRow>
            <InfoRow label="Bản sao lưu">{fmtBytes(info.sizes.backups)}</InfoRow>
            {info.disk && (
              <InfoRow label="Ổ đĩa còn trống">
                {fmtBytes(info.disk.free)} / {fmtBytes(info.disk.total)}
              </InfoRow>
            )}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Nhật ký thao tác" description="Ai làm gì, lúc nào — kể cả mỗi lần xem ảnh CCCD" />
        <ul className="divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="px-4 py-2.5 text-sm md:px-5">
              <p>
                <b>{users.find((u) => u.id === a.userId)?.displayName ?? 'Hệ thống'}</b> · <span className="font-mono text-xs">{a.action}</span>
                {a.entity && (
                  <span className="text-muted">
                    {' '}
                    · {a.entity} #{a.entityId}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                {fmtDateTime(a.at)} {a.ip && `· ${a.ip}`}
              </p>
              {a.detail && <p className="mt-0.5 line-clamp-2 font-mono text-[11px] break-all text-subtle">{a.detail}</p>}
            </li>
          ))}
        </ul>
        {audit && audit.items.length === 50 && (
          <CardBody className="flex justify-center pt-3">
            <Button variant="outline" size="sm" loading={isFetching} onClick={() => setBefore(items.at(-1)?.id)}>
              Xem cũ hơn
            </Button>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
