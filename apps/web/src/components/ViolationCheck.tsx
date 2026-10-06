// Kiểm tra phạt nguội theo biển số: không cần biết giờ vi phạm.
// Tự tra qua dịch vụ tra cứu; dịch vụ lỗi → chép biển số, mở trang chính thức, dán kết quả.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardPaste, ExternalLink, FileCheck2, Search, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAction, useAuth } from '@/lib/hooks';
import type { FineAutoCheck, FleetCheckResult, MatchedViolation, VehicleWithStatus, ViolationCheckResult } from '@/lib/types';
import { cn, errorMessage, relTime, telLink } from '@/lib/utils';
import { plateKey } from '@shared/text';
import { fmtDateTime } from '@shared/time';
import { Button } from './ui/button';
import { Input, Select, Textarea } from './ui/form';
import { Badge, Card, CardBody, CardHeader, Notice, Spinner } from './ui/misc';

export const OFFICIAL_LOOKUP_URL = 'https://csgt.bocongan.gov.vn/tra-cuu-phat-nguoi';

function ViolationRow({ v, onRecord, recording }: { v: MatchedViolation; onRecord: () => void; recording: boolean }) {
  return (
    <li className="space-y-2 px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{v.violatedAt ? fmtDateTime(v.violatedAt) : v.timeText || 'Không rõ thời gian'}</p>
          {v.violation && <p className="text-sm">{v.violation}</p>}
          <p className="text-xs text-muted">{[v.location, v.unit].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {v.status === 'unpaid' && <Badge tone="red">Chưa xử phạt</Badge>}
          {v.status === 'paid' && <Badge>Đã xử phạt</Badge>}
          {v.recordedFineId ? (
            <Badge tone="green">
              <FileCheck2 className="size-3" /> Đã ghi hồ sơ
            </Badge>
          ) : (
            v.violatedAt != null && (
              <Button size="sm" variant={v.status === 'paid' ? 'outline' : 'primary'} onClick={onRecord} loading={recording}>
                Ghi hồ sơ
              </Button>
            )
          )}
        </div>
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-sm',
          v.renter ? 'bg-brand-soft' : v.verdict === 'blocked' ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-surface-2',
        )}
      >
        <UserRound className="size-4 shrink-0 text-muted" />
        {v.renter ? (
          <>
            <span>
              Người giữ xe: <Link to={`/customers/${v.renter.customerId}`} className="font-semibold hover:underline">{v.renter.fullName}</Link>
            </span>
            {v.renter.phone && (
              <a href={telLink(v.renter.phone)} className="text-brand">
                {v.renter.phone}
              </a>
            )}
            {v.rental && (
              <Link to={`/rentals/${v.rental.id}`} className="text-brand hover:underline">
                {v.rental.code}
              </Link>
            )}
          </>
        ) : (
          <span className="text-muted">
            {v.verdict === 'idle'
              ? 'Không có lượt thuê nào lúc đó — xe ở bãi theo dữ liệu đã ghi'
              : v.verdict === 'blocked'
                ? 'Lúc đó xe đang ở gara / tạm ngưng'
                : v.verdict === 'unknown_vehicle'
                  ? 'Biển số không có trong danh sách xe'
                  : 'Không đọc được giờ vi phạm'}
          </span>
        )}
      </div>
      {v.nearBoundary && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5" /> Sát giờ giao/nhận xe — đối chiếu ảnh và biên bản trước khi báo khách.
        </p>
      )}
    </li>
  );
}

