// Phí sàn Mioto và thông tin chủ xe ký gửi chỉ quản lý được biết. Nhiều route trả nguyên dòng lượt thuê, dòng xe,
// nên lọc tập trung ở hook preSerialization thay vì nhớ sửa từng route.

const ADMIN_ONLY = new Set(['ownerName', 'ownerPhone', 'ownerSharePct', 'channelFee', 'channelFeePct', 'channelPayout', 'channelPaidAt', 'channelMoney', 'channelOwed', 'miotoFeePct']);

/** Bỏ các trường chỉ quản trị thấy ở mọi độ sâu (chỉ đụng object thường và mảng). */
export function stripAdminOnly(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripAdminOnly);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!ADMIN_ONLY.has(k)) out[k] = stripAdminOnly(x);
    return out;
  }
  return v;
}
