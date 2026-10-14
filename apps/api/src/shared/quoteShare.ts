// Báo giá nhanh cho khách hỏi "ngày này còn xe nào, bao nhiêu?": nhiều xe trống trong cùng
// khoảng thời gian, mỗi xe một khối giá. Dùng chung khuôn phiếu với rentalShare (ảnh / tin nhắn Zalo).

import type { RentalShareDoc, ShareBlock } from './rentalShare.js';
import { fmtNumber } from './text.js';
import { fmtDateTime, fmtDuration } from './time.js';

export interface QuoteShareItem {
  /** "Toyota Vios 2022". */
  name: string;
  plate: string;
  /** "5 chỗ · số tự động · xăng". */
  details: string;
  lines: { description: string; amount: number }[];
  total: number;
  deposit: number;
  kmLimit: number;
  photoFileId: string | null;
}

export interface QuoteShareInput {
  start: number;
  end: number;
  items: QuoteShareItem[];
  showPlate: boolean;
  shopName: string;
}

const vnd = (n: number) => `${n < 0 ? '−' : ''}${fmtNumber(Math.abs(n))}đ`;

export function buildQuoteShare(i: QuoteShareInput): RentalShareDoc {
  const shop = i.shopName.trim() || 'Cửa hàng';
  const range = `${fmtDateTime(i.start)} → ${fmtDateTime(i.end)}`;
  const blocks: ShareBlock[] = i.items.map((x) => ({
    heading: [x.name, i.showPlate && x.plate].filter(Boolean).join(' · '),
    icon: '🚗',
    rows: [
      ...(x.details ? [{ label: 'Xe', value: x.details }] : []),
      ...x.lines.map((l) => ({ label: l.description, value: vnd(l.amount) })),
      { label: 'Tổng tiền thuê', value: vnd(x.total), strong: true },
      { label: 'Tiền cọc', value: x.deposit ? vnd(x.deposit) : 'Không cần cọc' },
      { label: 'Giới hạn quãng đường', value: x.kmLimit ? `${fmtNumber(x.kmLimit)} km` : 'Không giới hạn' },
    ],
  }));
  return {
    stage: 'quote',
    title: i.items.length > 1 ? `Báo giá ${i.items.length} xe trống` : 'Báo giá thuê xe',
    icon: '📋',
    code: '',
    plate: '',
    subtitle: range,
    lead: ['Chào anh/chị,', `${shop} gửi anh/chị báo giá thuê xe tự lái từ ${fmtDateTime(i.start)} đến ${fmtDateTime(i.end)} (${fmtDuration(i.end - i.start)}):`],
    blocks,
    notes: [
      'Giá chưa gồm phí giao xe tận nơi (nếu có), xăng / sạc pin và phí cầu đường.',
      'Xe trống theo lịch lúc gửi báo giá — xe được giữ chỗ khi anh/chị đặt cọc.',
    ],
    photos: i.items.map((x) => x.photoFileId).filter((x): x is string => !!x),
    photosHeading: 'Ảnh xe',
    pay: null,
  };
}
