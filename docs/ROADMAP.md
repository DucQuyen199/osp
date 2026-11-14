# Lộ trình

Trạng thái hiện tại: **v0.2** — hệ thống có kernel Rust, PostgreSQL, API REST và React; chưa phải sản phẩm hoàn chỉnh để bán.

## Đã có

- 50 module, 186 loại dữ liệu, 835 sự kiện, 22 gói ngành; nghiệp vụ liên module chạy trong Rust bounded contexts.
- PostgreSQL, transaction/savepoint, tenant lock, migration, RLS, backup.
- Tài sản cố định có vốn hóa, khấu hao theo hai phương pháp, thanh lý và báo cáo lịch dự báo theo tháng dùng chung công thức Decimal với luồng ghi sổ.
- Application của module tài sản cố định chia facade và use case nhỏ cho chuẩn hóa tài sản, khấu hao, vốn hóa, thanh lý và cập nhật sổ cái.
- Application kế toán giữ facade nhỏ; phân giải tài khoản, ghi sổ bút toán và phân bổ phế phẩm sản xuất được tách thành các module Rust theo trách nhiệm riêng, vẫn chạy trong transaction của kernel.
- Persistence thanh toán kế toán giữ facade và chia kiểm tra hóa đơn, hoàn tiền, nguồn thanh toán và tài khoản mặc định thành module Rust chuyên trách; số liệu tiếp tục dùng Decimal và transaction của kernel.
- Handler tồn kho tách riêng điều chuyển/kiểm kê và biến động từ sự kiện nguồn; khâu chuẩn bị tách tracked-lines khỏi định giá stock-move. Facade Rust giữ hợp đồng gọi hiện tại cho event composition root.
- Webhook outbox được ghi cùng transaction phát event; worker Rust claim có lease, gửi HTTPS có kiểm tra SSRF và HMAC, retry có giới hạn, dead-letter cùng API quản trị retry/đóng delivery.
- Nhật ký audit được RLS `FORCE` theo tenant; trigger PostgreSQL chặn cập nhật, xóa trực tiếp và `TRUNCATE` trong luồng DB thông thường.
- RBAC, Argon2id, phiên và API token, rate limiting, OpenAPI 3.1.
- React/Vite, giao diện quản trị, timeline liên module, responsive; design system và rà axe-core.
- Bàn vận hành hóa đơn điện tử: hàng đợi theo trạng thái, liên kết hóa đơn kế toán, xem lỗi/phản hồi/lịch sử gọi provider, thử lại và yêu cầu hủy có lý do. Phát hành thật vẫn cần ánh xạ hợp đồng và thông tin xác thực từ provider được chọn.
- Phụ lục hợp đồng được lập, gửi duyệt, áp dụng theo ngày hiệu lực và ghi snapshot lịch sử; hỗ trợ đổi tên, điều khoản, giá trị và ngày kết thúc trên hợp đồng đang hiệu lực.
- Thuê bao lưu ngày bắt đầu mặc định và neo ngày thu theo lịch gốc, tránh trôi lịch tháng/quý/năm qua các tháng ngắn; kỳ đến hạn tiếp tục tự lập hóa đơn bằng scheduler.
- Nhà thuốc chỉ ghi nhận cấp phát qua state machine sau giao dịch POS hoàn tất; timestamp, lịch sử đơn thuốc và bán hàng cùng commit/rollback.
- Lệnh sản xuất theo dõi sản lượng đạt/phế phẩm riêng trong QC; thành phẩm theo dõi lô nhận mã lô và hạn dùng được liên kết tới phiếu QC và tồn kho.
- Bàn bán buôn cho phép lập thêm vận đơn theo số lượng còn lại, tính cả chuyến nháp/đang giao/đã giao và loại phần giao thất bại khỏi lượng đã phân công.
- Lịch hẹn ở trạng thái yêu cầu tính lại giờ kết thúc và giá mặc định khi đổi dịch vụ hoặc giờ bắt đầu; khung giờ mới tiếp tục qua kiểm tra khóa tài nguyên và trùng lịch.
- Ký thầu phụ chỉ ghi nhận cam kết chi phí; hồ sơ nghiệm thu/đề nghị thanh toán có giá trị lũy kế được giới hạn trong hợp đồng và chỉ phát sinh hóa đơn phải trả sau khi duyệt.
- Mua hàng chỉ ghi nhận GRNI khi nhận kho; nhiều hóa đơn nhà cung cấp theo từng đợt nhận được đối chiếu lũy kế với số lượng nhận/trả và GRNI, công nợ chỉ phát sinh sau khi duyệt từng hóa đơn; hàng trả trước hóa đơn giảm GRNI, hàng trả sau hóa đơn gắn với bill để điều chỉnh giảm phải trả.
- Docker image Linux đã build và chạy qua Compose test riêng; đã diễn tập pg_dump/pg_restore, restart, RLS, phiên đăng nhập và luồng bán hàng sau khôi phục. Vẫn cần xác minh vận hành/tải/HA trên hạ tầng production thực tế.

