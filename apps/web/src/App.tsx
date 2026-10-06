import { useQueryClient } from '@tanstack/react-query';
import { lazy as reactLazy, Suspense, useEffect, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { PageLoader } from './components/ui/misc';
import { setUnauthorizedHandler } from './lib/api';
import { AuthProvider, useAuthState } from './lib/hooks';
import { Login, Setup } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';

/**
 * Sau khi cập nhật, máy đang mở bản cũ sẽ không tải được các file JS đã bị thay.
 * Gặp lỗi đó thì tải lại trang một lần để lấy bản mới.
 */
function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return reactLazy(() =>
    load().catch((err) => {
      const key = 'chunk-reload-at';
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined);
      }
      throw err;
    }),
  );
}

const Calendar = lazy(() => import('./pages/Calendar'));
const RentalsList = lazy(() => import('./pages/rentals/RentalsList'));
const RentalNew = lazy(() => import('./pages/rentals/RentalNew'));
const RentalDetail = lazy(() => import('./pages/rentals/RentalDetail'));
const Handover = lazy(() => import('./pages/rentals/Handover'));
const CustomersList = lazy(() => import('./pages/customers/CustomersList'));
const CustomerEdit = lazy(() => import('./pages/customers/CustomerEdit'));
const CustomerDetail = lazy(() => import('./pages/customers/CustomerDetail'));
const VehiclesList = lazy(() => import('./pages/vehicles/VehiclesList'));
const VehicleEdit = lazy(() => import('./pages/vehicles/VehicleEdit'));
const VehicleDetail = lazy(() => import('./pages/vehicles/VehicleDetail'));
const Fines = lazy(() => import('./pages/Fines'));
const Settings = lazy(() => import('./pages/settings/Settings'));

export function App() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useAuthState();

  useEffect(() => {
    setUnauthorizedHandler(() => void qc.invalidateQueries({ queryKey: ['auth'] }));
  }, [qc]);

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">Không kết nối được máy chủ</p>
        <p className="text-sm text-muted">Kiểm tra mạng hoặc Tailscale trên thiết bị này.</p>
        <button className="text-sm text-brand" onClick={() => refetch()}>
          Thử lại
        </button>
      </div>
    );
  }
  if (data.needsSetup) return <Setup />;
  if (!data.user) return <Login />;

  return (
    <AuthProvider user={data.user}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="rentals" element={<RentalsList />} />
            <Route path="rentals/new" element={<RentalNew />} />
            <Route path="rentals/:id" element={<RentalDetail />} />
            <Route path="rentals/:id/pickup" element={<Handover kind="pickup" />} />
            <Route path="rentals/:id/return" element={<Handover kind="return" />} />
            <Route path="customers" element={<CustomersList />} />
            <Route path="customers/new" element={<CustomerEdit />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="customers/:id/edit" element={<CustomerEdit />} />
            <Route path="vehicles" element={<VehiclesList />} />
            <Route path="vehicles/new" element={<VehicleEdit />} />
            <Route path="vehicles/:id" element={<VehicleDetail />} />
            <Route path="vehicles/:id/edit" element={<VehicleEdit />} />
            <Route path="fines" element={<Fines />} />
            <Route path="settings/*" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
