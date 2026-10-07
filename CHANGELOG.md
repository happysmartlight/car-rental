# Thay đổi

Ghi theo phiên bản, mới nhất ở trên. Nội dung mục của từng phiên bản được dùng làm ghi chú
hiển thị trong trang **Cài đặt → Phiên bản & cập nhật**.

## [0.2.3] - 2026-10-07

### Sửa
- **Điện thoại: các trang không còn bị tràn ra ngoài màn hình** (khung và ô nhập liệu bị cắt mất bên phải). Gặp ở Tổng quan, Đặt xe mới, Xe, hồ sơ khách và Mẫu hợp đồng — do dòng chữ dài (giá tháng, tên khách, danh sách tiện nghi) kéo rộng cả trang. Nay dòng dài tự xuống dòng hoặc rút gọn bằng "…".
- Danh sách hợp đồng & biên bản trong lượt thuê, danh sách mẫu hợp đồng và thẻ xe đang bảo dưỡng: tên không còn bị bóp mỗi chữ một dòng — các nút tự xuống hàng dưới khi chật.
- Đặt xe mới: dòng thông tin xe hiện đủ cả giá ngày và giá tháng.
- Laptop màn nhỏ / iPad xoay ngang: Đặt xe mới, chi tiết lượt thuê, chi tiết xe và Cài đặt chỉ chia nhiều cột khi đủ rộng, không còn ô nhập bị bóp hẹp.

## [0.2.2] - 2026-10-07

### Sửa
- **iPhone: ô chọn ngày giờ bị tràn ra ngoài khung** (giờ nhận/trả xe khi đặt xe, ngày lễ Tết trong Giá & quy định…). Lỗi này còn làm cả trang bị thu nhỏ — thanh tiêu đề hụt một khoảng bên phải — và mỗi lần chạm vào ô nhập là màn hình tự phóng to. Nay các ô nằm gọn trong khung, trang không còn tự phóng to khi nhập liệu (vẫn chụm hai ngón để phóng to được).
- Phụ thu lễ, Tết: hai ô ngày có nhãn **Từ ngày / Đến ngày**, không còn là hai ô trống khó phân biệt trên điện thoại.

## [0.2.1] - 2026-10-06

### Cải tiến
- **Ghi phạt nguội thủ công thông minh hơn**: chọn xe từ danh sách đội xe (vẫn có "Biển khác" để nhập tay). Vừa chọn giờ vi phạm là app tra ngược lịch sử thuê và hiện ngay người đang giữ xe lúc đó — tên, SĐT, CCCD, mã hợp đồng, giờ giao/nhận, lái phụ — và tự gắn hồ sơ vào khách đó khi lưu.
- Vi phạm sát giờ giao/nhận xe có cảnh báo đối chiếu ảnh và biên bản. Xe ở bãi lúc đó thì gợi ý các lượt thuê kề trước/sau (trong 6 giờ) để chọn nếu giờ trên thông báo bị lệch. Lượt đặt chưa ghi giao xe, xe đang bảo dưỡng/sửa chữa cũng được báo rõ.
- Bấm vào thẻ khách để gắn hoặc bỏ gắn; mở lại hồ sơ cũ không tự đổi khách đã gắn.

## [0.2.0] - 2026-10-06

### Mới
- **Thuê theo tháng**: mỗi xe có giá tháng và giới hạn km/tháng. App tự chọn cách tính rẻ hơn cho khách (theo ngày hay theo tháng dương lịch); ngày lẻ tính bằng giá tháng ÷ 30; thuê gần tháng mà tính ngày đắt hơn thì tự áp giá 1 tháng. Nút chọn nhanh 1 / 3 / 6 tháng khi đặt xe, gia hạn nhanh +1 ngày / +1 tuần / +1 tháng. Giá tháng có trong hợp đồng và ảnh/tin nhắn chia sẻ bảng giá.
- **Kiểm tra phạt nguội chỉ cần biển số**: chọn xe → Kiểm tra, mỗi vi phạm tìm được tự hiện người đang giữ xe lúc đó, bấm "Ghi hồ sơ" một lần. Dịch vụ tra cứu tự động lỗi thì chép biển số, mở trang chính thức của Cục CSGT, dán kết quả vào app — app tự đọc giờ vi phạm. Tra theo giờ (khi có thông báo giấy) chuyển thành mục phụ.
- **Tự kiểm tra phạt nguội cả đội xe** mỗi ngày hoặc mỗi tuần: vi phạm mới tự ghi hồ sơ và báo Telegram kèm tên khách.

