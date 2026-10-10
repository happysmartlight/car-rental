import {
  CalendarRange,
  Car,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Receipt,
  ScanLine,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { useAuth, useTheme, type Theme } from '@/lib/hooks';
import { bootVersion } from '@/lib/pwa';
import { cn, initials } from '@/lib/utils';
import { CashEntryDialog, type CashDialogState } from '../CashEntryDialog';
import { Dialog } from '../ui/dialog';
import { Menu, MenuItem, MenuSeparator } from '../ui/misc';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { UpdateBanner } from './UpdateBanner';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  admin?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Lịch xe', icon: CalendarRange },
  { to: '/rentals', label: 'Lượt thuê', icon: KeyRound },
  { to: '/customers', label: 'Khách hàng', icon: Users },
  { to: '/vehicles', label: 'Xe', icon: Car },
  { to: '/cashflow', label: 'Thu chi', icon: Wallet, admin: true },
  { to: '/fines', label: 'Phạt nguội', icon: ShieldAlert },
  { to: '/settings', label: 'Cài đặt', icon: Settings },
];

const QUICK: { to: string; label: string; desc: string; icon: LucideIcon }[] = [
  { to: '/rentals/new', label: 'Đặt xe mới', desc: 'Chọn khách, xe, giờ — tự tính giá', icon: KeyRound },
  { to: '/customers/new?scan=1', label: 'Thêm khách bằng CCCD', desc: 'Quét mã QR trên căn cước', icon: ScanLine },
  { to: '#cash', label: 'Ghi chi phí', desc: 'Xăng, rửa xe, sửa chữa, bến bãi…', icon: Receipt },
  { to: '/fines', label: 'Tra phạt nguội', desc: 'Biển số + giờ vi phạm → ai giữ xe', icon: ShieldAlert },
  { to: '/customers/new', label: 'Thêm khách nhập tay', desc: 'Khi không quét được QR', icon: UserPlus },
];

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Sáng', icon: Sun },
  { value: 'dark', label: 'Tối', icon: Moon },
  { value: 'system', label: 'Theo máy', icon: Monitor },
];

function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/';
  };
}

