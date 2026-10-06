import { RefreshCw, Sparkles } from 'lucide-react';
import { useUpdateAvailable } from '@/lib/pwa';

/** Banner khi máy chủ đã chạy bản mới mà trang này còn là bản cũ. */
export function UpdateBanner() {
  const { available, reload } = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="anim-up fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0">
      <button onClick={reload} className="flex w-full items-center gap-3 rounded-2xl bg-fg px-4 py-3 text-left text-bg shadow-pop">
        <Sparkles className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">Đã có bản mới v{available.version}</span>
          <span className="block opacity-80">Bấm để tải lại</span>
        </span>
        <RefreshCw className="size-4 shrink-0" />
      </button>
    </div>
  );
}
