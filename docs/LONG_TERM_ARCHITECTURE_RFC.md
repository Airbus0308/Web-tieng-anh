# 🏛️ IELTS Master — Bản Thảo Luận Kiến Trúc Dài Hạn & Quy Chuẩn UX (RFC v1)

> **Người khởi tạo:** Antigravity (Project Coordinator)  
> **Đối tượng thảo luận:** Claude Code (Frontend/UX Architect) & OpenAI Codex (Backend/Data Architect)  
> **Mục tiêu:** Định hình lộ trình phát triển dài hạn (Phase 9 → Phase 12), giải quyết bài toán **Đăng nhập & Lưu trữ Hồ sơ Học viên**, **Hệ sinh thái Nguồn Tài Liệu Đầu Vào**, và **Tái cấu trúc Giao diện (Progressive Disclosure — Hiển thị thông tin hợp lý, không quá tải)**.

---

## 1. Đánh Giá Hiện Trạng Sau Phase 8B (Những điểm cần nâng cấp)

Sau 8 Phase, dự án đã có đầy đủ tính năng cốt lõi (Placement Test, Writing AI, Speaking AI, Analytics, Study Hub SRL-SLA 3 giai đoạn). Tuy nhiên, để trở thành một sản phẩm thực tế bền vững (Production-Ready), có **3 vấn đề lớn** cần giải quyết:

1. **Giao diện `study.html` đang hiển thị quá nhiều khối cùng lúc (Information Overload & Duplication):**
   - Hiện tại khi mở `study.html`, người dùng phải cuộn qua **hơn 8 khối thẻ xếp chồng dọc**:
     * Khối `#study-banner` (Đếm ngược + Lỗ hổng kiến thức của Phase 7) **bị trùng lặp chức năng** với `#profile-card` (Hồ sơ năng lực) và `#kbcp-commitment-box` (Form ngày thi + Target Band của Phase 8B).
     * Khi người dùng đang học trong `#player-section` (Bước 1 → Bước 5), toàn bộ các khối phía trên (`#forethought-panel`, `#library-section`, `#source-section`) vẫn chiếm diện tích khổng lồ khiến người học phải cuộn chuột rất xa.
2. **Chưa có Tài khoản & Hồ sơ Học viên Bền vững (Auth & Multi-Device Profile):**
   - Dữ liệu hiện lưu trong các file JSON chung (`results/*.json`) và `localStorage`.
   - Khi triển khai lên **Vercel** (môi trường Serverless `/tmp` tạm thời) hoặc khi nhiều học viên cùng truy cập 1 link public, dữ liệu giữa các học viên sẽ bị trộn lẫn hoặc mất đi khi Serverless cold-start.
3. **Nguồn Tài Liệu Nhập Vào & Nội Dung Giáo Trình Cần Thực Chất Hơn:**
   - Hiện mới chỉ hỗ trợ dán văn bản thuần, file `.txt`/`.md`, hoặc URL đơn giản. Học viên thực tế cần tải **file `.pdf` / `.docx`**, nhập **Transcript/Subtitles thực tế**, hoặc **Tạo bài học trực tiếp từ các lỗi sai trong bài Writing/Speaking của chính mình**.
   - Các câu hỏi `drill` mẫu trong `config.json` hiện còn dùng chung nội dung minh họa giữa các Unit, cần được biên soạn chuyên biệt theo từng chủ đề Unit.

---

## 2. Ba Trụ Cột Kiến Trúc Dài Hạn (Phase 9 → Phase 12)

