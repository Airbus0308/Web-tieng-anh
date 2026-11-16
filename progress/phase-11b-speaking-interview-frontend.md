# Phase 11B — Speaking 3-Part Mock Interview Frontend

- **Trạng thái:** ✅ Hoàn thành
- **Người thực hiện:** Claude Code
- **Ngày:** 2026-11-16

## Phạm vi

Nâng `speaking.html` thành phòng thi nói 2 chế độ. Chế độ Cue Card giữ nguyên toàn bộ DOM ID và luồng cũ (mặc định); chế độ Interview chạy Part 1 → Part 2 → Part 3 với Giám khảo AI, dùng backend Phase 11A.

## Thay đổi

| File | Nội dung |
| :--- | :--- |
| `speaking.html` | Thêm `#speaking-mode-tabs` (`#tab-speaking-cuecard` mặc định / `#tab-speaking-interview`), `#interview-room-panel` (`#interview-stepper`, `#examiner-prompt-card`, `#examiner-question-text`, `#btn-speak-question`, `#btn-toggle-tts`, `#examiner-feedback-bubble`), `#interview-room-footer` (`#btn-next-turn`, `#btn-finish-interview`, `#interview-transcript-log`); kết quả thêm `#speaking-result-mode-chip`, `#speaking-part-breakdown`, `#speaking-inline-corrections`, `#speaking-band8-highlights`. |
| `css/speaking.css` | Style cho tab, stepper, thẻ giám khảo, bong bóng phản hồi, nút phát âm, nhật ký chat, breakdown/corrections/Band 8. |
| `js/speaking.js` | `setMode`, `startInterview`, `nextTurn`, `finishInterview`, `speakQuestion`, `toggleTts`; `_interviewTurns`; TTS `en-GB` qua `speechSynthesis`; render kết quả mở rộng; `createMistakeUnit` truyền `inline_corrections`. |
| `tests/smoke.test.js` | 3 test mới (DOM/token, luồng interview bằng fake DOM + mock fetch, `createMistakeUnit`). |

## Luồng Interview

- Hàng đợi câu hỏi: 3 câu Part 1 → cue card Part 2 (dùng lại đồng hồ 1m chuẩn bị + 2m nói và `#speaking-input`/ghi âm) → 3 câu Part 3.
- `#btn-next-turn` lưu lượt `{ part, question, answer, durationSec }` vào `_interviewTurns`, ghi vào `#interview-transcript-log`; ở Part 1 và Part 3 gọi `/api/speaking/examiner-turn` rồi hiển thị `examinerReplyEn`, `coachingTipVi` và nút nghe từng từ `pronunciationTargets`. Ở Part 3, `followUpQuestionEn` được chèn làm câu kế tiếp (tối đa 2 câu phản biện, nên tối đa 9 lượt ≤ giới hạn 12 của server). Lỗi examiner không chặn buổi thi.
- Hết câu hỏi → tự gửi chấm; `#btn-finish-interview` bật khi tổng số từ ≥ 40 và chấm sớm bất kỳ lúc nào (lưu cả câu trả lời đang dở). Payload: `{ transcript, topic, part: "Full Interview (Part 1-2-3)", mode: "interview", topicId, interviewTurns, durationSeconds }`. Chế độ Cue Card nay cũng gửi `mode: "cuecard"` và `topicId`.

## Ghi chú thiết kế

- Spec 2.3 đặt `#interview-turn-controls` trong panel; thực tế nút điều khiển và nhật ký nằm trong `#interview-room-footer` (ngay dưới ô nhập), để nút "Tiếp tục" nằm sát khung trả lời mà không phải di chuyển `#editor-section` (giữ nguyên DOM cũ).
- Chuyển tab giữa chừng sẽ hỏi xác nhận trước khi hủy buổi phỏng vấn.
- Band 8 lấy theo `topicId` (hoặc khớp prompt Part 2 với bản ghi lịch sử cũ).

## Kiểm thử

`npm test`: **73 test, 71 pass, 0 fail, 2 skip** (hai test gọi Gemini trực tiếp bị bỏ qua do không có `GEMINI_API_KEY`). Chưa kiểm tra thủ công trên trình duyệt thật (TTS/ghi âm cần Chrome/Edge).
