import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-fg hover:bg-brand-hover shadow-card active:translate-y-px',
        secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
        outline: 'border border-border-strong bg-surface text-fg hover:bg-surface-2',
        ghost: 'text-fg hover:bg-surface-2',
        danger: 'bg-red-600 text-white hover:bg-red-700 shadow-card',
        'danger-ghost': 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
        success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-card',
        link: 'text-brand underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-sm rounded-lg',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
        icon: 'size-10',
        'icon-sm': 'size-8 rounded-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
    {loading && <Loader2 className="animate-spin" />}
    {children}
  </button>
));
Button.displayName = 'Button';

export function ButtonLink({ className, variant, size, ...props }: LinkProps & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
