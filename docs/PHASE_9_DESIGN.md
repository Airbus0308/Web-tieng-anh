# 🧭 Phase 9 — Bản Thiết Kế Chốt (Design Spec v1)

> **Tác giả:** Claude Code (Frontend/UX Architect) · **Ngày chốt:** 2026-11-15
> **Nguồn:** `docs/LONG_TERM_ARCHITECTURE_RFC.md` (RFC v1) + khảo sát mã nguồn tại commit `8edd0ef`.
> **Trạng thái:** Đã được chủ dự án và Coordinator duyệt 4 quyết định ở mục 0.2. **Phase 9A: ✅ DONE** (Claude Code). Phase 9B chia Codex (backend) + Claude Code (frontend).

---

## 0. Bối cảnh & Quyết định đã chốt

### 0.1 Đính chính so với RFC
| # | RFC ghi | Thực tế trong code | Hệ quả |
|---|---|---|---|
| 1 | `#player-section` | Trình học là **`#lesson-section`** | Dùng đúng ID `#lesson-section`. |
| 2 | Drill "dùng chung nội dung minh họa" | **Cả 8 Unit dùng chung đúng 3 câu drill** (24 mục, 3 nội dung); **32/32 câu quiz thiếu `skillTag`**; `gram-u1`/`gram-u2` trùng 1 câu quiz | Viết lại 24 drill + gắn `skillTag` cho 32 quiz. |
| 3 | Trường `quickQuiz` | Test và `normalizeStudyUnit` dùng **`sample.quiz`** (đúng 4 câu) và **`sample.drill`** (đúng 3 câu) | **Giữ tên `quiz`**; "Quick Quiz" chỉ là nhãn giao diện. |
| 4 | Speaking có `inline_corrections` | Kết quả Speaking **chỉ có** `criteria` + `suggestions` + transcript | "Học từ lỗi sai" của Speaking dùng tiêu chí thấp nhất + suggestions + trích đoạn transcript. |
| 5 | Lưu `results/users/<userId>.json` | Vercel chỉ ghi được `/tmp` (mất khi cold-start) | Cần **kho lưu trữ đám mây** cho production (Upstash Redis — mục 9B-2). |
| 6 | — | `#study-banner`, `#progress-list`, `#progress-count` **không có trong test** | Được phép gộp/bỏ. |

### 0.2 Quyết định đã chốt (2026-11-15, Coordinator xác nhận)
1. **Phiên đăng nhập = Cookie `im_uid`** (`HttpOnly`, `SameSite=Lax`, `Secure` ở production), giá trị là session id ngẫu nhiên, server chỉ lưu hash. Mô hình **"Guest trước — nâng cấp bằng Mã đồng bộ `IELTS-XXXX-XXXX` sau"**. **Không** dùng Bearer/JWT trong `localStorage`.
2. **`db/store.js` với 2 adapter:** `json-dir` (`results/users/<uid>/<collection>.json`) cho Local/test, **Upstash Redis REST API (gọi qua `fetch`)** cho Vercel.
3. **Bài học "Học từ lỗi sai" (`study.html#create=mistakes`) được vượt Cổng Chẩn đoán** (bài Writing/Speaking đã là dữ liệu chẩn đoán).
4. **Bỏ `#study-banner`** (sau khi chuyển `#countdown-number`, `#countdown-label`, `#gap-list`, `#btn-open-suggested` vào Cockpit) **và thẻ sidebar "Tiến độ Mastery"**; giữ tên trường `quiz` (hiển thị "Quick Quiz"); **Chứng chỉ/TRF dời sang Phase 12** (9B chỉ chuẩn bị trường `achievements`).

---

## PHASE 9A — Progressive Disclosure Study Hub (Claude Code)

**Phạm vi file:** `study.html`, `css/study.css`, `js/study.js`, `config.json`, `tests/smoke.test.js`. Không đụng backend.

### 9A-1. Nguyên tắc
- **Chỉ di chuyển, không đổi tên** mọi DOM ID đang được test (`exam-date`, `target-band`, `countdown-number`, `gap-list`, `textbook-list`, `source-text`, `source-file`, `source-url`, `mastery-fill`, `step-body`, `srl-stage-bar`, `diagnostic-gate`, `forethought-panel`, `profile-body`, `kbcp-commitment-box`, `commit-time`, `commit-minutes`, `streak-bar`, `srs-due-panel`, `srs-due-list`, `recommended-curriculum`, `tutor-feedback-panel`, `checkpoint-history`).
- Giữ nguyên toàn bộ chuỗi văn bản mà test Phase 8B kiểm tra (①②③, tên 3 giai đoạn, nội dung Cổng Chẩn đoán).
- Form nhập liệu ẩn sau `<details>` — **mặc định hiển thị kết quả, không hiển thị form**.

