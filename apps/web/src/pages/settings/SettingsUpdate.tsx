// Phiên bản & cập nhật: kiểm tra bản mới, cập nhật một chạm, quay về bản cũ, tự cập nhật ban đêm.

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, History, Loader2, Power, RefreshCw, Rocket, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Switch } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, Notice, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { reloadIntoNewVersion, waitForVersion } from '@/lib/pwa';
import { errorMessage, relTime } from '@/lib/utils';
import { fmtDate, fmtDateTime } from '@shared/time';

interface Release {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  url: string;
  isCurrent: boolean;
  isNewer: boolean;
}
interface UpdateState {
  current: { version: string; commit: string; buildTime: string };
  updater: { alive: boolean; heartbeat: number | null; phase: string; requestId: string | null; result: string | null; message: string | null; current: string | null; previous: string | null; finishedAt: number | null; scriptVersion: string | null };
  pending: Record<string, string> | null;
  log: string;
  available: Release | null;
  releases: Release[];
  lastCheckAt: number | null;
  lastCheckError: string | null;
  autoUpdate: boolean;
  autoUpdateHour: number;
  repo: string;
  preUpdateBackups: { name: string; createdAt: number; note: string | null }[];
}

const PHASE: Record<string, string> = {
  idle: 'Sẵn sàng',
  prepare: 'Chuẩn bị',
  pulling: 'Đang tải bản mới',
  restoring: 'Đang khôi phục dữ liệu',
  restarting: 'Đang khởi động lại',
  health: 'Đang kiểm tra bản mới',
  rolling_back: 'Bản mới lỗi — đang quay về bản cũ',
  done: 'Xong',
  failed: 'Thất bại',
  rolled_back: 'Đã quay về bản cũ',
};

function Changelog({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-sm text-muted">Không có ghi chú.</p>;
  return (
    <div className="space-y-1 text-sm">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith('#')) return <p key={i} className="pt-2 font-semibold">{t.replace(/^#+\s*/, '')}</p>;
        if (/^[-*]\s/.test(t)) return <p key={i} className="flex gap-2 pl-1"><span className="text-brand">•</span><span>{t.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}</span></p>;
        return <p key={i}>{t.replace(/\*\*/g, '')}</p>;
      })}
    </div>
  );
}

