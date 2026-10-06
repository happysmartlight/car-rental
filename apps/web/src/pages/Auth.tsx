import { useQueryClient } from '@tanstack/react-query';
import { Car, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ErrorBox } from '@/components/ui/misc';
import { api } from '@/lib/api';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4 pt-safe">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand text-brand-fg shadow-pop">
            <Car className="size-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-card">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { username, password });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Quản lý thuê xe" subtitle="Đăng nhập để tiếp tục">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tên đăng nhập">
          <Input autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </Field>
        <Field label="Mật khẩu">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Đăng nhập
        </Button>
      </form>
    </AuthLayout>
  );
}

export function Setup() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ displayName: '', username: 'admin', password: '', confirm: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new Error('Hai lần nhập mật khẩu không khớp'));
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/setup', { displayName: form.displayName, username: form.username, password: form.password });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Chào mừng!" subtitle="Lần đầu chạy app — tạo tài khoản quản trị">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tên hiển thị" required>
          <Input value={form.displayName} onChange={set('displayName')} placeholder="vd: Anh Bằng" required autoFocus />
        </Field>
        <Field label="Tên đăng nhập" required hint="Chữ thường không dấu, số">
          <Input value={form.username} onChange={set('username')} autoCapitalize="none" required />
        </Field>
        <Field label="Mật khẩu" required hint="Tối thiểu 8 ký tự">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
        </Field>
        <Field label="Nhập lại mật khẩu" required>
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <ShieldCheck /> Tạo tài khoản
        </Button>
      </form>
    </AuthLayout>
  );
}
