import { Check } from 'lucide-react';
import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { fmtNumber, parseMoney } from '@shared/text';
import { msToVnLocalInput, vnLocalInputToMs } from '@shared/time';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-xl border border-border-strong bg-surface px-3 text-fg placeholder:text-subtle transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-ring disabled:opacity-60 disabled:bg-surface-2';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-11 md:h-10', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2.5', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      fieldBase,
      'h-11 appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 md:h-10',
      "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a94a5' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium text-fg', className)}>
      {children}
    </label>
  );
}

export function Field({ label, hint, error, children, className, required }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <Label>
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </Label>
      )}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Ô tiền: tự nhóm hàng nghìn khi gõ (1.500.000). */
export function MoneyInput({ value, onChange, className, placeholder = '0', ...props }: { value: number | null | undefined; onChange: (v: number | null) => void; className?: string; placeholder?: string; disabled?: boolean; autoFocus?: boolean; id?: string }) {
  const [text, setText] = useState(value == null ? '' : fmtNumber(value));
  useEffect(() => {
    const parsed = parseMoney(text);
    if (parsed !== (value ?? null)) setText(value == null ? '' : fmtNumber(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        className={cn(fieldBase, 'tabular h-11 pr-8 text-right md:h-10', className)}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const n = parseMoney(e.target.value);
          setText(n == null ? '' : fmtNumber(n));
          onChange(n);
        }}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle">đ</span>
    </div>
  );
}

export function NumberInput({ value, onChange, suffix, className, ...props }: { value: number | null | undefined; onChange: (v: number | null) => void; suffix?: string; className?: string; min?: number; max?: number; placeholder?: string; disabled?: boolean }) {
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        className={cn(fieldBase, 'tabular h-11 md:h-10', suffix && 'pr-12', className)}
        value={value == null ? '' : fmtNumber(value)}
        onChange={(e) => onChange(parseMoney(e.target.value))}
        {...props}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle">{suffix}</span>}
    </div>
  );
}

/** Chọn ngày giờ theo giờ VN (giá trị là epoch ms). */
export function DateTimeInput({ value, onChange, className, ...props }: { value: number | null | undefined; onChange: (v: number | null) => void; className?: string; disabled?: boolean; min?: number }) {
  return (
    <input
      type="datetime-local"
      className={cn(fieldBase, 'h-11 md:h-10', className)}
      value={value == null ? '' : msToVnLocalInput(value)}
      onChange={(e) => onChange(e.target.value ? vnLocalInputToMs(e.target.value) : null)}
      disabled={props.disabled}
      min={props.min != null ? msToVnLocalInput(props.min) : undefined}
    />
  );
}

/** Chọn ngày (giá trị "YYYY-MM-DD"). */
export function DateInput({ value, onChange, className, ...props }: { value: string | null | undefined; onChange: (v: string | null) => void; className?: string; disabled?: boolean }) {
  return <input type="date" className={cn(fieldBase, 'h-11 md:h-10', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...props} />;
}

export function Checkbox({ checked, onChange, label, description, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 select-none', className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong bg-surface',
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </button>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex items-center justify-between gap-4', disabled ? 'opacity-60' : 'cursor-pointer')}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium">{label}</span>}
          {description && <span className="block text-xs text-muted">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-surface-3')}
      >
        <span className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </label>
  );
}

/** Nhóm nút chọn một (thay cho radio). */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
