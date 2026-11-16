# Phase 10B — Writing Task 1 Frontend: Chế độ Task, Biểu đồ SVG & Overall Writing Band

- **Trạng thái:** ✅ DONE (Frontend; backend xem [phase-10a-writing-task1-backend.md](phase-10a-writing-task1-backend.md), nội dung đề xem [phase-10b-content-gemini.md](phase-10b-content-gemini.md))
- **Người thực hiện:** Claude Code
- **Ngày:** 2026-11-16
- **Đặc tả:** [docs/PHASE_10_DESIGN.md](../docs/PHASE_10_DESIGN.md) mục 3 (3.1 – 3.3)

## Các thay đổi

| File | Nội dung |
| :--- | :--- |
| `writing.html` | **`#writing-task-tabs`** (ARIA tablist) gồm `#tab-task2` (mặc định), `#tab-task1-academic`, `#tab-task1-general`, đặt trên `.writing-layout`. **`#writing-overall-banner`** gồm Task 1 mới nhất · Task 2 mới nhất · 🎯 Overall Writing Band, có dòng gợi ý và nút chuyển nhanh sang Task còn thiếu. **`#task1-visual-filter`** và **`#task1-visual-container`** nằm trong `#topic-section`. Kết quả có thêm `#result-task-chip` (`Task 1 · Bar Chart` / `Task 2 · Essay`) và `#result-overview-chip`. Các phần chữ thay đổi theo chế độ được gắn ID (badge, thời gian, số từ, tiêu đề, Assessment Guide, Strategy). **Mọi ID của Phase 2 → 9B đều giữ nguyên.** |
| `js/writing.js` | **3 chế độ** (`MODES`): Task 2 dùng 40 phút và ≥ 250 từ; Task 1 dùng 20 phút và ≥ 150 từ, lấy từ `task1WordCountRequirements` nếu có. Mỗi chế độ giữ **đề, nháp và thời gian còn lại riêng** trong bộ nhớ (`_modeState`). Hỗ trợ phím ←/→/Home/End và deep link `writing.html#task1-academic`. **`renderTask1Visual(topic)`** dùng SVG/HTML thuần, không thư viện ngoài, cho 7 dạng: `bar` (cột nhóm, `viewBox 0 0 680 300`, trục, lưới, nhãn đỉnh cột, chú giải), `line` (nhiều đường, chấm tròn, nhãn giá trị đầu/cuối), `pie` (2 biểu đồ tròn và bảng %), `table` (`<table class="task1-data-table">` đánh dấu ▲ cao nhất / ▼ thấp nhất mỗi cột), `process` (`<ol class="task1-process">` các bước nối mũi tên), `map` (từng khu vực trước → sau kèm loại thay đổi) và `letter` (khung thư, 3 `bulletPoints`, `Tone`). Biểu đồ có tooltip (`<title>`) và **Bảng số liệu** để đọc không cần màu. Thêm chip **Cụm từ hữu ích** (`usefulPhrases`) và **Overview mẫu** (`overviewSample`) gập lại, chỉ mở khi học viên bấm. **Nộp Task 1** gửi `{ essay, topic, taskNumber: 1, subType, topicId, visualSummary }`. Lỗi 400 hiện đúng thông báo của server. **Kết quả** hiện `Task Achievement (TA)` và nhãn `✓ Có Overview rõ ràng` / `⚠️ Cần bổ sung đoạn Overview` khi có `has_clear_overview`. **Lịch sử** sắp mới nhất trước và có huy hiệu `[Task 1 · …]` / `[Task 2 · Essay]`. Nút **🎯 Tạo Bài Học Khắc Phục Lỗi Này** dùng cho cả Task 1; tiêu chí `TA` được gửi trong `mistakeContext`. **Banner** gọi `GET /api/writing/summary`; offline thì tính từ `localStorage` theo đúng công thức của server. |
| `css/writing.css` | Style tab, banner, khung biểu đồ, bảng, quy trình, bản đồ, thư, chip gợi ý, huy hiệu kết quả và lịch sử. Từ 760px trở xuống: tab và banner xếp dọc, quy trình 1 cột với mũi tên ↓, biểu đồ cuộn ngang. |
| `js/analytics.js`, `analytics.html` | Thẻ **Writing** hiện **Overall Writing Band** `(T1 + 2×T2)/3` cùng điểm thành phần (`#writing-score-meta`) khi đã có cả 2 Task; nếu chưa thì hiện điểm trung bình kèm lời nhắc Task còn thiếu. Thêm tiêu chí **TA** vào phần phân tích kỹ năng và vào xét "tiêu chí yếu nhất". Badge ghi số bài Task 1 / Task 2. |
| `tests/smoke.test.js` | 3 test Phase 10B mới. Sửa test 10A để chấp nhận đề Gemini thêm vào (xem dưới). |

