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
| `bg-brand-solid` + `text-brand-fg` | Nền đặc có chữ trắng: nút chính, ô tích, số thứ tự bước. Không dùng `bg-brand` cho chỗ có chữ: ở giao diện tối `--brand` quá sáng, chữ trắng không đọc được |
| `bg-popover` | Lớp nổi: menu, danh sách xổ xuống, ô tìm nhanh (giao diện tối sáng hơn thẻ phía sau) |
| `bg-hover` | Dòng đang trỏ/chọn trong menu và danh sách |
| `bg-chart-in` / `bg-chart-out` / `bg-chart-profit` | Biểu đồ thu chi: thu (xanh) / chi (cam) / lãi (xanh ngọc). Trong SVG dùng `var(--chart-in)`… Đã kiểm tra phân biệt được với người mù màu, cả sáng lẫn tối |

Ô chọn `<select>` dùng component `Select` (class `select-chevron` vẽ mũi tên). Không viết `bg-[…]` tùy ý cạnh `bg-surface`
— tailwind-merge sẽ xóa mất màu nền. Danh sách lựa chọn bên trong lấy màu `--popover` từ CSS gốc.

Màu trạng thái dùng `Badge tone=` / `Notice tone=` (`blue` đã đặt, `violet` đang thuê, `amber` chờ/cảnh báo,
`red` quá hạn/lỗi, `green` xong). Màu Tailwind trực tiếp chỉ cho số tiền âm/dương, cảnh báo nhỏ — luôn kèm `dark:`.
Xanh và cam dùng tông 700 (`text-emerald-700`, `text-amber-700`), tông 600 không đủ tương phản trên nền sáng. Đỏ dùng `text-red-700` khi nằm trên `bg-bg` hoặc `bg-surface-2`.
Không dùng `opacity-*` để làm mờ chữ cần đọc: muốn báo "không khả dụng" thì đổi viền, nền hoặc làm mờ ảnh.

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

## Chuyển động

Mục tiêu là phản hồi nhanh, không bắt người dùng chờ. Các class nằm trong `index.css`, đều tự tắt khi máy bật giảm chuyển động.

| Class / component | Dùng cho |
|---|---|
| `anim-page` | Vào trang (`Page` đã có sẵn). Chỉ đổi opacity |
| `anim-stagger` | Đặt ở thẻ cha: các thẻ, dòng con lần lượt hiện ra |
| `anim-grow-x` / `anim-grow-y` | Thanh tiến độ, cột biểu đồ |
| `anim-draw` | Đường biểu đồ (cần `pathLength={1}`) |
| `anim-pop` | Dấu tích |
| `press` | Phản hồi khi bấm, thay cho `transition-colors`. Dòng danh sách dùng `active:bg-surface-2` |
| `CountUp` (`components/ui/count-up.tsx`) | Số chạy, chỉ cho ô tổng để xem nhanh |

- Không dùng `CountUp` cho ô nhập, báo giá, phiếu thu, quyết toán: ở đó phải thấy đúng số ngay. Mỗi ô cần `id` riêng để quay lại trang không chạy lại từ 0.
- Hoạt ảnh đáng xem ở phần dưới trang phải đợi cuộn tới, dùng `useSeenOnScreen` (`CountUp` và biểu đồ đã có sẵn). Nếu không, trên điện thoại nó chạy xong trước khi người dùng nhìn thấy.
- Chỉ animate `transform`, `opacity`. Không dùng hiệu ứng nảy, không nhấp nháy trang trí.
- Không để lại `transform` sau khi chạy (không dùng `forwards` với transform, trừ hoạt ảnh đóng hộp thoại): nó làm hỏng `fixed`, `sticky` của phần tử con.

## Bố cục

- `Page` (trong `AppShell.tsx`): tiêu đề dính trên cùng khi cuộn trên điện thoại, nút quay lại, hành động bên phải.
- Máy tính (≥1024px): sidebar trái. Điện thoại: thanh tab dưới + nút **+** giữa (tạo nhanh).
- Nút hành động chính của form dài: dính đáy (`sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`) để luôn bấm được.
- Vùng bấm cao ≥40px dưới `lg`, chỉ thu nhỏ từ `lg:` trở lên (`Button size="sm"`, `Segmented`, `Checkbox`, `Switch` đã làm sẵn). Nút tự viết: thêm `min-h-10 lg:min-h-0` hoặc `py-2.5 lg:py-1`. Nút icon hoặc link nhỏ trong dòng, không muốn đổi bố cục: thêm class `tap-target`.

## Checklist trước khi xong một màn hình

- [ ] Xem ở 390px và 1440px, cả sáng lẫn tối.
- [ ] Ô nhập trên iOS không bị zoom (font ≥16px trên mobile — đã đặt trong CSS gốc).
- [ ] Chữ đạt tương phản ≥4,5:1 ở cả sáng lẫn tối; nút và ô chọn có vùng bấm ≥40px trên điện thoại.
- [ ] Phần tử dính đáy/đỉnh có chừa safe-area.
- [ ] Trạng thái rỗng (`Empty`), đang tải (`Skeleton`/`PageLoader`), lỗi (toast tiếng Việt).
- [ ] Không lộ đủ số CCCD trong danh sách (dùng `maskId`).
