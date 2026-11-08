/**
 * IELTS Placement Test — Application Controller
 * 
 * Orchestrates modules: QuestionBank, ScoringEngine, MockDatabase, UI.
 * Handles the test lifecycle: start → answer → submit → score → save.
 */

const App = (() => {

  let _currentState = 'intro'; // 'intro' | 'testing' | 'results'

  /* ── Initialize ─────────────────────────────────────── */

  function init() {
    console.log('[App] IELTS Placement Test initialized.');
    _showIntro();
  }

  /* ── Show Intro Screen ──────────────────────────────── */

  function _showIntro() {
    _currentState = 'intro';
    const content = document.getElementById('test-content');
    content.innerHTML = `
      <div class="intro-container fade-in">
        <div class="intro-badge">Placement Test</div>
        <h2 class="intro-title">Assess Your English Proficiency</h2>
        <p class="intro-desc">
          This placement test contains <strong>15 questions</strong> across Reading and Listening sections.
          Your results will help us create a personalized study plan tailored to your current level.
        </p>

        <div class="intro-features">
          <div class="intro-feature">
            <div class="feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
            </div>
            <div>
              <strong>8 Reading Questions</strong>
              <span>Passage comprehension & vocabulary</span>
            </div>
          </div>
          <div class="intro-feature">
            <div class="feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
            </div>
            <div>
              <strong>7 Listening Questions</strong>
              <span>Transcript analysis & detail recognition</span>
            </div>
          </div>
          <div class="intro-feature">
            <div class="feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <strong>~15 Minutes</strong>
              <span>Estimated completion time</span>
            </div>
          </div>
        </div>

        <button class="btn-start" onclick="App.startTest()">
          <span>Begin Test</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>

        ${_renderPastAttempts()}
      </div>
    `;
  }

  /* ── Past Attempts Banner ───────────────────────────── */

  function _renderPastAttempts() {
    const count = MockDatabase.getAttemptCount();
    if (count === 0) return '';

    const latest = MockDatabase.getLatestResult();
    const date = new Date(latest.timestamp).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });

    return `
      <div class="past-attempts">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>Last attempt: Band ${latest.estimatedBand} on ${date} · ${count} total attempt${count > 1 ? 's' : ''}</span>
      </div>
    `;
  }

  /* ── Start Test ─────────────────────────────────────── */

  function startTest() {
    _currentState = 'testing';

    // Show progress bar area
    document.getElementById('progress-bar').classList.add('visible');
    document.getElementById('timer-area').classList.add('visible');

    UI.renderTest();
    UI.startTimer();

    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Handle Submit ──────────────────────────────────── */

  function handleSubmit() {
    const answers = UI.collectAnswers();
    const totalQuestions = QuestionBank.getTotalCount();

    // Check if all questions are answered
    if (Object.keys(answers).length < totalQuestions) {
      UI.highlightUnanswered();
      UI.showToast('Please answer all questions before submitting.', 'warning');
      return;
    }

    // Confirm submission
    const confirmed = confirm('Are you sure you want to submit your test? You cannot change your answers after submission.');
    if (!confirmed) return;

    // Stop timer
    const timeSpent = UI.stopTimer();

    // Score the test
    const questions = QuestionBank.getAllQuestions();
    const result = ScoringEngine.evaluate(answers, questions);
    result.timeSpentSeconds = timeSpent;

    // Save to mock database
    const record = MockDatabase.saveResult(result);
    console.log('[App] Test scored and saved:', record);

    // Update state & render results
    _currentState = 'results';
    document.getElementById('progress-bar').classList.remove('visible');
    document.getElementById('timer-area').classList.remove('visible');

    UI.renderResults(result);
    UI.showToast('Test submitted successfully!', 'success');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Retake Test ────────────────────────────────────── */

  function retakeTest() {
    _showIntro();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Export Results ─────────────────────────────────── */

  function exportResults() {
    const json = MockDatabase.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ielts-placement-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.showToast('Results exported as JSON.', 'success');
  }

  /* ── Public API ─────────────────────────────────────── */

  return {
    init,
    startTest,
    handleSubmit,
    retakeTest,
    exportResults,
    getState: () => _currentState
  };

})();

/* ── Bootstrap ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', App.init);
