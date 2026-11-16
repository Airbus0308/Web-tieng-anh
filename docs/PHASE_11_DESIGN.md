# 📐 Đặc Tả Kỹ Thuật Phase 11: Interactive Speaking Mock Interview (Part 1 → Part 2 → Part 3 Live AI Examiner)

> **Điều phối & Kiến trúc & QA (Architect & Auditor):** Antigravity  
> **Thực thi Nội dung & AI Prompt (`Phase 11A-Content`):** Gemini CLI (`config.json`, `progress/phase-11a-content-gemini.md`)  
> **Thực thi Backend API (`Phase 11A-Backend`):** OpenAI Codex (`server.js`, `tests/smoke.test.js`, `progress/phase-11a-speaking-interview-backend.md`)  
> **Thực thi Frontend UI & TTS (`Phase 11B-UI`):** Claude Code (`speaking.html`, `css/speaking.css`, `js/speaking.js`, `tests/smoke.test.js`, `progress/phase-11b-speaking-interview-frontend.md`)

---

## 1. Mục Tiêu Cốt Lõi & Bảo Toàn Tương Thích Ngược

1. **Nâng cấp `speaking.html` thành Phòng Thi Nói IELTS 2 Chế Độ:**
   - **Chế độ 1 — Cue Card Practice (`#tab-speaking-cuecard`, mặc định):** Giữ nguyên 100% các DOM ID và luồng luyện nhanh Part 2 & 3 hiện có để tương thích ngược tuyệt đối với mọi bài kiểm thử từ Phase 4 → Phase 10.
   - **Chế độ 2 — Full 3-Part Live Mock Interview (`#tab-speaking-interview`):** Mô phỏng phòng thi vấn đáp 1-1 với Giám khảo AI qua đủ **3 Part chuẩn IELTS (11–14 phút)**:
     * **Part 1 (Introduction & Interview — 3 câu hỏi ngắn, ~15–30s/câu):** Giám khảo hỏi các chủ đề quen thuộc (Work/Study, Hometown, Daily Routine, Technology...).
     * **Part 2 (Individual Long Turn — 1 phút chuẩn bị + 2 phút nói liên tục):** Hiển thị Cue Card, đồng hồ đếm ngược 1 phút chuẩn bị rồi tự động chuyển sang 2 phút thu âm/trả lời.
     * **Part 3 (Two-Way Discussion & Adaptive Follow-up — 3 câu hỏi thảo luận sâu + câu hỏi phản biện trực tiếp từ AI):** Sau mỗi câu trả lời của học viên, Giám khảo AI (`POST /api/speaking/examiner-turn`) phản hồi ngắn gọn và đặt câu hỏi xoáy sâu (follow-up) dựa trên chính ý kiến học viên vừa nêu!
2. **Giám Khảo AI Phát Âm Giọng Nói (`Web Speech Synthesis TTS`) & Thu Âm (`SpeechRecognition`):**
   - Giám khảo AI tự động đọc câu hỏi bằng giọng Anh-Anh (`en-GB`) hoặc Anh-Mỹ (`en-US`) qua `window.speechSynthesis` (có nút bật/tắt âm thanh `#btn-toggle-tts` và nút `🔊 Nghe lại câu hỏi`).
   - Sau mỗi lượt trả lời trong phòng phỏng vấn, hiển thị gợi ý tức thì (`coachingTipVi`) và các từ vựng cần lưu ý phát âm (`pronunciationTargets`).
3. **Chấm Điểm Toàn Diện Cả 3 Part (`POST /api/speaking/score`):**
   - Hỗ trợ nhận thêm mảng `interviewTurns: [{ part: 1|2|3, question, answer, durationSec }]` bên cạnh `transcript` tổng hợp.
   - Trả về 4 tiêu chí chuẩn (`FC`, `LR`, `GRA`, `PR`), nhận xét từng phần `partBreakdown: { part1, part2, part3 }`, gợi ý `inline_corrections` cho các câu nói sai ngữ pháp/dùng từ chưa tự nhiên trong transcript, và kết nối mượt mà với nút **`#btn-create-mistake-unit` ("🎯 Tạo Bài Học Khắc Phục Lỗi Này")**.

