import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from './api';
import type { SessionUser, SettingsData } from './types';
import { errorMessage } from './utils';

// ── Phiên đăng nhập ──────────────────────────────────────────────────────────

interface AuthState {
  needsSetup: boolean;
  user: SessionUser | null;
}

const AuthCtx = createContext<{ user: SessionUser; isAdmin: boolean } | null>(null);

export function AuthProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <AuthCtx.Provider value={{ user, isAdmin: user.role === 'admin' }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth ngoài AuthProvider');
  return v;
}

export function useAuthState() {
  return useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthState>('/api/auth/state'), staleTime: Infinity, retry: 1 });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsData>('/api/settings'), staleTime: 5 * 60_000 });
}

// ── Gọi API ghi + tự làm mới dữ liệu + báo toast ──────────────────────────

export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string); onSuccess?: (r: TResult, vars: TVars) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, vars) => {
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r, vars);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
  });
}

// ── Tiện ích ──────────────────────────────────────────────────────────────

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export type Theme = 'light' | 'dark' | 'system';

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* trình duyệt chặn storage */
  }
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  return [theme, setTheme];
}

/** Đếm ngược/tăng mỗi phút để các nhãn "còn 2 giờ" tự cập nhật. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