### 🔐 Trụ cột 1: Hệ Thống Đăng Nhập, Hồ Sơ Học Viên & Đồng Bộ Đám Mây (Auth & Learner Profile)
- **Cơ chế Đăng nhập Kép (Zero-Friction Auth)**:
  1. **Tài khoản Học viên (Email + Mật khẩu hoặc Mã Học Viên `Sync Passcode`)**:
     - Đăng ký / Đăng nhập nhanh gọn ngay trên Modal Header (`js/auth-profile.js`).
     - Sử dụng session token (`Authorization: Bearer <token>` hoặc Cookie) gắn `userId` cho mọi bản ghi.
  2. **Chế độ Khách (Guest Mode) & Tự động Gộp Dữ liệu (Auto-Merge on Sign-up)**:
     - Người mới vào web vẫn có thể làm Placement Test ngay mà không bị chặn bởi màn hình bắt đăng nhập.
     - Ngay khi đăng ký tài khoản, toàn bộ lịch sử trong `localStorage` của trình duyệt tự động đồng bộ (`merge`) vào `userId` mới.
  3. **Hồ Sơ Học Viên Toàn Diện (`Learner Profile`)**:
     - Lưu trữ: `displayName`, `avatar`, `currentBand`, `targetBand`, `examDate`, `studyCommitment` (giờ học + số phút), `streakStats` (`currentStreak`, `longestStreak`, `activeDates`), `skillProfile` (`reading`, `listening`, `writing`, `speaking` + 8 tiêu chí thành phần), và `calibrationIndex` (độ chuẩn xác khi tự đánh giá năng lực).
  4. **Tầng Lưu Trữ Đa Môi Trường (`db/store.js`)**:
     - Tự động phân tách dữ liệu theo `userId`.
     - Hỗ trợ lưu file JSON phân vùng theo user (`results/users/<userId>.json`), SQLite (`node:sqlite`), hoặc kết nối Cloud DB (Supabase / Turso / Vercel KV) qua biến môi trường để không mất dữ liệu trên Vercel.

### 📚 Trụ cột 2: Hệ Sinh Thái Nguồn Tài Liệu Đầu Vào (Smart Content Ingestion Engine)
Mở rộng khu vực **Nạp tài liệu** thành 4 nguồn thông minh:
1. **Tài liệu File Học thuật (`.pdf`, `.docx`, `.txt`, `.md`)**:
   - Hỗ trợ đọc trích xuất văn bản từ đề thi/giáo trình PDF và Word ngay trên trình duyệt hoặc qua API `/api/study/extract-source`.
2. **Bài báo Quốc tế & YouTube / TED Talk**:
   - Tự động bóc tách nội dung bài báo sạch, đếm độ khó từ vựng (CEFR B2/C1/C2) trước khi tạo Unit 5 bước.
3. **"Học Từ Chính Lỗi Sai Của Tôi" (Learn From My Mistakes — Liên kết Writing/Speaking ➔ Study Hub)**:
   - Thêm nút **"🎯 Tạo Bài Học Khắc Phục Lỗi Này"** ngay trong kết quả chấm điểm của trang `writing.html` và `speaking.html`.
   - Khi bấm vào, hệ thống lấy toàn bộ `inline_corrections` và tiêu chí điểm thấp nhất của bài thi đó để sinh ra 1 Unit 5 bước chuyên trị đúng những lỗi học viên vừa mắc phải!
4. **Kho Giáo trình Chuẩn Chuyên Sâu (`config.json`)**:
   - Biên soạn riêng biệt câu hỏi `quickQuiz` (có `skillTag`) và `drill` cho từng Unit trong 8 Unit chuẩn (không dùng câu hỏi lặp lại giữa các Unit).

### 🎨 Trụ cột 3: Thiết Kế Giao Diện "Progressive Disclosure" (Hiển Thị Thông Tin Hợp Lý, Tinh Gọn)
Nguyên tắc cốt lõi: **"Đúng thông tin — Đúng giai đoạn — Không trùng lặp — Không làm ngợp người học"**:
1. **Thanh Hồ Sơ Học Viên Toàn Cục (Global Learner Bar trên Header của cả 5 trang)**:
   - Hiển thị gọn trên thanh điều hướng: `[👤 Tên học viên | 🎯 Band 5.5 → 7.0 | 🔥 3 ngày Streak | 🔑 AI Keys]`.
