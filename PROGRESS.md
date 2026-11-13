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
| **Phase 8A** | **SRL-SLA Adaptive Backend Engine (`server.js`, `config.json`)** — Vòng lặp Tự điều chỉnh 3 giai đoạn (Zimmerman + COPES + KBCP): Cổng Test Đầu vào + Giáo trình i+1 + SRS Spaced Repetition + Feynman/Socratic Tutor + Lượng giá Siêu nhận thức | 🟡 READY FOR HANDOFF | OpenAI Codex | `progress/phase-08a-adaptive-backend.md` *(chờ tạo)* | — |
| **Phase 8B** | **SRL-SLA 3-Stage Closed-Loop Study Hub UI (`study.html`, `js/study.js`, `css/study.css`)** — Giao diện Tự điều chỉnh 3 Giai đoạn: (1) Forethought & Test Gate + KBCP Plan ➔ (2) Performance 4 Kỹ thuật Nhận thức + Socratic Coach ➔ (3) Self-Reflection Checkpoint + SRS Queue | ⚪ WAITING FOR 8A | Claude Code | `progress/phase-08b-adaptive-study-ui.md` *(chờ tạo)* | — |

---

## 🎯 Đặc Tả Kỹ Thuật Phase 8: Kiến Trúc Học Ngoại Ngữ Tự Điều Chỉnh (SRL-SLA Architecture)

Kết hợp **Mô hình 3 giai đoạn chu kỳ của Zimmerman**, **Siêu nhận thức COPES (Winne & Hadwin)**, **Khung Cam kết KBCP (McDaniel & Einstein)** và **4 Kỹ thuật Khoa học Nhận thức (Feynman Self-Explanation, Active Recall, Spaced Repetition SRS, Interleaving)** vào luồng 3 giai đoạn:
> **Giai đoạn 1 (Forethought): Đầu vào bằng Test bắt buộc & Cam kết KBCP** ➔ **Giai đoạn 2 (Performance): Học Giáo trình Cá nhân hóa ($i+1$) qua 4 Kỹ thuật Nhận thức + Gia sư AI Socratic** ➔ **Giai đoạn 3 (Self-Reflection): Lượng giá Đầu ra Định kỳ, Đối chiếu Siêu nhận thức & Vòng lặp Ôn tập Ngắt quãng (SRS)**.

---

### ⚙️ Phase 8A (Giao cho OpenAI Codex — Backend SRL-SLA Engine, Giáo trình Chuyên sâu & SRS API)

1. **Nâng cấp Chiều sâu Giáo trình & Nhận thức trong `config.json`**:
   - Trong mỗi Unit của `sampleTextbooks`:
     * Bổ sung `levelTag` (`"Foundation"`, `"Intermediate"`, `"Advanced"`) và `targetWeakness` (`["Reading", "Listening", "TR", "CC", "LR", "GRA", "FC"]`).
     * Trong `sample.lesson`:
       - Bổ sung `bandUpgradeExamples`: ít nhất 2 cặp câu đối chiếu `{ "bandLow": "câu mẫu Band 5.0-5.5", "bandHigh": "câu nâng cấp Band 7.5+", "analysisVi": "giải thích cấu trúc/từ vựng ăn điểm" }`.
       - Bổ sung `feynmanPromptVi`: câu hỏi yêu cầu học viên tự giải thích lại quy tắc cốt lõi bằng lời của mình (Kỹ thuật Feynman).
     * Trong `sample.flashcards`: bổ sung trường `"ipa"` (phiên âm quốc tế) và `"clozeSentence"` (câu khuyết từ với chỗ trống `___` để luyện **Active Recall** chủ động nhớ lại từ thay vì chỉ đọc thụ động).
     * Trong `sample.drill`: thiết kế theo kỹ thuật **Interleaving (Học đan xen)** — mỗi câu có thêm trường `"skillTag"` trộn lẫn giữa `"Reading Paraphrase"`, `"Grammar Error Fix (GRA)"`, và `"Lexical Collocation (LR)"`.
   - Bổ sung `tutorFeedbackPrompt` (huấn luyện theo phương pháp Socratic/Feynman: gợi mở, không chép hộ đáp án) và `checkpointEvaluationPrompt` vào `config.json`.