export function SettingsUpdate() {
  const confirm = useConfirm();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['update'], queryFn: () => api.get<UpdateState>('/api/system/update'), refetchInterval: 15_000 });
  const [progress, setProgress] = useState<{ target: string; msg: string; done?: boolean; failed?: string } | null>(null);
  const [rollback, setRollback] = useState<Release | null>(null);
  const [restoreData, setRestoreData] = useState(false);
  const [restoreName, setRestoreName] = useState('');
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const check = useAction(() => api.post<{ available: Release | null }>('/api/system/update/check'), {
    invalidate: [['update']],
    success: (r) => (r.available ? `Có bản mới v${r.available.version}` : 'Đang dùng bản mới nhất'),
  });
  const saveAuto = useAction((body: { autoUpdate: boolean; autoUpdateHour: number }) => api.put('/api/system/update/config', body), { invalidate: [['update']], success: 'Đã lưu' });
  const restart = useAction(() => api.post('/api/system/restart'), { success: 'Đã gửi yêu cầu khởi động lại' });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data?.log, showLog]);

  const run = async (target: string, restoreBackup: string | null) => {
    setProgress({ target, msg: 'Đang sao lưu dữ liệu…' });
    let requestId = '';
    try {
      requestId = (await api.post<{ requestId: string }>('/api/system/update/apply', { version: target, restoreBackup })).requestId;
    } catch (err) {
      setProgress({ target, msg: '', failed: errorMessage(err) });
      return;
    }
    // Theo dõi pha của updater cho tới khi máy chủ chạy bản đích.
    const poll = setInterval(async () => {
      try {
        const s = await api.get<UpdateState>('/api/system/update');
        // Updater ghi kết quả gắn với đúng requestId của lần bấm này.
        if (s.updater.requestId === requestId && s.updater.finishedAt && s.updater.result && s.updater.result !== 'ok') {
          clearInterval(poll);
          setProgress({ target, msg: '', failed: s.updater.message ?? 'Cập nhật thất bại' });
          void refetch();
        } else setProgress((p) => (p && !p.done ? { ...p, msg: PHASE[s.updater.phase] ?? s.updater.phase } : p));
      } catch {
        /* máy chủ đang khởi động lại */
      }
    }, 2500);
    const ok = await waitForVersion(target, (msg) => setProgress((p) => (p && !p.done && !p.failed ? { ...p, msg } : p)));
    clearInterval(poll);
    if (ok) {
      setProgress({ target, msg: 'Đã cập nhật xong. Đang tải lại…', done: true });
      setTimeout(() => void reloadIntoNewVersion(), 1500);
    } else setProgress((p) => (p?.failed ? p : { target, msg: '', failed: 'Quá thời gian chờ. Xem nhật ký cập nhật bên dưới.' }));
  };

  if (isLoading || !data) return <PageLoader />;
  const u = data.updater;
  const busy = !!data.pending || !['idle', 'done', 'failed', 'rolled_back', 'unknown'].includes(u.phase);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4 pt-4">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Rocket className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">Đang chạy</p>
            <p className="text-2xl font-semibold">v{data.current.version}</p>
            <p className="text-xs text-muted">
              {data.current.commit ? `commit ${data.current.commit.slice(0, 7)}` : 'bản dev'}
              {data.current.buildTime && ` · build ${fmtDateTime(Date.parse(data.current.buildTime))}`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" onClick={() => check.mutate()} loading={check.isPending}>
              <RefreshCw /> Kiểm tra bản mới
            </Button>
            <p className="text-xs text-muted">{data.lastCheckAt ? `Kiểm tra ${relTime(data.lastCheckAt)}` : 'Chưa kiểm tra'}</p>
          </div>
        </CardBody>
        {data.lastCheckError && (
          <CardBody>
            <Notice tone="amber">Không kiểm tra được: {data.lastCheckError}</Notice>
          </CardBody>
        )}
      </Card>

      {!u.alive && (
        <Notice tone="amber" icon={CircleAlert}>
          <p className="font-medium">Dịch vụ cập nhật chưa chạy</p>
          <p className="mt-1">
            Nút cập nhật cần container <code>car-rental-updater</code> (có sẵn trong <code>docker-compose.yml</code> khi cài bằng <code>setup.sh</code>). Trên Pi, trong thư mục <code>~/car-rental</code> chạy một lần: <code className="font-mono">docker compose up -d</code>
          </p>
        </Notice>
      )}

      {progress && (
        <Card className={progress.failed ? 'border-red-300' : progress.done ? 'border-emerald-300' : 'border-brand/40'}>
          <CardBody className="flex items-center gap-3 pt-4">
            {progress.failed ? <CircleAlert className="size-6 text-red-600" /> : progress.done ? <CheckCircle2 className="size-6 text-emerald-600" /> : <Loader2 className="size-6 animate-spin text-brand" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{progress.failed ? `Cập nhật v${progress.target} không thành công` : progress.done ? `Đã lên v${progress.target}` : `Đang cập nhật lên v${progress.target}`}</p>
              <p className="text-sm text-muted">{progress.failed ?? progress.msg}</p>
              {!progress.failed && !progress.done && <p className="mt-1 text-xs text-subtle">Đừng đóng trang. App tạm ngưng khoảng 1–2 phút.</p>}
            </div>
            {progress.failed && (
              <Button variant="ghost" size="sm" onClick={() => setProgress(null)}>
                Đóng
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {data.available && !progress && (
        <Card className="border-brand/40">
          <CardHeader title={`Có bản mới v${data.available.version}`} description={`Phát hành ${fmtDate(Date.parse(data.available.publishedAt))}`} />
          <CardBody className="space-y-4">
            <Changelog text={data.available.notes} />
            <Notice tone="blue">Trước khi cập nhật app tự sao lưu dữ liệu. Nếu bản mới khởi động lỗi, app tự quay về bản cũ.</Notice>
            <Button
              size="lg"
              disabled={!u.alive || busy}
              onClick={async () => {
                if (await confirm({ title: `Cập nhật lên v${data.available!.version}?`, description: 'App tạm ngưng 1–2 phút. Tránh cập nhật khi đang giao/nhận xe.', confirmText: 'Cập nhật' })) void run(data.available!.version, null);
              }}
            >
              <Rocket /> Cập nhật ngay
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Tự cập nhật ban đêm" description="Bỏ qua đêm đó nếu có lượt giao/nhận xe trong 2 giờ tới" />
        <CardBody className="flex flex-wrap items-center gap-4">
          <Switch checked={data.autoUpdate} onChange={(v) => saveAuto.mutate({ autoUpdate: v, autoUpdateHour: data.autoUpdateHour })} label="Bật tự cập nhật" disabled={!u.alive} />
          <Field label="Lúc" className="w-32">
            <Select value={data.autoUpdateHour} onChange={(e) => saveAuto.mutate({ autoUpdate: data.autoUpdate, autoUpdateHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={History} title="Các phiên bản" description={`Từ github.com/${data.repo}`} />
        {data.releases.length ? (
          <ul className="divide-y divide-border">
            {data.releases.map((r) => (
              <li key={r.version} className="px-4 py-3 md:px-5">
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        v{r.version} {r.isCurrent && <Badge tone="green">Đang chạy</Badge>} {r.isNewer && <Badge tone="blue">Mới hơn</Badge>} {r.prerelease && <Badge tone="amber">Thử nghiệm</Badge>}
                      </span>
                      <span className="text-xs text-muted">{fmtDate(Date.parse(r.publishedAt))}</span>
                    </span>
                    {!r.isCurrent && (
                      <Button
                        size="sm"
                        variant={r.isNewer ? 'primary' : 'outline'}
                        disabled={!u.alive || busy || !!progress}
                        onClick={(e) => {
                          e.preventDefault();
                          if (r.isNewer) void confirm({ title: `Cập nhật lên v${r.version}?`, confirmText: 'Cập nhật' }).then((ok) => {
                            if (ok) void run(r.version, null);
                          });
                          else {
                            setRestoreData(false);
                            setRestoreName(data.preUpdateBackups[0]?.name ?? '');
                            setRollback(r);
                          }
                        }}
                      >
                        {r.isNewer ? 'Cập nhật' : 'Quay về bản này'}
                      </Button>
                    )}
                  </summary>
                  <div className="mt-3 rounded-xl bg-surface-2 p-3">
                    <Changelog text={r.notes} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="text-sm text-muted">Chưa có thông tin phiên bản. Bấm "Kiểm tra bản mới".</p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={Terminal}
          title="Dịch vụ cập nhật"
          description={u.alive ? `${PHASE[u.phase] ?? u.phase} · tín hiệu ${u.heartbeat ? relTime(u.heartbeat) : '—'}` : 'Không chạy'}
          action={
            <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>
              {showLog ? 'Ẩn nhật ký' : 'Xem nhật ký'}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {u.result && (
            <p className="text-sm">
              Lần gần nhất: <b>{u.result === 'ok' ? 'thành công' : u.result === 'rolled_back' ? 'lỗi, đã quay về bản cũ' : 'thất bại'}</b>
              {u.finishedAt && ` · ${fmtDateTime(u.finishedAt)}`}
              {u.message && ` · ${u.message}`}
            </p>
          )}
          {showLog && <pre ref={logRef} className="max-h-80 overflow-auto rounded-xl bg-[#0b0d12] p-3 font-mono text-xs leading-relaxed text-emerald-200">{data.log || '(trống)'}</pre>}
          <Button
            variant="outline"
            size="sm"
            disabled={!u.alive || busy}
            onClick={async () => {
              if (await confirm({ title: 'Khởi động lại app?', description: 'App tạm ngưng khoảng 30 giây.' })) {
                restart.mutate();
                toast.info('Đang khởi động lại…');
                setTimeout(() => void reloadIntoNewVersion(), 20_000);
              }
            }}
          >
            <Power /> Khởi động lại app
          </Button>
        </CardBody>
      </Card>

      <Dialog
        open={!!rollback}
        onOpenChange={(o) => !o && setRollback(null)}
        title={`Quay về v${rollback?.version}?`}
        description="Dùng khi bản mới có lỗi. Dữ liệu nhập sau khi cập nhật vẫn giữ, trừ khi chọn khôi phục dữ liệu."
        footer={
          <Button
            variant="danger"
            onClick={() => {
              const target = rollback!.version;
              setRollback(null);
              void run(target, restoreData ? restoreName : null);
            }}
          >
            Quay về
          </Button>
        }
      >
        <div className="space-y-3">
          <Checkbox checked={restoreData} onChange={setRestoreData} label="Khôi phục cả dữ liệu về lúc trước khi cập nhật" description="Chỉ chọn khi bản mới làm hỏng dữ liệu. Mọi thứ nhập sau thời điểm đó sẽ mất, và cần đăng nhập lại." />
          {restoreData && (
            <Field label="Bản sao lưu">
              <Select value={restoreName} onChange={(e) => setRestoreName(e.target.value)}>
                {data.preUpdateBackups.map((b) => (
                  <option key={b.name} value={b.name}>
                    {fmtDateTime(b.createdAt)} {b.note && `· ${b.note}`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Dialog>
    </div>
  );
}