## Còn thiếu

- SSO/OIDC, 2FA, mã hóa at-rest, lưu audit độc lập/WORM chống DBA, metrics/traces/alerts và kiểm thử xâm nhập.
- Email xác thực/thông báo hỗ trợ HTTPS provider hoặc SMTP mã hóa; còn cần cấu hình DNS email (SPF/DKIM/DMARC), API ngân hàng/thanh toán trực tiếp và adapter vận chuyển. Đối soát ngân hàng hiện nhận CSV và ISO 20022 CAMT.053 từ tệp.
- Tối ưu chỉ mục/truy vấn theo workload, mở rộng scheduler và billing/licensing OSP.
- Kế toán Việt Nam có mẫu tài khoản cấp 1 và các mã chi tiết được liệt kê trong phụ lục TT99/2025, TT133/2016; vẫn thiếu ánh xạ biểu mẫu, kê khai thuế chính thức, nhập ngân hàng trực tiếp và xác minh chuyên môn.
- Hóa đơn điện tử cần adapter nhà cung cấp. Kho/sản xuất cần xác minh production và đào sâu các nghiệp vụ theo ngành.
- BI hỗ trợ tự thiết kế báo cáo, dashboard, KPI, lưu snapshot theo lịch ngày/tuần và gửi CSV đính kèm qua hàng đợi SMTP hoặc HTTPS email provider.
- Hóa đơn nhà cung cấp cho phép ghi giá/thuế thực tế và phí/chiết khấu có mô tả, thuế riêng; chênh lệch giá và điều chỉnh cấp hóa đơn được ghi rõ vào chi phí mua (632), không làm treo GRNI. Quy tắc duyệt hỗ trợ dung sai theo ngưỡng hóa đơn; quy trình tranh chấp lưu lý do, hủy yêu cầu duyệt đang chờ và yêu cầu ghi chú giải quyết trước khi gửi lại. Còn thiếu phân bổ landed cost vào valuation layer, đối chiếu phần điều chỉnh với credit note khi trả hàng và chuyên gia xác minh cách xử lý thuế từng trường hợp.
- Đối soát sao kê ngân hàng đã hỗ trợ đồng tiền giao dịch, snapshot tỷ giá từng dòng, CSV/CAMT.053 và kiểm tra với giá trị sổ cái tiền cơ sở; còn thiếu kết nối API ngân hàng trực tiếp và báo cáo hợp nhất. Còn thiếu đa công ty, accessibility với trình đọc màn hình, đa ngôn ngữ, POS/KDS chuyên dụng, PWA/offline, tải HTTP và đa trình duyệt. Bulk action cho mọi entity có state machine đã có API Rust và giao diện danh sách; giới hạn 100 bản ghi mỗi giao dịch và rollback cả lô nếu một chuyển trạng thái lỗi. Kế toán hiện snapshot tỷ giá chứng từ/thanh toán, ghi nhận FX realized và tạo nháp đánh giá lại công nợ theo ngày.

Các module CRM/Marketing, bán hàng, mua hàng, loyalty, logistics, field service, helpdesk, LMS, performance, ngân sách, lịch, nhà hàng, lương và bán vé đã có luồng Rust nền tảng; cần hoàn thiện theo ngành và phản hồi khách hàng. Payroll hiện có thuế, khoản đóng góp theo policy tenant, giờ làm thêm đã duyệt và thanh toán công nợ khoản đóng; cần chuyên môn hóa bảng thuế/bảo hiểm, điều kiện tham gia, khai báo và quyết toán theo từng pháp vực.

## Thứ tự đề xuất

1. Chọn một ngành theo nhu cầu khách hàng thật.
2. Hoàn tất email, tích hợp, scheduler, quan sát và accessibility.
3. Đào sâu luồng nghiệp vụ ngành, tối ưu giao diện và tích hợp hóa đơn điện tử.
4. Bán thử cho 3–5 khách, sau đó mở rộng bằng vertical pack.

## Nguyên tắc

- Ưu tiên độ tin cậy số liệu, nhất là tiền và tồn kho.
- Mỗi tính năng cần kiểm thử luồng và tài liệu.
- Không cam kết tuân thủ pháp lý trước khi có tư vấn chuyên môn.
