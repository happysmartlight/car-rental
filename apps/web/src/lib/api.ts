// Gọi API. Lỗi trả về dạng ApiError có message tiếng Việt từ máy chủ.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng / Tailscale.', 'network');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* không phải JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'unauthenticated') onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Lỗi HTTP ${res.status}`, data?.code, data ?? undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  form: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

export interface UploadedFile {
  id: string;
  kind: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

/** Tải 1 file lên. `stamp` = dòng chữ đóng lên ảnh (giờ + biển số). */
export function uploadFile(file: Blob, kind: string, opts: { stamp?: string; name?: string } = {}): Promise<UploadedFile> {
  const form = new FormData();
  form.append('kind', kind);
  if (opts.stamp) form.append('stamp', opts.stamp);
  form.append('file', file, opts.name ?? (file instanceof File ? file.name : 'upload.jpg'));
  return api.form<UploadedFile>('/api/files', form);
}

export const fileUrl = (id: string, opts: { thumb?: boolean; download?: boolean } = {}) =>
  `/api/files/${id}${opts.thumb ? '?thumb=1' : opts.download ? '?download=1' : ''}`;

/** Chuỗi query từ object, bỏ giá trị rỗng. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
