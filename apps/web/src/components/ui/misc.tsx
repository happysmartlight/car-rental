import { DropdownMenu as DM } from 'radix-ui';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Tone } from '@shared/constants';
import { cn } from '@/lib/utils';

const TONES: Record<Tone, string> = {
  gray: 'bg-surface-2 text-muted ring-border',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900',
  red: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900',
};

export function Badge({ tone = 'gray', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Card({ children, className, ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface shadow-card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, icon: Icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-2 md:px-5', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 size-5 shrink-0 text-muted" />}
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 pt-2 pb-4 md:px-5', className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-2', className)} />;
}

export function Empty({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface-2">
          <Icon className="size-6 text-muted" />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div className={cn('rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300', className)}>
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Notice({ tone = 'blue', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-2.5 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset', TONES[tone], className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Dòng "nhãn — giá trị" trong khung thông tin. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5 text-sm', className)}>
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium break-words">{children || <span className="font-normal text-subtle">—</span>}</span>
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        {Icon && (
          <span className={cn('flex size-8 items-center justify-center rounded-lg', tone ? TONES[tone] : 'bg-surface-2 text-muted')}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="tabular mt-2 text-lg font-semibold tracking-tight whitespace-nowrap sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="anim-zoom z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-pop">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({ children, onSelect, icon: Icon, danger, disabled }: { children: ReactNode; onSelect?: () => void; icon?: LucideIcon; danger?: boolean; disabled?: boolean }) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2',
        danger && 'text-red-600 dark:text-red-400',
      )}
    >
      {Icon && <Icon className="size-4 text-current opacity-70" />}
      {children}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
