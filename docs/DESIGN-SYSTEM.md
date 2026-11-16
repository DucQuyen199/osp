# OSP Design System · v1

Tài liệu này là quy chuẩn thiết kế và giao diện của OSP Suite. Ứng dụng React nằm trong [client/](../client); token CSS dùng chung nằm ở [client/public/app/styles/](../client/public/app/styles/).

**Phạm vi.** Ứng dụng web ERP/CRM đa module, đa ngành, tiếng Việt. Giao diện được **sinh tự động từ khai báo entity** (form, bảng, drawer, huy hiệu trạng thái, timeline) nên design system phải đủ chặt để hàng trăm màn hình sinh ra vẫn nhất quán mà không ai thiết kế từng màn.

**Công nghệ.** React + Vite, CSS thuần và ES modules. Production dùng bundle có bước build; vẫn chạy dưới CSP nghiêm ngặt (`script-src 'self'; style-src 'self'`), nên **cấm** `style="..."` inline và `<script>` inline.

Trong JSX cũng không dùng prop `style={{...}}`: CSP sẽ chặn thuộc tính style do React tạo. Dùng lớp CSS và design token; với biểu đồ dùng thuộc tính hình học SVG như `width`, `points` và `fill` để biểu diễn dữ liệu. Những lớp `u-legacy-*` là lớp tương thích được sinh khi di chuyển giao diện cũ; màn hình mới nên dùng tên lớp mô tả chức năng.

---

## 1. Nguyên tắc

| # | Nguyên tắc | Hệ quả khi thiết kế |
|---|---|---|
| 1 | **Nhất quán hơn sáng tạo** | Một vấn đề, một cách giải. Màn hình mới dùng lại thành phần có sẵn; chỉ thêm thành phần khi không thể ghép từ cái cũ. |
| 2 | **Thấy được chuỗi nhân quả** | Điểm khác biệt của OSP là các module tự phản ứng với nhau. Giao diện phải làm điều đó *nhìn thấy được* (tab "Hệ quả liên module", toast "9 bước tiếp theo đã tự chạy"), không để người dùng đoán. |
| 3 | **Ngôn ngữ của ngành** | Thuật ngữ đổi theo ngành ("Bệnh nhân", "Học viên"). Mọi nhãn đi qua lớp thuật ngữ, không viết cứng. |
| 4 | **Trạng thái quyết định hành động** | Nút hành động chỉ hiện khi trạng thái và quyền cho phép. Người dùng không bao giờ bấm vào thứ chắc chắn bị từ chối. |
| 5 | **Truy cập được là điều kiện, không phải tính năng** | WCAG 2.1 AA là mức tối thiểu. Có kiểm thử tự động bắt hồi quy (mục 9). |
| 6 | **Không phá hủy trong im lặng** | Hành động không thể hoàn tác phải qua hộp xác nhận nêu rõ hậu quả. |
| 7 | **Tài liệu là một phần của sản phẩm** | Thành phần không có trong tài liệu này coi như không tồn tại. |

---

## 2. Design tokens

Nguồn duy nhất: [tokens.css](../client/public/app/styles/tokens.css). **Quy tắc cứng: thành phần chỉ dùng token ngữ nghĩa** (`--text`, `--accent`, `--border`…), không dùng hex. Hiện không còn màu hex nào ngoài `tokens.css` (đã kiểm bằng tìm kiếm mã nguồn).

### 2.1 Màu

Tương phản đo bằng công thức WCAG 2.1 (tỷ lệ độ chói tương đối). "Cần" là ngưỡng AA: 4.5:1 cho chữ thường, 3:1 cho thành phần giao diện.

**Nền, viền, chữ**

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `--bg` | `#f4f5f8` | `#0d1117` | Nền trang |
| `--surface` | `#ffffff` | `#151a22` | Thẻ, bảng, drawer, ô nhập |
| `--surface-2` | `#eef0f4` | `#1c232d` | Đầu bảng, hover nhẹ, vùng phụ |
| `--border` | `#dde1e8` | `#29313d` | Đường kẻ trang trí |
| `--border-strong` | `#b9c1ce` | `#3d4757` | Viền nút phụ |
| `--border-input` | `#818c9e` | `#657080` | Viền ô nhập liệu (cần ≥ 3:1) |
| `--text` | `#151a23` | `#e8ebf1` | Chữ chính |
| `--text-muted` | `#546072` | `#a3adbb` | Chữ phụ, mô tả |
| `--text-faint` | `#5f6b7d` | `#8e99a8` | Chú thích nhỏ, hint |

