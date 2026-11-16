# 🛡️ QA Audit — Phase 10: Writing Task 1 (Academic SVG Visuals & General Letter) + Overall Writing Band

- **Auditor:** Antigravity (thay thế Cursor CLI do chạm giới hạn quota)
- **Date:** 2026-11-16
- **Scope:**
  - **Phase 10A Backend (OpenAI Codex):** `commit 8a6332d`, `d8146fc`
  - **Phase 10B-Content (Gemini CLI):** `commit 1cff38b`
  - **Phase 10B-UI (Claude Code):** `commit 90a35c6`, `4b6c985`
- **Spec Reference:** `docs/PHASE_10_DESIGN.md`

---

## 1. Tổng Quan Kết Quả Kiểm Duyệt

| Hạng mục | Kết quả |
| :--- | :--- |
| **Verdict** | **✅ VERIFIED (Đạt chuẩn đóng Phase 10)** |
| **Bộ kiểm thử tự động (`npm test`)** | **67 tests: `65 pass · 0 fail · 2 skip`** (2 bài skip cần `GEMINI_API_KEY` trực tiếp) |
| **Ngân hàng đề Task 1 (`config.json`)** | **8 đề đầy đủ** (`bar`, `line`, `pie`, `table`, `process`, `map`, `letter Formal`, `letter Semi-formal`) kèm `keyFacts`, `overviewSample` Band 8.0+ và `usefulPhrases` |

---

## 2. Bảng Đánh Giá Chi Tiết Theo Hạng Mục

| Hạng mục Kiểm duyệt | Đánh giá | Bằng chứng Kỹ thuật (`file:line`) |
| :--- | :---: | :--- |
| **1. Tương thích ngược & Hợp đồng API (`GET /api/writing/config`, `POST /api/writing/score`)** | ✅ PASS | `server.js:732-746` giữ nguyên toàn bộ trường Task 2 và trả thêm `task1WordCountRequirements`, `sampleTask1Topics`, `task1Criteria`. `server.js:826-847` kiểm tra ngưỡng `150` từ cho `taskNumber === 1` và `250` từ cho `taskNumber === 2`. |
| **2. Chuẩn hóa Tiêu chí `TA` & Cờ `has_clear_overview`** | ✅ PASS | `server.js:873-881` tự động chuẩn hóa tiêu chí đầu tiên của Task 1 thành `TA` (`Task Achievement`) kể cả khi AI trả về `TR`; xóa `has_clear_overview` khi `subType === 'general'`. |
| **3. Công thức Điểm Overall Writing (`1/3 Task 1 + 2/3 Task 2`)** | ✅ PASS | Đồng nhất giữa `server.js:699-720` (`computeWritingBandSummary`), `js/writing.js:1411-1433` (`computeWritingSummary`) và `js/analytics.js`: `Math.round(((t1 + 2 * t2) / 3) * 2) / 2`, làm tròn đến bước `0.5` gần nhất; bản ghi lịch sử cũ không có `taskNumber` mặc định là Task 2. |
| **4. Bộ vẽ Biểu đồ SVG/HTML (`renderTask1Visual`) & Chống XSS** | ✅ PASS | `js/writing.js:1160-1389` hỗ trợ đủ 7 dạng (`bar`, `line`, `pie`, `table`, `process`, `map`, `letter`), dùng bảng màu cố định `VIZ_COLORS` đạt chuẩn tương phản trên nền tối `#1a2035` và bọc mọi nhãn dữ liệu qua `_esc()` (`_escapeHtml`). Đã kiểm thử fuzzing `<img onerror>` trên cả 7 dạng trong `tests/smoke.test.js`. |
| **5. Tích hợp *"Học từ chính lỗi sai của tôi"* (`mistakeContext` với `TA`)** | ✅ PASS | `db/mistakes.js` và `js/writing.js:1479-1498` truyền đầy đủ `weakestCriterion: "TA"` (hoặc đối tượng tiêu chí) sang `POST /api/study/generate-unit`. |

---

## 3. Xử Lý Xung Đột Nhỏ Giữa Các Bước (Đã Giải Quyết)

- **[RESOLVED] Assertion cứng 6 ID đề trong `tests/smoke.test.js:972`:**
  - Khi Gemini CLI mở rộng `sampleTask1Topics` từ 6 lên 8 đề (thêm `wt1-ac-map-01` và `wt1-gt-letter-02` `Semi-formal`), bài kiểm thử 10A ban đầu so khớp cứng 6 ID.
  - Claude Code đã cập nhật `tests/smoke.test.js` trong `commit 90a35c6` để kiểm tra tập con 6 ID bắt buộc, chấp nhận mở rộng lên 8 đề và cho phép `tone` thuộc `Formal | Semi-formal | Informal`.

---

## 4. Kết Luận Nghiệm Thu

- **Phase 10A (Codex):** ✅ **VERIFIED**
- **Phase 10B-Content (Gemini CLI):** ✅ **VERIFIED**
- **Phase 10B-UI (Claude Code):** ✅ **VERIFIED**

Toàn bộ **Phase 10** chính thức hoàn thành (`✅ VERIFIED`), sẵn sàng chuyển sang **Phase 11 (Interactive Speaking Mock Interview: Part 1 → Part 2 → Part 3 Live Examiner)**.
