// Phụ kiện kèm một lượt thuê (dùng chung API + web).

export interface PlannedAccessory {
  /** id trong vehicle_accessories; null = món thêm riêng cho lượt này. */
  id: number | null;
  name: string;
  quantity: number;
  value: number;
  /** false = lượt này không kèm (đang thiếu, hỏng, đem sửa…). */
  present: boolean;
  note?: string | null;
}

/**
 * Danh sách phụ kiện của lượt: theo danh sách đã chỉnh lúc đặt xe, cộng các món mới thêm vào xe
 * sau đó. Chưa chỉnh (null) thì theo danh sách hiện tại của xe.
 */
export function mergeAccessoryPlan<T extends PlannedAccessory>(planned: T[] | null | undefined, current: T[]): T[] {
  if (!planned) return current;
  const known = new Set(planned.map((a) => a.id).filter((x) => x != null));
  return [...planned, ...current.filter((a) => a.id == null || !known.has(a.id))];
}