### Sửa
- Giao diện tối: ô chọn (dropdown) bị nền trắng chữ trắng — nay có nền tối, đủ tương phản; menu, ô tìm nhanh, danh sách chọn khách nổi rõ trên nền; dòng đang chọn dễ thấy; chữ đỏ/xanh/vàng sáng hơn; thông báo đổi màu theo giao diện.
- Ô chọn thiếu mũi tên và bị cắt chữ.

## [0.1.0] - 2026-10-06

Bản đầu tiên.

### Tính năng
- **Khách hàng**: quét QR trên căn cước để điền form, ảnh CCCD/GPLX, báo trùng hồ sơ, danh sách đen, lịch sử thuê.
- **Xe**: bảng giá (ngày, cuối tuần, giờ lẻ, giới hạn km), hạn đăng kiểm/bảo hiểm/phí đường bộ, mốc bảo dưỡng, lịch gara.
- **Phụ kiện trên xe**: danh mục dựng sẵn ~30 món (cảm biến áp suất lốp, camera, sạc dự phòng, nước hoa…), tìm không dấu và theo tên gọi khác, gợi ý theo xe cùng dòng / cả đội / xe điện, chép từ xe khác, áp cho cả đội. Phụ kiện tự vào checklist giao/nhận và hợp đồng; nhận xe thiếu món nào thì tự đề xuất khoản đền bù.
- **Chia sẻ bảng giá cho khách**: ảnh bảng giá từng xe hoặc cả đội (giá, tiện nghi, phụ thu lễ Tết sắp tới, thủ tục, số liên hệ) và tin nhắn chữ để dán Zalo — gửi qua nút chia sẻ của điện thoại.
- **Đặt xe**: báo giá trực tiếp, thấy xe trống, chặn trùng lịch, cảnh báo GPLX/danh sách đen/phạt nguội còn nợ, lái phụ, cọc, tài sản thế chấp.
- **Hợp đồng tự động**: 3 mẫu Word dựng sẵn, xuất Word + PDF, lưu ảnh bản đã ký. Tải mẫu Word của riêng bạn lên được.
- **Giao / nhận xe** trên điện thoại: ODO, xăng, 6 khung ảnh đóng dấu giờ, vết trầy, giấy tờ kèm theo, chữ ký khách; tự tính phí trễ giờ, vượt km.
- **Quyết toán**: cấn trừ cọc, giữ một phần cọc chờ phạt nguội và nhắc hoàn; mã VietQR đúng số tiền.
- **Phạt nguội**: tra ngược biển số + giờ vi phạm ra người giữ xe; ghi hồ sơ vi phạm, trừ vào cọc.
- **Lịch xe** dạng timeline, **Tổng quan** với việc cần làm, doanh thu tháng, tỉ lệ lấp đầy.
- **Thông báo Telegram** và bản tin buổi sáng.
- **Sao lưu** hằng đêm + gửi Telegram có mã hóa; khôi phục trên giao diện.
- **Cập nhật trong app**: cập nhật một chạm, tự cập nhật ban đêm, tự quay về khi bản mới lỗi, quay về bản cũ kèm dữ liệu.
- Quản trị / nhân viên, nhật ký thao tác, giao diện sáng/tối, cài lên màn hình điện thoại.
