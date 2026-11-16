# Phase 11A — Speaking 3-Part Mock Interview Config & Backend API

- **Trạng thái:** ✅ Hoàn thành; Phase 11B frontend sẵn sàng bàn giao
- **Người thực hiện:** OpenAI Codex
- **Ngày:** 2026-11-16

## Phạm vi

Mở rộng Speaking từ bài luyện Part 2/3 thành nền tảng backend cho phỏng vấn đủ ba phần. Payload chấm điểm cũ vẫn hoạt động; chế độ interview bổ sung lượt hỏi đáp có cấu trúc, phản biện thích ứng và nhận xét theo từng Part.

## Thay đổi

| File | Nội dung |
| :--- | :--- |
| `config.json` | Giữ nguyên `id`, `category`, `part2`, `part3` của `sp-01`–`sp-05`; thêm Part 1, follow-up bank và bốn cụm Band 8 cho từng đề; thêm `sp-06`–`sp-08`; bổ sung prompt examiner và schema chấm mới. |
| `server.js` | Thêm examiner-turn có `studyRateLimit`, AI key pool và fallback tất định; mở rộng prompt/chấm/lưu Speaking interview, correction filtering và part breakdown. |
| `tests/smoke.test.js` | Kiểm tra tám đề đủ ba Part, validation/fallback/mock AI examiner, transcript tự ghép, correction filtering, breakdown và bản ghi interview. |

## Hợp đồng API

- `GET /api/speaking/config` trả tám `sampleTopics`, bốn `criteria` và `wordCountRequirements`; mỗi đề có `part1Topic`, ba câu Part 1, cue card Part 2, ba câu Part 3, hai follow-up và bốn cụm Band 8.
- `POST /api/speaking/examiner-turn` nhận `{ topicId, part, turnIndex, questionAsked, candidateTranscript }`. Transcript thiếu/rỗng trả 400. Khi có key, API gọi prompt examiner qua key pool và kiểm tra schema; khi thiếu key, provider lỗi hoặc schema sai, API trả fallback tất định với câu hỏi từ ngân hàng đề, coaching tiếng Việt và 2–3 từ dài cần luyện phát âm.
- `POST /api/speaking/score` tiếp tục nhận payload cũ `{ transcript, topic, part, durationSeconds }`. Payload mới có thể thêm `mode`, `topicId`, `interviewTurns`; nếu transcript rỗng, server ghép các câu trả lời hợp lệ. Tối đa 12 lượt được chuẩn hóa và lưu theo `req.userId`.
- `inline_corrections` chỉ giữ mục có `original` xuất hiện nguyên văn trong transcript. Với `mode: "interview"`, response luôn có `part_breakdown.part1`, `part2`, `part3`; nếu AI bỏ thiếu, server sinh thống kê số lượt và số từ.

## Kiểm thử

`npm test`: **70 test, 68 pass, 0 fail, 2 skip**. Hai test gọi Gemini trực tiếp được bỏ qua đúng điều kiện do môi trường không có `GEMINI_API_KEY`; các nhánh AI mới được kiểm tra bằng OpenAI-compatible mock và các nhánh offline bằng fallback tất định.

Đã kiểm tra thêm `node --check server.js`, JSON config được Node parse thành công và `git diff --check` không phát hiện lỗi whitespace.

## Bàn giao Phase 11B

Frontend có thể lấy toàn bộ ngân hàng đề từ `/api/speaking/config`, gọi `/api/speaking/examiner-turn` sau lượt Part 1/3 và gửi toàn bộ `interviewTurns` tới `/api/speaking/score`. Tên trường kết quả chuẩn từ backend là `part_breakdown` và `inline_corrections`; response đồng thời trả lại `mode`, `topicId`, `interviewTurns` để UI dựng báo cáo và lịch sử.
