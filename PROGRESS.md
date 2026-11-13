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
| **Phase 4** | **Speaking Practice & AI Examiner** — Luyện nói Part 2/3, thu âm / Speech-to-Text, chấm 4 tiêu chí (`FC`, `LR`, `GRA`, `PR`) | ✅ DONE | Claude Code | [phase-04-speaking-practice.md](progress/phase-04-speaking-practice.md) | `574872a`, `56b9f63` |
| **Phase 5** | **Inline Essay Correction, Security & 3-Tier AI Engine** — Chữa lỗi trực tiếp + Khóa file nhạy cảm + AI 3 tầng | ✅ DONE | Codex & Antigravity | [phase-05-inline-and-security.md](progress/phase-05-inline-and-security.md) | `6940a77`, `0fd6800` |
| **Phase 6** | **Anti-Copy DRM & Exam Proctoring Security (`js/exam-security.js`)** — Chặn copy đề, chặn paste bài mẫu, cảnh báo chuyển tab & đo tốc độ gõ phím | ✅ DONE | Codex | [phase-06-exam-security.md](progress/phase-06-exam-security.md) | `a69b37e`, `498789b` |
| **Phase 7** | **Study Hub v1 (Initial Prototype)** — Khung trang Study Hub ban đầu | ✅ DONE | Claude Code | [phase-07-astra-study-hub.md](progress/phase-07-astra-study-hub.md) | `a8462cc`, `6fc9563` |
| **Phase 8A** | **Adaptive Curriculum Engine & Periodic Evaluation API (`server.js`, `config.json`)** — Cổng kiểm tra Test đầu vào bắt buộc + Thiết kế bài học theo năng lực từ giáo trình + API tương tác Feedback & Lượng giá đầu ra định kỳ | 🟡 READY FOR HANDOFF | OpenAI Codex | `progress/phase-08a-adaptive-backend.md` *(chờ tạo)* | — |
| **Phase 8B** | **3-Stage Closed-Loop Study Hub UI (`study.html`, `js/study.js`, `css/study.css`)** — Giao diện khép kín 3 giai đoạn: (1) Cổng Test Đầu vào → (2) Bài học Cá nhân hóa từ Giáo trình + Tương tác có Feedback → (3) Lượng giá Đầu ra Định kỳ | ⚪ WAITING FOR 8A | Claude Code | `progress/phase-08b-adaptive-study-ui.md` *(chờ tạo)* | — |

---

## 🎯 Đặc Tả Kỹ Thuật Phase 8: Chu Trình Học Tập Thích Ứng Khép Kín 3 Giai Đoạn

Mô hình mới tái cấu trúc hoàn toàn `Study Hub` theo luồng khép kín:
> **Giai đoạn 1: Đầu vào bằng Test bắt buộc** ➔ **Giai đoạn 2: Thiết kế bài học cá nhân hóa theo năng lực từ các giáo trình cung cấp (kèm tương tác có Feedback)** ➔ **Giai đoạn 3: Lượng giá đầu ra định kỳ + Feedback đối chiếu tiến bộ**.

---

### ⚙️ Phase 8A (Giao cho OpenAI Codex — Backend API, Data Giáo trình Chuyên sâu & Kiểm thử)

1. **Mở rộng chiều sâu Giáo trình trong `config.json`**:
   - Nâng cấp `sampleTextbooks` trong `config.json`: Mỗi Unit cần có nội dung giáo trình phong phú, sâu sắc hơn (thêm `levelTag` như `"Foundation"`, `"Intermediate"`, `"Advanced"`; trong `sample.lesson` có thêm `bandUpgradeExamples: [{ band5: "...", band75: "...", analysisVi: "..." }]` để học viên thấy cách nâng cấp câu từ Band thấp lên Band cao; trong `sample.flashcards` có thêm trường `ipa` phiên âm quốc tế).
   - Thêm prompt `tutorFeedbackPrompt` và `checkpointEvaluationPrompt` vào `config.json`.