---

## 2. Phân Vùng Chi Tiết Cho Từng Agent (Zero-Conflict Workflow)

### 2.1. Phase 11A-Content — Giao cho Gemini CLI (Chỉ sửa `config.json`)

1. **Mở rộng các đề trong `sampleSpeakingTopics` của `config.json` (từ 5 đề lên 8 đề đầy đủ Part 1 + Part 2 + Part 3):**
   - Giữ nguyên 100% các trường hiện có (`id`, `category`, `part2`, `part3`) của 5 đề `sp-01` → `sp-05`.
   - Bổ sung vào cả 5 đề hiện có và 3 đề mới (`sp-06`, `sp-07`, `sp-08`) các trường sau:
     ```json
     {
       "id": "sp-01",
       "category": "People & Education",
       "part1Topic": "Teachers & Learning Habits",
       "part1": [
         "Do you prefer studying alone or with a group of friends? Why?",
         "What was your favourite subject when you were at primary school?",
         "Have you ever taught someone else how to do something?"
       ],
       "part2": {
         "prompt": "Describe a teacher who has influenced you.",
         "points": ["Who this person is", "How you know this person", "What they taught you"],
         "closing": "and explain why this person influenced you so much."
       },
       "part3": [
         "Do you think teachers are as respected today as in the past?",
         "How has technology changed the role of teachers?",
         "What qualities make a good teacher?"
       ],
       "followUpBank": [
         "Why do you think some students respond better to strict teachers while others need encouragement?",
         "Can artificial intelligence ever truly replace the human connection of a classroom mentor?"
       ],
       "modelBand8Highlight": [
         "instilled a lifelong passion for — truyền cảm hứng đam mê lâu dài cho",
         "went above and beyond the call of duty — tận tâm vượt mức trách nhiệm",
         "tailored their pedagogical approach — điều chỉnh phương pháp sư phạm phù hợp",
         "fostered critical thinking — nuôi dưỡng tư duy phản biện"
       ]
     }
     ```
   - **3 đề mới cần thêm vào `sampleSpeakingTopics`**:
     * `sp-06` (`category: "Environment & Cities"`, `part1Topic: "Weather & Public Transport"`, Cue Card: *Describe an environmental problem or pollution issue in your city*).
     * `sp-07` (`category: "Work & Ambition"`, `part1Topic: "Daily Routine & Career Goals"`, Cue Card: *Describe a challenging project or goal you worked hard to achieve*).
     * `sp-08` (`category: "Culture & Media"`, `part1Topic: "Reading & Films"`, Cue Card: *Describe a book, film or documentary that changed the way you think about something*).
2. **Bổ sung Prompt Giám khảo Phản biện vào `config.json`:**
   - `"speakingExaminerFollowUpPrompt"`:
     Prompt yêu cầu AI đóng vai Giám khảo IELTS Speaking trực tiếp: dựa vào `part` (`1` hoặc `3`), `questionAsked` và `candidateTranscript`, tạo phản hồi chuyển ý tự nhiên của giám khảo (`examinerReplyEn`), 1 câu hỏi phản biện ngắn gọn đào sâu vào ý thí sinh vừa nói (`followUpQuestionEn`), 1 lời khuyên ngắn bằng tiếng Việt (`coachingTipVi`), và mảng 2–3 từ trong câu trả lời cần chú ý trọng âm/phát âm (`pronunciationTargets`).
   - Cập nhật nhẹ `"speakingResponseFormat"` để khuyến khích AI trả thêm `"part_breakdown": { "part1": "string", "part2": "string", "part3": "string" }` và `"inline_corrections": [{ "original": "verbatim phrase from transcript", "correction": "improved natural phrase", "explanation": "reason" }]`.

