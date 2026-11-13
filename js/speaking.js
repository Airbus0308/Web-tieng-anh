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
  let _minWords = MIN_WORDS_DEFAULT;
  let _isLoading = false;

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
      const res = await fetch('/api/speaking/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, topic: _topicText(), part: 'Part 2 & Part 3', durationSeconds: duration,
          integrity: typeof ExamSecurity !== 'undefined' ? ExamSecurity.snapshot() : null })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scoring failed.');
      _saveLocalAttempt(data, transcript, duration);
      renderResults(data);
      loadHistory();
    } catch (err) {
      showToast(err.message || 'Could not score your response.', 'error');
    } finally {
      _setLoading(false);
    }
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
    const src = data.result || data;
    const band = Number(src.overall_band ?? src.overallBand ?? 0);
    const colorClass = _colorClass(band);
    _el('result-overall-band').textContent = band.toFixed(1);
    const circle = _el('result-band-circle');
    circle.style.borderColor = _colorHex(band);
    _el('result-band-label').textContent = _bandLabel(band);
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

    const suggestions = src.suggestions || [];
    _el('suggestions-list').innerHTML = suggestions.map(s => `<li>${_escapeHtml(s)}</li>`).join('');
    const area = _el('results-area');
    area.dataset.band = colorClass;
    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        result: {
          overall_band: data.overall_band,
          overall_feedback: data.overall_feedback,
          criteria: data.criteria,
          suggestions: data.suggestions
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

  function resetForm() {
    clearDraft();
    _el('results-area').style.display = 'none';
    changeTopic();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return { init, changeTopic, startPrep, startSpeaking, resetTimer, toggleRecording, handleSubmit, clearDraft, resetForm, updateWordCount };
})();

document.addEventListener('DOMContentLoaded', SpeakingApp.init);