**Nhấn (thương hiệu)**

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `--accent` | `#1f4fd8` | `#3f6df0` | Nền nút chính, viền focus, mục đang chọn |
| `--accent-hover` | `#1840b0` | `#5a82f5` | Hover nút chính |
| `--accent-text` | `#1a46c4` | `#8fb0ff` | Liên kết, chữ nhấn |
| `--accent-soft` | `#e6edff` | `#1b2745` | Nền mục đang chọn |
| `--on-accent` | `#ffffff` | `#ffffff` | Chữ trên `--accent` |

**Trạng thái** (mỗi nghĩa là một cặp chữ + nền)

| Ý nghĩa | Chữ (sáng / tối) | Nền (sáng / tối) | Dùng khi |
|---|---|---|---|
| `success` | `#0f6b37` / `#63d492` | `#e2f4e9` / `#123221` | Hoàn tất, đã thanh toán, đã duyệt |
| `warning` | `#7c4a00` / `#f3b94f` | `#fdf0d3` / `#3a2b0d` | Chờ xử lý, đến hạn, cần chú ý |
| `danger` | `#a82118` / `#ff8d82` | `#fde7e5` / `#401a16` | Thất bại, từ chối, hủy, quá hạn |
| `info` | `#0a5a9c` / `#74bbf3` | `#dff0fc` / `#102c44` | Đang xử lý, đã gửi, thông tin |
| `neutral` | `#384150` / `#c2cad6` | `#e9ecf1` / `#252d38` | Nháp, mới, mặc định |

Nền đặc: `--danger-solid` (nút xóa, toast lỗi), `--success-solid` (toast thành công), chữ trên chúng là `--on-solid`.

**Kết quả đo tương phản**

| Cặp | Sáng | Tối | Cần |
|---|---|---|---|
| Chữ chính / bề mặt | 17.4 | 14.6 | 4.5 |
| Chữ phụ / bề mặt | 6.4 | 7.7 | 4.5 |
| Chữ phụ / `--surface-2` | 5.6 | 7.0 | 4.5 |
| Chú thích (`faint`) / nền trang | 5.0 | 6.6 | 4.5 |
| Chữ trên nút chính | 6.6 | 4.5 | 4.5 |
| Link / bề mặt | 7.7 | 8.2 | 4.5 |
| Chữ trên nút xóa | 5.8 | 4.6 | 4.5 |
| Mọi huy hiệu trạng thái | 5.8 – 8.7 | 6.8 – 8.4 | 4.5 |
| Viền ô nhập / bề mặt | 3.4 | 3.5 | 3.0 |
| Viền focus / bề mặt | 6.6 | 3.9 | 3.0 |

> **Lịch sử.** Lần đo đầu phát hiện hai giá trị không đạt: chú thích `faint` trên nền trang (4.42:1) và viền ô nhập (1.8:1). Cả hai đã sửa (`--text-faint`, thêm `--border-input`). Khi đổi bất kỳ màu nào, phải đo lại.

**Quy tắc dùng màu**
- Màu **không bao giờ là kênh duy nhất**: huy hiệu trạng thái luôn có chữ; lỗi form luôn có dòng chữ kèm viền đỏ.
- Chỉ một màu nhấn. Không thêm màu thương hiệu thứ hai; cần phân biệt thì dùng chữ, icon hoặc nhóm.
- Chế độ tối do hệ điều hành quyết định mặc định (`prefers-color-scheme`), người dùng có thể ghi đè bằng nút ở thanh trên (lưu vào `localStorage`).

### 2.2 Chữ

Họ chữ hệ thống, không tải font ngoài (nhanh, không rò rỉ riêng tư, hỗ trợ đầy đủ dấu tiếng Việt):
`system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`. Mã/ID dùng `--font-mono`.

| Token | Cỡ | Dùng cho |
|---|---|---|
| `--fs-xs` | 12px | Huy hiệu, nhãn cột, siêu dữ liệu |
| `--fs-sm` | 13px | Hint, thông báo lỗi, ô bảng phụ |
| `--fs-md` | 15px | **Cỡ nền**: nội dung, ô nhập, nút |
| `--fs-lg` | 17px | Tiêu đề thẻ, tiêu đề mục |
| `--fs-xl` | 20px | `h2` |
| `--fs-2xl` | 26px | `h1` trang, số liệu lớn |
| `--fs-3xl` | 34px | Chỉ dùng ở trang đích |