---

### 2.2. Phase 11A-Backend — Giao cho OpenAI Codex (Chỉ sửa `server.js`, `tests/smoke.test.js`)

1. **`GET /api/speaking/config`**:
   - Trả đầy đủ `sampleTopics` (bao gồm `part1Topic`, `part1`, `part2`, `part3`, `followUpBank`, `modelBand8Highlight`), `criteria`, và `wordCountRequirements`.
2. **`POST /api/speaking/examiner-turn`** (áp dụng `studyRateLimit` 30 req/15m):
   - Nhận `{ topicId, part, turnIndex, questionAsked, candidateTranscript }`.
   - Kiểm tra hợp lệ:
     * Nếu `candidateTranscript` rỗng hoặc không phải chuỗi: trả `400 { error: 'candidateTranscript is required.' }`.
   - Tìm `topicObj` trong `config.sampleSpeakingTopics` theo `topicId` (nếu có).
   - Có hàm **Deterministic Fallback (`buildFallbackExaminerTurn`)** khi không có AI key hoặc AI lỗi:
     * Chọn câu hỏi kế tiếp từ `topicObj.followUpBank` hoặc `topicObj.part3` / `topicObj.part1`.
     * Tự động trích 2–3 từ dài nhất (`>= 7` ký tự) từ `candidateTranscript` làm `pronunciationTargets`.
     * Đưa ra `coachingTipVi` dựa trên độ dài câu trả lời (ví dụ: nếu `< 20` từ ở Part 1/3 thì khuyên mở rộng bằng công thức *Direct Answer + Reason + Short Example*).
   - Khi có AI key, gọi `generateWithKeyPool` với `config.speakingExaminerFollowUpPrompt`, kiểm tra schema và fallback an toàn nếu lỗi.
   - Trả về `200`:
     ```json
     {
       "part": 3,
       "turnIndex": 0,
       "wordCount": 34,
       "examinerReplyEn": "Thank you. Building on what you mentioned...",
       "followUpQuestionEn": "Why do you think some students respond better to strict teachers?",
       "coachingTipVi": "Câu trả lời có độ dài tốt (34 từ). Hãy thử bổ sung 1 ví dụ thực tế để nâng điểm Fluency & Coherence.",
       "pronunciationTargets": ["influenced", "pedagogical"],
       "provider": "..."
     }
     ```
3. **Nâng cấp `POST /api/speaking/score`**:
   - Giữ nguyên tương thích ngược 100% khi chỉ gửi `{ transcript, topic, part, durationSeconds }`.
   - Hỗ trợ nhận thêm `interviewTurns` (mảng các lượt `{ part: 1|2|3, question, answer, durationSec }`) và `mode: "cuecard" | "interview"`, `topicId`:
     * Nếu `transcript` trống nhưng có `interviewTurns`, tự động ghép `transcript` từ các câu trả lời trong `interviewTurns`.
     * Ghép thông tin các lượt hỏi đáp (`interviewTurns`) vào `buildSpeakingPrompt` để AI đánh giá chính xác cả 3 Part.
     * Chuẩn hóa `result.inline_corrections` (chỉ giữ các cụm `original` thực sự xuất hiện trong `transcript`, giống như Writing) và `result.part_breakdown` (nếu có `interviewTurns` mà AI không trả `part_breakdown`, tự sinh tóm tắt số từ/lượt nói của `part1`, `part2`, `part3`).
     * Lưu vào `speaking_results` của `req.userId` kèm `mode`, `topicId`, `interviewTurns` (tối đa 12 lượt).

---

### 2.3. Phase 11B-UI — Giao cho Claude Code (Chỉ sửa `speaking.html`, `css/speaking.css`, `js/speaking.js`, `tests/smoke.test.js`)