export function AppShell() {
  const { user, isAdmin } = useAuth();
  const nav = NAV.filter((n) => !n.admin || isAdmin);
  const [theme, setTheme] = useTheme();
  const [quickOpen, setQuickOpen] = useState(false);
  const [cash, setCash] = useState<CashDialogState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const palette = useCommandPalette();
  const logout = useLogout();
  const navigate = useNavigate();
  const ThemeIcon = THEMES.find((t) => t.value === theme)?.icon ?? Monitor;

  return (
    // overflow-x-clip: phần tử nào lỡ tràn ngang cũng không làm trang rộng hơn màn hình (iOS sẽ thu nhỏ cả trang).
    // clip (không phải hidden) để thanh tiêu đề sticky vẫn dính.
    <div className="min-h-dvh overflow-x-clip lg:pl-64">
      {/* ── Sidebar máy tính ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-card">
            <Car className="size-5" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold">Thuê Xe</p>
            <p className="text-xs text-muted">Tự lái</p>
          </div>
        </div>
        <div className="px-3 pb-2">
          <button onClick={() => palette.setOpen(true)} className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-muted hover:border-border-strong">
            <Search className="size-4" />
            <span className="flex-1 text-left">Tìm nhanh…</span>
            <kbd className="rounded-md border border-border bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn('flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors', isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg')
              }
            >
              <n.icon className="size-[18px]" />
              {n.label}
            </NavLink>
          ))}
          <button onClick={() => setQuickOpen(true)} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-medium text-brand-fg shadow-card hover:bg-brand-hover">
            <Plus className="size-4" /> Tạo nhanh
          </button>
        </nav>
        <div className="border-t border-border p-3">
          <Menu
            align="start"
            trigger={
              <button className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2">
                <span className="flex size-9 items-center justify-center rounded-full bg-surface-3 text-sm font-semibold">{initials(user.displayName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{user.displayName}</span>
                  <span className="block text-xs text-muted">
                    {user.role === 'admin' ? 'Quản trị' : 'Nhân viên'}
                    {bootVersion && ` · v${bootVersion.version}`}
                  </span>
                </span>
                <ThemeIcon className="size-4 text-muted" />
              </button>
            }
          >
            {THEMES.map((t) => (
              <MenuItem key={t.value} icon={t.icon} onSelect={() => setTheme(t.value)}>
                Giao diện {t.label.toLowerCase()} {theme === t.value && '✓'}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={Settings} onSelect={() => navigate('/settings/account')}>
              Tài khoản & mật khẩu
            </MenuItem>
            <MenuItem icon={LogOut} danger onSelect={logout}>
              Đăng xuất
            </MenuItem>
          </Menu>
        </div>
      </aside>

      <UpdateBanner />

      <main className="pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-10">
        <Outlet context={{ openPalette: () => palette.setOpen(true) }} />
      </main>

      {/* ── Thanh dưới điện thoại ── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 pb-safe backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          <TabLink to="/" end icon={LayoutDashboard} label="Tổng quan" />
          <TabLink to="/calendar" icon={CalendarRange} label="Lịch" />
          <div className="flex justify-center">
            <button onClick={() => setQuickOpen(true)} aria-label="Tạo nhanh" className="-mt-6 flex size-14 items-center justify-center rounded-2xl bg-brand text-brand-fg shadow-pop active:scale-95">
              <Plus className="size-7" />
            </button>
          </div>
          <TabLink to="/rentals" icon={KeyRound} label="Lượt thuê" />
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-muted">
            <MenuIcon className="size-[22px]" />
            Thêm
          </button>
        </div>
      </nav>

      <Dialog open={quickOpen} onOpenChange={setQuickOpen} title="Tạo nhanh" size="sm">
        <div className="space-y-2">
          {QUICK.map((q) => (
            <button
              key={q.to}
              onClick={() => {
                setQuickOpen(false);
                if (q.to === '#cash') setCash({ mode: 'new' });
                else navigate(q.to);
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left hover:bg-surface-2"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <q.icon className="size-5" />
              </span>
              <span>
                <span className="block font-medium">{q.label}</span>
                <span className="block text-sm text-muted">{q.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title={user.displayName} description={user.role === 'admin' ? 'Quản trị' : 'Nhân viên'} size="sm">
        <div className="grid grid-cols-3 gap-2">
          {nav.slice(3).map((n) => (
            <button
              key={n.to}
              onClick={() => {
                setMoreOpen(false);
                navigate(n.to);
              }}
              className="flex flex-col items-center gap-2 rounded-2xl border border-border p-3 text-sm font-medium hover:bg-surface-2"
            >
              <n.icon className="size-6 text-brand" />
              {n.label}
            </button>
          ))}
          <button
            onClick={() => {
              setMoreOpen(false);
              palette.setOpen(true);
            }}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border p-3 text-sm font-medium hover:bg-surface-2"
          >
            <Search className="size-6 text-brand" />
            Tìm nhanh
          </button>
        </div>
        <p className="mt-5 mb-2 text-sm font-medium text-muted">Giao diện</p>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={cn('flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm', theme === t.value ? 'border-brand bg-brand-soft text-brand' : 'border-border')}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
        <button onClick={logout} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl p-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
          <LogOut className="size-4" /> Đăng xuất
        </button>
        {bootVersion && <p className="mt-2 text-center text-xs text-subtle">Phiên bản {bootVersion.version}</p>}
      </Dialog>

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      <CashEntryDialog state={cash} onClose={() => setCash(null)} />
    </div>
  );
}

function TabLink({ to, icon: Icon, label, end }: { to: string; icon: LucideIcon; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 text-[11px] font-medium', isActive ? 'text-brand' : 'text-muted')}>
      <Icon className="size-[22px]" />
      {label}
    </NavLink>
  );
}

// ── Khung trang ──────────────────────────────────────────────────────────────

export function Page({
  title,
  subtitle,
  actions,
  back,
  children,
  width = 'default',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: string | true;
  children: ReactNode;
  width?: 'default' | 'narrow' | 'wide';
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    if (typeof back === 'string') navigate(back);
    else if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };
  const max = { default: 'max-w-6xl', narrow: 'max-w-3xl', wide: 'max-w-[1600px]' }[width];
  return (
    <div className={cn('mx-auto px-4 md:px-6 lg:px-8', max)}>
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-bg/85 px-4 pt-safe backdrop-blur-xl md:static md:mx-0 md:mb-6 md:border-0 md:bg-transparent md:px-0 md:pt-6 md:backdrop-blur-none">
        <div className="flex min-h-14 items-center gap-2 py-2">
          {back && (
            <button onClick={goBack} aria-label="Quay lại" className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight md:text-2xl">{title}</h1>
            {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}