Độ đậm: 400 (thường), 500 (nhãn, nút), 600 (tiêu đề), 700 (số liệu). Dòng: `--lh-base` 1.55 cho đoạn văn, `--lh-tight` 1.3 cho tiêu đề. Số trong bảng dùng `font-variant-numeric: tabular-nums` (lớp `.num`) để thẳng hàng.

### 2.3 Khoảng cách, bo góc, độ cao, chuyển động

| Nhóm | Token | Giá trị |
|---|---|---|
| Khoảng cách (lưới 4px) | `--sp-1` … `--sp-12` | 4, 8, 12, 16, 20, 24, 32, 40, 48 px (không có `--sp-7`, `--sp-9`, `--sp-11`) |
| Bo góc | `--r-sm` / `--r-md` / `--r-lg` / `--r-pill` | 6 / 10 / 14 / 999 px |
| Độ cao | `--shadow-1` / `-2` / `-3` | thẻ / menu nổi / drawer & dialog |
| Chuyển động | `--dur-fast` / `--dur` | 120 ms / 200 ms, easing `cubic-bezier(0.2, 0, 0, 1)` |
| Điều khiển | `--control-h` | 40px; **44px** khi con trỏ thô (`pointer: coarse`) |

`prefers-reduced-motion: reduce` đặt mọi thời lượng về 0 và tắt hoạt ảnh skeleton/spinner thành rất chậm.

### 2.4 Bố cục và điểm ngắt

| Điểm ngắt | Thay đổi |
|---|---|
| ≤ 960px | Sidebar thành ngăn kéo (nút menu + scrim), `two-col` xuống một cột, ẩn tên doanh nghiệp ở thanh trên |
| ≤ 900px | Trang đích một cột, ẩn danh sách điểm nổi bật |
| ≤ 640px | `form-grid` một cột |
| ≤ 560px | Danh sách mô tả (`dl`) xếp dọc |

Chiều rộng nội dung tối đa `--content-max` = 92rem; sidebar `--sidebar-w` = 16.5rem; thanh trên `--topbar-h` = 4rem.

**Lớp chồng (z-index):** skip-link 100 · toast 200 · menu 50 · sidebar mobile 40 · scrim 35 · thanh trên 30. Dialog/drawer dùng `<dialog>` gốc nên nằm ở *top layer* của trình duyệt, không cần z-index.

---

## 3. Thành phần

Mỗi thành phần ghi: mục đích, biến thể, trạng thái, truy cập, nên/không nên. Lớp CSS ở [components.css](../client/public/app/styles/components.css); toast và hộp xác nhận dùng [feedback.js](../client/src/lib/feedback.js).

### 3.1 Button — `.btn`
**Dùng khi:** thực hiện một hành động. Nút điều hướng thuần dùng thẻ `<a>`.

| Biến thể | Lớp | Dùng khi |
|---|---|---|
| Chính | `.btn-primary` | Một hành động quan trọng nhất của vùng (Tạo mới, Lưu). **Tối đa một nút chính mỗi vùng.** |
| Phụ | `.btn` | Hành động bổ trợ (Hủy, Xuất CSV) |
| Nguy hiểm | `.btn-danger` | Xóa, thu hồi — chỉ xuất hiện *trong hộp xác nhận*, không đặt sẵn ngoài trang |
| Ẩn nền | `.btn-ghost` | Nút icon ở thanh công cụ |
| Kích cỡ | `.btn-sm` (32px) | Nút trong bảng/hàng |

| Trạng thái | Biểu hiện |
|---|---|
| Hover | Nền đậm hơn một bậc |
| Focus-visible | Viền 2px màu `--accent`, cách 2px |
| Active | Dịch xuống 1px |
| Disabled | Mờ 50%, `cursor: not-allowed`, vẫn giữ trong DOM |
| Loading | Chữ ẩn, spinner ở giữa, `aria-busy="true"`, **chặn bấm đúp** (`withLoading`) |

**Truy cập:** phần tử `<button type="button">`; nút chỉ có icon *bắt buộc* có `aria-label` (dùng `iconButton()`).

| Nên | Không nên |
|---|---|
| Nhãn là động từ: "Tạo khách hàng", "Xác nhận" | Nhãn mơ hồ: "OK", "Gửi", "Tiếp" |
| Nút xóa nêu rõ đối tượng trong hộp xác nhận | Nút "Xóa" đỏ đặt sẵn cạnh nút chính |
| Dùng `withLoading` cho mọi hành động gọi mạng | Để nút bấm được nhiều lần khi đang chờ |

