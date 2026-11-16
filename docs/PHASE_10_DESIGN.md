# 📐 Đặc Tả Kỹ Thuật Phase 10: Writing Task 1 (Academic SVG Visuals & General Letter) + Overall Writing Band

> **Điều phối & Thiết kế (Architect):** Antigravity  
> **Thực thi Backend (Phase 10A):** OpenAI Codex (`config.json`, `server.js`, `db/mistakes.js`, `tests/smoke.test.js`)  
> **Thực thi Frontend (Phase 10B):** Claude Code (`writing.html`, `css/writing.css`, `js/writing.js`, `js/analytics.js`, `tests/smoke.test.js`)  
> **Kiểm duyệt Độc lập (Phase 10C):** Cursor CLI (`progress/qa-audit-phase-10.md`)

---

## 1. Mục Tiêu Cốt Lõi & Bảo Toàn Tương Thích Ngược

1. **Mở rộng `writing.html` thành Phòng Luyện Writing Toàn Diện (Task 1 + Task 2):**
   - Hỗ trợ đầy đủ **3 chế độ luyện tập**:
     * **Task 2 — Essay (`40 phút · Tối thiểu 250 từ`)**: Giữ nguyên 100% hành vi và DOM ID hiện có để không làm gãy bất kỳ bài kiểm thử nào từ Phase 2 → Phase 9B.
     * **Task 1 Academic — Data & Diagram Report (`20 phút · Tối thiểu 150 từ`)**: Hiển thị biểu đồ trực quan bằng **SVG / HTML Table chuẩn học thuật** (Bar Chart, Line Graph, Pie Chart, Data Table, Process Diagram) kèm bảng số liệu chuẩn (`visualData` & `keyFacts`) để cả học viên quan sát và Giám khảo AI đối chiếu độ chính xác số liệu.
     * **Task 1 General Training — Letter Writing (`20 phút · Tối thiểu 150 từ`)**: Đề bài viết thư theo tình huống kèm 3 gạch đầu dòng (`bulletPoints`) và yêu cầu giọng văn (`Formal` / `Semi-formal` / `Informal`).
2. **Chấm Điểm Chuẩn Giám Khảo IELTS Cho Task 1 (`TA` · `CC` · `LR` · `GRA`):**
   - Khác với Task 2 dùng tiêu chí **`TR` (Task Response)**, Task 1 chấm theo tiêu chí chính thức **`TA` (Task Achievement)**:
     * Với **Task 1 Academic**: Kiểm tra xem bài viết có đoạn **Overview (Tổng quan xu hướng chính)** rõ ràng không, có trích dẫn số liệu (`keyFacts`) chính xác để so sánh không, và có tránh đưa ý kiến cá nhân không.
     * Với **Task 1 General**: Kiểm tra mục đích bức thư, giọng văn (`tone`) có nhất quán không, và có trả lời đủ 3 `bulletPoints` trong đề không.
3. **Công Thức Tính Điểm Overall Writing Chính Thức (`1/3 Task 1 + 2/3 Task 2`):**
   - Theo quy chuẩn IELTS, Task 2 chiếm trọng số gấp đôi Task 1:
     $$\text{Overall Writing Band} = \text{roundToHalf}\left(\frac{\text{Band}_{\text{Task 1}} + 2 \times \text{Band}_{\text{Task 2}}}{3}\right)$$
   - Khi học viên đã có ít nhất 1 bài Task 1 và 1 bài Task 2 trong lịch sử, hệ thống tự động tính và hiển thị **Overall Writing Band** (kèm điểm thành phần Task 1 mới nhất + Task 2 mới nhất) trên cả `writing.html`, `analytics.html` và `GET /api/study/diagnostic-status`.

---

## 2. Thiết Kế Chi Tiết Phase 10A — Backend & Ngân Hàng Đề Task 1 (Giao cho OpenAI Codex)

### 2.1. Bổ sung Cấu hình Task 1 vào `config.json`
Giữ nguyên các trường hiện có (`systemInstruction`, `scoringCriteria`, `sampleTopics`, `wordCountRequirements` cho Task 2) và bổ sung:

1. **`task1SystemInstruction`**:
   - Prompt đóng vai Giám khảo IELTS chấm Writing Task 1 (Academic & General Training) theo chuẩn British Council / IDP / Cambridge.
2. **`task1ScoringCriteria`**:
   - 4 tiêu chí có trọng số `0.25` mỗi tiêu chí:
     * `taskAchievement` (`name: "Task Achievement"`, `abbreviation: "TA"`): Đánh giá **Overview**, độ chính xác khi chọn lọc & so sánh số liệu (`keyFacts`) đối với Academic, hoặc độ bao phủ 3 `bulletPoints` & giọng văn (`tone`) đối với General Letter; phạt nặng nếu dưới 150 từ hoặc không có Overview.
     * `coherenceAndCohesion` (`abbreviation: "CC"`).
     * `lexicalResource` (`abbreviation: "LR"`): Từ vựng mô tả xu hướng (`surge`, `plummet`, `plateau`, `account for`, `respectively`...) hoặc ngôn ngữ thư tín.
     * `grammaticalRangeAndAccuracy` (`abbreviation: "GRA"`).
3. **`task1ResponseFormat`**:
   - Cùng cấu trúc JSON trả về như `responseFormat` của Task 2 (`criteria` với `abbreviation` là `TA | CC | LR | GRA`, `overall_band`, `overall_feedback`, `suggestions`, `inline_corrections`), bổ sung thêm trường tùy chọn `"has_clear_overview": boolean` để học viên biết ngay bài viết đã có đoạn Overview đạt chuẩn hay chưa.
4. **`task1WordCountRequirements`**:
   - `{ "min": 150, "recommended": 180, "timeMinutes": 20 }`.
5. **`sampleTask1Topics`** (Tối thiểu **6 đề đa dạng**, đầy đủ dữ liệu để vẽ SVG phía client và chấm bằng AI):
   - Mỗi đề trong `sampleTask1Topics` có cấu trúc:
     ```json
     {
       "id": "wt1-ac-bar-01",
       "taskNumber": 1,
       "subType": "academic",
       "visualType": "bar",
       "category": "Energy & Environment",
       "taskType": "Bar Chart",
       "prompt": "The bar chart below shows the percentage of total electricity generated from renewable sources in four countries between 2010 and 2025.",
       "instructions": "Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.",
       "visualData": {
         "title": "Share of Electricity from Renewable Sources (%)",
         "unit": "%",
         "categories": ["2010", "2015", "2020", "2025"],
         "series": [
           { "label": "Norway", "color": "#34d399", "values": [65, 71, 78, 86] },
           { "label": "Germany", "color": "#6366f1", "values": [17, 30, 44, 58] },
           { "label": "Vietnam", "color": "#fbbf24", "values": [28, 33, 41, 52] },
           { "label": "Australia", "color": "#f87171", "values": [10, 14, 24, 39] }
         ]
       },
       "keyFacts": [
         "Norway consistently produced the highest proportion of renewable electricity across all four years, rising from 65% in 2010 to 86% in 2025.",
         "Germany experienced the most dramatic growth (+41 percentage points), more than tripling from 17% to 58%.",
         "Vietnam maintained steady growth from 28% in 2010 to 52% in 2025, staying ahead of Australia throughout the period.",
         "Australia started lowest at 10% in 2010 but nearly quadrupled to 39% by 2025."
       ]
     }
     ```
   - **6 đề bắt buộc trong `sampleTask1Topics`**:
     1. `wt1-ac-bar-01` (`subType: "academic"`, `visualType: "bar"`): Biểu đồ cột năng lượng tái tạo ở 4 quốc gia (2010–2025).
     2. `wt1-ac-line-01` (`subType: "academic"`, `visualType: "line"`): Biểu đồ đường tỷ lệ người học đại học qua 3 phương thức (On-campus, Hybrid, Fully Online) từ 2012 đến 2024.
     3. `wt1-ac-pie-01` (`subType: "academic"`, `visualType: "pie"`): Biểu đồ tròn cơ cấu chi tiêu hộ gia đình tại 1 đô thị châu Á năm 2005 so với 2025 (Housing, Food, Education, Transport, Healthcare).
     4. `wt1-ac-table-01` (`subType: "academic"`, `visualType: "table"`): Bảng số liệu thống kê hệ thống tàu điện ngầm tại 5 thành phố lớn (Năm mở cửa, Chiều dài tuyến km, Lượng hành khách triệu lượt/năm, Giá vé trung bình USD).
     5. `wt1-ac-process-01` (`subType: "academic"`, `visualType: "process"`): Sơ đồ quy trình 6 bước tái chế nhựa PET thành sợi vải dệt may (`steps: [{ step: 1, title: "Collection & Sorting", detail: "..." }, ...]`).
     6. `wt1-gt-letter-01` (`subType: "general"`, `visualType: "letter"`, `tone: "Formal"`): Thư gửi Ban quản lý thư viện thành phố đề xuất cải thiện khu vực tự học và kéo dài giờ mở cửa cuối tuần (`bulletPoints`: 3 ý bắt buộc).

