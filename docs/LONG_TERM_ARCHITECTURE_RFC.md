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

### 🎨 Trụ cột 3: Thiết Kế Giao Diện "Progressive Disclosure" Học Tập Từ Frappe LMS, LearnHouse & Canvas LMS
Chọn lọc tinh hoa từ 3 nền tảng LMS mã nguồn mở hiện đại nhất (**LearnHouse**, **Frappe LMS**, **Canvas LMS**) nhưng giữ nguyên kiến trúc **Node.js + Vanilla ES6 nhẹ, siêu tốc trên Vercel**:

1. **Học từ LearnHouse (`learnhouse/learnhouse`) — Tách biệt "Dashboard Khóa Học" và "Phòng Học Tập Trung (Focus Player)"**:
   - Thay vì xếp chồng tất cả các khối trên 1 trang dài, `study.html` tách thành **2 chế độ hiển thị rõ ràng**:
     * **Chế độ 1 — Study Dashboard (Khi đang ở ngoài sảnh)**:
       - **Hàng trên (Compact Cockpit 3 cột)**:
         1. **Hồ Sơ & Đếm Ngược Kỳ Thi**: Gộp `#study-banner` và `#profile-card` (Band đầu vào ➔ Band mục tiêu, Số ngày còn lại, Cam kết KBCP If-Then).
         2. **Thói Quen & Streak (`github-readme-streak-stats` + Tuần lễ T2–CN)**.
         3. **Canvas-style "Việc Cần Làm Hôm Nay" (To-Do & SRS Queue)**: Liệt kê rõ số thẻ SRS cần ôn hôm nay + Nút `"Tiếp tục học Unit đang dở"` hoặc `"Học Unit i+1 gợi ý"`.
       - **Khu vực chính dưới Dashboard chia 2 Tab gọn gàng**:
         + Tab `📚 Kho Khóa Học & Lộ Trình i+1`: Hiển thị các bộ giáo trình dưới dạng **Course Cards (kiểu Frappe LMS)** có thanh tiến độ tổng của từng bộ sách (`0% → 100%`) và danh sách Unit bên trong.
         + Tab `➕ Tạo Bài Học AI Từ Tài Liệu / Lỗi Sai`: Khu vực nạp văn bản, file, URL/YouTube hoặc tạo từ lỗi sai Writing/Speaking.
     * **Chế độ 2 — Focus Classroom Mode (Khi bấm "Học ngay" vào 1 Unit)**:
       - Tự động thu gọn toàn bộ Dashboard sảnh ngoài (có nút `← Quay lại Kho khóa học` ở góc trái trên).
       - Giao diện phòng học chỉ còn 2 cột sạch sẽ như **LearnHouse**:
         + **Cột chính (70%)**: Thanh 5 bước Mastery + Nội dung bước học hiện tại (Lý thuyết Feynman / Thẻ từ Active Recall / Quiz / Drill Interleaving / Output Checkpoint).
         + **Cột phải (30%)**: **LearnHouse AI Copilot (`#tutor-feedback-panel` — Gia sư Socratic)** + Tiến độ 5 bước của bài đang học.

2. **Học từ Frappe LMS (`frappe/lms`) — Hồ Sơ Học Viên (`Learner Profile`) & Cấp Phiếu Điểm / Chứng Chỉ (`IELTS Test Report Form`)**:
   - **Thanh Hồ Sơ Học Viên Toàn Cục (Global Learner Bar)** trên Header của cả 5 trang: `[👤 Tên học viên | 🎯 Band 5.5 → 7.0 | 🔥 Streak | 🔑 AI Keys]`.
   - **Cấp Chứng Nhận & Phiếu Điểm Chuẩn IELTS (TRF Card)**: Khi học viên hoàn thành đủ các bài đánh giá hoặc đạt `100% Mastery` một bộ giáo trình trên Frappe-style Course Card, hệ thống cho phép xuất **Phiếu Điểm IELTS Master (IELTS Test Report Form & Mastery Certificate)** có đóng dấu xác thực `ExamSecurity Verified`.

3. **Học từ Canvas LMS (`instructure/canvas-lms`) — Module Prerequisites, Sổ Điểm 8 Tiêu Chí (Rubric Gradebook) & "Học Từ Lỗi Sai"**:
   - **Điều kiện tiên quyết (Prerequisites)**: Bắt buộc qua Cổng Chẩn Đoán (Placement Test) mới mở khóa lộ trình; hiển thị huy hiệu `PASSED ✓` rõ ràng trên từng Unit.
   - **Liên kết Sổ điểm (Rubric Gradebook) sang Bài học**: Từ trang `writing.html`, `speaking.html` và `analytics.html`, học viên bấm 1 nút **"🎯 Tạo Bài Học Khắc Phục Lỗi Này"** để biến các câu sửa lỗi (`inline_corrections`) và tiêu chí yếu nhất thành 1 bài học 5 bước trong Study Hub.

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