### 3.2 Field — Input, Select, Textarea, Checkbox
**Cấu trúc:** `.field` bọc `<label for>` + điều khiển + `.hint`/`.error-text`.

| Trạng thái | Biểu hiện |
|---|---|
| Mặc định | Viền `--border-input` (3.4:1) |
| Hover | Viền chuyển `--text-muted` |
| Focus | Viền `--accent` + vòng 3px `--accent-soft` |
| Lỗi | `aria-invalid="true"`, viền `--danger-solid`, dòng lỗi liên kết bằng `aria-describedby` |
| Chỉ đọc | Nền `--surface-2`, chữ `--text-muted` |

**Truy cập:** mọi điều khiển có `<label>` liên kết bằng `for`/`id`; trường bắt buộc có dấu `*` (ẩn khỏi trình đọc màn hình) **và** chữ "(bắt buộc)" cho trình đọc màn hình + `aria-required`. Khi gửi lỗi, focus chuyển đến trường lỗi đầu tiên.

**Ánh xạ kiểu trường → điều khiển** (form tự sinh):

| Kiểu | Điều khiển | Ghi chú |
|---|---|---|
| `string` | `input[type=text]` (`email` nếu tên trường là `email`) | |
| `text` | `textarea` | Chiếm cả hàng |
| `number`, `money` | `input[type=number]` + `inputMode=decimal` | Hiển thị `1.250.000 ₫` ở chế độ xem |
| `date`, `datetime` | `input[type=date]`, `datetime-local` | Định dạng theo ngôn ngữ trình duyệt |
| `bool` | `checkbox` có nhãn | |
| `enum` | `select` | Nhãn dịch qua từ điển trạng thái |
| `ref` | `select` nạp từ entity được tham chiếu + liên kết "Quản lý …" | Nhãn bản ghi lấy từ `name/title/subject/sku/code…` |
| `json` | `textarea` mono, kiểm JSON khi lưu | |
| `json` tên `lines` | **Bộ sửa dòng hàng** (3.12) | |

### 3.3 Badge / Chip — `.badge`, `.chip`
**Badge** thể hiện *trạng thái* (có chấm tròn + chữ). **Chip** thể hiện *nhãn/thẻ* (không chấm). Sắc thái chọn tự động từ từ điển trạng thái (`tone()` trong [i18n.js](../client/src/lib/i18n.js)): `success`, `warning`, `danger`, `info`, mặc định `neutral`.

| Nên | Không nên |
|---|---|
| Chữ luôn đi kèm màu | Chỉ dùng chấm màu |
| Dùng nhãn tiếng Việt từ từ điển | Hiện mã thô (`in_progress`) |

### 3.4 Card & Stat — `.card`, `.stat`
Thẻ gom nội dung liên quan; `.stat` là thẻ số liệu, **cả thẻ là liên kết** dẫn tới danh sách tương ứng (vùng bấm lớn). Số dùng `tabular-nums`.

### 3.5 Table — `.table`
**Dùng cho:** danh sách bản ghi. Đầu cột viết hoa nhỏ, `scope="col"`; cột tiền/số căn phải; hàng có thể bấm (`.clickable`) **và** ô đầu tiên là `<a>` thật để dùng được bằng bàn phím.
- Cuộn ngang trong `.table-wrap` trên màn hình hẹp (không làm trang cuộn ngang).
- Cột rỗng (nút thao tác) phải có `<span class="sr-only">Thao tác</span>` trong `<th>`.
- Phân trang `.pager`: "N bản ghi · trang x/y" (`aria-live="polite"`), nút Trước/Sau.

### 3.6 Tabs — `.tabs`, `.tab`
`role="tablist"`/`role="tab"`, `aria-selected`. Dùng để chia nội dung *cùng một đối tượng* (Thông tin / Hệ quả liên module) hoặc mục cài đặt (khi đó mỗi tab là `<a href>`).

### 3.7 Alert — `.alert`
Thông báo *trong dòng*: `info` (mặc định), `success`, `warning`, `danger`. Lỗi gửi form dùng `role="alert"`. Tiêu đề in đậm + danh sách các lỗi.

### 3.8 Empty state — `.empty`
**Bắt buộc** cho mọi danh sách/khối rỗng. Cấu trúc: icon, tiêu đề, một câu giải thích *vì sao rỗng và làm gì tiếp*, nút hành động chính (nếu người dùng có quyền).