### 9A-2. Bố cục 2 chế độ
```
#srl-stage-bar  (1 dòng, đồng bộ theo view: Sảnh=①, Bước 1–4=②, Bước 5=③)
#diagnostic-gate (chỉ khi bị khóa — thay toàn bộ #hub-view)

#hub-view ─────────────── SẢNH HỌC TẬP ───────────────
#forethought-panel.cockpit (lưới 3 cột)
┌ #profile-card ─────┬ #kbcp-commitment-box ─┬ #srs-due-panel ──────────┐
│ 87 ngày (countdown)│ 🔥 Streak SVG card     │ ✅ Việc cần làm hôm nay   │
│ Band 5.5 → 7.0     │ T2 T3 T4 T5 T6 T7 CN   │ ▶ Tiếp tục Unit đang dở  │
│ #gap-list (chips)  │ "Nếu đến 20:00 … 25'"  │ #btn-open-suggested      │
│ #profile-body ▾    │ ⚙ Sửa cam kết ▾        │ 🔁 n thẻ SRS đến hạn      │
│ ⚙ Chỉnh mục tiêu ▾ │                        │   (3 thẻ đầu + Xem hết ▾)│
└────────────────────┴────────────────────────┴──────────────────────────┘
#hub-tabs: [ 📚 Kho Khóa Học ] [ ➕ Nạp Tài Liệu / Tạo bài AI ]
  #panel-courses: #recommended-curriculum (dải "Lộ trình i+1")
                  #library-section → #textbook-list (lưới Course Card)
                  ▸ #checkpoint-history (details: Lịch sử lượng giá)
  #panel-create : #source-section (Dán | File | URL)

#classroom-view (hidden) ─────── PHÒNG HỌC TẬP TRUNG ───────
[#btn-back-to-hub ← Quay lại Kho khóa học]  breadcrumb: Kho › Sách › Unit
┌ #lesson-section (~70%) ────────────┬ aside (~30%) ─────────────┐
│ mastery bar · step-dots · step-body│ #tutor-feedback-panel     │
│ ← Quay lại      Tiếp tục →         │ #step-outline (5 bước)    │
└────────────────────────────────────┴───────────────────────────┘
```

### 9A-3. Course Card (theo Frappe LMS)
- Dải màu đầu thẻ theo kỹ năng, tên sách, chip `Band x–y · skill`, nhãn **⭐ Gợi ý cho bạn** nếu chứa Unit gợi ý.
- **Tiến độ tổng của bộ sách** = trung bình mastery các Unit → thanh `0% → 100%` + `n Unit · x% hoàn thành`.
- CTA chính **Bắt đầu / Tiếp tục / Ôn lại** → Unit đầu tiên chưa đạt 100%.
- Danh sách Unit (`<details>`): trạng thái `○` chưa học · `◐ 60%` · `✓ PASSED`, chip `levelTag`, nút **Học ngay** + **Tạo mới bằng AI**.
- Lưới `repeat(auto-fill, minmax(300px, 1fr))`.

### 9A-4. Hành vi JS
- **`setView('hub' | 'classroom')`** là nguồn sự thật duy nhất: bật/tắt `hidden` của `#hub-view` / `#classroom-view`, cập nhật stage bar.
- `openUnit()` → vào Phòng học: `history.pushState` với `#unit=<id>` (nút Back trình duyệt quay về Sảnh), focus `#lesson-title`; thoát → focus lại nút đã bấm.
- Lưu Unit đang học (kể cả Unit do AI tạo) vào `localStorage['ielts_study_last_unit']` → nút **▶ Tiếp tục Unit đang dở** và khôi phục khi tải lại trang.
- `applyGate()`: bị khóa → ẩn cả `#hub-view` và `#classroom-view`, chỉ hiện Cổng. Offline (không gọi được API chẩn đoán) → Sảnh vẫn mở, hồ sơ báo "Chưa có hồ sơ".
- Tab dùng `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, phím ←/→; nhớ tab đang chọn trong `localStorage`.
- Responsive: ≥1100px 3 cột · 720–1100px 2 cột · điện thoại 1 cột, **"Việc cần làm" lên đầu**. Phòng học ≤900px: sidebar xuống dưới bài học.
- Streak SVG `width:100%; height:auto` để vừa cột ~360px.

### 9A-5. Ngân hàng câu hỏi (`config.json`)
- Gắn `skillTag` cho 32 câu quiz (`Reading`, `Listening`, `Writing TR`, `Writing CC`, `Grammar (GRA)`, `Lexical (LR)` …).
- Viết lại 24 drill: mỗi Unit 3 câu **theo chủ đề Unit**, đan xen đúng 3 kỹ năng: 1 `Reading Paraphrase` + 1 `Grammar Error Fix (GRA)` + 1 `Lexical Collocation (LR)`.
- Sửa câu quiz trùng giữa `gram-u1` và `gram-u2`.

### 9A-6. Test bổ sung
- `study.html` có `#hub-view`, `#classroom-view`, `#btn-back-to-hub`, `#hub-tabs`, `#panel-courses`, `#panel-create`; không còn `id="study-banner"`.
- `study.css` có `.cockpit`, `.course-card`, `.hub-tab`, `.classroom-view`.
- `study.js` có `setView`, `ielts_study_last_unit`, `pushState`.
- `config.json`: không có câu quiz/drill nào trùng nội dung giữa các Unit; mọi quiz/drill có `skillTag`; mỗi drill set có đủ 3 kỹ năng.