2. **Loại bỏ trùng lặp trên `study.html`**:
   - **Gộp `#study-banner` và `#forethought-panel`** thành một **Bảng Điều Khiển Học Tập Tinh Gọn (Compact Study Cockpit)** gồm 3 thẻ ngang cân đối:
     * **Thẻ 1 — Hồ Sơ & Mục Tiêu (Profile & Countdown)**: Band hiện tại ➔ Band mục tiêu, Số ngày còn lại tới kỳ thi, và Cam kết giờ học If-Then.
     * **Thẻ 2 — Thói Quen & Streak (`github-readme-streak-stats` + Tuần lễ T2–CN)**.
     * **Thẻ 3 — Cần Làm Hôm Nay (Today's Action Queue)**: Số thẻ SRS đến hạn ôn tập hôm nay + Unit $i+1$ ưu tiên số 1 (bấm 1 nút là vào học ngay).
3. **Chuyển đổi Chế độ Xem theo Giai đoạn (Tabbed / Stage-Driven Workspace trên `study.html`)**:
   - Thay vì hiển thị tất cả các khối dài lê thê cùng lúc, thanh `#srl-stage-bar` (`① Kế hoạch & Ôn tập SRS` | `② Kho Học Liệu & Nạp Nguồn` | `③ Phòng Học Tập Trung 5 Bước`) đóng vai trò là **Bộ chuyển chế độ hiển thị (View Switcher)** (kèm nút `"Hiện tất cả"` nếu muốn):
     * Khi chưa chọn Unit: Ưu tiên hiển thị **Bảng Điều Khiển + Hộp Ôn SRS + Kho Giáo Trình Gợi Ý**.
     * Khi bấm **"Học ngay"** một Unit: Tự động thu gọn phần Kho giáo trình & Nạp tài liệu, cuộn mượt vào **Phòng Học Tập Trung (Focus Lesson Player)** + **Gia sư AI Socratic** ở cột bên!

---

## 3. Lộ Trình Phát Triển Chi Tiết (Master Plan: Phase 9 → Phase 12)

| Phase | Tên Phase | Trọng tâm Kỹ thuật & Giao diện | Phân công |
| :--- | :--- | :--- | :---: |
| **Phase 9A** | **UI Decluttering & Progressive Disclosure (`study.html`, `css/study.css`, `js/study.js`)** | Gộp các khối trùng lặp trên `study.html`, thiết kế Bảng điều khiển 3 cột tinh gọn, chế độ Focus Mode khi đang học Unit, biên soạn câu hỏi Drill/Quiz riêng cho từng Unit. | Claude Code |
| **Phase 9B** | **Learner Auth, Multi-User Profile & "Learn From My Mistakes" Pipeline (`server.js`, `js/auth-profile.js`)** | Đăng nhập/Đăng ký + Mã đồng bộ (`Sync Code`), tách dữ liệu theo `userId` (hỗ trợ Guest auto-merge), tải file `.pdf`/`.docx`, và nút tạo bài học trực tiếp từ lỗi sai Writing/Speaking. | OpenAI Codex & Claude Code |
| **Phase 10** | **Writing Task 1 (Academic Charts/Graphs & General Letter) + Overall Writing Band** | Bổ sung luyện viết Task 1 với biểu đồ trực quan (Bar, Line, Pie, Table, Process, Map bằng SVG), chấm 4 tiêu chí Task 1 (`TA`, `CC`, `LR`, `GRA`) và tính điểm Overall Writing ($\frac{1}{3}\text{Task 1} + \frac{2}{3}\text{Task 2}$). | OpenAI Codex & Claude Code |
| **Phase 11** | **Interactive Speaking Mock Interview (Part 1 → Part 2 → Part 3 Live Examiner)** | Phòng thi vấn đáp trực tiếp: Giám khảo AI đọc câu hỏi bằng giọng nói (TTS), bấm giờ chuẩn từng Part và tự động hỏi xoáy (follow-up questions) ở Part 3 dựa trên câu trả lời của học viên. | Claude Code & OpenAI Codex |
| **Phase 12** | **Full-Length 4-Skill Mock Exam & Certificate Export** | Thi thử 4 kỹ năng liên hoàn dưới áp lực thời gian + Giám sát chống gian lận (`ExamSecurity`), xuất bảng điểm chuẩn IELTS Test Report Form (TRF) kèm lộ trình khắc phục. | Antigravity, Codex & Claude Code |

---

## 4. Câu Hỏi Thảo Luận Dành Cho Claude Code
Khi đọc tài liệu này, Claude Code hãy phản hồi ngắn gọn góc nhìn thiết kế UI/UX của bạn về:
1. Cách bố trí **Compact Study Cockpit** và cơ chế chuyển tab/thu gọn trên `study.html` sao cho vừa hiển thị thông tin hợp lý, trực quan, vừa giữ nguyên toàn bộ ID đang được kiểm thử trong `tests/smoke.test.js`?
2. Thiết kế **Thanh Hồ sơ Học viên (Learner Profile Pill & Auth Modal)** trên thanh Header chung của cả 5 trang (`index.html`, `writing.html`, `speaking.html`, `study.html`, `analytics.html`) sao cho đồng bộ với nút `AI Keys` hiện tại?
3. Sau khi thống nhất phương án, hãy bắt tay triển khai **Phase 9A** hoặc báo cáo đề xuất chi tiết trước khi viết code.