| Nên | Không nên |
|---|---|
| "Chưa có khách hàng nào. Tạo bản ghi đầu tiên để bắt đầu." + nút Tạo | "Không có dữ liệu" |
| Phân biệt "chưa có gì" và "không khớp bộ lọc" | Dùng chung một thông báo cho cả hai |

### 3.9 Skeleton — `.skeleton`
Hiển thị trong lúc tải (`aria-busy`). Không dùng spinner toàn trang.

### 3.10 Dialog & Drawer — `<dialog>`
Dùng phần tử `<dialog>` gốc với `showModal()`: trình duyệt tự **bẫy focus**, đóng bằng **Esc**, đặt nền mờ. OSP bổ sung: trả focus về phần tử đã mở dialog khi đóng (`openDialog`).

| Loại | Lớp | Dùng khi |
|---|---|---|
| Modal | `.modal` (rộng ≤ 32rem) | Xác nhận, nhập một giá trị, form ngắn |
| Drawer | `.drawer` (rộng ≤ 40rem) / `.drawer.wide` (52rem) | Tạo/sửa bản ghi, xem chi tiết — giữ ngữ cảnh danh sách phía sau |

Drawer có ba vùng: `.drawer-head` · `.drawer-body` (cuộn) · `.drawer-foot` (nút cố định). Mở drawer chi tiết **thay đổi URL** (`#/e/module/entity/id`) để chia sẻ/nạp lại được; đóng thì URL về danh sách.

**Hộp xác nhận** (`confirmDialog`): tiêu đề là câu hỏi cụ thể, nội dung nêu hậu quả, nút xác nhận mang tên hành động ("Xóa", "Thu hồi"), `danger` cho hành động phá hủy.

### 3.11 Toast — `.toast`
Phản hồi *không chặn* sau một hành động (`role="status"`, `aria-live="polite"`). Tự tắt sau ~4 giây (7 giây với lỗi). Thành công dùng nền `--success-solid`; lỗi `--danger-solid`.
Toast thành công của hành động trạng thái **nêu số bước tự động đã chạy**: "Xác nhận xong. 9 bước tiếp theo đã tự chạy ở các module khác."
**Không** dùng toast cho lỗi cần người dùng sửa (dùng `.alert` trong form).

### 3.12 Bộ sửa dòng hàng — `.lines`
Dùng cho trường JSON tên `lines`. Mỗi dòng: sản phẩm (chọn) · số lượng · đơn giá · nút xóa. Chọn sản phẩm tự điền đơn giá từ bảng sản phẩm; chân bảng hiển thị **tạm tính**; máy chủ tính lại tổng chính thức (`sum(lines, qty*price)`).

### 3.13 Timeline — `.timeline`
Hiển thị chuỗi sự kiện liên module. Mỗi mục: tiêu đề ("Hóa đơn bán · Tạo mới"), thời gian, "bước N của chuỗi", liên kết "Mở bản ghi", và các chip kết quả:
- `✓ Kế toán` (xanh) — module đã phản ứng thành công
- `✕ Kho: <lý do>` (đỏ) — module phản ứng lỗi (mục có chấm đỏ)
- Mục thụt/nhạt theo độ sâu chuỗi (`depth-1…3`).

Đây là thành phần đặc trưng của OSP; xem nguyên tắc 2.

### 3.14 Menu người dùng — `.menu`
Nút có `aria-haspopup="menu"`, `aria-expanded`; đóng khi bấm ra ngoài. Hiện tên, email và "Đăng xuất".

### 3.15 Điều hướng — `.sidebar`
`<nav aria-label="Điều hướng chính">`. Nhóm theo loại module (tiêu đề `.nav-title`), mỗi module là `<details>` chứa "Tổng quan" và từng loại dữ liệu; mục hiện tại có `aria-current="page"`; module đang xem và module lõi tự mở. Mục "Quản trị › Cài đặt" chỉ hiện với quản trị viên. Có **skip-link** "Bỏ qua điều hướng" là phần tử tab đầu tiên. Ở màn hình nhỏ, sidebar ẩn khỏi cây truy cập và thứ tự tab khi đóng; khi mở sẽ nhận focus, giữ focus trong menu, và trả focus về nút menu khi đóng bằng Escape hoặc nút phủ.

### 3.16 Avatar — `.avatar`
Chữ cái đầu của hai từ cuối trong tên, nền `--accent-soft`.

---

## 4. Mẫu màn hình (patterns)

