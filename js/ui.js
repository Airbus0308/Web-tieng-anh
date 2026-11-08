/**
 * IELTS Placement Test — UI Rendering Module
 * 
 * Handles all DOM manipulation, rendering questions,
 * collecting answers, and displaying results.
 */

const UI = (() => {

  let _startTime = null;
  let _timerInterval = null;

  /* ── Helpers ────────────────────────────────────────── */

  function _el(id) { return document.getElementById(id); }

  function _formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  /* ── Timer ──────────────────────────────────────────── */

  function startTimer() {
    _startTime = Date.now();
    const timerEl = _el('timer-display');
    _timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - _startTime) / 1000);
      timerEl.textContent = _formatTime(elapsed);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(_timerInterval);
    return Math.floor((Date.now() - _startTime) / 1000);
  }

  /* ── Render the Test ────────────────────────────────── */

  function renderTest() {
    const readingPassage = QuestionBank.getReadingPassage();
    const listeningScenario = QuestionBank.getListeningScenario();
    const readingQuestions = QuestionBank.getReadingQuestions();
    const listeningQuestions = QuestionBank.getListeningQuestions();

    const container = _el('test-content');
    container.innerHTML = '';

    // ─── Reading Section ───
    const readingSection = document.createElement('section');
    readingSection.className = 'test-section';
    readingSection.innerHTML = `
      <div class="section-header">
        <div class="section-icon reading-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </div>
        <div>
          <h2 class="section-title">Reading Comprehension</h2>
          <p class="section-subtitle">${readingQuestions.length} questions · Read the passage and answer</p>
        </div>
      </div>
      <div class="passage-card">
        <div class="passage-label">Reading Passage</div>
        <div class="passage-text">${readingPassage.split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
      </div>
      <div class="questions-list" id="reading-questions"></div>
    `;
    container.appendChild(readingSection);

    const readingList = readingSection.querySelector('#reading-questions');
    readingQuestions.forEach((q, i) => {
      readingList.appendChild(_createQuestionCard(q, i + 1));
    });

    // ─── Listening Section ───
    const listeningSection = document.createElement('section');
    listeningSection.className = 'test-section';
    listeningSection.innerHTML = `
      <div class="section-header">
        <div class="section-icon listening-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
        </div>
        <div>
          <h2 class="section-title">Listening Comprehension</h2>
          <p class="section-subtitle">${listeningQuestions.length} questions · Read the transcript and answer</p>
        </div>
      </div>
      <div class="passage-card listening-card">
        <div class="passage-label">Audio Transcript</div>
        <div class="passage-text transcript-text">${listeningScenario.split('\n\n').map(p => {
          // Highlight speaker names
          return `<p>${p.replace(/(Dr\. Patel|Sarah):/g, '<strong class="speaker">$1:</strong>')}</p>`;
        }).join('')}</div>
      </div>
      <div class="questions-list" id="listening-questions"></div>
    `;
    container.appendChild(listeningSection);

    const listeningList = listeningSection.querySelector('#listening-questions');
    listeningQuestions.forEach((q, i) => {
      listeningList.appendChild(_createQuestionCard(q, readingQuestions.length + i + 1));
    });

    // ─── Submit Button ───
    const submitArea = document.createElement('div');
    submitArea.className = 'submit-area';
    submitArea.innerHTML = `
      <div class="submit-info">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span>Ensure all questions are answered before submitting</span>
      </div>
      <button id="submit-btn" class="btn-submit" onclick="App.handleSubmit()">
        <span>Submit Test</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      </button>
    `;
    container.appendChild(submitArea);

    // Update progress
    _updateProgress();
  }

  /* ── Create a single question card ──────────────────── */

  function _createQuestionCard(question, number) {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `question-${question.id}`;
    card.setAttribute('data-question-id', question.id);

    const difficultyClass = question.difficulty.toLowerCase().replace(/[^a-z0-9]/g, '');

    card.innerHTML = `
      <div class="question-header">
        <span class="question-number">Q${number}</span>
        <span class="question-difficulty diff-${difficultyClass}">${question.difficulty}</span>
      </div>
      <p class="question-text">${question.text}</p>
      <div class="options-list">
        ${question.options.map((opt, i) => `
          <label class="option-label" id="option-${question.id}-${i}">
            <input type="radio" name="q-${question.id}" value="${i}"
                   onchange="UI.onAnswerSelect('${question.id}', ${i})">
            <span class="option-radio"></span>
            <span class="option-text">${opt}</span>
          </label>
        `).join('')}
      </div>
    `;

    return card;
  }

  /* ── Answer Selection Handler ───────────────────────── */

  function onAnswerSelect(questionId, optionIndex) {
    // Mark question card as answered
    const card = _el(`question-${questionId}`);
    if (card) card.classList.add('answered');

    _updateProgress();
  }

  /* ── Progress Tracker ───────────────────────────────── */

  function _updateProgress() {
    const total = QuestionBank.getTotalCount();
    const answered = document.querySelectorAll('.question-card.answered').length;
    const pct = Math.round((answered / total) * 100);

    _el('progress-fill').style.width = pct + '%';
    _el('progress-text').textContent = `${answered} / ${total} answered`;

    // Enable/disable submit button
    const btn = _el('submit-btn');
    if (btn) {
      btn.disabled = answered < total;
      btn.classList.toggle('btn-ready', answered === total);
    }
  }

  /* ── Collect Answers ────────────────────────────────── */

  function collectAnswers() {
    const answers = {};
    const questions = QuestionBank.getAllQuestions();

    questions.forEach(q => {
      const selected = document.querySelector(`input[name="q-${q.id}"]:checked`);
      if (selected) {
        answers[q.id] = parseInt(selected.value, 10);
      }
    });

    return answers;
  }

  /* ── Show Unanswered Warning ────────────────────────── */

  function highlightUnanswered() {
    const questions = QuestionBank.getAllQuestions();
    let firstUnanswered = null;

    questions.forEach(q => {
      const card = _el(`question-${q.id}`);
      const selected = document.querySelector(`input[name="q-${q.id}"]:checked`);
      if (!selected) {
        card.classList.add('unanswered-shake');
        setTimeout(() => card.classList.remove('unanswered-shake'), 800);
        if (!firstUnanswered) firstUnanswered = card;
      }
    });

    if (firstUnanswered) {
      firstUnanswered.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ── Render Results ─────────────────────────────────── */

  function renderResults(result) {
    const container = _el('test-content');
    const s = result.score;
    const rb = result.sectionBreakdown;
    const recommendation = ScoringEngine.getRecommendation(result.estimatedBand);

    // Band color
    const bandNum = parseFloat(result.estimatedBand);
    let bandColor = 'var(--accent-red)';
    if (bandNum >= 7) bandColor = 'var(--accent-green)';
    else if (bandNum >= 5.5) bandColor = 'var(--accent-amber)';
    else if (bandNum >= 4) bandColor = 'var(--accent-orange)';

    container.innerHTML = `
      <div class="results-container fade-in">

        <!-- Hero Score Card -->
        <div class="result-hero">
          <div class="result-hero-bg"></div>
          <div class="result-hero-content">
            <p class="result-label">Your Estimated IELTS Band</p>
            <div class="result-band" style="--band-color: ${bandColor}">
              <span class="band-number">${result.estimatedBand}</span>
            </div>
            <p class="result-band-label">${result.bandLabel}</p>
            <p class="result-cefr">CEFR Level: <strong>${result.cefr}</strong></p>
          </div>
        </div>

        <!-- Score Summary -->
        <div class="result-grid">
          <div class="result-stat-card">
            <div class="stat-icon correct-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div class="stat-value">${s.correct}<span class="stat-total">/${s.total}</span></div>
            <div class="stat-label">Correct Answers</div>
          </div>
          <div class="result-stat-card">
            <div class="stat-icon pct-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="5" x2="5" y2="19"/>
                <circle cx="6.5" cy="6.5" r="2.5"/>
                <circle cx="17.5" cy="17.5" r="2.5"/>
              </svg>
            </div>
            <div class="stat-value">${s.percentage}<span class="stat-unit">%</span></div>
            <div class="stat-label">Overall Score</div>
          </div>
          <div class="result-stat-card">
            <div class="stat-icon time-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="stat-value">${_formatTime(result.timeSpentSeconds)}</div>
            <div class="stat-label">Time Taken</div>
          </div>
        </div>

        <!-- Section Breakdown -->
        <div class="breakdown-card">
          <h3 class="breakdown-title">Section Breakdown</h3>
          <div class="breakdown-bars">
            <div class="breakdown-row">
              <div class="breakdown-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
                Reading
              </div>
              <div class="bar-track">
                <div class="bar-fill reading-fill" style="width: ${rb.reading.percentage}%"></div>
              </div>
              <span class="bar-value">${rb.reading.correct}/${rb.reading.total} (${rb.reading.percentage}%)</span>
            </div>
            <div class="breakdown-row">
              <div class="breakdown-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                </svg>
                Listening
              </div>
              <div class="bar-track">
                <div class="bar-fill listening-fill" style="width: ${rb.listening.percentage}%"></div>
              </div>
              <span class="bar-value">${rb.listening.correct}/${rb.listening.total} (${rb.listening.percentage}%)</span>
            </div>
          </div>
        </div>

        <!-- Recommendation -->
        <div class="recommendation-card">
          <div class="rec-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </div>
          <div>
            <h4 class="rec-title">Study Recommendation</h4>
            <p class="rec-text">${recommendation}</p>
          </div>
        </div>

        <!-- Answer Review -->
        <details class="review-section">
          <summary class="review-toggle">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            Review Your Answers
          </summary>
          <div class="review-list">
            ${_renderReviewItems(result)}
          </div>
        </details>

        <!-- Actions -->
        <div class="result-actions">
          <button class="btn-secondary" onclick="App.retakeTest()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Retake Test
          </button>
          <button class="btn-primary" onclick="App.exportResults()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Results
          </button>
        </div>

        <!-- Database confirmation -->
        <div class="db-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Result saved to database · Attempt #${MockDatabase.getAttemptCount()}
        </div>
      </div>
    `;

    // Animate bars after render
    requestAnimationFrame(() => {
      container.querySelectorAll('.bar-fill').forEach(bar => {
        bar.style.transition = 'width 1s cubic-bezier(0.4, 0, 0.2, 1) 0.3s';
      });
    });
  }

  /* ── Review Items ───────────────────────────────────── */

  function _renderReviewItems(result) {
    const questions = QuestionBank.getAllQuestions();
    return result.questionResults.map((qr, i) => {
      const q = questions.find(x => x.id === qr.id);
      const icon = qr.correct
        ? '<svg class="review-icon correct" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg class="review-icon wrong" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

      return `
        <div class="review-item ${qr.correct ? 'review-correct' : 'review-wrong'}">
          <div class="review-q-header">
            ${icon}
            <span class="review-q-num">Q${i + 1}</span>
            <span class="review-q-section">${qr.section}</span>
          </div>
          <p class="review-q-text">${q.text}</p>
          ${!qr.correct ? `
            <div class="review-answer">
              <span class="your-answer">Your answer: <strong>${q.options[qr.userAnswer] || 'Not answered'}</strong></span>
              <span class="correct-answer">Correct: <strong>${q.options[qr.correctAnswer]}</strong></span>
            </div>
          ` : ''}
          <p class="review-explanation">${q.explanation}</p>
        </div>
      `;
    }).join('');
  }

  /* ── Toast Notification ─────────────────────────────── */

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* ── Public API ─────────────────────────────────────── */

  return {
    renderTest,
    renderResults,
    collectAnswers,
    highlightUnanswered,
    onAnswerSelect,
    startTimer,
    stopTimer,
    showToast
  };

})();
