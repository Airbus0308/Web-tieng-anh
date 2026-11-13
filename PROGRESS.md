# 📊 IELTS Master — Bảng Điều Phối & Tiến Độ Dự Án (Project Tracker)

> **Vai trò Điều phối (Project Coordinator):** Antigravity  
> **Đội ngũ Thực thi (Execution Agents):** Antigravity, Claude Code, OpenAI Codex  
> **Repository:** [Airbus0308/Web-tieng-anh](https://github.com/Airbus0308/Web-tieng-anh)  
> **Cập nhật lần cuối:** 2026-11-13

---

## 🗺️ Tổng Quan Lộ Trình (Master Roadmap)

| Phase | Hạng mục (Milestone) | Trạng thái | Người thực hiện | Báo cáo chi tiết | Commit |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **Phase 1** | **Placement Test (Reading & Listening)** — 15 câu MCQ, chấm Band, lưu Mock DB | ✅ DONE | Antigravity | [phase-01-placement-test.md](progress/phase-01-placement-test.md) | `d7f50f9` |
| **Phase 2** | **Writing Task 2 AI Grader** — Giao diện viết, chấm 4 tiêu chí qua Gemini API, `config.json` | ✅ DONE | Antigravity | [phase-02-writing-task2-ai.md](progress/phase-02-writing-task2-ai.md) | `38baa5d` |
| **Phase 3** | **Backend Sync & Proficiency Analytics Dashboard** — Đồng bộ DB + Trang phân tích năng lực & lộ trình AI | ✅ DONE | Codex & Antigravity | [phase-03-analytics-dashboard.md](progress/phase-03-analytics-dashboard.md) | `d9e97e0` |
| **Phase 4** | **Speaking Practice & Real Listening Audio** — Thu âm Speaking chấm bằng Gemini + Audio cho Listening | 🟡 READY FOR HANDOFF | Claude Code / Codex | `progress/phase-04-speaking-and-audio.md` *(chờ tạo)* | — |
| **Phase 5** | **Inline Essay Correction & Writing Task 1** — Bôi đỏ lỗi trực tiếp trên câu + Học biểu đồ Task 1 | ⚪ PLANNED | Claude Code / Codex | `progress/phase-05-inline-correction-task1.md` *(chờ tạo)* | — |

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

### Mục tiêu Phase 4: Speaking Practice & Real Listening Audio (`speaking.html`)

#### 1. Bổ sung trình phát Audio thực tế cho phần Listening ở Placement Test (`js/ui.js` & `js/questions.js`)
- Thêm trình điều khiển phát âm thanh (sử dụng Web Speech API `speechSynthesis` phân vai giọng đọc cho Dr. Patel và Sarah, kèm thanh điều khiển Play / Pause / Replay và tùy chọn ẩn/hiện Transcript) để phần thi Listening mang trải nghiệm nghe thực sự thay vì chỉ đọc văn bản.

#### 2. Xây dựng trang Luyện Nói IELTS Speaking (`speaking.html`, `css/speaking.css`, `js/speaking.js`)
- Cập nhật thanh điều hướng (`nav-links`) trên tất cả các trang để có: **Placement Test** | **Writing Practice** | **Speaking Practice** | **Analytics**.
- Giao diện `speaking.html` hỗ trợ luyện tập **Speaking Part 2 (Cue Card)** & **Part 3**:
  - Hiển thị chủ đề (Cue Card), đồng hồ đếm ngược 1 phút chuẩn bị và 2 phút nói.
  - Cho phép ghi âm giọng nói (qua `MediaRecorder` / Web Speech Recognition) hoặc nhập bản transcript câu trả lời để gửi chấm điểm.
  - Hiển thị điểm 4 tiêu chí Speaking chính thức: **Fluency & Coherence (FC)**, **Lexical Resource (LR)**, **Grammatical Range & Accuracy (GRA)**, **Pronunciation (PR)**.

#### 3. Mở rộng `config.json` & `server.js`
- Thêm `speakingCriteria`, `sampleSpeakingTopics`, và `speakingSystemInstruction` vào `config.json`.
- Thêm các endpoint vào `server.js`:
  - `GET /api/speaking/config` — Trả về chủ đề mẫu và tiêu chí chấm Speaking.
  - `POST /api/speaking/score` — Chấm điểm bài nói qua Gemini (`generateWithRetry`) và lưu lịch sử vào `results/speaking_results.json`.
  - `GET /api/speaking/history` — Trả về danh sách các lần luyện Speaking.

#### 4. Nghiệm thu (Definition of Done)
- Bổ sung kiểm thử cho `/speaking.html`, `/api/speaking/config`, `/api/speaking/history`, `/api/speaking/score` vào `tests/smoke.test.js`.
- Chạy `npm test` PASS 100%.
- Tạo báo cáo `progress/phase-04-speaking-and-audio.md` và cập nhật bảng trên trong `PROGRESS.md`.
- Commit và push lên nhánh `main`.