### 4.1 Danh sách
`page-head` (breadcrumb, `h1` = tên theo thuật ngữ ngành, mô tả quy trình trạng thái, nút Xuất/Nhập/Tạo) → `card` chứa `toolbar` (tìm kiếm + lọc trạng thái) → bảng → `pager`.
- Tìm kiếm tức thì phía client trên tối đa 1.000 bản ghi đã tải (nhãn của trường tham chiếu cũng được tìm).
- Bản ghi mới nhất hiển thị trước.
- Vượt 1.000 bản ghi: hiển thị thông báo giới hạn. *(Phân trang/tìm kiếm phía máy chủ nằm trong [lộ trình](ROADMAP.md).)*

### 4.2 Chi tiết bản ghi (drawer)
Tiêu đề = nhãn bản ghi + huy hiệu trạng thái → thanh hành động → tab **Thông tin** / **Hệ quả liên module**.
- **Nút hành động sinh từ máy trạng thái**: chỉ hiện hành động hợp lệ từ trạng thái hiện tại *và* người dùng có quyền (`entity.action`). Hành động đầu là nút chính, trừ hành động hướng tới trạng thái `danger`.
- Hành động đưa tới trạng thái `danger` (hủy, từ chối…) luôn qua hộp xác nhận.
- Sau hành động: nếu có bước tự động ở module khác, tự chuyển sang tab Hệ quả.

### 4.3 Form tạo/sửa
Drawer với lưới 2 cột (1 cột trên di động); trường `text`/`json` chiếm cả hàng. Trường tính tự động và trường trạng thái **không** có trong form (ghi chú "Tự tính: …"). Lỗi từ máy chủ được **gắn về đúng trường** kèm câu thân thiện ("Vui lòng nhập tên"); lỗi không gắn được hiện trong `.alert` đầu form.

### 4.4 Trang đích / Onboarding
Hai cột: khối giới thiệu (giá trị cốt lõi) + bảng đăng nhập/tạo doanh nghiệp. Tạo doanh nghiệp: **1. chọn ngành** (lưới thẻ, `aria-pressed`, có mô tả số module) → **2. thông tin** → hệ thống bật sẵn gói. Có đường tắt "Dùng thử ngay với dữ liệu mẫu" khi máy chủ bật `OSP_DEMO`.

### 4.5 Trang chủ
Lời chào → thẻ số liệu (ưu tiên thực thể phổ biến mà người dùng được đọc, tối đa 8) → "Hoạt động gần đây" (ưu tiên sự kiện có kéo theo bước tự động) + "Module của bạn". Khi chưa có dữ liệu: trạng thái rỗng dẫn tới Thêm khách hàng / Thêm sản phẩm / Nhập CSV.

### 4.6 Xử lý lỗi và trạng thái chờ
| Tình huống | Cách hiển thị |
|---|---|
| Đang tải danh sách | Skeleton |
| Lỗi tải | `.alert.danger` có icon, giữ nguyên bố cục trang |
| Lỗi gửi form | Gắn vào trường + `.alert` đầu form, focus vào trường lỗi |
| Lỗi hành động nhanh (đổi trạng thái, xóa) | Toast đỏ |
| Mất mạng | "Không kết nối được máy chủ. Kiểm tra mạng và thử lại." |
| Phiên hết hạn (401) | Về trang đăng nhập + toast giải thích; không mất ngữ cảnh đột ngột |
| Không có quyền (403) | Nút bị ẩn từ trước; nếu vẫn gặp, hiện thông báo của máy chủ |

---

## 5. Thuật ngữ, ngôn ngữ và giọng văn

### 5.1 Thuật ngữ theo ngành
Tên loại dữ liệu và trường tham chiếu đi qua `entityLabel()` / `fieldLabelOf()`: nếu gói ngành khai báo `terminology['master-data.party'] = 'Bệnh nhân'`, toàn bộ tiêu đề, nút ("Tạo bệnh nhân"), menu và nhãn trường `party` đổi theo. **Không viết cứng** tên thực thể trong giao diện.

### 5.2 Từ điển nhãn
[i18n.js](../client/src/lib/i18n.js) chứa nhãn cho trường, trạng thái, hành động, nhóm module. Thiếu mục → tự "người hóa" mã (`in_progress` → "In progress") để không vỡ giao diện, nhưng **phải bổ sung từ điển** khi thêm module. Từ điển hiện ở phía client; chuyển thành `label` trong khai báo trường là việc trong [lộ trình](ROADMAP.md).

