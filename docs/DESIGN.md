# Quy ước giao diện

Đọc trước khi tạo/sửa màn hình. Mục tiêu: dùng tốt bằng một tay trên iPhone lúc đứng ngoài bãi xe,
và gọn gàng trên laptop.

## Màu & theme

Token định nghĩa trong `apps/web/src/index.css` (`:root` = sáng, `.dark` = tối). Chỉ dùng token, không dùng mã màu cứng
cho nền/chữ/viền:

| Token | Dùng cho |
|---|---|
| `bg-bg` | Nền trang |
| `bg-surface` | Thẻ, hộp thoại |
| `bg-surface-2` / `bg-surface-3` | Nền phụ, nút secondary, hover |
| `border-border` / `border-border-strong` | Viền thẻ / viền ô nhập |
| `text-fg` / `text-muted` / `text-subtle` | Chữ chính / phụ / mờ |
| `bg-brand`, `text-brand`, `bg-brand-soft` | Màu nhấn (xanh dương), mục đang chọn |
| `bg-popover` | Lớp nổi: menu, danh sách xổ xuống, ô tìm nhanh (giao diện tối sáng hơn thẻ phía sau) |
| `bg-hover` | Dòng đang trỏ/chọn trong menu và danh sách |
| `bg-chart-in` / `bg-chart-out` / `bg-chart-profit` | Biểu đồ thu chi: thu (xanh) / chi (cam) / lãi (xanh ngọc). Trong SVG dùng `var(--chart-in)`… Đã kiểm tra phân biệt được với người mù màu, cả sáng lẫn tối |

Ô chọn `<select>` dùng component `Select` (class `select-chevron` vẽ mũi tên). Không viết `bg-[…]` tùy ý cạnh `bg-surface`
— tailwind-merge sẽ xóa mất màu nền. Danh sách lựa chọn bên trong lấy màu `--popover` từ CSS gốc.

Màu trạng thái dùng `Badge tone=` / `Notice tone=` (`blue` đã đặt, `violet` đang thuê, `amber` chờ/cảnh báo,
`red` quá hạn/lỗi, `green` xong). Màu Tailwind trực tiếp (`text-red-600`…) chỉ cho số tiền âm/dương, cảnh báo nhỏ — luôn kèm `dark:`.

Theme: sáng / tối / theo máy, lưu `localStorage.theme`, áp trước khi React chạy (không nháy).

## Chữ & số

- Font Be Vietnam Pro (tự host, đủ dấu tiếng Việt).
- Tiền: `fmtVnd` → `1.500.000 đ`; cột số dùng class `tabular`.
- Ngày giờ: `fmtDateTime` → `14:30 06/10/2026` (giờ VN). Không dùng `toLocaleString`.

## Thành phần (`components/ui`)

`Button` (primary, secondary, outline, ghost, danger), `Card` + `CardHeader` + `CardBody`, `Badge`, `Notice`,
`InfoRow`, `Stat`, `Empty`, `Dialog` (điện thoại = bottom sheet, máy tính = giữa màn hình), `useConfirm()`,
`Menu`. Form: `Field`, `Input`, `Select` (native — đẹp trên iOS), `MoneyInput` (tự nhóm nghìn), `NumberInput`,
`DateTimeInput`, `DateInput`, `Checkbox`, `Switch`, `Segmented`.
Ảnh: `PhotoInput` (nén trên máy trước khi gửi, đóng dấu giờ), `Gallery`. Khác: `VietQr`, `SignaturePad`, `FuelGauge`, `CccdScanner`,
`CashEntryDialog` (ghi khoản thu chi / khoản định kỳ — dùng lại ở mọi nơi cần ghi chi phí).

## Bố cục

- `Page` (trong `AppShell.tsx`): tiêu đề dính trên cùng khi cuộn trên điện thoại, nút quay lại, hành động bên phải.
- Máy tính (≥1024px): sidebar trái. Điện thoại: thanh tab dưới + nút **+** giữa (tạo nhanh).
- Nút hành động chính của form dài: dính đáy (`sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`) để luôn bấm được.

## Checklist trước khi xong một màn hình

- [ ] Xem ở 390px và 1440px, cả sáng lẫn tối.
- [ ] Ô nhập trên iOS không bị zoom (font ≥16px trên mobile — đã đặt trong CSS gốc).
- [ ] Phần tử dính đáy/đỉnh có chừa safe-area.
- [ ] Trạng thái rỗng (`Empty`), đang tải (`Skeleton`/`PageLoader`), lỗi (toast tiếng Việt).
- [ ] Không lộ đủ số CCCD trong danh sách (dùng `maskId`).
