// Phiếu báo khách một vi phạm phạt nguội trong thời gian thuê (ảnh hoặc tin nhắn Zalo),
// kèm mã QR nếu khách chuyển tiền để cửa hàng nộp thay / hoàn lại tiền cửa hàng đã nộp.

import type { FineStatus } from './constants.js';
import type { RentalShareDoc, ShareRow } from './rentalShare.js';
import { fmtNumber } from './text.js';
import { fmtDateTime } from './time.js';

export interface FineShareInput {
  fine: {
    plate: string;
    violatedAt: number;
    location: string | null;
    violation: string | null;
    amount: number | null;
    status: FineStatus;
    noticeFileId: string | null;
  };
  rental: { code: string; start: number; end: number | null } | null;
  customerName: string;
  shopName: string;
}

const vnd = (n: number) => `${fmtNumber(n)}đ`;

export function buildFineShare(i: FineShareInput): RentalShareDoc {
  const { fine: f, rental: r } = i;
  const shop = i.shopName.trim() || 'Cửa hàng';
  const rows: ShareRow[] = [{ label: 'Biển số', value: f.plate }, { label: 'Thời gian vi phạm', value: fmtDateTime(f.violatedAt), strong: true }];
  if (f.location) rows.push({ label: 'Địa điểm', value: f.location });
  if (f.violation) rows.push({ label: 'Lỗi vi phạm', value: f.violation });
  rows.push(f.amount ? { label: 'Mức phạt', value: vnd(f.amount), strong: true, tone: 'red' } : { label: 'Mức phạt', value: 'Chờ quyết định xử phạt' });
  const paidByShop = f.status === 'we_paid';
  const notes = [
    'Theo hợp đồng thuê xe, vi phạm giao thông trong thời gian thuê (kể cả phát hiện sau khi đã trả xe) do bên thuê chịu trách nhiệm.',
    paidByShop
      ? 'Cửa hàng đã nộp phạt thay anh/chị — anh/chị vui lòng hoàn lại số tiền trên.'
      : 'Anh/chị có thể tự đến cơ quan CSGT giải quyết, hoặc chuyển khoản để cửa hàng nộp thay.',
    'Tra cứu chính thức: csgt.bocongan.gov.vn hoặc ứng dụng VNeTraffic (Bộ Công an).',
  ];
  return {
    stage: 'fine',
    title: 'Thông báo phạt nguội',
    icon: '🚨',
    code: r?.code ?? '',
    plate: f.plate,
    lead: [
      `Chào anh/chị ${i.customerName},`,
      `${shop} nhận được thông báo vi phạm giao thông (phạt nguội) của xe ${f.plate} trong thời gian anh/chị thuê xe${
        r ? ` (hợp đồng ${r.code}, từ ${fmtDateTime(r.start)}${r.end ? ` đến ${fmtDateTime(r.end)}` : ''})` : ''
      }.`,
    ],
    blocks: [{ heading: 'Vi phạm', icon: '🚦', rows }],
    notes,
    photos: f.noticeFileId ? [f.noticeFileId] : [],
    photosHeading: 'Ảnh thông báo vi phạm',
    pay: f.amount ? { label: paidByShop ? 'Hoàn lại tiền phạt' : 'Tiền phạt (cửa hàng nộp thay)', amount: f.amount, note: `${r?.code ?? f.plate} PHAT NGUOI` } : null,
  };
}