2. **Xây dựng các Endpoint Chu trình 3 Giai đoạn trong `server.js`**:
   - **`GET /api/study/diagnostic-status`**:
     * Đọc lịch sử từ `results/placement_results.json`, `results/writing_results.json`, `results/speaking_results.json` (và chấp nhận query/post fallback từ client nếu cần).
     * Kiểm tra điều kiện mở khóa: `unlocked: placementHistory.length > 0` (bắt buộc phải hoàn thành ít nhất 1 bài Placement Test mới mở khóa thiết kế giáo trình; khuyến khích có thêm Writing/Speaking).
     * Nếu `unlocked === true`, tự động tính toán `profile`:
       - `inputBand`: Trung bình có trọng số từ Placement (`estimatedBand`), Writing (`overall_band`), Speaking (`overall_band`).
       - `recommendedTargetBand`: `Math.min(8.5, Math.max(6.0, Math.round((inputBand + 1.0) * 2) / 2))`.
       - `skills`: `{ reading, listening, writing, speaking }`.
       - `weakAreas`: Danh sách các kỹ năng/tiêu chí yếu nhất (từ câu sai Placement và tiêu chí thấp nhất của Writing `TR/CC/LR/GRA` & Speaking `FC/LR/GRA/PR`).
       - `recommendedCurriculum`: Danh sách các Unit giáo trình từ `config.sampleTextbooks` được sắp xếp ưu tiên theo đúng `weakAreas` và khoảng `inputBand → recommendedTargetBand`, kèm lý do chọn (`matchReasonVi`).
   - **`POST /api/study/tutor-feedback`** (Tương tác có Feedback trong lúc học):
     * Nhận `{ unitTitle, stepContext, userQuestion, userAttempt, inputBand, targetBand }`.
     * Gọi AI qua `generateWithKeyPool` (nếu AI lỗi/timeout thì trả về feedback hướng dẫn cục bộ thông minh dựa trên `stepContext`) để giải thích từng bước, nhận xét câu trả lời của học viên, đưa ra gợi ý sửa lỗi (`correction`, `explanationVi`, `followUpTip`).
   - **`POST /api/study/checkpoint-evaluate`** (Lượng giá Đầu ra Định kỳ):
     * Nhận `{ unitId, unitTitle, inputBand, targetBand, quizScore, quizTotal, writtenOutput, spokenTranscript, targetWords, prompt }`.
     * Kiểm tra `writtenOutput` hoặc `spokenTranscript` tối thiểu 30 từ (trả 400 nếu thiếu).
     * Chấm điểm đầu ra bằng `generateWithKeyPool` (kèm fallback chấm cục bộ nếu AI timeout) và trả về báo cáo lượng giá định kỳ:
       - `score` (0–100), `outputBand` (0–9, làm tròn 0.5), `inputBand`, `bandDelta` (`outputBand - inputBand`).
       - `passed`: `score >= 70` (Đạt chuẩn để mở khóa học phần tiếp theo hay cần học bù).
       - `criteriaBreakdown`: Điểm thành phần (`taskAchievement`, `lexicalResource`, `grammarAccuracy`).
       - `usedTargetWords`: Các từ vựng mục tiêu học viên đã dùng đúng.
       - `inlineCorrections`: `[{ original, correction, explanationVi }]` sửa lỗi trực tiếp trên bài lượng giá của học viên.
       - `feedbackVi`, `feedbackEn`, `nextActionVi` (Hướng dẫn bước tiếp theo: mở khóa bài mới hoặc ôn lại phần nào).
     * Lưu kết quả lượng giá vào `results/study_checkpoints.json` (và cung cấp `GET /api/study/checkpoints`) đồng thời tự động cập nhật `results/study_progress.json` nếu `passed === true`.

3. **Kiểm thử & Bàn giao Phase 8A**:
   - Bổ sung kiểm thử vào `tests/smoke.test.js` cho `GET /api/study/diagnostic-status` (khi chưa có Placement Test thì `unlocked: false`, sau khi có Placement Test thì `unlocked: true` kèm `profile` và `recommendedCurriculum`), `POST /api/study/tutor-feedback`, và `POST /api/study/checkpoint-evaluate` (kiểm tra validation 400 và chấm trả về đủ `outputBand`, `bandDelta`, `passed`, `inlineCorrections`).
   - Chạy `npm test` đảm bảo PASS 100%, tạo báo cáo `progress/phase-08a-adaptive-backend.md`, cập nhật `PROGRESS.md` (chuyển 8A sang `✅ DONE` và 8B sang `🟡 READY FOR HANDOFF`), commit và push lên `origin main`.

---

### 🎨 Phase 8B (Giao cho Claude Code — Giao diện Chu trình 3 Giai đoạn trên `study.html`, `js/study.js`, `css/study.css`)

