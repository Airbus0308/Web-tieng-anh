# Phase 12-Content — Ngân Hàng Đề Thi Thử IELTS 4 Kỹ Năng (`data/mock-exams.json`)

- **Trạng thái:** ✅ Hoàn thành
- **Người thực hiện:** Gemini CLI
- **Ngày:** 2026-11-16
- **Phạm vi file (Zero-Conflict):** Chỉ tạo mới `data/mock-exams.json` và `progress/phase-12-content-gemini.md`. Không chỉnh sửa `config.json`, `server.js`, `PROGRESS.md`, `speaking.html`, `js/speaking.js`, hay `tests/smoke.test.js`.

---

## 1. Cấu Trúc & Nội Dung `data/mock-exams.json`

File `data/mock-exams.json` chứa đối tượng gốc `{ "mockExams": [...] }` gồm **2 bộ đề thi thử IELTS Academic 4 kỹ năng hoàn chỉnh** (`level: "IELTS Academic (Band 5.5–8.0)"`, `durationMinutes: 45`):

### 1.1. `mock-ac-01` — *Urban Ecology, Renewable Energy & Education*
- **Listening (221 từ, Section 3):** Đối thoại học thuật giữa Dr. Patel, Maya và Liam về nghiên cứu nông trại thẳng đứng (vertical farming) và vi khí hậu đô thị. Gồm **6 câu hỏi** (`3 mcq` + `3 tfng`) kèm `explanationVi` và `evidenceQuote` khớp nguyên văn transcript.
- **Reading (363 từ, 4 đoạn `[A]`–`[D]`):** Bài đọc *"Rewilding Urban Waterways: Ecological Gains and Social Trade-offs"* (tái sinh sông ngòi đô thị, kiểm soát lũ, làm mát và rủi ro *ecological gentrification*). Gồm **6 câu hỏi** (`2 matching_info` + `3 tfng` + `1 mcq`) kèm `explanationVi` và `evidenceQuote`.
- **Writing:** Tham chiếu `wt1-ac-bar-01` (`minWordsTask1: 150`) và `wt2-01` (`minWordsTask2: 250`) khớp `config.json`.
- **Speaking:** Tham chiếu `sp-01` gồm `part1Questions` (2 câu), `part2CueCard` (`prompt`, `points`, `closing`), và `part3Questions` (2 câu).

### 1.2. `mock-ac-02` — *Neuroscience of Sleep, Urban Mobility & Hybrid Study*
- **Listening (233 từ, Section 4):** Bài giảng học thuật về nhịp sinh học (circadian rhythms), giấc ngủ và hiệu suất nhận thức ở sinh viên đại học. Gồm **6 câu hỏi** (`3 mcq` + `3 tfng`) kèm `explanationVi` và `evidenceQuote` khớp nguyên văn transcript.
- **Reading (350 từ, 4 đoạn `[A]`–`[D]`):** Bài đọc *"The Economics and Equity of the Fifteen-Minute City"* (quy hoạch đô thị 15 phút, doanh thu bán lẻ địa phương và thách thức công bằng ở ngoại ô). Gồm **6 câu hỏi** (`2 matching_info` + `3 tfng` + `1 mcq`) kèm `explanationVi` và `evidenceQuote`.
- **Writing:** Tham chiếu `wt1-ac-line-01` (`minWordsTask1: 150`) và `wt2-02` (`minWordsTask2: 250`) khớp `config.json`.
- **Speaking:** Tham chiếu `sp-02` gồm `part1Questions` (2 câu), `part2CueCard` (`prompt`, `points`, `closing`), và `part3Questions` (2 câu).

---

## 2. Kiểm Tra & Lưu Ý Bàn Giao

- **Kiểm tra cú pháp JSON:**
  `node -e 'const d=JSON.parse(require("fs").readFileSync("data/mock-exams.json","utf8")); console.log("Mock exams:", d.mockExams.length);'` → **`Mock exams: 2`**.
- **Kiểm tra ràng buộc dữ liệu:**
  - `mock-ac-01`: Listening 221 từ (220–280), Reading 363 từ (350–450), 6 câu Listening + 6 câu Reading, 100% `evidenceQuote` khớp nguyên văn.
  - `mock-ac-02`: Listening 233 từ (220–280), Reading 350 từ (350–450), 6 câu Listening + 6 câu Reading, 100% `evidenceQuote` khớp nguyên văn.
- **Lưu ý cho Phase 12 Frontend/Backend:**
  - Trường `listening.audioUrl` được đặt là `"assets/audio/placement-section1.mp3"` theo đúng đặc tả; hiện tại trong `assets/audio/` đang có sẵn file `placement-listening.mp3` (chưa có `placement-section1.mp3`), khi tích hợp UI có thể bổ sung file audio tương ứng hoặc fallback về `placement-listening.mp3`.