### 2.2. Nâng cấp Các Route API trong `server.js`

1. **`GET /api/writing/config`**:
   - Giữ nguyên toàn bộ các trường cũ (`model`, `wordCountRequirements`, `sampleTopics`, `criteria`) cho Task 2 để tương thích ngược 100%.
   - Bổ sung thêm:
     * `task1WordCountRequirements`: `config.task1WordCountRequirements` (`{ min: 150, recommended: 180, timeMinutes: 20 }`).
     * `sampleTask1Topics`: `config.sampleTask1Topics`.
     * `task1Criteria`: danh sách 4 tiêu chí Task 1 (`TA`, `CC`, `LR`, `GRA`).
2. **`POST /api/writing/score`**:
   - Nhận `{ essay, topic, taskNumber, topicId, subType, visualSummary }`:
     * Mặc định `normalizedTaskNumber = Number(taskNumber) === 1 ? 1 : 2` (nếu client không gửi `taskNumber`, mặc định là `2` để mọi bài test cũ của Task 2 giữ nguyên hành vi).
     * Kiểm tra số từ tối thiểu:
       - Nếu `normalizedTaskNumber === 1`: `minWords = config.task1WordCountRequirements?.min || 150`.
       - Nếu `normalizedTaskNumber === 2`: `minWords = config.wordCountRequirements?.min || 250`.
       - Nếu `wordCount < minWords`: trả `400 { error, wordCount, minRequired: minWords, taskNumber: normalizedTaskNumber }`.
     * Nếu `normalizedTaskNumber === 1`:
       - Nếu có `topicId`, tự động tra cứu đề tương ứng trong `config.sampleTask1Topics` để lấy `keyFacts`, `visualData`, `bulletPoints`, `tone` đưa vào hàm `buildTask1EvaluationPrompt(essay, topicObj, visualSummary)`.
       - Chuẩn hóa kết quả trả về từ AI: đảm bảo `criteria[0].abbreviation` cho Task 1 là `"TA"` (nếu AI trả `"TR"` cho Task 1 thì tự động chuẩn hóa thành `"TA"` - `"Task Achievement"`).
     * Lưu bản ghi vào `writing_results` (qua `store.list` / `store.replace` theo `req.userId`) kèm thêm các trường:
       `taskNumber: normalizedTaskNumber`, `subType: subType || (normalizedTaskNumber === 1 ? 'academic' : 'essay')`, `topicId: topicId || null`.
     * Tính kèm đối tượng `writingBandSummary = computeWritingBandSummary(history)` và trả về trong response của `POST /api/writing/score`.
