# Phase 9A — Progressive Disclosure Study Cockpit, Focus Classroom & Unit-specific Drills

- **Trạng thái:** ✅ DONE
- **Người thực hiện:** Claude Code
- **Ngày:** 2026-11-15
- **Đặc tả:** [docs/PHASE_9_DESIGN.md](../docs/PHASE_9_DESIGN.md) (gồm cả hợp đồng API Phase 9B cho Codex)

## Mục tiêu và phạm vi

Giải quyết tình trạng `study.html` xếp chồng hơn 8 khối dọc và trùng lặp giữa `#study-banner` (Phase 7) với `#profile-card` + `#kbcp-commitment-box` (Phase 8B), bằng cách tách thành 2 chế độ hiển thị: **Sảnh Học Tập** (Compact Cockpit 3 cột + 2 Tab, kiểu Frappe LMS) và **Phòng Học Tập Trung** (kiểu LearnHouse). Đồng thời làm giàu ngân hàng câu hỏi trong `config.json`. Backend chỉ sửa 1 dòng.

## Các thay đổi

| File | Nội dung |
| :--- | :--- |
| `study.html` | Bỏ `#study-banner`. Thêm `#hub-view`: `#forethought-panel.cockpit` gồm 3 thẻ (`#profile-card` Hồ sơ & Kỳ thi · `#kbcp-commitment-box` Thói quen & Cam kết · `#srs-due-panel` Việc cần làm hôm nay), `#hub-tabs` (ARIA tablist) với `#panel-courses` (`#recommended-curriculum`, `#library-section`, lịch sử lượng giá thu gọn) và `#panel-create` (`#source-section`). Thêm `#classroom-view` gồm `#btn-back-to-hub`, breadcrumb, `#lesson-section` và sidebar (`#tutor-feedback-panel` + dàn ý 5 bước `#step-outline`). Bỏ thẻ sidebar "Tiến độ Mastery". **Mọi ID đang được test đều giữ nguyên**, chỉ đổi vị trí. |
| `js/study.js` | `setView('hub' \| 'classroom')` là nguồn trạng thái duy nhất; `openUnit()` vào Phòng học, `history.pushState('#unit=<id>')`, nút Back của trình duyệt (`popstate`) quay về Sảnh, focus được trả về đúng nút. Unit đang học (kể cả Unit do AI tạo) lưu ở `ielts_study_last_unit` → nút **▶ Tiếp tục Unit đang dở** và mở lại bằng deep link `#unit=…`. Unit mở lại ở bước chưa hoàn thành đầu tiên. Course Card có tiến độ tổng của bộ sách, nút Bắt đầu / Tiếp tục / Ôn lại, danh sách Unit thu gọn có trạng thái ○ / ◐ / ✓ PASSED. Hàng đợi SRS chỉ hiện 3 thẻ, có nút "Xem tất cả". Tab nhớ lựa chọn (`ielts_study_hub_tab`), hỗ trợ phím ←/→, mở thẳng tab Nạp tài liệu bằng `#create` (chuẩn bị cho 9B). Hiển thị Band đầu vào → Band mục tiêu. |
| `css/study.css` | `.cockpit`, `.course-grid`, `.course-card` (dải màu theo kỹ năng), `.hub-tab`, `.classroom-view`, `.classroom-layout` (sidebar dính khi cuộn), `.step-outline`. Responsive: ≥1100px 3 cột · 720–1100px 2 cột ("Việc cần làm" chiếm hàng đầu) · điện thoại 1 cột ("Việc cần làm" lên đầu); Phòng học ≤992px xếp 1 cột. Bỏ style `.study-banner`. |
| `config.json` | Gắn `skillTag` cho cả 32 câu quiz (`Reading`, `Listening`, `Writing TR`, `Writing CC`, `Grammar (GRA)`, `Lexical (LR)`). Sửa câu trùng giữa `gram-u1` và `gram-u2`. Viết mới 24 câu drill theo chủ đề từng Unit, mỗi Unit đủ 3 kỹ năng đan xen (`Reading Paraphrase`, `Grammar Error Fix (GRA)`, `Lexical Collocation (LR)`), vị trí đáp án đúng được xáo trộn. `studyUnitPrompt` yêu cầu AI trả về `skillTag` cho quiz. |
| `server.js` | `normalizeStudyUnit` giữ lại `skillTag` của quiz (trước đây bị loại bỏ). |
| `tests/smoke.test.js` | 4 test mới (xem phần Kiểm thử). |
| `docs/PHASE_9_DESIGN.md` | Đặc tả chốt Phase 9A + hợp đồng API Phase 9B (cookie `im_uid`, `db/store.js` json-dir + Upstash Redis REST, Session Guard giới hạn thiết bị, role `guest`/`student`/`instructor`, nhánh `mistakeContext` của `generate-unit`). |

## Quyết định cần lưu ý

- Giữ tên trường `quiz` (giao diện hiển thị "Quick Quiz") vì test, `normalizeStudyUnit` và prompt AI đều dùng tên này.
- `#hub-view` bị ẩn cho tới khi `diagnostic-status` trả kết quả (có dòng "Đang tải sảnh học tập..."), để người chưa mở khóa không thấy Sảnh nhấp nháy rồi mới hiện Cổng Chẩn đoán. Nếu không gọi được API, Sảnh vẫn mở ở chế độ ngoại tuyến như Phase 8B.
- `openUnit` cho phép `source === 'mistakes'` đi qua Cổng Chẩn đoán (đã chốt cho 9B); hiện chưa có luồng nào tạo ra source này.
- Lỗi khi bấm "Tạo mới bằng AI" trên Course Card hiển thị ở `#hub-status` (trước đây ghi vào `#source-status`, nằm ở tab khác nên người dùng không thấy).

## Kiểm thử

- `npm test`: 46 test, 44 pass, 0 fail, 2 skip (hai test Gemini trực tiếp cần `GEMINI_API_KEY`).
- Test mới của Phase 9A:
  1. `study.html` có `#hub-view`, `#classroom-view`, `#btn-back-to-hub`, `#hub-tabs` và các tabpanel. Không còn `#study-banner`. Countdown, gap list, nút gợi ý, form mục tiêu, streak và SRS nằm trong cockpit. Trình học và gia sư nằm trong `#classroom-view`.
  2. `study.css` có `.cockpit`, `.course-card`…; `study.js` có `setView`, `ielts_study_last_unit`, `pushState`, `popstate`.
  3. `config.json`: không có câu quiz/drill nào trùng giữa các Unit; mọi câu có `skillTag` hợp lệ; drill của mỗi Unit đủ đúng 3 kỹ năng.
  4. `generate-unit` (fallback không AI) giữ `skillTag` của quiz.
- Kiểm tra thủ công bằng Chrome headless trên server riêng, có seed dữ liệu Placement, SRS và tiến độ: Sảnh 1440px hiển thị cockpit 3 cột, tab và Course Card (nhãn gợi ý, tiến độ); deep link `#unit=cam-u1` mở thẳng Phòng học ở Bước 4 (Unit đã đạt 60%), có breadcrumb, gia sư và dàn ý 5 bước. Ở bề ngang hẹp, cockpit xếp 1 cột với "Việc cần làm" lên đầu. Chrome headless không cho cửa sổ hẹp hơn khoảng 500px, nên chưa kiểm tra được đúng bề ngang 400px.
- **Chưa kiểm tra thủ công:** thao tác bấm "← Quay lại Kho khóa học" và nút Back của trình duyệt (headless chỉ chụp ảnh tĩnh); phần này mới được kiểm qua đọc code.