---

## PHASE 9B — Learner Identity, Profile Pill & "Học Từ Lỗi Sai"

### 9B-1. Mô hình định danh: "Khách trước — nâng cấp sau"
1. Mọi trình duyệt nhận cookie **`im_uid`** (HttpOnly, SameSite=Lax, Secure ở prod, 400 ngày) trỏ tới một user `kind: "guest"` được tạo **lười** ở request ghi dữ liệu đầu tiên. → Giải quyết ngay việc nhiều học viên dùng chung 1 link public bị trộn dữ liệu.
2. **Tạo mã đồng bộ** (`POST /api/auth/passcode`): gắn mã dạng `IELTS-7K3F-92QX` (Crockford base32, ≥40 bit) **vào chính user hiện tại**, lưu hash scrypt; `kind → "member"`. Không di chuyển dữ liệu. Mã chỉ hiển thị 1 lần (có nút tạo lại mã → vô hiệu mã cũ).
3. **Nhập mã trên máy khác** (`POST /api/auth/redeem { passcode, localData }`): server biết cả guest hiện tại lẫn tài khoản đích → **gộp phía server** (dữ liệu server của guest + `localData` từ trình duyệt: `ielts_placement_results`, `ielts_writing_history`, `ielts_speaking_history`, `ielts_study_goal`, `ielts_study_commitment`, `ielts_study_streak`, `ielts_study_progress`), loại trùng theo `id`/`timestamp`/`unitId` (mastery lấy max), rồi chuyển cookie sang tài khoản đích.
4. **Bảo mật bắt buộc:** rate-limit redeem 10 lần/15 phút/IP; mọi request thay đổi dữ liệu kiểm tra header `Origin` khớp host (CSRF); session id lưu hash SHA-256; `POST /api/auth/logout` xoá session.
5. v1 **chưa** cần email + mật khẩu; cơ chế cookie sẵn sàng thêm email/OAuth sau.
6. **Session Guard — giới hạn thiết bị (theo RFC `8d2f03c`, triết lý Better Auth):** mỗi tài khoản giữ tối đa `MAX_DEVICES_PER_USER` phiên hoạt động (mặc định **3**). Redeem mã khi đã đủ → trả `409 { error: "device_limit", devices: [{ id, label, lastSeenAt }] }`; UI cho học viên chọn "Đăng xuất thiết bị cũ" (`DELETE /api/auth/sessions/:id`) rồi thử lại. Phiên không hoạt động quá 60 ngày tự hết hạn.
7. **Phân quyền `role`:** `guest` (chưa có mã) · `student` (đã tạo/nhập mã) · `instructor` (chỉ cấp bằng script/ENV `INSTRUCTOR_PASSCODES`, chưa có UI ở 9B; dành cho Phase 10+ xem sổ điểm học viên). Middleware `requireRole(...)` sẵn sàng nhưng 9B chỉ dùng cho các API quản trị.

### 9B-2. Backend (giao OpenAI Codex)
- **Middleware `identify`** gắn `req.userId` cho mọi `/api/*`.
- **`db/store.js`** — interface: `list(userId, collection)`, `append(userId, collection, record)`, `upsert(userId, collection, key, record)`, `getProfile/putProfile`, `sessions.*`. Hai adapter:
  - `json-dir` (mặc định local/test): `results/users/<userId>/<collection>.json`.
  - `upstash` khi có `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`: gọi Upstash Redis REST API bằng `fetch` (không thêm thư viện native). Khoá gợi ý: `im:user:<uid>` (hash hồ sơ), `im:sess:<sha256(sid)>` → uid (có TTL), `im:pass:<sha256(passcode)>` → uid, `im:rec:<uid>:<collection>` (list JSON, giới hạn độ dài bằng `LTRIM`).
  - Chạy trên Vercel mà **không** có biến Upstash → `GET /api/me` trả `storage: "ephemeral"` để UI cảnh báo.
