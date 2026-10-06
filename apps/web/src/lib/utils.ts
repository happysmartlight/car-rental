import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Có lỗi xảy ra';
}

export function telLink(phone: string | null | undefined): string | undefined {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined;
}

export function zaloLink(phone: string | null | undefined): string | undefined {
  return phone ? `https://zalo.me/${phone.replace(/\D/g, '')}` : undefined;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts.at(-1)?.[0] ?? '') + (parts.length > 1 ? (parts[0][0] ?? '') : '')).toUpperCase();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function relTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const suffix = diff < 0 ? 'trước' : 'nữa';
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút ${suffix}`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} giờ ${suffix}`;
  const d = Math.round(h / 24);
  return `${d} ngày ${suffix}`;
}
