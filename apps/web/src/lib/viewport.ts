// Vá lỗi iOS 26 (WebKit) ở web app mở từ màn hình chính: sau khi bàn phím đóng — kể cả bàn phím của app
// khác, vd gõ tìm người nhận trong khung chia sẻ Zalo — vùng hiển thị không trở lại cỡ cũ (innerHeight /
// visualViewport nhỏ hơn hoặc lệch). Thanh dưới `fixed bottom-0` nổi lên giữa màn hình tới khi tắt hẳn app.
// Cách vá: nhớ chiều cao lớn nhất đã thấy; khi bàn phím đóng / quay lại app mà vùng hiển thị vẫn thấp hơn
// thì ép WebKit đo lại, từ nhẹ (nhích cuộn 1px) tới mạnh (ẩn/hiện khung app). Không đổi gì nếu không bị kẹt.

const NOT_TYPING = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'range', 'color']);

/** Đang gõ (bàn phím mở thật) → vùng hiển thị nhỏ là đúng, không vá. */
function typing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !NOT_TYPING.has(el.type);
}

const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;
const viewHeight = () => Math.min(window.innerHeight, Math.round(window.visualViewport?.height ?? window.innerHeight));

/** Chiều cao đầy đủ theo bề ngang (xoay iPad thì mỗi chiều một mốc). */
const fullHeight = new Map<number, number>();

function track() {
  if (typing() || zoomed()) return;
  const w = window.innerWidth;
  fullHeight.set(w, Math.max(fullHeight.get(w) ?? 0, viewHeight()));
}

function stuck(): boolean {
  if (typing() || zoomed()) return false;
  const full = fullHeight.get(window.innerWidth);
  return (full !== undefined && full - viewHeight() > 4) || (window.visualViewport?.offsetTop ?? 0) > 2;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function nudgeScroll() {
  const { scrollX: x, scrollY: y } = window;
  window.scrollTo(x, y > 0 ? y - 1 : y + 1);
  return nextFrame().then(() => window.scrollTo(x, y));
}

/** Ẩn rồi hiện khung app để WebKit dựng lại bố cục; giữ nguyên vị trí cuộn của trang và các vùng cuộn con. */
async function reflow(acrossFrame: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  const { scrollX: x, scrollY: y } = window;
  const scrolled = [...root.querySelectorAll<HTMLElement>('*')].filter((el) => el.scrollTop || el.scrollLeft).map((el) => [el, el.scrollLeft, el.scrollTop] as const);
  root.style.display = 'none';
  void root.offsetHeight;
  // Cách mạnh nhất: để trạng thái ẩn lên màn hình đúng 1 khung hình (chớp rất nhanh).
  if (acrossFrame) {
    await nextFrame();
    await nextFrame();
  }
  root.style.display = '';
  for (const [el, left, top] of scrolled) {
    el.scrollLeft = left;
    el.scrollTop = top;
  }
  window.scrollTo(x, y);
}

const STEPS = [nudgeScroll, () => reflow(false), () => reflow(true)];
let busy = false;

async function heal() {
  if (busy || !stuck()) return;
  await wait(150);
  if (busy || !stuck()) return; // chỉ là đang chuyển cảnh
  busy = true;
  try {
    for (const step of STEPS) {
      await step();
      await nextFrame();
      await nextFrame();
      if (!stuck()) return;
    }
    // Vá không được (hoặc màn hình đổi cỡ thật, vd thanh cuộc gọi trên máy có nút Home): nhận cỡ hiện tại làm
    // mốc để không chớp lại mỗi lần chạm.
    fullHeight.set(window.innerWidth, viewHeight());
  } finally {
    busy = false;
  }
}

const isIosStandalone = () => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Trong Safari thường, innerHeight đổi theo thanh địa chỉ nên không dùng mốc chiều cao được.
  return ios && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
};

let installed = false;

export function installViewportFix() {
  if (installed || !isIosStandalone()) return;
  installed = true;
  track();
  const later = (ms: number) => () => {
    track();
    setTimeout(() => void heal(), ms);
  };
  window.visualViewport?.addEventListener('resize', later(500));
  window.addEventListener('resize', later(500));
  // Bàn phím đóng: chờ hết hiệu ứng trượt xuống rồi mới đo.
  document.addEventListener('focusout', later(500));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && later(400)());
  window.addEventListener('focus', later(400));
  window.addEventListener('pageshow', later(400));
}

/** Gọi sau khi bảng chia sẻ / tải file của iPhone đóng — khung của app khác có thể đã mở bàn phím. */
export function healViewportSoon() {
  if (!installed) return;
  for (const ms of [400, 1500]) setTimeout(() => void heal(), ms);
}