- Thay mọi `readJsonArray/writeJsonArray(resultsDir/...)` bằng `store.*` theo `req.userId`. Dữ liệu cũ toàn cục → user `legacy` + script `npm run claim-legacy -- <passcode>`.
- **API mới:** `GET /api/me` → `{ userId, kind, role, displayName, targetBand, currentBand, examDate, commitment, streak, achievements, storage }`; `PATCH /api/me`; `POST /api/auth/passcode`; `POST /api/auth/redeem`; `POST /api/auth/logout`; `GET /api/auth/sessions`; `DELETE /api/auth/sessions/:id`.
- **`POST /api/study/generate-unit` thêm nhánh `mistakeContext`:** `{ source: "writing"|"speaking", recordId, prompt, overallBand, weakestCriterion: { code, score, feedback }, corrections: [{ original, correction, explanation }] (≤10), suggestions: [] (≤6), transcriptExcerpt (≤1500 ký tự) }`. Dùng prompt mới `config.mistakeUnitPrompt`. **Fallback không AI bắt buộc** (test chạy offline): lesson = bảng lỗi → sửa; flashcards = cụm từ đã sửa; quiz = chọn câu đúng giữa câu gốc và câu sửa; drill trộn 3 `skillTag`; challenge yêu cầu viết lại có dùng cụm đã sửa. Tự đẩy các lỗi vào SRS. `unitId = mistake_<source>_<recordId>`. **Không áp dụng Cổng Chẩn đoán** cho nhánh này.
- Test: redeem lần thứ 4 (vượt `MAX_DEVICES_PER_USER`) trả 409 `device_limit`; cookie được cấp; 2 trình duyệt (2 cookie) không thấy dữ liệu của nhau; passcode → redeem gộp đúng; redeem sai mã 400/401 + rate-limit; Origin lạ bị chặn; `mistakeContext` fallback trả unit hợp lệ đủ 5 bước.

### 9B-3. Frontend (Claude Code, sau khi hợp đồng API ở 9B-2 ổn định)
- **`js/auth-profile.js`** (IIFE `AuthProfile`), nạp **trước** `js/api-keys.js` trên cả 5 trang.
- **Learner Profile Pill** chèn đầu `.header-right` (`prepend`, đứng trước nút AI Keys; giữ `#sync-status` của Analytics): `[ⓐ Tên · 🎯 5.5→7.0 · 🔥 3]`; khách: `👤 Khách · Lưu tiến độ`. Điện thoại: chỉ avatar + 🔥.
- **Modal** dùng lại phong cách backdrop của AI Keys, 3 tab: *Hồ sơ* (tên, mục tiêu, sao chép mã, đăng xuất) · *Tạo mã đồng bộ* · *Nhập mã đồng bộ*. Cảnh báo khi `storage: "ephemeral"`.
- Sự kiện `ielts:profile-updated` đồng bộ pill ↔ `study.html` (lưu mục tiêu / streak).
- **Nút "🎯 Tạo Bài Học Khắc Phục Lỗi Này"** trong `renderResults` của `writing.js` và `speaking.js` → ghi `localStorage['ielts_mistake_handoff']` (kèm `createdAt`) → mở `study.html#create=mistakes`. **Không** đưa bài viết lên URL.
- `study.html`: Tab ➕ thêm sub-tab **🎯 Từ lỗi sai của tôi** — xem trước danh sách lỗi, bấm tạo → `generate-unit { mistakeContext }` → vào Phòng học. Xoá handoff sau khi tạo thành công; handoff quá 24h bị bỏ qua.
- **Nạp `.pdf` / `.docx` phía trình duyệt**: tải lười pdf.js + mammoth từ CDN chỉ khi người dùng chọn file, trích text rồi gửi vào `/api/study/extract-source` sẵn có (không thêm phụ thuộc server, tránh giới hạn body 4.5 MB của Vercel). Giới hạn 10 MB file / 60.000 ký tự text.

### 9B-4. Thứ tự & phân công
| Bước | Việc | Người làm |
|---|---|---|
| 1 | Phase 9A trọn gói | Claude Code |
| 1 (song song) | 9B-2 backend + test | OpenAI Codex |
| 2 | 9B-3 frontend + test | Claude Code |
| 3 | Bật `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` trên Vercel, chạy `claim-legacy` | Chủ dự án / Antigravity |