2. **Xây dựng Hệ thống API SRL-SLA 3 Giai đoạn trong `server.js`** (dùng `studyRateLimit` 30 req/15 phút):
   - **`GET /api/study/diagnostic-status`** *(Giai đoạn 1 — Forethought & Diagnostic Gate)*:
     * Đọc lịch sử từ `results/placement_results.json`, `results/writing_results.json`, `results/speaking_results.json`, `results/study_srs.json`, `results/study_checkpoints.json`.
     * Đặt `unlocked: placementHistory.length > 0` (BẮT BUỘC hoàn thành ít nhất 1 bài Placement Test mới mở khóa giáo trình).
     * Trả về `{ unlocked, counts: { placement, writing, speaking }, profile, recommendedCurriculum, srsSummary }`:
       - Nếu `unlocked === false`: `profile: null`, `recommendedCurriculum: []`.
       - Nếu `unlocked === true`:
         * `profile`: `{ inputBand, recommendedTargetBand, skills: { reading, listening, writing, speaking }, weakAreas, calibrationIndex }` (trong đó `calibrationIndex` đo độ lệch trung bình giữa điểm học viên tự dự đoán và điểm thực tế ở các lần lượng giá trước).
         * `recommendedCurriculum`: danh sách các Unit từ `config.sampleTextbooks` được cá nhân hóa theo vùng phát triển gần ($i+1$: vừa tầm `inputBand → recommendedTargetBand`) và khớp với `weakAreas`, kèm `matchReasonVi` và `mastery`.
         * `srsSummary`: `{ totalItems, dueTodayCount, dueItems }` (các từ vựng/cấu trúc đến hạn ôn tập ngắt quãng hôm nay).
   - **`POST /api/study/tutor-feedback`** *(Giai đoạn 2 — Socratic & Feynman Interactive Feedback)*:
     * Nhận `{ mode, unitTitle, stepContext, userQuestion, userAttempt, inputBand, targetBand }` (`mode` có thể là `"feynman"` khi học viên tự giải thích quy tắc, hoặc `"socratic"` khi học viên hỏi bài/sửa câu). Trả `400` nếu thiếu cả `userQuestion` và `userAttempt`.
     * Gọi AI qua `generateWithKeyPool` (kèm timeout 20s và fallback cục bộ thông minh) trả về `{ replyVi, replyEn, correction, explanationVi, socraticHintVi, followUpQuestion, understood: boolean, provider }`.
   - **`GET /api/study/srs` & `POST /api/study/srs/review`** *(Kỹ thuật Spaced Repetition — Lặp lại ngắt quãng 1–3–7–14 ngày)*:
     * Lưu trong `results/study_srs.json`.
     * `GET /api/study/srs`: trả về danh sách các thẻ từ vựng/lỗi ngữ pháp trong hàng đợi SRS cùng các mục `dueToday` (`nextReviewAt <= now`).
     * `POST /api/study/srs/review`: nhận `{ itemId, word, meaning, example, quality }` (`quality` ∈ `["again", "hard", "good", "easy"]` hoặc thêm mới từ bài học/bài lượng giá), tính toán `intervalDays` (`again` = 0 ngày/ôn ngay, `hard` = 1 ngày, `good` = 3 ngày, `easy` = 7–14 ngày), cập nhật `nextReviewAt` và lưu vào `results/study_srs.json`.
   - **`POST /api/study/checkpoint-evaluate` & `GET /api/study/checkpoints`** *(Giai đoạn 3 — Self-Reflection & Periodic Output Evaluation)*:
     * Nhận `{ unitId, unitTitle, inputBand, targetBand, selfPredictedBand, selfDifficultyReason, quizScore, quizTotal, writtenOutput, spokenTranscript, targetWords, prompt }`.
     * Kết hợp `outputText = (writtenOutput || spokenTranscript || '').trim()`. Trả `400` nếu dưới 30 từ (`wordCount`, `minRequired: 30`).
     * Chấm điểm bằng `generateWithKeyPool` (kèm timeout 25s và fallback chấm cục bộ chi tiết), trả về:
       - `score` (0–100), `inputBand`, `outputBand` (0–9, bước 0.5), `bandDelta` (`outputBand - inputBand`).
       - **Siêu nhận thức COPES (`metacognition`)**: `{ selfPredictedBand, calibrationGap: Number((outputBand - selfPredictedBand).toFixed(1)), calibrationFeedbackVi, selfDifficultyReason }`.
       - `passed`: `score >= 70`.
       - `criteriaBreakdown`: `{ taskAchievement, lexicalResource, grammarAccuracy }`.
       - `usedTargetWords` (các từ đã dùng được) và `missedTargetWords` (các từ mục tiêu chưa dùng được).
       - `inlineCorrections`: `[{ original, correction, explanationVi }]`.
       - `feedbackVi`, `feedbackEn`, `nextActionVi`.
     * **Tự động đẩy vào vòng lặp SRS**: Nếu có `missedTargetWords` hoặc `inlineCorrections`, tự động thêm/cập nhật các mục đó vào `results/study_srs.json` với trạng thái cần ôn tập (`nextReviewAt = now`) để học viên không bao giờ quên lỗi của mình!
     * Lưu bản ghi lượng giá vào `results/study_checkpoints.json` và nếu `passed === true` thì cập nhật `mastery: 100` cho `unitId` trong `results/study_progress.json`.

