// Biểu đồ 12 tháng: cột Thu (xanh) + Chi vận hành (cam) cạnh nhau, đường Lãi vận hành.
// Một trục tiền duy nhất. Rê/chạm vào tháng để xem số; bấm để mở tháng đó. Có bảng số thay thế.

import { useLayoutEffect, useRef, useState } from 'react';
import type { CashTotals } from '@/lib/types';
import { cn } from '@/lib/utils';
import { fmtCompactVnd, fmtMonthKey, parseMonthKey } from '@shared/cashflow';
import { fmtVnd } from '@shared/text';

export type TrendRow = CashTotals & { key: string };

const H = 230;
const PAD = { top: 14, right: 6, bottom: 34, left: 46 };

/** Bước chia trục tròn: 1, 2, 2.5, 5 × 10^k. */
function niceStep(range: number, count = 4): number {
  if (range <= 0) return 1_000_000;
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

/** Cột bo 4px ở đầu dữ liệu, vuông ở gốc. */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const h = Math.abs(y0 - y1);
  if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  const up = y1 < y0;
  const tip = y1;
  const s = up ? 1 : -1;
  return `M${x},${y0} V${tip + s * r} Q${x},${tip} ${x + r},${tip} H${x + w - r} Q${x + w},${tip} ${x + w},${tip + s * r} V${y0} Z`;
}

export function CashChart({ data, selected, onSelect, className }: { data: TrendRow[]; selected?: string | null; onSelect?: (key: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = data.length;
  const values = data.flatMap((d) => [d.income, d.expense, d.profit]);
  const step = niceStep(Math.max(...values, 0) - Math.min(...values, 0));
  const yMax = Math.max(step, Math.ceil(Math.max(...values, 0) / step) * step);
  const yMin = Math.min(0, Math.floor(Math.min(...values, 0) / step) * step);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const band = n ? plotW / n : 0;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * plotH;
  const barW = Math.max(3, Math.min(24, (band - 8) / 2 - 1));
  const groupW = barW * 2 + 2;
  const cx = (i: number) => PAD.left + i * band + band / 2;
  const zero = y(0);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${cx(i)},${y(d.profit)}`).join(' ');

  const hv = hover != null ? data[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max(cx(hover) - 90, 0), Math.max(0, width - 180)) : 0;

  return (
    <div ref={ref} className={cn('relative select-none', className)} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Biểu đồ thu, chi và lãi theo tháng" className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--border-strong)' : 'var(--border)'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-subtle text-[11px]">
                {fmtCompactVnd(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x0 = PAD.left + i * band + (band - groupW) / 2;
            const p = parseMonthKey(d.key)!;
            const isSel = selected === d.key;
            return (
              <g key={d.key}>
                {(hover === i || isSel) && <rect x={PAD.left + i * band + 1} y={PAD.top} width={Math.max(0, band - 2)} height={plotH} rx={6} fill="var(--hover)" opacity={hover === i ? 0.9 : 0.55} />}
                <path d={barPath(x0, barW, zero, y(d.income))} fill="var(--chart-in)" />
                <path d={barPath(x0 + barW + 2, barW, zero, y(d.expense))} fill="var(--chart-out)" />
                <text x={cx(i)} y={H - PAD.bottom + 16} textAnchor="middle" className={cn('text-[11px]', isSel ? 'fill-fg font-semibold' : 'fill-muted')}>
                  T{p.month}
                </text>
                {(i === 0 || p.month === 1) && (
                  <text x={cx(i)} y={H - PAD.bottom + 29} textAnchor="middle" className="fill-subtle text-[10px]">
                    {p.year}
                  </text>
                )}
              </g>
            );
          })}

          <path d={line} fill="none" stroke="var(--chart-profit)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <circle key={d.key} cx={cx(i)} cy={y(d.profit)} r={hover === i ? 5 : 4} fill="var(--chart-profit)" stroke="var(--surface)" strokeWidth={2} />
          ))}

          {/* Vùng bấm: cả cột tháng, to hơn hình vẽ. */}
          {data.map((d, i) => (
            <rect
              key={d.key}
              x={PAD.left + i * band}
              y={0}
              width={band}
              height={H}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${fmtMonthKey(d.key)}: thu ${fmtVnd(d.income)}, chi ${fmtVnd(d.expense)}, lãi ${fmtVnd(d.profit)}`}
              className="cursor-pointer outline-none"
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(d.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect?.(d.key);
                }
              }}
            />
          ))}
        </svg>
      )}
      {!width && <div style={{ height: H }} />}

      {hv && (
        <div className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-xl border border-border-strong bg-popover p-2.5 text-xs shadow-pop" style={{ left: tipLeft }}>
          <p className="mb-1.5 font-medium text-muted">{fmtMonthKey(hv.key)}</p>
          <TipRow color="var(--chart-in)" label="Thu" value={hv.income} />
          <TipRow color="var(--chart-out)" label="Chi vận hành" value={hv.expense} />
          <TipRow color="var(--chart-profit)" label="Lãi" value={hv.profit} />
          {hv.capitalOut + hv.capitalIn !== 0 && <TipRow label="Vốn, trả góp" value={hv.capitalIn - hv.capitalOut} />}
          {onSelect && <p className="mt-1.5 text-[11px] text-subtle">Bấm để xem tháng này</p>}
        </div>
      )}
    </div>
  );
}

function TipRow({ color, label, value }: { color?: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color ?? 'var(--subtle)' }} />
      <span className="tabular font-semibold text-fg">{fmtVnd(value)}</span>
      <span className="ml-auto text-muted">{label}</span>
    </div>
  );
}

/** Chú thích: ô vuông cho cột, gạch cho đường. */
export function CashLegend({ className }: { className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted', className)}>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-chart-in" /> Thu
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-chart-out" /> Chi vận hành
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 rounded-full bg-chart-profit" /> Lãi
      </span>
    </span>
  );
}

/** Bảng số thay cho biểu đồ. */
export function CashTrendTable({ data, selected, onSelect }: { data: TrendRow[]; selected?: string | null; onSelect?: (key: string) => void }) {
  const showCapital = data.some((d) => d.capitalIn || d.capitalOut);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th className="py-2 pr-2 text-left font-medium">Tháng</th>
            <th className="px-2 py-2 text-right font-medium">Thu</th>
            <th className="px-2 py-2 text-right font-medium">Chi</th>
            <th className="px-2 py-2 text-right font-medium">Lãi</th>
            {showCapital && <th className="py-2 pl-2 text-right font-medium">Dòng tiền ròng</th>}
          </tr>
        </thead>
        <tbody className="tabular">
          {data.map((d) => (
            <tr key={d.key} onClick={() => onSelect?.(d.key)} className={cn('cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/60', selected === d.key && 'bg-surface-2/60 font-semibold')}>
              <td className="py-2 pr-2 whitespace-nowrap">{fmtMonthKey(d.key).replace('Tháng ', 'T')}</td>
              <td className="px-2 py-2 text-right whitespace-nowrap">{fmtVnd(d.income)}</td>
              <td className="px-2 py-2 text-right whitespace-nowrap">{fmtVnd(d.expense)}</td>
              <td className={cn('px-2 py-2 text-right whitespace-nowrap', d.profit < 0 && 'text-red-600 dark:text-red-400')}>{fmtVnd(d.profit)}</td>
              {showCapital && <td className={cn('py-2 pl-2 text-right whitespace-nowrap', d.net < 0 && 'text-red-600 dark:text-red-400')}>{fmtVnd(d.net)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