3. **Hàm `computeWritingBandSummary(writingHistory)` & Route `GET /api/writing/summary`**:
   - Phân loại các bản ghi trong `writingHistory`:
     * Bản ghi có `Number(r.taskNumber) === 1` thuộc nhóm **Task 1**.
     * Bản ghi có `Number(r.taskNumber) === 2` hoặc không có `taskNumber` (dữ liệu lịch sử cũ) thuộc nhóm **Task 2**.
   - Lấy điểm mới nhất (`latestTask1Band`, `latestTask2Band`) và điểm trung bình (`avgTask1Band`, `avgTask2Band`).
   - Nếu học viên đã có cả Task 1 và Task 2:
     * `combinedOverallBand = roundToHalf((latestTask1Band + 2 * latestTask2Band) / 3)` (ví dụ: Task 1 = `6.0`, Task 2 = `7.0` ➔ `(6.0 + 14.0) / 3 = 6.67` ➔ làm tròn mức 0.5 gần nhất thành **`6.5`**).
   - Nếu chỉ mới có 1 trong 2 Task:
     * `combinedOverallBand = null`, `estimatedSingleTaskBand = latestTask2Band ?? latestTask1Band`.
   - Cung cấp route `GET /api/writing/summary` trả về `{ task1Count, task2Count, latestTask1Band, latestTask2Band, avgTask1Band, avgTask2Band, combinedOverallBand, formula: "(Task1 + 2 * Task2) / 3" }`.
   - Cập nhật `GET /api/study/diagnostic-status` để nếu người dùng có cả Task 1 và Task 2 thì điểm kỹ năng `writing` ưu tiên dùng `combinedOverallBand` (hoặc trung bình có trọng số) và nhận diện cả lỗi yếu `TA` trong `weakAreas`.
4. **Cập nhật `db/mistakes.js` & `config.json`**:
   - Cho phép `weakestCriterion` trong `mistakeContext` nhận thêm `"TA"` (`Task Achievement`) và bổ sung `"TA"` vào `targetWeakness` của ít nhất 2 Unit phù hợp trong `config.sampleTextbooks` (ví dụ: Unit từ vựng học thuật / liên kết câu).

---

## 3. Thiết Kế Chi Tiết Phase 10B — Giao Diện Task 1, Bộ Vẽ Biểu Đồ SVG & Overall Writing (Giao cho Claude Code)

### 3.1. Thanh Chuyển Đổi Chế Độ Luyện Tập (`#writing-task-tabs`) trên `writing.html`
- Đặt ngay phía trên `.writing-layout` (hoặc trong `.writing-intro`):
  - 3 nút chuyển tab rõ ràng:
    1. `#tab-task2` (`data-task-mode="task2"`, mặc định active khi mới mở trang): **📝 Task 2: Academic/General Essay (40 phút · ≥ 250 từ)**
    2. `#tab-task1-academic` (`data-task-mode="task1-academic"`): **📊 Task 1 Academic: Charts, Tables & Process (20 phút · ≥ 150 từ)**
    3. `#tab-task1-general` (`data-task-mode="task1-general"`): **✉️ Task 1 General: Letter Writing (20 phút · ≥ 150 từ)**
- Khi chuyển chế độ:
  - Tự động cập nhật đồng hồ `#writing-timer-display` (`40:00` cho Task 2; `20:00` cho Task 1).
  - Tự động cập nhật bộ đếm từ `#word-count-badge` và `#char-limit-indicator` (`Minimum 250 words` cho Task 2; `Minimum 150 words` cho Task 1).
  - Giữ nháp riêng trong bộ nhớ tạm cho từng chế độ để học viên chuyển tab xem đề không bị mất chữ đang gõ.

### 3.2. Khung Hiển Thị Biểu Đồ SVG / Sơ Đồ Quy Trình / Tình Huống Thư (`#task1-visual-container`)
- Nằm bên trong `#topic-section` (chỉ hiển thị khi đang ở chế độ Task 1, tự ẩn khi ở Task 2):
  - Bộ chọn nhanh loại biểu đồ Task 1 (`#task1-visual-filter` hoặc chọn trực tiếp từng đề): `Bar Chart` · `Line Graph` · `Pie Chart` · `Table` · `Process Diagram` (ở tab Academic) và `Formal / Semi-formal / Informal Letter` (ở tab General).
  - **Hàm vẽ trực quan thuần SVG/HTML (`renderTask1Visual(topic)`)** trong `js/writing.js` (không phụ thuộc thư viện ngoài, sắc nét trên nền tối Dark Glassmorphism):
    * `visualType === "bar"`: Vẽ biểu đồ cột nhóm bằng `<svg viewBox="0 0 680 300">` có trục tung/trục hoành, lưới ngang, nhãn số liệu trên đỉnh cột và chú giải màu (`legend`).
    * `visualType === "line"`: Vẽ biểu đồ đường đa chuỗi bằng `<svg>` có điểm tròn (`<circle>`), nhãn giá trị và đường nối mượt.
    * `visualType === "pie"`: Vẽ 2 biểu đồ tròn so sánh 2 năm bằng `<svg>` (`stroke-dasharray` hoặc quạt `path`) kèm bảng phần trăm rõ ràng.
    * `visualType === "table"`: Vẽ bảng dữ liệu chuẩn học thuật `<table class="task1-data-table">` có highlight số cao nhất/thấp nhất.
    * `visualType === "process"`: Vẽ sơ đồ chuỗi các bước (`Step 1 ➔ Step 2 ➔ ...`) bằng các thẻ quy trình nối mũi tên trực quan.
    * `visualType === "letter"`: Hiển thị hộp tình huống thư kèm danh sách 3 yêu cầu `bulletPoints` và nhãn giọng văn (`Tone: Formal`).