3. **Kiểm thử & Bàn giao Phase 8A**:
   - Bổ sung kiểm thử vào `tests/smoke.test.js` cho:
     * `GET /api/study/diagnostic-status` (`unlocked: false` khi chưa có Placement Test, `unlocked: true` kèm `profile`, `recommendedCurriculum`, `srsSummary` khi đã có Placement Test).
     * `config.json` có `bandUpgradeExamples`, `feynmanPromptVi`, `ipa`, `clozeSentence`, `skillTag`.
     * `POST /api/study/tutor-feedback` (400 khi rỗng, 200 kèm `socraticHintVi` / `replyVi` khi hợp lệ).
     * `GET /api/study/srs` & `POST /api/study/srs/review` (lưu và tính `intervalDays`, `nextReviewAt`).
     * `POST /api/study/checkpoint-evaluate` (400 khi < 30 từ, 200 kèm `outputBand`, `bandDelta`, `metacognition`, `passed`, `inlineCorrections`, và tự động đẩy từ bị thiếu vào SRS).
   - Chạy `npm test` PASS 100%, tạo báo cáo `progress/phase-08a-adaptive-backend.md`, cập nhật `PROGRESS.md` (chuyển 8A sang `✅ DONE` và 8B sang `🟡 READY FOR HANDOFF`), commit và push lên `origin main`.

---

### 🎨 Phase 8B (Giao cho Claude Code — Giao diện Học Ngoại Ngữ Tự Điều Chỉnh SRL-SLA 3 Giai Đoạn trên `study.html`, `js/study.js`, `css/study.css`)

1. **Thanh Chu Trình 3 Giai Đoạn Zimmerman ở đầu `study.html`**:
   - Hiển thị 3 chặng rõ ràng:
     * `① Forethought: Test Chẩn đoán & Kế hoạch KBCP`
     * `② Performance: Giáo trình Cá nhân hóa & 4 Kỹ thuật Nhận thức`
     * `③ Self-Reflection: Lượng giá Đầu ra & Phản tư Siêu nhận thức`

2. **Giai đoạn 1 — Forethought: Cổng Test Đầu Vào Bắt Buộc, Hồ sơ Năng lực & Cam kết KBCP**:
   - Tự động đồng bộ `localStorage` (`ielts_placement_results`) lên server nếu cần rồi gọi `GET /api/study/diagnostic-status`.
   - **Nếu `unlocked === false` (Chưa làm Placement Test)**:
     * Hiển thị màn hình **🔒 Cổng Chẩn Đoán Đầu Vào Bắt Buộc (Mandatory Diagnostic Gate)** khóa khu vực giáo trình, yêu cầu làm Placement Test (`index.html`) và khuyến nghị làm thêm Writing (`writing.html`) & Speaking (`speaking.html`).
   - **Nếu `unlocked === true` (Đã có Test Đầu vào)**:
     * Hiển thị **Hồ Sơ Năng Lực Đầu Vào (`Input Band`, điểm 4 kỹ năng, `weakAreas`)**.
     * **Khung Cam Kết Thực Thi KBCP (If-Then Study Commitment)**: Cho phép đặt `Target Exam Date`, `Target Band`, và cam kết giờ học cố định mỗi ngày (*"Nếu đến [20:00] mỗi ngày, tôi sẽ học ít nhất [25 phút] tại bàn học"* — lưu `localStorage`), kèm thanh theo dõi **Streak 7 ngày (`T2 → CN`)**.
     * **Hộp Ôn Tập Ngắt Quãng Hôm Nay (`SRS Due Today Queue`)**: Lấy từ `GET /api/study/srs` hiển thị các từ vựng/cấu trúc đến hạn ôn hôm nay với các nút đánh giá độ nhớ `Quên (Ôn lại ngay)` / `Khó (1 ngày)` / `Nhớ tốt (3 ngày)` / `Rất dễ (7 ngày)` gọi `POST /api/study/srs/review`.
     * **Lộ Trình Giáo Trình Cá Nhân Hóa (`recommendedCurriculum`)**: Hiển thị danh sách các Học phần được chọn riêng theo Band ($i+1$) và điểm yếu của học viên kèm lý do `matchReasonVi`.

