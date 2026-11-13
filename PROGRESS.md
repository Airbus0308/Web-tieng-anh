# 📊 IELTS Master — Bảng Điều Phối & Tiến Độ Dự Án (Project Tracker)

> **Vai trò Điều phối (Project Coordinator):** Antigravity  
> **Đội ngũ Thực thi (Execution Agents):** Antigravity, Claude Code, OpenAI Codex  
> **Repository:** [Airbus0308/Web-tieng-anh](https://github.com/Airbus0308/Web-tieng-anh)  
> **Cập nhật lần cuối:** 2026-11-13

---

## 🗺️ Tổng Quan Lộ Trình (Master Roadmap)

| Phase | Hạng mục (Milestone) | Trạng thái | Người thực hiện | Báo cáo chi tiết | Commit |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **Phase 1** | **Placement Test (Reading & Listening)** — 15 câu MCQ, Audio thật khóa tua ngược, mở Transcript sau khi nộp | ✅ DONE | Antigravity | [phase-01-placement-test.md](progress/phase-01-placement-test.md) | `d7f50f9`, `c840741` |
| **Phase 2** | **Writing Task 2 AI Grader** — Giao diện viết, chấm 4 tiêu chí qua Gemini API, `config.json` | ✅ DONE | Antigravity | [phase-02-writing-task2-ai.md](progress/phase-02-writing-task2-ai.md) | `38baa5d` |
| **Phase 3** | **Backend Sync & Proficiency Analytics Dashboard** — Đồng bộ DB + Skill Breakdown 4 tiêu chí Writing & lộ trình AI | ✅ DONE | Codex & Antigravity | [phase-03-analytics-dashboard.md](progress/phase-03-analytics-dashboard.md) | `d9e97e0`, `8d7d3fa` |
| **Phase 4** | **Speaking Practice & AI Examiner** — Luyện nói Part 2/3, thu âm / Speech-to-Text, chấm 4 tiêu chí (`FC`, `LR`, `GRA`, `PR`) | 🟡 READY FOR HANDOFF | Claude Code / Codex | `progress/phase-04-speaking-practice.md` *(chờ tạo)* | — |
| **Phase 5** | **Inline Essay Correction & Production Security** — Bôi đỏ sửa lỗi trực tiếp trên câu + Bảo mật Server & Rate Limit | ⚪ PLANNED | Claude Code / Codex | `progress/phase-05-inline-and-security.md` *(chờ tạo)* | — |

---

## 🔄 Quy Trình Phối Hợp Giữa Điều Phối Viên & Các Agent (Workflow Protocol)

Mỗi khi hoàn thành một Phase, Agent thực thi (**Claude Code** hoặc **Codex**) **BẮT BUỘC** thực hiện đủ 4 bước trước khi bàn giao lại cho Điều phối viên:

1. **Chạy kiểm thử:** Tất cả tính năng mới phải có test trong `tests/smoke.test.js` và chạy `npm test` đạt **100% PASS**.
2. **Tạo file báo cáo tiến độ mới:** Tạo một file markdown mới trong thư mục `progress/` theo mẫu chuẩn:
   - Tên file: `progress/phase-XX-<ten-ngan-gon>.md`
   - Nội dung gồm: *Mục tiêu*, *Các file đã tạo/sửa*, *API/Schema mới*, *Kết quả test*, và *Ghi chú bàn giao cho Phase kế tiếp*.
3. **Cập nhật bảng `PROGRESS.md`:** Đổi trạng thái Phase vừa làm sang `✅ DONE`, điền link tới file báo cáo mới trong `progress/`, và chuyển Phase kế tiếp sang `🟡 READY FOR HANDOFF`.
4. **Commit & Push lên GitHub:** Commit với message rõ ràng (`feat(phase-X): ...`) và push lên `origin main` để Điều phối viên nghiệm thu.

---

## 📋 Nhiệm Vụ Đang Mở: Phase 4 (Giao cho Claude Code / Codex)

### Mục tiêu Phase 4: Xây dựng trang Luyện Nói IELTS Speaking (`speaking.html`) & Đồng bộ 4 Kỹ năng lên Analytics

> *Lưu ý:* Phần Audio thật cho bài Listening trong Placement Test (`assets/audio/placement-listening.mp3`, khóa tua ngược, chỉ hiện Transcript sau khi nộp bài) đã được hoàn thành ở commit `c840741`. Phase 4 tập trung hoàn thiện kỹ năng thứ 4: **Speaking**.

#### 1. Xây dựng trang Luyện Nói IELTS Speaking (`speaking.html`, `css/speaking.css`, `js/speaking.js`)
- Cập nhật thanh điều hướng (`nav-links`) trên tất cả các trang (`index.html`, `writing.html`, `speaking.html`, `analytics.html`) để có đủ 4 mục: **Placement Test** | **Writing Practice** | **Speaking Practice** | **Analytics**.
- Giao diện `speaking.html` hỗ trợ luyện tập **Speaking Part 2 (Cue Card) & Part 3**:
  - Hiển thị chủ đề Cue Card (cho phép đổi đề bài từ danh sách đề mẫu), đồng hồ bấm giờ (1 phút chuẩn bị + 2 phút nói).
  - Hỗ trợ thu âm/chuyển giọng nói thành văn bản bằng **Web Speech Recognition API** (`webkitSpeechRecognition` / `SpeechRecognition`) kết hợp ô nhập/chỉnh sửa văn bản (`textarea`) để học viên trên mọi trình duyệt đều có thể gửi bài nói chấm điểm.
  - Hiển thị kết quả chấm AI chi tiết theo **4 tiêu chí Speaking chính thức**:
    - `FC` — Fluency and Coherence (25%)
    - `LR` — Lexical Resource (25%)
    - `GRA` — Grammatical Range and Accuracy (25%)
    - `PR` — Pronunciation / Delivery (25%)
  - Lưu lịch sử luyện nói ở cả `localStorage` (`ielts_speaking_history`) và Backend (`results/speaking_results.json`).

#### 2. Mở rộng `config.json` & `server.js`
- Thêm `speakingCriteria` (`FC`, `LR`, `GRA`, `PR`), `sampleSpeakingTopics`, `speakingSystemInstruction`, và `speakingResponseFormat` vào `config.json`.
- Thêm 3 endpoint vào `server.js`:
  - `GET /api/speaking/config` — Trả về danh sách chủ đề Speaking mẫu và 4 tiêu chí chấm.
  - `POST /api/speaking/score` — Kiểm tra độ dài câu trả lời (tối thiểu 40 từ), gọi Gemini qua `generateWithRetry`, lưu vào `results/speaking_results.json` và trả về kết quả chấm.
  - `GET /api/speaking/history` — Trả về lịch sử các lần luyện Speaking.

#### 3. Tích hợp điểm Speaking vào trang `analytics.html` & `js/analytics.js`
- Cập nhật `analytics.html` và `js/analytics.js` để đọc thêm `/api/speaking/history` (fallback `ielts_speaking_history`), hiển thị điểm trung bình **Speaking** và đưa các lượt luyện Speaking vào biểu đồ tiến độ chung.

#### 4. Nghiệm thu (Definition of Done)
- Bổ sung kiểm thử cho `/speaking.html`, `GET /api/speaking/config`, `GET /api/speaking/history`, `POST /api/speaking/score` (kiểm tra lỗi khi rỗng / dưới số từ tối thiểu) vào `tests/smoke.test.js`.
- Chạy `npm test` PASS 100%.
- Tạo báo cáo `progress/phase-04-speaking-practice.md` và cập nhật bảng trên trong `PROGRESS.md` (chuyển Phase 4 sang `✅ DONE` và mở Phase 5).
- Commit và push lên nhánh `main`.