export function ViolationCheck({ vehicles }: { vehicles: VehicleWithStatus[] }) {
  const { isAdmin } = useAuth();
  const [plate, setPlate] = useState(vehicles[0]?.plate ?? '');
  const [result, setResult] = useState<ViolationCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<number | 'all' | null>(null);
  const [fleet, setFleet] = useState<FleetCheckResult | null>(null);

  const qc = useQueryClient();
  const { data: auto } = useQuery({ queryKey: ['fine-auto-check'], queryFn: () => api.get<FineAutoCheck>('/api/fines/auto-check') });
  const setFrequency = useAction((frequency: FineAutoCheck['frequency']) => api.put('/api/fines/auto-check', { frequency }), { invalidate: [['fine-auto-check']], success: 'Đã lưu' });
  const runFleet = useAction(() => api.post<FleetCheckResult>('/api/fines/auto-check/run'), {
    invalidate: [['fines'], ['fine-auto-check'], ['dashboard']],
    onSuccess: (r) => {
      setFleet(r);
      if (r.ok) toast.success(`Đã kiểm tra ${r.checked} xe: ${r.found} vi phạm, ${r.recorded} mới ghi hồ sơ`);
      else toast.error(r.error ?? 'Không kiểm tra được');
    },
  });

  const check = async () => {
    if (plateKey(plate).length < 5) return toast.error('Chọn hoặc nhập biển số');
    setChecking(true);
    setResult(null);
    try {
      const r = await api.post<ViolationCheckResult>('/api/fines/check', { plate });
      setResult(r);
      if (!r.ok) setPasteOpen(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const readPasted = async () => {
    try {
      setResult(await api.post<ViolationCheckResult>('/api/fines/parse', { plate, text }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openOfficial = async () => {
    try {
      await navigator.clipboard.writeText(plateKey(plate));
      toast.success(`Đã chép biển số ${plateKey(plate)} — dán vào ô tra cứu`);
    } catch {
      /* không chép được thì người dùng tự gõ */
    }
    window.open(OFFICIAL_LOOKUP_URL, '_blank', 'noopener');
    setPasteOpen(true);
  };

  const record = async (items: MatchedViolation[], key: number | 'all') => {
    setRecording(key);
    try {
      const r = await api.post<{ created: number; skipped: number; ids: number[] }>('/api/fines/record', {
        plate: result?.plate ?? plate,
        items: items.map((v) => ({ violatedAt: v.violatedAt, location: v.location, violation: v.violation, statusText: v.statusText, unit: v.unit })),
      });
      toast.success(r.created ? `Đã ghi ${r.created} vi phạm vào hồ sơ` : 'Các vi phạm này đã có trong hồ sơ');
      setResult((prev) =>
        prev && {
          ...prev,
          violations: prev.violations.map((v) => {
            const i = items.indexOf(v);
            return i >= 0 ? { ...v, recordedFineId: r.ids[i] } : v;
          }),
        },
      );
      void qc.invalidateQueries({ queryKey: ['fines'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRecording(null);
    }
  };

  const pending = (result?.violations ?? []).filter((v) => !v.recordedFineId && v.violatedAt != null && v.status !== 'paid');

  return (
    <Card>
      <CardHeader icon={ShieldCheck} title="Kiểm tra vi phạm" description="Chọn xe rồi kiểm tra — app tự cho biết ai đang giữ xe lúc vi phạm" />
      <CardBody className="space-y-4">
        {!!vehicles.length && (
          <div className="flex flex-wrap gap-1.5">
            {vehicles.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setPlate(v.plate);
                  setResult(null);
                }}
                className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', plate === v.plate ? 'border-brand bg-brand-soft text-brand' : 'border-border hover:bg-surface-2')}
              >
                {v.plate}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Hoặc nhập biển số" autoCapitalize="characters" className="sm:max-w-56" />
          <Button onClick={check} loading={checking} className="sm:w-auto">
            <Search /> Kiểm tra
          </Button>
          {isAdmin && vehicles.length > 1 && (
            <Button variant="outline" onClick={() => runFleet.mutate()} loading={runFleet.isPending}>
              Kiểm tra cả đội ({vehicles.length} xe)
            </Button>
          )}
        </div>

        {checking && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" /> Đang tra cứu {plateKey(plate)}… (có thể mất 10–20 giây)
          </p>
        )}

        {fleet && (
          <div className="rounded-2xl border border-border p-3 text-sm">
            <p className="mb-1 font-medium">Kết quả kiểm tra cả đội</p>
            <ul className="space-y-0.5">
              {fleet.vehicles.map((v) => (
                <li key={v.plate} className={v.ok ? '' : 'text-red-600'}>
                  {v.plate}: {v.ok ? (v.found ? `${v.found} vi phạm${v.recorded ? ` · ${v.recorded} mới ghi hồ sơ` : ''}` : 'không có vi phạm') : v.error}
                </li>
              ))}
            </ul>
            {!fleet.ok && <p className="mt-1 text-muted">Dừng lại vì dịch vụ tra cứu lỗi. Dùng cách chép–dán bên dưới.</p>}
          </div>
        )}

        {result && !result.ok && (
          <Notice tone="amber" icon={TriangleAlert}>
            <p className="font-medium">Chưa tự tra được: {result.error}</p>
            <p className="mt-1">Tra trên trang chính thức của Cục CSGT (cần bấm xác nhận "không phải robot"), rồi chép kết quả dán vào ô bên dưới — app tự đọc giờ vi phạm và tìm người giữ xe.</p>
          </Notice>
        )}

        {result?.ok && !result.violations.length && (
          <Notice tone="green" icon={CheckCircle2}>
            Không có vi phạm nào cho {result.plate}
            {result.checkedAt && ` (tra lúc ${fmtDateTime(result.checkedAt)})`}.
          </Notice>
        )}

        {!!result?.violations.length && (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5 md:px-5">
              <p className="text-sm font-medium">
                {result.plate}: {result.violations.length} vi phạm · {result.violations.filter((v) => v.status === 'unpaid').length} chưa xử phạt
              </p>
              {pending.length > 1 && (
                <Button size="sm" onClick={() => record(pending, 'all')} loading={recording === 'all'}>
                  Ghi tất cả {pending.length} vi phạm chưa xử phạt
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border">
              {result.violations.map((v, i) => (
                <ViolationRow key={i} v={v} recording={recording === i} onRecord={() => record([v], i)} />
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-2xl border border-dashed border-border-strong p-3">
          <button onClick={() => setPasteOpen(!pasteOpen)} className="flex w-full items-center gap-2 text-left text-sm font-medium">
            <ClipboardPaste className="size-4 text-brand" />
            <span className="flex-1">Tra trên trang chính thức / VNeTraffic rồi dán kết quả</span>
            <span className="text-muted">{pasteOpen ? 'Ẩn' : 'Mở'}</span>
          </button>
          {pasteOpen && (
            <div className="mt-3 space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Bấm nút dưới: app chép sẵn biển số {plateKey(plate) || '…'} và mở trang tra cứu của Cục CSGT.</li>
                <li>Dán biển số, chọn ô tô, xác nhận captcha, bấm tra cứu.</li>
                <li>Bôi đen toàn bộ kết quả → Sao chép → quay lại đây dán vào ô dưới. Thông báo trên app VNeTraffic cũng dán được.</li>
              </ol>
              <Button variant="outline" onClick={openOfficial} disabled={plateKey(plate).length < 5}>
                <ExternalLink /> Chép biển số & mở trang tra cứu
              </Button>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={'Biển kiểm soát: 51K-123.45\nThời gian vi phạm: 14:30, 28/09/2026\nHành vi vi phạm: …'} />
              <Button onClick={readPasted} disabled={text.trim().length < 5}>
                Đọc kết quả
              </Button>
            </div>
          )}
        </div>

        {isAdmin && auto && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Tự kiểm tra cả đội:</span>
            <Select value={auto.frequency} onChange={(e) => setFrequency.mutate(e.target.value as FineAutoCheck['frequency'])} className="h-9 w-auto md:h-9">
              <option value="off">Tắt</option>
              <option value="daily">Mỗi ngày</option>
              <option value="weekly">Mỗi tuần</option>
            </Select>
            <span className="text-xs text-muted">
              {auto.lastRunAt ? `Lần cuối ${relTime(auto.lastRunAt)}${auto.lastError ? ` — lỗi: ${auto.lastError}` : ` — ${auto.lastFound ?? 0} vi phạm, ${auto.lastNew ?? 0} mới`}` : 'Chưa chạy lần nào'}
              {auto.frequency !== 'off' && ' · có vi phạm mới sẽ tự ghi hồ sơ và báo Telegram'}
            </span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