### 5.3 Giọng văn
| Quy tắc | Ví dụ đúng | Ví dụ sai |
|---|---|---|
| Xưng "bạn", câu ngắn, chủ động | "Bạn chưa có quyền tạo dữ liệu ở đây." | "Người dùng không được phép thực hiện." |
| Nút bắt đầu bằng động từ | "Thêm người dùng", "Thu hồi" | "Người dùng mới", "Thu hồi token?" (là câu hỏi, dùng cho tiêu đề hộp thoại) |
| Lỗi nói *chuyện gì + làm gì* | "Sai email hoặc mật khẩu." / "Vui lòng nhập tên." | "Lỗi 401", "Invalid input" |
| Không đổ lỗi cho người dùng | "Chưa lưu được" | "Bạn nhập sai" |
| Hậu quả nói rõ trước hành động phá hủy | "Thao tác này không thể hoàn tác." | "Bạn chắc chứ?" |
| Giữ nguyên tên riêng/thuật ngữ quốc tế quen thuộc | CRM, SKU, API token, CSV, Zalo | Dịch cưỡng ép |
| Số tiền `1.250.000 ₫`; ngày `dd/mm/yyyy`; số có dấu chấm ngăn nghìn | | `1250000`, `2026-11-10` |
| Câu hỏi cho tiêu đề hộp xác nhận, mệnh lệnh cho nút | "Xóa bản ghi này?" → nút "Xóa" | Cả hai đều "OK" |

---

## 6. Truy cập (WCAG 2.1 AA)

### 6.1 Đã kiểm tra và đảm bảo
| Yêu cầu | Cách đạt |
|---|---|
| Tương phản chữ 4.5:1, UI 3:1 (1.4.3, 1.4.11) | Tokens đã đo (mục 2.1), sáng và tối |
| Không dùng màu làm kênh duy nhất (1.4.1) | Huy hiệu có chữ; link trong đoạn văn có gạch chân |
| Bàn phím (2.1.1, 2.4.7) | Mọi điều khiển là phần tử gốc (`button`, `a`, `select`…); focus ring 2px luôn thấy |
| Bỏ qua khối lặp (2.4.1) | Skip-link đầu trang |
| Tiêu đề trang, thứ tự (2.4.2, 1.3.1) | `document.title` theo màn hình; một `h1` mỗi trang; landmark `header/nav/main` |
| Quản lý focus khi đổi màn hình | Focus chuyển vào `h1` của trang mới; dialog/drawer trả focus về nút đã mở |
| Nhãn cho điều khiển (1.3.1, 4.1.2) | `label[for]`; nút icon có `aria-label`; trạng thái lỗi `aria-invalid` + `aria-describedby` |
| Thông báo động (4.1.3) | Toast `role="status"`; lỗi form `role="alert"`; bộ đếm phân trang `aria-live` |
| Kích thước mục tiêu chạm | Điều khiển cao 40px, 44px với con trỏ thô |
| Giảm chuyển động (2.3.3) | `prefers-reduced-motion` |
| Thu phóng/Reflow (1.4.10) | Bố cục co giãn, kiểm tra không tràn ngang ở 390px |
| Ngôn ngữ trang (3.1.1) | `<html lang="vi">` |

