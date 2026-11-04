// Số chạy cho các ô tổng (Tổng quan, Thu chi). Chỉ để xem nhanh, số cuối luôn chính xác.
// Không dùng cho ô nhập, báo giá, phiếu thu, quyết toán: ở đó phải thấy đúng số ngay.

import { useEffect, useRef, useState } from 'react';
import { fmtVnd } from '@shared/text';
import { useSeenOnScreen } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const DURATION_MS = 650;

/** Số đã hiện của từng ô trong phiên: quay lại trang không chạy lại từ 0, chỉ chạy khi số đổi. */
const lastShown = new Map<string, number>();

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export function CountUp({ id, value, format = fmtVnd, className }: { id: string; value: number; format?: (n: number) => string; className?: string }) {
  const [ref, seen] = useSeenOnScreen<HTMLSpanElement>();
  const [shown, setShown] = useState(() => (reducedMotion() ? value : (lastShown.get(id) ?? 0)));
  const current = useRef(shown);

  useEffect(() => {
    if (!seen) return; // Ô dưới màn hình đợi cuộn tới mới chạy.
    lastShown.set(id, value);
    const from = current.current;
    if (from === value || reducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, Math.max(0, (now - startedAt) / DURATION_MS));
      const next = t === 1 ? value : Math.round(from + (value - from) * easeOutCubic(t));
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [id, value, seen]);

  const final = format(value);
  if (shown === value) {
    return (
      <span ref={ref} className={cn('tabular', className)}>
        {final}
      </span>
    );
  }
  // Đang chạy: giữ sẵn bề rộng của số cuối để bố cục không nhảy; trình đọc màn hình và bản in chỉ có số cuối.
  return (
    <span ref={ref} className={cn('tabular inline-grid [&>*]:col-start-1 [&>*]:row-start-1', className)}>
      <span className="invisible print:visible">{final}</span>
      <span aria-hidden className="print:invisible">
        {format(shown)}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