3. **Giai đoạn 2 — Performance: Bài Học Giáo Trình qua 4 Kỹ Thuật Nhận Thức + Gia sư AI Socratic**:
   - Trong trình học 5 bước (`0% → 100% Mastery`):
     * **Bước 1 — Deep Lesson & Kỹ thuật Tự giải thích Feynman (`20%`)**:
       - Hiển thị lý thuyết song ngữ + **Bảng Nâng Cấp Câu theo Band (`bandUpgradeExamples`: Band 5.5 ➔ Band 7.5+)** + lỗi thường gặp.
       - Cuối Bước 1 có ô **💡 Thử thách Feynman (`feynmanPromptVi`)**: học viên tự diễn giải lại quy tắc bằng 1–2 câu của chính mình và bấm `"Kiểm tra độ hiểu với Gia sư AI"` (gọi `POST /api/study/tutor-feedback` với `mode: "feynman"`).
     * **Bước 2 — Active Recall Lexicon & Spaced Repetition (`40%`)**:
       - Hiển thị thẻ từ vựng có phiên âm `ipa`, nút **🔊 Nghe phát âm** (`window.speechSynthesis`), câu điền khuyết `clozeSentence` để học viên **chủ động nhớ lại từ (Active Recall)** trước khi lật thẻ, và nút `"➕ Đưa vào lịch ôn SRS"` (`POST /api/study/srs/review`).
     * **Bước 3 & Bước 4 — Quick Quiz & Interleaved Skill Mixer (`60% → 80%`)**:
       - Hiển thị nhãn kỹ năng đan xen (`skillTag`: Reading / GRA / LR) trên từng câu hỏi (**Interleaving**).
       - Sau mỗi câu có nút **"💬 Hỏi Gia sư AI Socratic"** để nhận gợi ý bậc thang (`socraticHintVi`) từ `POST /api/study/tutor-feedback`.
     * **Khung Gia sư AI Siêu Nhận Thức (`#tutor-feedback-panel`)**: Luôn túc trực để học viên hỏi bài, xin gợi ý sửa câu mà không chép hộ đáp án.

4. **Giai đoạn 3 — Self-Reflection: Lượng Giá Đầu Ra Định Kỳ & Tự Phản Tư Siêu Nhận Thức (`100%`)**:
   - Ở Bước 5 (**Periodic Output Checkpoint**):
     * Học viên viết đoạn văn học thuật (`writtenOutput`, tối thiểu 30 từ) hoặc bấm nút **🎙️ Thu âm trả lời bằng giọng nói** (`SpeechRecognition`) vận dụng các `targetWords`.
     * **Bước Tự Đánh Giá Siêu Nhận Thức (Metacognitive Calibration — COPES)**: Ngay trước nút nộp chấm điểm, học viên chọn:
       1. `selfPredictedBand`: *"Bạn tự dự đoán bài trả lời này của mình đạt Band mấy?"* (`5.0` → `8.5`).
       2. `selfDifficultyReason`: *"Trở ngại lớn nhất khi bạn làm bài này là gì?"* (`Nhớ từ vựng nhưng chưa biết ghép câu`, `Ngữ pháp còn lúng túng`, `Bí ý tưởng triển khai`, `Áp lực thời gian`).
     * Khi bấm chấm điểm (`POST /api/study/checkpoint-evaluate`), hiển thị **Báo Cáo Lượng Giá & Phản Tư 3 Chiều**:
       - **Đối chiếu 3 cột Band**: `Band Đầu vào (${inputBand})` ➔ `Band Tự dự đoán (${selfPredictedBand})` ➔ `Band Thực tế Đạt được (${outputBand})` kèm nhận xét Siêu nhận thức (`calibrationFeedbackVi`).
       - **3 Thanh tiêu chí (`criteriaBreakdown`)**, **Từ vựng đã dùng (`usedTargetWords`) vs. Từ vựng bị bỏ sót (`missedTargetWords` — báo rõ đã tự động đẩy vào lịch ôn SRS)**.
       - **Sửa lỗi câu trực tiếp (`inlineCorrections`)**: Câu gốc gạch đỏ → Câu sửa xanh lá + Giải thích.
       - **Trạng thái Mở khóa (`PASSED ✓` hoặc `NEEDS REVIEW ↻`)** và danh sách **Lịch sử Lượng giá Định kỳ (`GET /api/study/checkpoints`)** ở Sidebar.

5. **Kiểm thử & Bàn giao Phase 8B**:
   - Cập nhật/bổ sung kiểm thử vào `tests/smoke.test.js` kiểm tra `study.html` và `js/study.js` tích hợp đầy đủ các thành phần SRL-SLA (`diagnostic-status`, `tutor-feedback`, `srs`, `checkpoint-evaluate`, `selfPredictedBand`).
   - Chạy `npm test` đảm bảo PASS 100%.
   - Tạo báo cáo `progress/phase-08b-adaptive-study-ui.md`, cập nhật `PROGRESS.md` (chuyển Phase 8B sang `✅ DONE`), commit và push lên `origin main`.
