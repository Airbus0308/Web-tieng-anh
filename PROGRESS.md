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
| **Phase 5** | **Inline Essay Correction & Production Security** — Bôi đỏ sửa lỗi trực tiếp trên câu + Bảo mật Server & Rate Limit | ✅ DONE | Codex | [phase-05-inline-and-security.md](progress/phase-05-inline-and-security.md) | `6940a77` |

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

## ✅ Phase 5 đã hoàn thành

- Express chỉ phục vụ các trang HTML, `config.json` và tài nguyên trong `css/`, `js/`, `assets/`. File mã nguồn, môi trường, kết quả và tài liệu nội bộ không truy cập được qua HTTP.
- Bốn endpoint Gemini dùng chung hạn mức 10 yêu cầu mỗi IP trong 15 phút.
- Kết quả Writing hiển thị các cụm từ được sửa và giải thích; dữ liệu được lưu trong lịch sử.
- Kết quả kiểm thử và giới hạn triển khai: [Báo cáo Phase 5](progress/phase-05-inline-and-security.md).

Phase tiếp theo chưa được điều phối viên xác định.
