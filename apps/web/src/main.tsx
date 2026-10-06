import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import { App } from './App';
import { ConfirmProvider } from './components/ui/dialog';
import { ApiError } from './lib/api';
import { registerServiceWorker } from './lib/pwa';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </BrowserRouter>
      <Toaster position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  </StrictMode>,
);