1. **Thanh chuyển đổi chế độ `#speaking-mode-tabs` trên `speaking.html`**:
   - Giữ nguyên toàn bộ DOM ID cũ của chế độ Cue Card (`#topic-section`, `#timer-card`, `#editor-section`, `#speaking-input`, `#btn-record`, `#btn-submit`, `#results-area`...).
   - Thêm 2 tab:
     * `#tab-speaking-cuecard` (`data-speaking-mode="cuecard"`, mặc định active): **🎯 Luyện Nhanh Part 2 & 3 (Cue Card Practice)**
     * `#tab-speaking-interview` (`data-speaking-mode="interview"`): **🎙️ Phòng Thi Giả Lập 3 Part Với Giám Khảo AI (Live Mock Interview)**
2. **Phòng Thi Giả Lập 3 Part (`#interview-room-panel`)**:
   - Thanh bước `#interview-stepper`: `① Part 1: Interview (3 câu)` ➔ `② Part 2: Cue Card (1p chuẩn bị + 2p nói)` ➔ `③ Part 3: Discussion & AI Follow-up`.
   - **Thẻ Giám khảo AI (`#examiner-prompt-card`)**:
     * Hiển thị avatar Giám khảo, câu hỏi hiện tại (`#examiner-question-text`), nút **`🔊 Nghe Giám khảo hỏi`** (`#btn-speak-question`, dùng `window.speechSynthesis`), và công tắc **`#btn-toggle-tts`** (Bật/Tắt tự động đọc câu hỏi).
   - **Tương tác theo từng lượt trả lời (`#interview-turn-controls`)**:
     * Học viên ghi âm hoặc gõ câu trả lời cho câu hỏi hiện tại vào `#speaking-input`, sau đó bấm **`#btn-next-turn` ("Trả lời xong & Sang câu tiếp →")**:
       - Lưu lượt trả lời vào danh sách `_interviewTurns`.
       - Ở Part 1 (cuối câu 2) và Part 3: gọi `POST /api/speaking/examiner-turn` để hiển thị nhận xét ngắn của Giám khảo (`#examiner-feedback-bubble`: `coachingTipVi` + các từ cần chú ý phát âm `pronunciationTargets` có nút bấm nghe phát âm từng từ!) và câu hỏi phản biện `followUpQuestionEn`.
     * Hiển thị nhật ký hội thoại **`#interview-transcript-log`** (các bong bóng chat `Examiner` ↔ `Candidate` theo từng Part 1, 2, 3) ngay bên dưới để học viên theo dõi toàn bộ buổi phỏng vấn.
     * Khi hoàn thành đủ 3 Part (hoặc bấm nút `#btn-finish-interview` *"Kết thúc & Chấm điểm toàn bài"* bất kỳ lúc nào khi tổng số từ `>= 40`), tự động gửi `{ transcript, topic, part: "Full Interview (Part 1-2-3)", mode: "interview", topicId, interviewTurns }` tới `POST /api/speaking/score`.
3. **Nâng cấp Màn hình Kết quả (`#results-area`) trên `speaking.html`**:
   - Hiển thị huy hiệu chế độ thi (`#speaking-result-mode-chip`: `Full Mock Interview · Part 1–2–3` hoặc `Part 2 & 3 Cue Card`).
   - Hiển thị thẻ **`#speaking-part-breakdown`** (nhận xét & thống kê từng phần Part 1 / Part 2 / Part 3 khi thi chế độ Interview).
   - Hiển thị **`#speaking-inline-corrections`** (các cụm từ nói chưa tự nhiên `original` → `correction` + giải thích) nếu có.
   - Hiển thị hộp **`#speaking-band8-highlights`** (`modelBand8Highlight` từ đề bài) để học viên học ngay các cụm Idioms/Collocations Band 8.0+ của chủ đề đó.
   - Khi bấm **`#btn-create-mistake-unit` ("🎯 Tạo Bài Học Khắc Phục Lỗi Này")**, truyền kèm cả `inline_corrections` (nếu có) và `suggestions` sang `AuthProfile.createMistakeUnit`.
