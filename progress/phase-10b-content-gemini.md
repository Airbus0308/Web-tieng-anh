# Phase 10B-Content — Làm Giàu Ngân Hàng Đề Writing Task 1 (`config.json`)

- **Trạng thái:** ✅ Hoàn thành phần nội dung `config.json`
- **Người thực hiện:** Gemini CLI (IELTS Academic Architect & AI Prompt Engineer)
- **Ngày:** 2026-11-16
- **Phạm vi file đã sửa:** `config.json`, `progress/phase-10b-content-gemini.md` (không sửa `server.js`, `*.html`, `js/*.js`, `tests/smoke.test.js`)

---

## 1. Tóm Tắt Thay Đổi Trong `config.json`

### 1.1. Bổ sung 2 trường học thuật cho 6 đề Task 1 hiện có
Giữ nguyên 100% các trường hiện có (`id`, `taskNumber`, `subType`, `visualType`, `category`, `taskType`, `prompt`, `instructions`, `visualData`, `keyFacts`, `tone`, `bulletPoints`) và bổ sung thêm:
- `"overviewSample"`: 1–2 câu Overview mẫu chuẩn Band 8.0+ (hoặc câu mở đầu bức thư mẫu cho `wt1-gt-letter-01`).
- `"usefulPhrases"`: Mảng 5 cụm từ vựng/collocations Band 7.5+ phù hợp trực tiếp với từng đề.

| ID Đề | Dạng bài | Điểm nhấn bổ sung |
| :--- | :--- | :--- |
| `wt1-ac-bar-01` | Bar Chart | Overview về tăng trưởng năng lượng tái tạo (Norway dẫn đầu, Germany tăng mạnh nhất) + 5 collocations (`consistently led by a substantial margin`, `witnessed a nearly fourfold surge`, ...) |
| `wt1-ac-line-01` | Line Graph | Overview về xu hướng chuyển dịch sang học kết hợp/trực tuyến + 5 collocations (`a pronounced shift away from`, `experienced sustained upward momentum`, ...) |
| `wt1-ac-pie-01` | Pie Charts | Overview về Housing vượt Food thành khoản chi lớn nhất + 5 collocations (`accounted for the largest share`, `remained relatively static`, ...) |
| `wt1-ac-table-01` | Data Table | Overview đối chiếu mạng lưới tàu điện ngầm châu Á vs phương Tây + 5 collocations (`handled the highest annual ridership`, `in stark contrast to`, ...) |
| `wt1-ac-process-01` | Process Diagram | Overview quy trình 6 bước tái chế nhựa PET qua 2 lần nung chảy + 5 collocations (`comprises six sequential stages`, `culminates in the spinning of textile fibres`, ...) |
| `wt1-gt-letter-01` | Formal Letter | Câu mở đầu chuẩn Formal + 5 cụm từ đề xuất/yêu cầu lịch sự (`I am writing as a regular patron of`, `I look forward to your favourable response`, ...) |

### 1.2. Thêm 2 đề Task 1 mới (nâng tổng số lên 8 đề)
1. **Đề 7 — `wt1-ac-map-01` (`academic`, `map`):**
   - Chủ đề: *Urban Planning & Development* — So sánh bản đồ thị trấn ven biển Seaview giữa năm 1995 và hiện tại.
   - `visualData`: Đầy đủ `beforeLabel`, `afterLabel`, 4 `zones` (`North-West`, `Town Centre`, `South Coast`, `East`) với `before`, `after`, `changeType` (`redeveloped`, `expanded`, `replaced`, `modernised`) và `note`.
   - Kèm 4 `keyFacts`, `overviewSample` Band 8.0+, và 5 `usefulPhrases` chuyên tả bản đồ (`was demolished to make way for`, `was converted into`, `gave way to`, `was pedestrianised and expanded`, `underwent extensive modernisation`).
2. **Đề 8 — `wt1-gt-letter-02` (`general`, `letter`, `tone: "Semi-formal"`):**
   - Chủ đề: *Neighbourhood & Housing* — Thư gửi hàng xóm trao đổi nhã nhặn về việc mở nhạc lớn vào đêm khuya.
   - Đầy đủ 3 `bulletPoints`, 3 `keyFacts`, `overviewSample` mở đầu bức thư theo giọng văn `Semi-formal`, và 5 `usefulPhrases` (`I hope you have been keeping well`, `reach a mutually convenient compromise`, ...).

---

## 2. Kiểm Tra & Lưu Ý Bàn Giao (Phase 10B Frontend & Phase 10C QA)

- **Kiểm tra cú pháp JSON:**
  `node -e 'JSON.parse(require("fs").readFileSync("config.json", "utf8")); console.log("config.json OK")'` → **`config.json OK`**, `sampleTask1Topics.length === 8`.
- **Chạy `npm test` (`tests/smoke.test.js`):**
  - 61 pass, 2 skip (do chưa có `GEMINI_API_KEY`), 1 fail tại `tests/smoke.test.js:972`.
  - **Lý do fail dự kiến:** Test Phase 10A của Codex tại `tests/smoke.test.js:972` đang `assert.deepEqual` cứng danh sách 6 ID cũ (`['wt1-ac-bar-01', ..., 'wt1-gt-letter-01']`), và dòng `975` đang kiểm tra cứng `t.tone === 'Formal'` cho mọi đề `letter`. Do phạm vi nhiệm vụ không được sửa `tests/smoke.test.js`, Claude Code (Phase 10B) hoặc Cursor CLI (Phase 10C) cần cập nhật 2 assertion này để khớp với 8 đề (bao gồm `wt1-ac-map-01` và `wt1-gt-letter-02` có `tone: "Semi-formal"`).
- **Gợi ý cho Claude Code (Phase 10B Frontend):**
  - Có thể hiển thị `"overviewSample"` (dạng nút gợi ý / tham khảo sau khi nộp hoặc trong hộp hướng dẫn) và `"usefulPhrases"` (dạng chip từ vựng Band 7.5+) trên `writing.html` / `js/writing.js`.
  - Bổ sung nhánh render cho `visualType === "map"` trong `renderTask1Visual(topic)` (hiển thị bảng đối chiếu 2 mốc `beforeLabel` vs `afterLabel` theo 4 `zones` + `changeType`).