### 6.2 Kiểm thử tự động
`npm run e2e` mở Chrome thật, chạy **axe-core** (bộ luật `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `best-practice`) trên các màn hình: đăng nhập, tạo doanh nghiệp, trang chủ, danh sách, chi tiết (drawer), form (drawer), dòng sự kiện, cài đặt (người dùng, module, dữ liệu), và trang chủ ở chế độ tối. **Kết quả hiện tại: 0 vi phạm.** Lần chạy đầu đã bắt được 3 loại lỗi thật — link trong đoạn văn chỉ phân biệt bằng màu, `<th>` rỗng ở cột thao tác, role ARIA sai ở bộ sửa dòng hàng — đều đã sửa. (Hai lỗi tương phản của token — chú thích `faint`, viền ô nhập — được phát hiện bằng phép đo ở mục 2.1, không phải bởi axe.) Lưu ý khi viết kiểm thử: phải chờ animation drawer kết thúc trước khi chạy axe, nếu không độ mờ giữa chừng gây báo sai tương phản.

### 6.3 Giới hạn đã biết (chưa kiểm)
- **Chưa kiểm thử với trình đọc màn hình thật** (NVDA, JAWS, VoiceOver). axe không thay thế được việc này.
- Chưa có kiểm thử người dùng khuyết tật.
- Ô nhập ngày/giờ dùng điều khiển gốc nên định dạng theo ngôn ngữ trình duyệt (có thể hiện `mm/dd/yyyy`).
- Chỉ có tiếng Việt; chưa có cơ chế đa ngôn ngữ (xem lộ trình).
- Danh sách tối đa 1.000 bản ghi tải một lần; với dữ liệu lớn cần phân trang phía máy chủ.

---

## 7. Bảo mật giao diện (ràng buộc thiết kế)

Giao diện chạy dưới CSP: `default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'`.
- **Không** `style="…"`, `<script>` inline, `eval`, `innerHTML` với dữ liệu người dùng. Dữ liệu luôn vào DOM bằng `textContent`/`createTextNode` (hàm `h()`).
- Giá trị động cho kiểu dáng đi qua **lớp CSS** hoặc thuộc tính DOM (`el.style.x` được CSP cho phép nhưng hạn chế dùng).
- Có test tự động xác nhận HTML không chứa script/style inline.

---

## 8. Tổng kết kiểm toán hệ thống thiết kế (v1)

| Hạng mục | Kết quả |
|---|---|
| Thành phần có tài liệu | 16 nhóm thành phần (mục 3) |
| Token màu | 30 token ngữ nghĩa × 2 chế độ (sáng/tối) |
| Hex ngoài `tokens.css` | **0** |
| Style inline trong JS/HTML | **0** (đã dọn 2 thuộc tính thừa) |
| Vi phạm axe-core | **0** trên 13 màn hình/chế độ |
| Tương phản không đạt | 2 (đã sửa) |
| Chưa kiểm | Trình đọc màn hình thật, người dùng khuyết tật |

**Ưu tiên tiếp theo**
1. Kiểm thử thủ công bằng NVDA/VoiceOver cho 3 luồng chính (đăng nhập, tạo bản ghi, đổi trạng thái).
2. Chuyển từ điển nhãn vào khai báo module (`label` trên từng trường) để thêm ngôn ngữ và để module tự mang nhãn.
3. Thành phần **bảng nâng cao**: sắp xếp theo cột, chọn nhiều dòng, thao tác hàng loạt, phân trang phía máy chủ.
4. Thành phần **biểu đồ** theo hướng dẫn trực quan hóa dữ liệu (màu phân loại tách biệt khỏi màu trạng thái).
5. Thành phần **kanban** cho các thực thể có máy trạng thái (lead, deal, ticket).

---

## 9. Quy trình thay đổi

### 9.1 Thêm hoặc sửa thành phần — danh sách kiểm
- [ ] Chỉ dùng token ngữ nghĩa; nếu cần giá trị mới, thêm token vào `tokens.css` **cho cả sáng và tối** (và cả khối `prefers-color-scheme`).
- [ ] Đủ trạng thái: mặc định, hover, focus-visible, active, disabled, loading, lỗi (nếu áp dụng).
- [ ] Hoạt động bằng bàn phím; có tên truy cập; đúng phần tử HTML gốc trước, ARIA sau.
- [ ] Đo lại tương phản nếu đổi màu (xem bảng mục 2.1).
- [ ] Thêm vào bước kiểm của `tests/e2e/ui.mjs` nếu là màn hình/luồng mới; `npm run e2e` phải 0 vi phạm.
- [ ] Cập nhật tài liệu này (mục 3) cùng lúc với mã.
- [ ] Nội dung tiếng Việt theo mục 5; không viết cứng tên thực thể.

### 9.2 Phiên bản
Design system dùng **semver**: *major* đổi/xóa token hoặc lớp CSS đang dùng (cần hướng dẫn chuyển đổi), *minor* thêm token/thành phần, *patch* sửa lỗi hiển thị. Phiên bản hiện tại: **v1.0** (xem [CHANGELOG](../CHANGELOG.md)). Đổi tên token = thay đổi major: giữ token cũ làm bí danh (`--old: var(--new)`) ít nhất một phiên bản minor.

### 9.3 Tệp nguồn
```
client/public/
  app/styles/tokens.css       Token (nguồn duy nhất của giá trị thiết kế)
  app/styles/base.css         Reset, kiểu chữ nền, tiện ích (.row .stack .muted ...)
  app/styles/components.css   Thành phần
  app/styles/layout.css       App shell, trang đích

client/src/
  main.jsx                    React app shell and route dispatch
  lib/api.js                  Rust API and browser session client
  lib/state.js                Tenant metadata, permissions, and reference cache
  lib/i18n.js                 Labels and number/date formatting
  lib/feedback.js             Toasts and confirmation dialogs
```