### 3.3. Khung Tính Điểm Overall Writing (`#writing-overall-banner`) & Hiển Thị Kết Quả Task 1
- Bổ sung thanh **`#writing-overall-banner`** trên `writing.html` (và cập nhật thẻ Writing trên `analytics.html`):
  - Gọi `GET /api/writing/summary` (kết hợp fallback từ `localStorage`):
    * Hiển thị: **Task 1 Mới nhất: `Band X.X`** · **Task 2 Mới nhất: `Band Y.Y`** ➔ **🎯 Overall Writing Band (`1/3 Task 1 + 2/3 Task 2`): `Band Z.Z`**.
    * Nếu học viên mới chỉ làm Task 2 (chưa làm Task 1), hiển thị lời nhắc khích lệ: *"Hãy hoàn thành thêm 1 bài Writing Task 1 (150 từ) để mở khóa điểm Overall Writing chính thức theo công thức 1/3 Task 1 + 2/3 Task 2!"* kèm nút bấm chuyển nhanh sang tab Task 1.
- Ở khu vực kết quả chấm điểm (`#results-section`) và Lịch sử làm bài (`#history-list`):
  - Hiển thị huy hiệu phân biệt rõ `[Task 1 · Bar Chart]` hoặc `[Task 2 · Essay]` trên từng bản ghi lịch sử.
  - Khi xem kết quả Task 1, thẻ tiêu chí đầu tiên hiển thị đúng **`Task Achievement (TA)`** (và nếu có `has_clear_overview`, hiển thị nhãn `✓ Có Overview rõ ràng` hoặc `⚠️ Cần bổ sung đoạn Overview`).
  - Nút **`#btn-create-mistake-unit` ("🎯 Tạo Bài Học Khắc Phục Lỗi Này")** hoạt động cho cả kết quả Task 1 lẫn Task 2.
- **Bảo mật XSS**: Mọi chuỗi từ `visualData`, `prompt`, `bulletPoints` khi render vào SVG/HTML phải được escape qua `_escapeHtml()`.

---

## 4. Thiết Kế Chi Tiết Phase 10C — Kiểm Duyệt Độc Lập (Giao cho Cursor CLI)

Sau khi Codex (10A) và Claude Code (10B) hoàn tất, **Cursor CLI** kiểm duyệt:
1. Tương thích ngược: Tất cả bài kiểm thử cũ của Phase 1 → Phase 9B trong `tests/smoke.test.js` vẫn pass 100%.
2. Hợp đồng API `POST /api/writing/score`:
   - `taskNumber: 1` từ chối bài `< 150` từ và chấp nhận bài `150–249` từ (vốn sẽ bị từ chối nếu nhầm sang ngưỡng 250 từ của Task 2!).
   - `taskNumber: 2` (hoặc không truyền `taskNumber`) vẫn từ chối bài `< 250` từ.
3. Công thức `GET /api/writing/summary`: Kiểm tra tính đúng đắn của phép tính `roundToHalf((task1 + 2 * task2) / 3)`.
4. An toàn XSS trên bộ vẽ SVG/Table của Task 1 và tích hợp nút `"🎯 Tạo Bài Học Khắc Phục Lỗi Này"` với tiêu chí `TA`.
5. Xuất báo cáo kiểm duyệt tại `progress/qa-audit-phase-10.md`.
