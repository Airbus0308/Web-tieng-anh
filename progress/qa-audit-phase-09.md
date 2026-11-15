# QA Audit — Phase 9A & Phase 9B

- **Auditor:** Cursor CLI (Independent QA, Security & Architecture)
- **Date:** 2026-11-16
- **Scope:** Phase 9A (`7c4af1c`) + Phase 9B backend (`5caccdc`) + Phase 9B frontend (`f27b010`, progress hash `f2d5153`)
- **Checklist:** `docs/CURSOR_QA_CHECKLIST.md`

---

## 1. Tổng quan Kết quả Kiểm duyệt

| Mục | Kết quả |
| :--- | :--- |
| **Verdict** | **PASS WITH MINOR ISSUES** → sau xác nhận trên `main`: **✅ VERIFIED** |
| **`npm test` (sau commit Frontend 9B)** | **58 pass · 0 fail · 2 skip** (Gemini live cần `GEMINI_API_KEY`) |
| **Commits đã đối chiếu** | `7c4af1c` (9A) · `5caccdc` (9B backend) · `f27b010` (9B frontend + `revokeSessionId`) |

---

## 2. Bảng Đánh giá Theo Hạng mục

| Hạng mục | Đánh giá | Ghi chú ngắn |
| :--- | :---: | :--- |
| Kiến trúc & API Contract | ✅ | Cookie trên HTML trước script; redeem + `revokeSessionId`; mistakeContext khớp schema |
| Bảo mật & Cô lập dữ liệu | ✅ | scrypt/`timingSafeEqual`, SHA-256 session, CSRF Origin, store theo `req.userId`, XSS escape tốt |
| Giao diện & UX (9A/9B) | ✅ | DOM ID smoke còn đủ; gate bypass `source === 'mistakes'`; PDF/DOCX có fallback + gợi ý dán text |
| Độ phủ Test | ✅ | 60 tests (58+2 skip); device revoke-in-redeem, isolation, mistake offline, frontend wiring |

---

## 3. Danh sách Phát hiện Chi tiết (Findings)

### [HIGH] ~~Thiết bị thứ 4 không thu hồi được qua `DELETE` khi đang là guest~~ — **ĐÃ VÁ**

- **Vấn đề gốc (`5caccdc`):** `DELETE /api/auth/sessions/:id` chỉ xóa session của `req.userId` → guest thiết bị thứ 4 nhận `409 device_limit` rồi bị kẹt.
- **Vá (`f27b010`):** `db/auth.js:148-153` — redeem chấp nhận `revokeSessionId` khi passcode hợp lệ; `js/auth-profile.js` UI `revoke-and-redeem`.
- **Evidence test:** `tests/smoke.test.js` — `Phase 9B redeem can revoke one old device of the target account in the same step`.
- **Trạng thái:** ✅ Đã có trên `origin/main`.

### [LOW] Lệch UX so với bản design sớm: không có sub-tab `#create=mistakes` / handoff

- **Vị trí:** luồng thực tế `js/writing.js` / `js/speaking.js` → `AuthProfile.createMistakeUnit` → `/study.html#unit=<id>`.
- **Tác động:** Không ảnh hưởng chức năng; vẫn bypass `#diagnostic-gate` khi `source === 'mistakes'` (`js/study.js` `openUnit` / `setView` / `restoreFromHash`).
- **Trạng thái:** Chấp nhận như cải tiến UX; design đã cập nhật contract `revokeSessionId`. Không chặn đóng Phase 9.

### [LOW] ~~Rate-limit redeem 10 vs 5~~ / ~~CDN error không gợi ý dán text~~ — **ĐÃ KHỚP**

- Design hiện ghi **5 lần/15 phút/IP** (`docs/PHASE_9_DESIGN.md`); catch PDF/DOCX đã gợi ý tab Dán văn bản (`js/study.js:1108`).

---

## 4. Chi tiết Kiểm duyệt theo Checklist (Evidence)

### A. Contract & Race

| Kiểm tra | Kết quả | Evidence |
| :--- | :---: | :--- |
| Cookie `im_uid` trước API song song | ✅ | Middleware session trên HTML; test *establishes session on the application page…* |
| 5 trang load `auth-profile.js` trước page script | ✅ | `index/writing/speaking/study/analytics.html` |
| `409 device_limit` + thu hồi để redeem tiếp | ✅ | `revokeSessionId` + UI `revoke-and-redeem` |
| `mistakeContext` field names | ✅ | `source`, `recordId`, `prompt`, `overallBand`, `weakestCriterion`, `corrections`, `suggestions`, `transcriptExcerpt` khớp `db/mistakes.js` |
| Bypass diagnostic gate cho `mistakes` | ✅ | `openUnit` / `setView` / `hashIsMistakeUnit` / `restoreFromHash` |

### B. Security & Isolation

| Kiểm tra | Kết quả | Evidence |
| :--- | :---: | :--- |
| Cookie HttpOnly / SameSite=Lax / Secure(prod\|Vercel) | ✅ | `cookieOptions()` trong `db/auth.js` |
| Passcode scrypt + `timingSafeEqual` | ✅ | `db/auth.js` |
| Session token SHA-256 | ✅ | hash trước khi lưu |
| CSRF Origin / Sec-Fetch-Site | ✅ | middleware `/api` non-GET |
| Rate-limit redeem | ✅ | 5 fail / 15 phút / IP → 429 |
| Multi-tenant `store.*` + `req.userId` | ✅ | Placement/Writing/Speaking/Study/SRS/checkpoints; `gemini_keys.json` là cấu hình máy chủ |
| XSS `innerHTML` | ✅ | `esc` / `_escapeHtml` / `textContent` trên user & AI strings |

### C. Study Cockpit & Question Bank

| Kiểm tra | Kết quả | Evidence |
| :--- | :---: | :--- |
| DOM IDs Phase 7/8B/9A | ✅ | `#diagnostic-gate`, `#forethought-panel`, `#kbcp-commitment-box`, `#srs-due-panel`, `#tutor-feedback-panel`, `#exam-date`, `#target-band`, `#textbook-list`, `#lesson-section`, `#hub-view`, `#classroom-view`, `#btn-back-to-hub`, …; không còn `#study-banner` |
| `hub` ↔ `classroom` | ✅ | `setView` nguồn sự thật duy nhất |
| PDF/DOCX CDN + empty file | ✅ | `loadScript` `onerror`; empty PDF scan; catch + gợi ý dán text |
| `config.json` 32 quiz / 24 drill | ✅ | 8 units; mọi câu có `skillTag`; không trùng giữa units; mỗi drill set đủ 3 skill |

---

## 5. Kết luận Nghiệm thu

| Phase | Trạng thái auditor |
| :--- | :--- |
| **Phase 9A** | ✅ **VERIFIED** |
| **Phase 9B Backend** | ✅ **VERIFIED** (kèm vá `revokeSessionId` trong `f27b010`) |
| **Phase 9B Frontend** | ✅ **VERIFIED** |

**Phase 9 đủ điều kiện đóng** trên `origin/main` tại chuỗi commit trên; finding còn lại chỉ là ghi chú UX/design (không chặn Phase 10).

---

## 6. Ghi chú vận hành auditor

- Không đọc/commit `.env`, `results/`, `node_modules/`, token.
- Trong lúc Claude Code WIP: READ-ONLY; sau `f27b010`/`f2d5153` mới chốt test + báo cáo.
- Harness tạm `assets/__harness_9b*` đã được Claude Code xóa trước commit.
