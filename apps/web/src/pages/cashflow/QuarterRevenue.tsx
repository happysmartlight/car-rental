// Doanh thu theo quý để kê khai thuế hộ kinh doanh: thuê trực tiếp tự khai;
// lượt đặt qua app (Mioto) tách riêng — phần khách trả qua app do app khai/khấu trừ thay.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import { Card, CardBody, CardHeader, ErrorBox, Notice, Skeleton } from '@/components/ui/misc';
import { api, qs } from '@/lib/api';
import { useNow } from '@/lib/hooks';
import type { RevenueReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { parseQuarter, quarterOfPeriod, shiftQuarter } from '@shared/cashflow';
import { fmtVnd } from '@shared/text';

const APP_KEY = 'cash.revenueAppDirect';

function readFlag(): boolean {
  try {
    return localStorage.getItem(APP_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFlag(v: boolean) {
  try {
    localStorage.setItem(APP_KEY, v ? '1' : '0');
  } catch {
    /* bỏ qua */
  }
}

export function QuarterRevenueCard({ period }: { period: string }) {
  const now = useNow();
  const [quarter, setQuarter] = useState(() => quarterOfPeriod(period, now));
  // Đổi kỳ ở trang Thu chi → quý đi theo.
  useEffect(() => setQuarter(quarterOfPeriod(period, Date.now())), [period]);
  const [withApp, setWithApp] = useState(readFlag);
  const params = qs({ q: quarter, app: withApp ? '1' : '0' });
  const { data, error, isFetching } = useQuery({
    queryKey: ['revenue', quarter, withApp],
    queryFn: () => api.get<RevenueReport>(`/api/cashflow/revenue${params}`),
    placeholderData: keepPreviousData,
  });
  const t = data?.totals;
  const label = parseQuarter(quarter)?.label ?? quarter;

  return (
    <Card>
      <CardHeader
        icon={Receipt}
        title="Doanh thu theo quý (kê khai thuế)"
        description="Theo ngày nhận tiền, giống sổ thu chi. Không gồm tiền cọc đang giữ."
        action={
          <a href={`/api/cashflow/revenue/export${params}`} download className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            <Download /> Excel
          </a>
        }
      />
      <CardBody>
        <div className="mb-3 flex w-fit items-center rounded-xl border border-border bg-surface">
          <Button variant="ghost" size="icon" aria-label="Quý trước" onClick={() => setQuarter(shiftQuarter(quarter, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[7.5rem] text-center text-sm font-medium tabular">{label}</span>
          <Button variant="ghost" size="icon" aria-label="Quý sau" onClick={() => setQuarter(shiftQuarter(quarter, 1))}>
            <ChevronRight />
          </Button>
        </div>

        {error ? (
          <ErrorBox error={error} />
        ) : !data || !t ? (
          <Skeleton className="h-40" />
        ) : (
          <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Tháng</th>
                    <th className="py-2 pr-3 text-right font-medium">Thuê trực tiếp</th>
                    <th className="py-2 pr-3 text-right font-medium">Mioto · qua app</th>
                    <th className="py-2 pr-3 text-right font-medium">Mioto · trả thẳng</th>
                    <th className="py-2 text-right font-medium">Tự kê khai</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {data.months.map((m) => (
                    <tr key={m.key} className="border-b border-border">
                      <td className="py-2 pr-3">{m.label}</td>
                      <td className="py-2 pr-3 text-right">{fmtVnd(m.direct)}</td>
                      <td className="py-2 pr-3 text-right text-muted">{fmtVnd(m.app)}</td>
                      <td className="py-2 pr-3 text-right text-muted">{fmtVnd(m.appDirect)}</td>
                      <td className="py-2 text-right font-medium">{fmtVnd(m.declared)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3">Cả quý</td>
                    <td className="py-2 pr-3 text-right">{fmtVnd(t.direct)}</td>
                    <td className="py-2 pr-3 text-right">{fmtVnd(t.app)}</td>
                    <td className="py-2 pr-3 text-right">{fmtVnd(t.appDirect)}</td>
                    <td className="py-2 text-right text-base">{fmtVnd(t.declared)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <Switch
                checked={withApp}
                onChange={(v) => {
                  setWithApp(v);
                  writeFlag(v);
                }}
                label="Tính cả tiền khách Mioto trả thẳng cho cửa hàng"
                description="Bật nếu chứng từ khấu trừ thuế của Mioto chỉ gồm phần khách trả qua app."
              />
            </div>
            {t.appDirect > 0 && !withApp && (
              <Notice tone="amber" className="mt-3">
                Khách đặt qua Mioto đã trả thẳng cho cửa hàng {fmtVnd(t.appDirect)} trong {label.toLowerCase()} (tiền còn lại lúc nhận xe, phụ phí, cọc cấn trừ…). Đối chiếu chứng từ khấu trừ thuế Mioto gửi: nếu Mioto chưa tính phần này thì bật ô trên để cộng vào doanh thu tự kê khai.
              </Notice>
            )}
            <p className="mt-3 text-xs text-subtle">Ngưỡng doanh thu chịu thuế và mẫu tờ khai thay đổi theo quy định — hỏi lại kế toán hoặc cơ quan thuế trước khi nộp.</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
