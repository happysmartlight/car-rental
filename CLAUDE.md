# Car Rental

Web app quản lý cho thuê xe tự lái, tự host trên Raspberry Pi 5 (Docker + Tailscale).
Người dùng chính: chủ cửa hàng (5 xe) + 1 nhân viên giao xe, dùng chủ yếu trên iPhone (PWA).
Giao diện và thông báo **tiếng Việt**. Kế hoạch: [docs/PLAN.md](docs/PLAN.md) · việc treo: [docs/BACKLOG.md](docs/BACKLOG.md).

## Cấu trúc

- `apps/api` — Fastify 5 + TypeScript (NodeNext, import có đuôi `.js`), SQLite (better-sqlite3) + Drizzle.
  - `src/shared/` — code thuần (giá, tiền, VietQR, QR CCCD, giờ VN, chữ) **dùng chung với web** qua alias `@shared/*`. Không import gì của Node ở đây.
  - `src/services/` — nghiệp vụ (rentals, fines, documents, alerts, updateFlow). Đổi trạng thái lượt thuê chỉ qua `services/rentals.ts`.
  - `src/routes/` — HTTP; kiểm tra input bằng zod qua `parse()`; lỗi ném `HttpError` (message tiếng Việt).
  - `src/lib/` — auth, files (sharp), backup, pack (mã hóa), telegram, updater (giao tiếp file với sidecar), scheduler.
- `apps/web` — React 19 + Vite + Tailwind v4 + Radix. Kiểu dữ liệu: `src/lib/types.ts` (import type từ `@api/db/schema`).
- `deploy/` — `docker-compose.yml`, `updater.sh` (sidecar cập nhật, sh thuần), `setup.sh`, entrypoint.

## Quy tắc không được phá

1. **Giờ VN cố định UTC+7.** Dùng hàm trong `shared/time.ts`, không dùng `Date#getHours()` hay TZ máy. Tra phạt nguội lệch giờ = sai người.
2. **Không xóa cứng** khách, lượt thuê, hợp đồng, phiếu thu (dùng `archivedAt`, `voidedAt`). Lịch sử là bằng chứng phạt nguội.
3. **`rental_segments` là nguồn sự thật** xe nằm trong tay ai (giờ thực tế). Giao/nhận xe phải ghi segment.
4. **Văn bản đã sinh là bất biến** — không render lại đè lên file cũ.
5. **Migration chỉ THÊM** (bảng/cột mới nullable hoặc có default). Không đổi tên/xóa cột trong cùng bản — để "quay về bản cũ" chạy được trên DB đã nâng cấp. Sửa `schema.ts` xong chạy `npm run db:generate`; CI chặn nếu quên.
6. Tiền là số nguyên VND. Sổ tiền theo `shared/money.ts` (charges = phải trả, payments in/out/offset).
7. Secrets (Telegram, mật khẩu backup, cấu hình cập nhật) ở `data/config/local.json`, KHÔNG trong DB.
8. Ảnh CCCD/GPLX: chỉ qua `/api/files/:id` có đăng nhập; xem bản đầy đủ phải ghi `audit`.
9. Sửa nội dung mẫu Word dựng sẵn (`scripts/build-default-templates.ts`) → chạy `npm run templates -w apps/api` và **tăng `rev`** trong `BUILTINS` (`services/documents.ts`) để máy đang chạy tự lên mẫu mới. Mẫu người dùng đã thay file (`builtin = "<key>-user"`) không bị đè.

## Giao diện

Theo [docs/DESIGN.md](docs/DESIGN.md): token màu trong `index.css` (`bg-surface`, `text-muted`, `border-border`…), component trong `components/ui`.
Mobile-first: chừa safe-area, ô nhập ≥16px trên iOS, nút ≥40px. Ô tiền dùng `MoneyInput`. Ngày giờ dùng `DateTimeInput` (giờ VN).

## Kiểm tra trước khi xong

`npm run typecheck && npm test && npm run build`. Test tích hợp `apps/api/src/app.test.ts` chạy cả luồng thuê trên DB tạm — thêm ca mới khi đổi nghiệp vụ.
Thử giao diện: `DATA_DIR=./data-demo npm run seed:demo -w apps/api`, build web, chạy `node apps/api/dist/index.js` với `DATA_DIR` đó.

## Phát hành

Thêm mục `## [X.Y.Z]` vào CHANGELOG.md (tiếng Việt, viết cho người dùng) → `npm run release -- X.Y.Z` → `git push && git push --tags`.
CI build image arm64 lên GHCR + tạo GitHub Release; app trên Pi thấy bản mới trong trang Cập nhật.
Đổi `deploy/docker-compose.yml` hoặc `deploy/updater.sh` → updater tự áp dụng khi cập nhật (lấy từ tag tương ứng).