1. **Thiết kế lại `study.html`, `css/study.css`, `js/study.js` theo đúng 3 Giai đoạn trực quan**:
   - **Thanh Quy trình 3 Giai đoạn ở đầu trang (3-Stage Pipeline Stepper)**:
     * `① Chẩn đoán Đầu vào (Diagnostic Test)` ➔ `② Bài học Cá nhân hóa & Tương tác Feedback` ➔ `③ Lượng giá Đầu ra Định kỳ (Checkpoint Evaluation)`.
   - **Giai đoạn 1 — Cổng Đầu vào Bắt buộc (Mandatory Diagnostic Gate)**:
     * Gọi `GET /api/study/diagnostic-status` (kết hợp kiểm tra `localStorage` `ielts_placement_results` — nếu `localStorage` có mà server chưa có thì tự động đồng bộ `POST /api/placement/results` trước).
     * **Nếu CHƯA có bài Placement Test (`unlocked === false`)**:
       - Hiển thị màn hình **🔒 Cổng Chẩn Đoán Năng Lực Đầu Vào (Diagnostic Requirement Gate)** khóa khu vực giáo trình bên dưới, giải thích rõ: *"Hệ thống thiết kế giáo trình cá nhân hóa dựa trên năng lực thực tế của bạn. Vui lòng hoàn thành Bài Test Đầu Vào trước khi mở khóa lộ trình học."*
       - Hiển thị 3 thẻ trạng thái rõ ràng:
         1. `Placement Test (Reading & Listening)` — **Bắt buộc** (`Chưa hoàn thành` → Nút lớn **"Làm Bài Test Đầu Vào Ngay →"** trỏ tới `index.html`).
         2. `Writing Task 2 Diagnostic` — *Khuyến nghị* (hiển thị Band nếu đã làm hoặc nút sang `writing.html`).
         3. `Speaking Part 2/3 Diagnostic` — *Khuyến nghị* (hiển thị Band nếu đã làm hoặc nút sang `speaking.html`).
     * **Nếu ĐÃ làm bài Test Đầu vào (`unlocked === true`)**:
       - Hiển thị **Bảng Hồ Sơ Năng Lực Đầu Vào (Diagnostic Profile Card)**: Band đầu vào (`Input Band`), Band mục tiêu (`Target Band`), Điểm từng kỹ năng (`Reading`, `Listening`, `Writing`, `Speaking`), các Lỗ hổng Kiến thức cần khắc phục (`weakAreas`), và **Lộ trình Giáo trình Cá nhân hóa Được Đề Xuất (`recommendedCurriculum`)** kèm lý do tại sao hệ thống chọn từng bài học đó cho học viên.

   - **Giai đoạn 2 — Học Tập Cá Nhân Hóa từ Giáo Trình + Tương Tác Có Feedback**:
     * Khi mở một Học phần từ lộ trình cá nhân hóa (hoặc từ tài liệu nạp thêm):
       - **Học Lý thuyết Chuyên sâu & Bảng Nâng Cấp Band (`bandUpgradeExamples`)**: Hiển thị rõ câu mẫu ở trình độ hiện tại vs. câu nâng cấp lên Band mục tiêu, công thức áp dụng, lỗi thường gặp.
       - **Thẻ Từ vựng Học thuật (Flashcards + IPA + Phát âm Audio 🔊)**: Thêm nút bấm nghe phát âm tiếng Anh trực tiếp bằng `window.speechSynthesis` trên từng thẻ từ vựng.
       - **Bài tập Tương tác theo Năng lực (Interactive Quiz & Error Correction Drill)**: Làm từng câu có giải thích tức thì VÀ có nút **"💬 Hỏi Gia sư AI về câu này"** gửi ngữ cảnh sang `POST /api/study/tutor-feedback`.
       - **Khung Tương tác Gia sư AI 1-1 (Interactive Feedback Sidebar / Panel)**: Luôn nằm cạnh bài học để học viên đặt câu hỏi hoặc dán câu mình tự đặt để Gia sư AI nhận xét, sửa lỗi và gợi ý nâng Band ngay trong lúc học.

   - **Giai đoạn 3 — Lượng Giá Đầu Ra Định Kỳ + Feedback Đối Chiếu Tiến Bộ (Periodic Checkpoint Assessment)**:
     * Ở bước cuối của mỗi Học phần (hoặc tab Lượng giá Định kỳ):
       - Học viên thực hiện **Bài Lượng Giá Đầu Ra** gồm: Điểm phần câu hỏi kiểm tra (`quiz` + `drill`), Bài viết học thuật vận dụng từ vựng mục tiêu (`writtenOutput`) VÀ/HOẶC thu âm trả lời vấn đáp bằng Mic (`spokenTranscript` qua `SpeechRecognition`).
       - Gửi lên `POST /api/study/checkpoint-evaluate` và hiển thị **Báo Cáo Lượng Giá Đầu Ra Chi Tiết**:
         * **Đối chiếu Tiến bộ**: `Band Đầu vào (Input Band) ➔ Band Đầu ra (Output Band)` kèm huy hiệu tăng điểm (`+0.5` / `+1.0 Band`) và trạng thái **ĐẠT CHUẨN MỞ KHÓA (`PASSED ✓`)** hoặc **CẦN ÔN BÙ (`NEEDS REVIEW ↻`)**.
         * **Sửa lỗi trực tiếp trên bài lượng giá (`inlineCorrections`)**: Cụm từ gốc gạch đỏ → Cụm sửa màu xanh lá kèm lời giải thích tiếng Việt.
         * **Lịch sử các lần Lượng giá Định kỳ (`GET /api/study/checkpoints`)** hiển thị ở cột bên phải để theo dõi sự tiến bộ qua từng chặng.

2. **Kiểm thử & Bàn giao Phase 8B**:
   - Đảm bảo mọi test hiện có và test mới trong `tests/smoke.test.js` đều PASS 100% (`npm test`).
   - Tạo báo cáo `progress/phase-08b-adaptive-study-ui.md`, cập nhật `PROGRESS.md` (chuyển Phase 8B sang `✅ DONE`), commit và push lên `origin main`.
