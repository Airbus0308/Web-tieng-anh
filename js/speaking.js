/**
 * IELTS Master — Speaking Practice Module (Part 2 Cue Card & Part 3)
 *
 * - Loads cue cards from GET /api/speaking/config (with built-in fallback)
 * - 1-minute preparation + 2-minute speaking timer
 * - Speech-to-text via Web Speech Recognition API, editable in a textarea
 * - Scores via POST /api/speaking/score (FC, LR, GRA, PR)
 * - History via GET /api/speaking/history with localStorage fallback
 */
const SpeakingApp = (() => {
  const STORAGE_KEY_HISTORY = 'ielts_speaking_history';
  const MIN_WORDS_DEFAULT = 40;
  const PREP_SECONDS = 60;
  const SPEAK_SECONDS = 120;

  const _DEFAULT_TOPICS = [{
    id: 'sp-01', category: 'People',
    part2: { prompt: 'Describe a teacher who has influenced you.', points: ['Who this person is', 'How you know this person', 'What they taught you'], closing: 'and explain why this person influenced you so much.' },
    part3: ['Do you think teachers are as respected today as in the past?', 'What qualities make a good teacher?']
  }];

  let _topics = [];
  let _topicIndex = -1;
  let _currentTopic = null;
  let _lastResult = null; // last rendered score, used by "Learn From My Mistakes"
  let _minWords = MIN_WORDS_DEFAULT;
  let _isLoading = false;

  // Phase 11B — Mock Interview state
  const INTERVIEW_PART_LABEL = 'Full Interview (Part 1-2-3)';
  const MAX_FOLLOW_UPS = 2;
  let _mode = 'cuecard';
  let _interviewActive = false;
  let _interviewTurns = [];   // [{ part, question, answer, durationSec }]
  let _queue = [];            // upcoming { part, question, isFollowUp?, cue? }
  let _currentQ = null;
  let _turnStartedAt = null;
  let _followUpsUsed = 0;
  let _turnBusy = false;
  let _ttsEnabled = true;

  let _timerPhase = 'idle'; // idle | prep | speak | done
  let _timerSeconds = PREP_SECONDS;
  let _timerInterval = null;
  let _speakStartedAt = null;
  let _speakDuration = null;

  let _recognition = null;
  let _isRecording = false;
  let _baseText = '';

  const _el = id => document.getElementById(id);

  function _escapeHtml(str) {
    return String(str ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  }

  function countWords(text) {
    return text && text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  }

  const _colorClass = score => (parseFloat(score) >= 7 ? 'score-green' : parseFloat(score) >= 5.5 ? 'score-amber' : 'score-red');
  const _colorHex = score => (parseFloat(score) >= 7 ? 'var(--accent-green)' : parseFloat(score) >= 5.5 ? 'var(--accent-amber)' : 'var(--accent-red)');

  function _bandLabel(band) {
    const n = parseFloat(band);
    if (n >= 9) return 'Expert User';
    if (n >= 8) return 'Very Good User';
    if (n >= 7) return 'Good User';
    if (n >= 6) return 'Competent User';
    if (n >= 5) return 'Modest User';
    if (n >= 4) return 'Limited User';
    return 'Extremely Limited User';
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 18px;border-radius:10px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid rgba(148,163,184,.3);box-shadow:0 8px 24px rgba(0,0,0,.4)';
    if (type === 'error') toast.style.borderColor = 'var(--accent-red)';
    if (type === 'success') toast.style.borderColor = 'var(--accent-green)';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  /* ── Init & config ──────────────────────────────────── */
  async function init() {
    await _loadConfig();
    changeTopic();
    _el('speaking-input').addEventListener('input', updateWordCount);
    updateWordCount();
    _setupSpeechSupport();
    _setupTts();
    _renderTimer();
    loadHistory();
  }

  async function _loadConfig() {
    try {
      const res = await fetch('/api/speaking/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cfg = await res.json();
      _topics = Array.isArray(cfg.sampleTopics) && cfg.sampleTopics.length ? cfg.sampleTopics : _DEFAULT_TOPICS;
      _minWords = Number(cfg.wordCountRequirements?.min) || MIN_WORDS_DEFAULT;
    } catch {
      _topics = _DEFAULT_TOPICS;
    }
  }

  function changeTopic() {
    if (!_topics.length) return;
    let next = _topicIndex;
    if (_topics.length > 1) {
      while (next === _topicIndex) next = Math.floor(Math.random() * _topics.length);
    } else {
      next = 0;
    }
    _topicIndex = next;
    _currentTopic = _topics[next];
    _renderTopic(_currentTopic);
    resetTimer();
    const name = _el('interview-topic-name');
    if (name) name.textContent = _currentTopic.part1Topic || _currentTopic.category || _currentTopic.part2?.prompt || '';
  }

  function _renderTopic(topic) {
    const p2 = topic.part2 || {};
    _el('topic-category').textContent = topic.category || 'Speaking';
    _el('topic-prompt').textContent = p2.prompt || '';
    _el('cue-points').innerHTML = (p2.points || []).map(x => `<li>${_escapeHtml(x)}</li>`).join('');
    _el('cue-closing').textContent = p2.closing || '';
    _el('part3-list').innerHTML = (topic.part3 || []).map(x => `<li>${_escapeHtml(x)}</li>`).join('');
  }

  function _topicText() {
    return _currentTopic?.part2?.prompt || 'IELTS Speaking Part 2';
  }

  /* ── Word count ─────────────────────────────────────── */
  function updateWordCount() {
    const words = countWords(_el('speaking-input').value);
    const ok = words >= _minWords;
    _el('word-count-number').textContent = words;
    const badge = _el('word-count-badge');
    badge.classList.toggle('warning', !ok);
    badge.classList.toggle('success', ok);
    _el('btn-submit').disabled = !ok || _isLoading;
    _el('submit-hint').textContent = ok
      ? 'Ready to submit for AI scoring.'
      : `Provide at least ${_minWords} words to enable submission (current: ${words}).`;
    if (_mode === 'interview') _updateInterviewControls();
  }

  /* ── Timer ──────────────────────────────────────────── */
  const _fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  function _renderTimer() {
    const labels = { idle: 'Ready', prep: 'Preparation', speak: 'Speaking', done: "Time's up" };
    _el('timer-big').textContent = _fmt(_timerSeconds);
    _el('timer-display').textContent = _fmt(_timerSeconds);
    _el('phase-label').textContent = labels[_timerPhase];
    const card = _el('timer-card');
    card.classList.remove('phase-prep', 'phase-speak', 'phase-done');
    if (_timerPhase !== 'idle') card.classList.add(`phase-${_timerPhase}`);
  }

  function _clearInterval() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = null;
  }

  function _startCountdown(phase, seconds, onEnd) {
    _clearInterval();
    _timerPhase = phase;
    _timerSeconds = seconds;
    _renderTimer();
    _timerInterval = setInterval(() => {
      _timerSeconds -= 1;
      _renderTimer();
      if (_timerSeconds <= 0) { _clearInterval(); onEnd(); }
    }, 1000);
  }

  function startPrep() {
    _startCountdown('prep', PREP_SECONDS, startSpeaking);
  }

  function startSpeaking() {
    _speakStartedAt = Date.now();
    _speakDuration = null;
    _startCountdown('speak', SPEAK_SECONDS, () => {
      _speakDuration = SPEAK_SECONDS;
      _timerPhase = 'done';
      _timerSeconds = 0;
      _renderTimer();
      if (_isRecording) toggleRecording();
      showToast("Time's up! Review your transcript and submit.", 'info');
    });
    showToast('Speaking time started. Press Start Recording or type your answer.', 'info');
  }

  function resetTimer() {
    _clearInterval();
    _timerPhase = 'idle';
    _timerSeconds = PREP_SECONDS;
    _speakStartedAt = null;
    _speakDuration = null;
    _renderTimer();
  }

  function _durationSeconds() {
    if (_speakDuration) return _speakDuration;
    if (_speakStartedAt) return Math.min(SPEAK_SECONDS, Math.round((Date.now() - _speakStartedAt) / 1000));
    return null;
  }

  /* ── Speech recognition ─────────────────────────────── */
  function _setStatus(msg, isError = false) {
    const el = _el('speech-status');
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }

  function _setupSpeechSupport() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      _el('btn-record').disabled = true;
      _setStatus('Speech recognition is not supported in this browser. Type your answer instead (Chrome or Edge recommended for voice).', true);
      return;
    }
    _recognition = new SR();
    _recognition.lang = 'en-US';
    _recognition.continuous = true;
    _recognition.interimResults = true;

    _recognition.onresult = event => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk + ' ';
        else interim += chunk;
      }
      const sep = _baseText && !/\s$/.test(_baseText) ? ' ' : '';
      _el('speaking-input').value = (_baseText + sep + finalText + interim).replace(/\s+/g, ' ').trimStart();
      updateWordCount();
    };
    _recognition.onerror = event => {
      const msg = event.error === 'not-allowed' ? 'Microphone permission denied. Allow mic access or type your answer.'
        : event.error === 'no-speech' ? 'No speech detected. Try again.'
        : `Speech recognition error: ${event.error}`;
      _setStatus(msg, true);
      _stopRecordingUi();
    };
    _recognition.onend = () => {
      // Chrome ends sessions after silence; restart while the user still wants to record
      if (_isRecording) {
        _baseText = _el('speaking-input').value;
        try { _recognition.start(); } catch { _stopRecordingUi(); }
      }
    };
  }

  function _stopRecordingUi() {
    _isRecording = false;
    const btn = _el('btn-record');
    btn.classList.remove('recording');
    btn.setAttribute('aria-pressed', 'false');
    _el('btn-record-text').textContent = 'Start Recording';
  }

  function toggleRecording() {
    if (!_recognition) return;
    if (_isRecording) {
      _isRecording = false;
      try { _recognition.stop(); } catch { /* already stopped */ }
      _stopRecordingUi();
      _setStatus('Recording stopped. You can edit the transcript before submitting.');
      return;
    }
    _baseText = _el('speaking-input').value;
    try {
      _recognition.start();
    } catch {
      _setStatus('Could not start the microphone.', true);
      return;
    }
    _isRecording = true;
    const btn = _el('btn-record');
    btn.classList.add('recording');
    btn.setAttribute('aria-pressed', 'true');
    _el('btn-record-text').textContent = 'Stop Recording';
    _setStatus('Listening… speak clearly into your microphone.');
    if (_timerPhase === 'idle') startSpeaking();
  }

  /* ── Submit & results ───────────────────────────────── */
  async function handleSubmit() {
    if (_isLoading) return;
    if (_isRecording) toggleRecording();
    const transcript = _el('speaking-input').value.trim();
    if (countWords(transcript) < _minWords) {
      showToast(`Please provide at least ${_minWords} words.`, 'error');
      return;
    }
    _setLoading(true);
    try {
      const duration = _durationSeconds();
      await _scoreAndRender({ transcript, topic: _topicText(), part: 'Part 2 & Part 3', durationSeconds: duration,
        mode: 'cuecard', topicId: _currentTopic?.id || null }, duration);
    } catch (err) {
      showToast(err.message || 'Could not score your response.', 'error');
    } finally {
      _setLoading(false);
    }
  }

  async function _scoreAndRender(payload, duration) {
    const res = await fetch('/api/speaking/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, integrity: typeof ExamSecurity !== 'undefined' ? ExamSecurity.snapshot() : null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scoring failed.');
    _saveLocalAttempt(data, payload.transcript, duration);
    renderResults({ ...data, transcript: payload.transcript, topic: payload.topic });
    loadHistory();
    return data;
  }

  function _setLoading(loading) {
    _isLoading = loading;
    _el('scoring-loader').style.display = loading ? 'block' : 'none';
    _el('btn-spinner').style.display = loading ? 'inline-block' : 'none';
    _el('btn-submit-text').textContent = loading ? 'Scoring…' : 'Submit for AI Scoring';
    if (loading) _el('results-area').style.display = 'none';
    updateWordCount();
  }

  function _normalizeCriteria(data) {
    const raw = data.result?.criteria || data.criteria || [];
    return raw.map(c => ({
      name: c.name || c.abbreviation,
      abbreviation: String(c.abbreviation || c.abbr || '').toUpperCase(),
      score: Number(c.score),
      bandDescriptor: c.band_descriptor || c.bandDescriptor || '',
      feedback: c.feedback || ''
    }));
  }

  function renderResults(data) {
    _lastResult = data;
    const src = data.result || data;
    const band = Number(src.overall_band ?? src.overallBand ?? 0);
    const colorClass = _colorClass(band);
    _el('result-overall-band').textContent = band.toFixed(1);
    const circle = _el('result-band-circle');
    circle.style.borderColor = _colorHex(band);
    _el('result-band-label').textContent = _bandLabel(band);
    const isInterview = data.mode === 'interview' || src.mode === 'interview';
    _el('speaking-result-mode-chip').textContent = isInterview ? 'Full Mock Interview · Part 1–2–3' : 'Part 2 & 3 Cue Card';
    _el('result-word-count').textContent = `${data.wordCount || countWords(data.transcript || '')} words`;
    _el('result-overall-feedback').textContent = src.overall_feedback || src.overallFeedback || '';

    const grid = _el('criteria-grid');
    grid.innerHTML = _normalizeCriteria(data).map(item => `
      <div class="criterion-card ${_colorClass(item.score)}">
        <div class="criterion-header">
          <div class="criterion-title-wrap">
            <div class="criterion-abbr-badge">${_escapeHtml(item.abbreviation)}</div>
            <div><h3 class="criterion-name">${_escapeHtml(item.name)}</h3><span class="criterion-descriptor">${_escapeHtml(item.bandDescriptor)}</span></div>
          </div>
          <div class="criterion-score-badge"><span class="criterion-score-num">${item.score}</span><span class="criterion-score-max">/ 9</span></div>
        </div>
        <p class="criterion-feedback">${_escapeHtml(item.feedback)}</p>
      </div>`).join('');

    _renderPartBreakdown(src.part_breakdown || data.part_breakdown, isInterview);
    _renderInlineCorrections(src.inline_corrections || data.inline_corrections);
    _renderBand8(data);

    const suggestions = src.suggestions || [];
    _el('suggestions-list').innerHTML = suggestions.map(s => `<li>${_escapeHtml(s)}</li>`).join('');
    const area = _el('results-area');
    area.dataset.band = colorClass;
    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _renderPartBreakdown(breakdown, isInterview) {
    const box = _el('speaking-part-breakdown');
    const list = _el('speaking-part-breakdown-list');
    list.replaceChildren();
    if (isInterview && breakdown && typeof breakdown === 'object') {
      [1, 2, 3].forEach(n => {
        const text = breakdown[`part${n}`];
        if (typeof text !== 'string' || !text.trim()) return;
        const item = document.createElement('div');
        item.className = 'part-breakdown-item';
        const h = document.createElement('strong'); h.textContent = `Part ${n}`;
        const p = document.createElement('p'); p.textContent = text;
        item.append(h, p);
        list.appendChild(item);
      });
    }
    box.hidden = list.childElementCount === 0;
  }

  function _validCorrections(raw) {
    return (Array.isArray(raw) ? raw : []).filter(c => c && typeof c.original === 'string' && c.original.trim()
      && typeof c.correction === 'string' && c.correction.trim());
  }

  function _renderInlineCorrections(raw) {
    const box = _el('speaking-inline-corrections');
    const list = _el('speaking-inline-corrections-list');
    list.replaceChildren();
    _validCorrections(raw).forEach(c => {
      const row = document.createElement('div');
      row.className = 'speaking-correction';
      const del = document.createElement('del'); del.textContent = c.original;
      const arrow = document.createElement('span'); arrow.textContent = ' → ';
      const ins = document.createElement('ins'); ins.textContent = c.correction;
      row.append(del, arrow, ins);
      if (typeof c.explanation === 'string' && c.explanation.trim()) {
        const p = document.createElement('p'); p.textContent = c.explanation; row.appendChild(p);
      }
      list.appendChild(row);
    });
    box.hidden = list.childElementCount === 0;
  }

  function _renderBand8(data) {
    const box = _el('speaking-band8-highlights');
    const topic = _topics.find(t => t.id && t.id === data.topicId)
      || _topics.find(t => t.part2?.prompt && t.part2.prompt === data.topic);
    const items = Array.isArray(topic?.modelBand8Highlight) ? topic.modelBand8Highlight : [];
    _el('speaking-band8-list').innerHTML = items.map(x => `<li>${_escapeHtml(x)}</li>`).join('');
    box.hidden = !items.length;
  }

  /* ── History ────────────────────────────────────────── */
  function _getLocalHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  function _saveLocalAttempt(data, transcript, duration) {
    try {
      const history = _getLocalHistory();
      history.unshift({
        id: data.id || `speak_${Date.now()}`,
        timestamp: data.timestamp || new Date().toISOString(),
        topic: _topicText(),
        transcript,
        wordCount: data.wordCount || countWords(transcript),
        durationSeconds: duration,
        mode: data.mode || 'cuecard',
        topicId: data.topicId || null,
        result: {
          overall_band: data.overall_band,
          overall_feedback: data.overall_feedback,
          criteria: data.criteria,
          suggestions: data.suggestions,
          part_breakdown: data.part_breakdown,
          inline_corrections: data.inline_corrections
        }
      });
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history.slice(0, 20)));
    } catch (e) {
      console.warn('[SpeakingApp] Failed to save local history:', e);
    }
  }

  async function loadHistory() {
    let items;
    try {
      const res = await fetch('/api/speaking/history');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      items = Array.isArray(data) ? data.slice().reverse() : [];
    } catch {
      items = _getLocalHistory();
    }
    _renderHistory(items);
  }

  function _renderHistory(items) {
    const list = _el('history-list');
    _el('history-count-pill').textContent = items.length;
    if (!items.length) {
      list.innerHTML = '<div class="history-empty-state"><p>No speaking attempts yet. Submit your first answer to track progress over time.</p></div>';
      return;
    }
    list.innerHTML = '';
    items.slice(0, 20).forEach(item => {
      const band = Number(item.result?.overall_band ?? item.overall_band ?? 0);
      const cls = _colorClass(band);
      let date = 'Recent';
      try { date = new Date(item.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { /* keep default */ }
      const mini = (item.result?.criteria || item.criteria || [])
        .map(c => `<span class="criteria-mini-tag">${_escapeHtml(c.abbreviation)}: ${_escapeHtml(c.score)}</span>`).join('');
      const card = document.createElement('div');
      card.className = `history-item-card ${cls}`;
      card.title = 'Click to review this result';
      card.innerHTML = `
        <div class="history-item-header"><span class="history-date">${date}</span><span class="history-band-pill ${cls}">Band ${band.toFixed(1)}</span></div>
        <div class="history-prompt-preview">${_escapeHtml(item.topic || 'IELTS Speaking')}</div>
        <div class="history-item-footer"><span>${item.wordCount || 0} words</span><div class="history-criteria-mini">${mini}</div></div>`;
      card.addEventListener('click', () => renderResults(item));
      list.appendChild(card);
    });
  }

  /* ── Reset ──────────────────────────────────────────── */
  function clearDraft() {
    if (_isRecording) toggleRecording();
    _el('speaking-input').value = '';
    _baseText = '';
    updateWordCount();
  }

  /* ── Phase 9B: Learn From My Mistakes ─────────────────── */
  /** Unit is built from the weakest criterion, suggestions, transcript and (when present) inline_corrections. */
  async function createMistakeUnit(button) {
    const data = _lastResult;
    if (!data || typeof AuthProfile === 'undefined') { showToast('Hãy chấm một bài nói trước.', 'error'); return; }
    const src = data.result || data;
    const mistakeContext = {
      source: 'speaking',
      recordId: String(data.id || data.timestamp || `local_${Date.now()}`),
      prompt: data.topic || _topicText(),
      overallBand: Number(src.overall_band ?? src.overallBand) || null,
      weakestCriterion: AuthProfile.weakestCriterion(_normalizeCriteria(data)) || undefined,
      corrections: _validCorrections(src.inline_corrections || data.inline_corrections).slice(0, 10)
        .map(c => ({ original: c.original, correction: c.correction, explanation: c.explanation || '' })),
      suggestions: (src.suggestions || []).slice(0, 6),
      transcriptExcerpt: String(data.transcript || _el('speaking-input')?.value || '').slice(0, 1500)
    };
    try { await AuthProfile.createMistakeUnit(mistakeContext, button); }
    catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Phase 11B: Live Mock Interview ──────────────────── */
  function _setupTts() {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      _ttsEnabled = false;
      for (const id of ['btn-speak-question', 'btn-toggle-tts']) { const b = _el(id); if (b) b.disabled = true; }
      _el('btn-toggle-tts').textContent = '🔇 Trình duyệt không hỗ trợ TTS';
    }
  }

  function _speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch { /* TTS is best-effort */ }
  }

  function speakQuestion() { if (_currentQ) _speak(_currentQ.spokenText || _currentQ.question); }

  function toggleTts() {
    if (!('speechSynthesis' in window)) return;
    _ttsEnabled = !_ttsEnabled;
    const b = _el('btn-toggle-tts');
    b.setAttribute('aria-pressed', String(_ttsEnabled));
    b.textContent = _ttsEnabled ? '🔈 Tự đọc: Bật' : '🔇 Tự đọc: Tắt';
    if (!_ttsEnabled) window.speechSynthesis.cancel();
  }

  function setMode(mode) {
    if (mode !== 'cuecard' && mode !== 'interview') return;
    if (mode === _mode) return;
    if (_interviewActive && _interviewTurns.length && !window.confirm('Rời phòng thi sẽ hủy buổi phỏng vấn đang làm dở. Tiếp tục?')) return;
    _resetInterview();
    _mode = mode;
    const interview = mode === 'interview';
    for (const t of document.querySelectorAll('[data-speaking-mode]')) {
      const on = t.dataset.speakingMode === mode;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    }
    _el('interview-room-panel').hidden = !interview;
    _el('interview-room-footer').hidden = !interview;
    _el('topic-section').style.display = interview ? 'none' : '';
    _el('submit-section').style.display = interview ? 'none' : '';
    _el('timer-card').style.display = 'none';
    _el('editor-section').style.display = interview ? 'none' : '';
    _el('results-area').style.display = 'none';
    resetTimer();
    updateWordCount();
  }

  function _resetInterview() {
    _interviewActive = false;
    _interviewTurns = [];
    _queue = [];
    _currentQ = null;
    _turnStartedAt = null;
    _followUpsUsed = 0;
    _turnBusy = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (_isRecording) toggleRecording();
    _el('speaking-input').value = '';
    _baseText = '';
    _el('interview-transcript-log').replaceChildren();
    _el('examiner-feedback-bubble').hidden = true;
    _el('examiner-prompt-card').hidden = true;
    _el('interview-start-card').hidden = false;
    _el('interview-hint').textContent = '';
    _setStepper(1, true);
  }

  function _setStepper(part, reset = false) {
    for (const li of document.querySelectorAll('#interview-stepper .interview-step')) {
      const n = Number(li.dataset.step);
      li.classList.toggle('active', n === part);
      li.classList.toggle('done', !reset && n < part);
    }
  }

  function _buildQueue(topic) {
    const q = [];
    (topic.part1 || []).slice(0, 3).forEach(question => q.push({ part: 1, question }));
    const p2 = topic.part2 || {};
    q.push({ part: 2, question: p2.prompt || 'Describe a memorable experience.', spokenText: `${p2.prompt || ''} You have one minute to prepare, then speak for up to two minutes.`, cue: p2 });
    (topic.part3 || []).slice(0, 3).forEach(question => q.push({ part: 3, question }));
    return q;
  }

  function startInterview() {
    if (!_currentTopic) return;
    _resetInterview();
    _interviewActive = true;
    _queue = _buildQueue(_currentTopic);
    _el('interview-start-card').hidden = true;
    _el('editor-section').style.display = '';
    _showNextQuestion();
  }

  function _showNextQuestion() {
    _currentQ = _queue.shift() || null;
    _el('speaking-input').value = '';
    _baseText = '';
    updateWordCount();
    if (!_currentQ) { _finishedAllParts(); return; }
    _turnStartedAt = Date.now();
    _setStepper(_currentQ.part);
    _el('examiner-prompt-card').hidden = false;
    _el('examiner-part-label').textContent = _currentQ.isFollowUp ? ' · Part 3 — câu hỏi phản biện' : ` · Part ${_currentQ.part}`;
    _el('examiner-question-text').textContent = _currentQ.question;
    const cue = _el('examiner-cue-points');
    cue.hidden = !_currentQ.cue;
    cue.innerHTML = _currentQ.cue
      ? (_currentQ.cue.points || []).map(x => `<li>${_escapeHtml(x)}</li>`).join('') + (_currentQ.cue.closing ? `<li>${_escapeHtml(_currentQ.cue.closing)}</li>` : '')
      : '';
    _appendLog('examiner', _currentQ.part, _currentQ.question);
    const timerCard = _el('timer-card');
    resetTimer();
    timerCard.style.display = _currentQ.part === 2 ? '' : 'none';
    _el('btn-next-turn-text').textContent = 'Ghi nhận câu trả lời & Tiếp tục →';
    _el('interview-hint').textContent = _currentQ.part === 2
      ? 'Bấm "Start 1-min Preparation" (hoặc "Skip to Speaking"), rồi nói/gõ câu trả lời.'
      : 'Ghi âm hoặc gõ câu trả lời, sau đó bấm "Ghi nhận câu trả lời & Tiếp tục".';
    if (_ttsEnabled) _speak(_currentQ.spokenText || _currentQ.question);
  }

  function _appendLog(role, part, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    const meta = document.createElement('span');
    meta.className = 'chat-meta';
    meta.textContent = `${role === 'examiner' ? 'Examiner' : 'Candidate'} · Part ${part}`;
    const body = document.createElement('span');
    body.textContent = text;
    bubble.append(meta, body);
    _el('interview-transcript-log').appendChild(bubble);
  }

  function _interviewTotalWords() {
    return _interviewTurns.reduce((n, t) => n + countWords(t.answer), 0) + countWords(_el('speaking-input').value);
  }

  function _updateInterviewControls() {
    const hasAnswer = countWords(_el('speaking-input').value) > 0;
    _el('btn-next-turn').disabled = !_interviewActive || !_currentQ || !hasAnswer || _turnBusy || _isLoading;
    _el('btn-finish-interview').disabled = !_interviewActive || _interviewTotalWords() < _minWords || _turnBusy || _isLoading;
  }

  function _turnDuration() {
    if (_currentQ?.part === 2 && _durationSeconds()) return _durationSeconds();
    return _turnStartedAt ? Math.max(1, Math.round((Date.now() - _turnStartedAt) / 1000)) : null;
  }

  function _recordCurrentTurn() {
    const answer = _el('speaking-input').value.trim();
    if (!_currentQ || !answer) return null;
    if (_isRecording) toggleRecording();
    const turn = { part: _currentQ.part, question: _currentQ.question, answer, durationSec: _turnDuration() };
    _interviewTurns.push(turn);
    _appendLog('candidate', turn.part, answer);
    return turn;
  }

  async function nextTurn() {
    if (_turnBusy || !_currentQ) return;
    const asked = _currentQ;
    const turn = _recordCurrentTurn();
    if (!turn) { showToast('Hãy trả lời câu hỏi trước khi tiếp tục.', 'error'); return; }
    _el('speaking-input').value = '';
    _baseText = '';
    _el('examiner-feedback-bubble').hidden = true;
    _turnBusy = true;
    _updateInterviewControls();

    let followUp = null;
    if (asked.part !== 2) {
      _el('turn-spinner').style.display = 'inline-block';
      try {
        const turnIndex = _interviewTurns.filter(t => t.part === asked.part).length - 1;
        const res = await fetch('/api/speaking/examiner-turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topicId: _currentTopic?.id, part: asked.part, turnIndex, questionAsked: asked.question, candidateTranscript: turn.answer })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Examiner unavailable.');
        _renderExaminerFeedback(data);
        if (asked.part === 3 && typeof data.followUpQuestionEn === 'string' && data.followUpQuestionEn.trim() && _followUpsUsed < MAX_FOLLOW_UPS) {
          followUp = data.followUpQuestionEn.trim();
        }
      } catch (err) {
        showToast(err.message || 'Giám khảo AI tạm thời không phản hồi — tiếp tục sang câu kế tiếp.', 'error');
      } finally {
        _el('turn-spinner').style.display = 'none';
      }
    }
    if (followUp) {
      _followUpsUsed += 1;
      _queue.unshift({ part: 3, question: followUp, isFollowUp: true });
    }
    _turnBusy = false;
    _showNextQuestion();
  }

  function _renderExaminerFeedback(data) {
    const box = _el('examiner-feedback-bubble');
    box.replaceChildren();
    const add = (cls, text) => { const p = document.createElement('p'); if (cls) p.className = cls; p.textContent = text; box.appendChild(p); };
    if (data.examinerReplyEn) { add('examiner-reply', `“${data.examinerReplyEn}”`); _appendLog('examiner', data.part || (_currentQ?.part ?? 1), data.examinerReplyEn); }
    if (data.coachingTipVi) add('', `💡 ${data.coachingTipVi}`);
    const words = (Array.isArray(data.pronunciationTargets) ? data.pronunciationTargets : []).filter(w => typeof w === 'string' && w.trim());
    if (words.length) {
      const row = document.createElement('div');
      row.className = 'pron-targets';
      const label = document.createElement('span'); label.textContent = 'Luyện phát âm:'; row.appendChild(label);
      words.forEach(w => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pron-word'; b.dataset.word = w; b.textContent = `🔊 ${w}`;
        b.addEventListener('click', () => _speak(w));
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    box.hidden = box.childElementCount === 0;
  }

  function _finishedAllParts() {
    _currentQ = null;
    _setStepper(4);
    _el('examiner-question-text').textContent = 'Thank you. That is the end of the speaking test.';
    _el('examiner-part-label').textContent = '';
    _el('examiner-cue-points').hidden = true;
    _el('timer-card').style.display = 'none';
    _el('editor-section').style.display = 'none';
    _el('interview-hint').textContent = 'Bạn đã hoàn thành cả 3 Part — đang chấm điểm…';
    _updateInterviewControls();
    finishInterview();
  }

  async function finishInterview() {
    if (_isLoading || _turnBusy) return;
    if (_currentQ) _recordCurrentTurn(); // keep the draft answer of the question in progress
    const transcript = _interviewTurns.map(t => t.answer).join('\n\n');
    if (countWords(transcript) < _minWords) { showToast(`Cần tối thiểu ${_minWords} từ để chấm điểm.`, 'error'); return; }
    _el('speaking-input').value = '';
    _setLoading(true);
    try {
      const total = _interviewTurns.reduce((n, t) => n + (Number(t.durationSec) || 0), 0) || null;
      await _scoreAndRender({ transcript, topic: _topicText(), part: INTERVIEW_PART_LABEL, mode: 'interview',
        topicId: _currentTopic?.id || null, interviewTurns: _interviewTurns, durationSeconds: total }, total);
      _el('interview-hint').textContent = 'Đã chấm xong — xem kết quả bên dưới.';
    } catch (err) {
      showToast(err.message || 'Could not score your interview.', 'error');
    } finally {
      _setLoading(false);
    }
  }

  function resetForm() {
    if (_mode === 'interview') { _resetInterview(); _el('editor-section').style.display = 'none'; }
    clearDraft();
    _el('results-area').style.display = 'none';
    changeTopic();
    if (_mode === 'interview') _el('timer-card').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return { init, changeTopic, startPrep, startSpeaking, resetTimer, toggleRecording, handleSubmit, clearDraft, resetForm, updateWordCount, createMistakeUnit,
    renderResults, setMode, startInterview, nextTurn, finishInterview, speakQuestion, toggleTts };
})();

document.addEventListener('DOMContentLoaded', SpeakingApp.init);