## Quyết định cần lưu ý

- **Màu biểu đồ** lấy từ một bảng màu cố định (xanh dương, cam, xanh ngọc, vàng, hồng; đã chạy bộ kiểm tra mù màu và độ tương phản trên nền `#1a2035`: đạt cả 5 tiêu chí), **không đọc trường `color` trong `config.json`**. Lý do: màu trong config quá sáng trên nền tối, và không đưa chuỗi dữ liệu vào thuộc tính SVG thì tránh hẳn chèn thuộc tính. Mọi chữ (tiêu đề, nhãn, chú giải, bảng, quy trình, thư, cụm từ) đều qua `_escapeHtml()`.
- **Đường biểu đồ (line)** chỉ ghi số ở điểm đầu và cuối để các đường gần nhau không chồng nhãn. Giá trị ở giữa có trong tooltip và Bảng số liệu.
- **Chuyển chế độ** ẩn kết quả của Task khác (vẫn mở lại được từ Lịch sử) và tạm dừng đồng hồ; quay lại thì đồng hồ chạy tiếp từ chỗ cũ.
- **Nội dung của Gemini CLI** (`wt1-ac-map-01`, `wt1-gt-letter-02` Semi-formal, `overviewSample`, `usefulPhrases`) có trong thư mục làm việc nhưng **chưa được commit** lúc tôi bắt đầu. Frontend dùng các nội dung này nên tôi commit chúng thành một commit riêng ghi rõ tác giả Gemini CLI. Test 10A (Codex) đang so khớp cứng đúng 6 ID và `tone === 'Formal'`, nên tôi sửa thành: bắt buộc có 6 ID của đặc tả, cho phép thêm đề, `tone` thuộc `Formal / Semi-formal / Informal`, và `wt1-gt-letter-01` vẫn phải là `Formal`.
- Đặc tả nhắc bộ lọc "Formal / Semi-formal / Informal Letter". Hiện chỉ có đề Formal và Semi-formal, nên bộ lọc liệt kê đúng các đề đang có: mỗi đề một chip, ghi theo `taskType`.

## Kiểm thử

- `npm test`: 67 test, 65 pass, 0 fail, 2 skip (hai test Gemini trực tiếp cần `GEMINI_API_KEY`).
- Test mới:
  1. `writing.html` có tab (Task 2 mặc định), khung visual nằm trong `#topic-section`, banner, chip kết quả; toàn bộ ID cũ của Phase 2 → 9B còn nguyên; `writing.js` và `writing.css` có đủ các nhánh, chuỗi và class cần thiết.
  2. Chạy `renderTask1Visual` thật (trong `node:vm`) với cả 8 đề trong `config.json`. Kiểm tra số pie, số bước, số khu vực, `is-max`/`is-min` và Tone. Thử chèn `<img onerror>` vào mọi trường của cả 7 dạng: tất cả đều bị escape.
  3. Hàm tính Overall phía client khớp server: Task 1 = 6.0, Task 2 = 7.0 → 6.5; bản ghi cũ không có `taskNumber` được tính là Task 2; analytics có TA và Overall.
- Kiểm tra bằng Chrome headless (1300px) trên server riêng:
  - Cả 8 đề hiển thị đúng.
  - Banner với dữ liệu giả: Task 1 6.0 + Task 2 7.0 → 6.5.
  - Lịch sử có huy hiệu và sắp mới nhất trước.
  - Kết quả Task 1 hiện TA và "Cần bổ sung đoạn Overview".
  - Trang Analytics hiện Overall 6.5 và TA là tiêu chí yếu nhất.
- **Chưa kiểm tra thủ công:**
  - Chấm Task 1 thật bằng AI (máy không có key; luồng API đã có test 10A với provider giả lập).
  - Thao tác bấm thật trên tab và nút gợi ý của banner (headless chỉ chụp ảnh tĩnh).
  - Bề ngang điện thoại 400px (Chrome trên desktop không thu nhỏ cửa sổ dưới khoảng 500px).
