// Hộp thoại: trên điện thoại hiện dạng bottom sheet, trên máy tính hiện giữa màn hình.

import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const width = { sm: 'md:max-w-sm', md: 'md:max-w-lg', lg: 'md:max-w-2xl', xl: 'md:max-w-4xl' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'anim-up fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-border bg-surface shadow-pop focus:outline-none',
            'md:anim-zoom md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[88dvh] md:w-full md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
            width,
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-surface-3 md:hidden" />
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-3 pb-2 md:pt-5">
            <div className="min-w-0">
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Đóng">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-5">{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ── Hộp xác nhận dùng như hàm: const ok = await confirm({...}) ───────────────

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>(null);
  const confirm = useCallback((o: ConfirmOptions) => {
    setState(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (v: boolean) => {
    resolver.current?.(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={!!state}
        onOpenChange={(o) => !o && close(false)}
        title={state?.title}
        description={state?.description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {state?.cancelText ?? 'Hủy'}
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmText ?? 'Đồng ý'}
            </Button>
          </>
        }
      />
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
