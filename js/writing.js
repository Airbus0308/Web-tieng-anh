/**
 * IELTS Master — Writing Task 2 Practice Module
 * 
 * Manages the Writing Task 2 frontend workflow:
 * - Dynamic topic loading from config.json
 * - Real-time word and character counting with dynamic threshold styling
 * - Submission validation (min 250 words) and API scoring via /api/writing/score
 * - Results rendering: large band score circle, 4 criterion cards (TR, CC, LR, GRA),
 *   suggestions list, and color-coded feedback
 * - History tracking via /api/writing/history with local fallback
 * - Form reset, topic rotation, timer, and toast notifications
 */

const WritingApp = (() => {

  /* ── State ───────────────────────────────────────────── */
  let _topics = [];
  let _currentTopic = null;
  let _isLoading = false;
  let _timerSeconds = 40 * 60; // 40 minutes for Task 2
  let _timerInterval = null;
  let _timerRunning = false;

  /* Default fallback topics in case config.json cannot be fetched */
  const _DEFAULT_TOPICS = [
    {
      id: "wt2-01",
      category: "Education & Technology",
      taskType: "Agree or Disagree",
      prompt: "Some people believe that online education will eventually replace traditional classroom learning in universities. To what extent do you agree or disagree?",
      instructions: "Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words."
    },
    {
      id: "wt2-02",
      category: "Environment & Urban Planning",
      taskType: "Problem and Solution",
      prompt: "Many cities around the world are facing severe traffic congestion and rising air pollution. What are the causes of these problems, and what measures can governments take to resolve them?",
      instructions: "Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words."
    },
    {
      id: "wt2-03",
      category: "Youth & Career",
      taskType: "Discuss Both Views",
      prompt: "Some people think that young people should be encouraged to work or travel for a year before attending university. Others believe it is better to go straight to university. Discuss both views and give your own opinion.",
      instructions: "Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words."
    },
    {
      id: "wt2-04",
      category: "Society & Lifestyle",
      taskType: "Advantages & Disadvantages",
      prompt: "In many modern societies, an increasing number of people are choosing to live alone. What are the advantages and disadvantages of this trend for individuals and society as a whole?",
      instructions: "Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words."
    },
    {
      id: "wt2-05",
      category: "Global Economy & Culture",
      taskType: "Two-Part Question",
      prompt: "Nowadays, international tourism is one of the largest industries globally. Why do so many people travel to other countries, and is this a positive or negative development?",
      instructions: "Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words."
    }
  ];

  const STORAGE_KEY_HISTORY = 'ielts_writing_history';

  /* ── DOM Element Selectors ───────────────────────────── */
  function _el(id) {
    return document.getElementById(id);
  }

  /* ── Helper: Word & Character Counting ───────────────── */
  function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /* ── Helper: Color Coding by Score ───────────────────── */
  /**
   * Official IELTS color coding:
   * 7.0+: Green (--accent-green #34d399)
   * 5.5 - 6.5: Amber (--accent-amber #fbbf24)
   * < 5.5: Red (--accent-red #f87171)
   */
  function _getColorClass(score) {
    const num = parseFloat(score);
    if (num >= 7.0) return 'score-green';
    if (num >= 5.5) return 'score-amber';
    return 'score-red';
  }

  function _getColorHex(score) {
    const num = parseFloat(score);
    if (num >= 7.0) return 'var(--accent-green)';
    if (num >= 5.5) return 'var(--accent-amber)';
    return 'var(--accent-red)';
  }

  function _getColorGlow(score) {
    const num = parseFloat(score);
    if (num >= 7.0) return 'rgba(52, 211, 153, 0.25)';
    if (num >= 5.5) return 'rgba(251, 191, 36, 0.25)';
    return 'rgba(248, 113, 113, 0.25)';
  }

  function _getBandDescriptorLabel(band) {
    const num = parseFloat(band);
    if (num >= 9.0) return 'Expert User';
    if (num >= 8.0) return 'Very Good User';
    if (num >= 7.0) return 'Good User';
    if (num >= 6.0) return 'Competent User';
    if (num >= 5.0) return 'Modest User';
    if (num >= 4.0) return 'Limited User';
    return 'Extremely Limited User';
  }

  /* ── Toast Notifications ─────────────────────────────── */
  function showToast(message, type = 'info') {
    // Remove existing toasts if any
    const existing = document.querySelectorAll('.toast');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  /* ── Feature 1: init() ───────────────────────────────── */
  async function init() {
    console.log('[WritingApp] Initializing Writing Task 2 module...');

    // Load topics from config.json
    await _loadConfig();

    // Display a random topic
    changeTopic();

    // Setup event listeners
    _setupEventListeners();

    // Update word count display
    updateWordCount();

    // Load history
    await loadHistory();

    // Setup 40-minute timer display
    _initTimer();

    console.log('[WritingApp] Initialization complete.');
  }

  /* ── Load config.json ────────────────────────────────── */
  async function _loadConfig() {
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        throw new Error(`Failed to load config.json: ${response.status}`);
      }
      const data = await response.json();

      // Normalize topics structure from config
      if (Array.isArray(data.sampleTopics) && data.sampleTopics.length > 0) {
        _topics = data.sampleTopics;
      } else if (Array.isArray(data.topics) && data.topics.length > 0) {
        _topics = data.topics;
      } else if (data.writing && data.writing.task2 && Array.isArray(data.writing.task2.topics)) {
        _topics = data.writing.task2.topics;
      } else if (Array.isArray(data)) {
        _topics = data;
      } else {
        _topics = _DEFAULT_TOPICS;
      }
      console.log(`[WritingApp] Loaded ${_topics.length} topics from config.json`);
    } catch (err) {
      console.warn('[WritingApp] config.json fetch failed, using built-in topic bank:', err.message);
      _topics = _DEFAULT_TOPICS;
    }
  }

  /* ── Topic Selection ─────────────────────────────────── */
  function changeTopic() {
    if (!_topics || _topics.length === 0) {
      _topics = _DEFAULT_TOPICS;
    }

    // Pick a topic different from current if possible
    let newTopic = _topics[Math.floor(Math.random() * _topics.length)];
    if (_topics.length > 1 && _currentTopic && newTopic.id === _currentTopic.id) {
      const filtered = _topics.filter(t => t.id !== _currentTopic.id);
      newTopic = filtered[Math.floor(Math.random() * filtered.length)];
    }

    _currentTopic = newTopic;
    _renderTopic(_currentTopic);
  }

  function _renderTopic(topic) {
    if (!topic) return;

    const catEl = _el('topic-category');
    const typeEl = _el('topic-type');
    const promptEl = _el('topic-prompt');
    const instEl = _el('topic-instructions-text');

    if (catEl) catEl.textContent = topic.category || 'Writing Task 2';
    if (typeEl) typeEl.textContent = topic.taskType || 'Academic Essay';
    if (promptEl) promptEl.textContent = topic.prompt || 'Prompt unavailable.';
    if (instEl) {
      instEl.textContent = topic.instructions ||
        'Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words.';
    }
  }

  /* ── Event Listeners Setup ───────────────────────────── */
  function _setupEventListeners() {
    const textarea = _el('essay-input');
    if (textarea) {
      textarea.addEventListener('input', () => {
        updateWordCount();
        _startTimerOnTyping();
      });
      textarea.addEventListener('keyup', updateWordCount);
      textarea.addEventListener('paste', () => setTimeout(updateWordCount, 50));
    }

    // Keyboard shortcut: Ctrl + Enter to submit when valid
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const btn = _el('btn-submit-essay');
        if (btn && !btn.disabled && !_isLoading) {
          handleSubmit();
        }
      }
    });
  }

  /* ── Feature 2: updateWordCount() ────────────────────── */
  function updateWordCount() {
    const textarea = _el('essay-input');
    const text = textarea ? textarea.value : '';

    const words = countWords(text);
    const chars = text.length;

    // Update numbers in DOM
    const wordNumEl = _el('word-count-number');
    const charNumEl = _el('char-count-number');
    const badge = _el('word-count-badge');
    const submitBtn = _el('btn-submit-essay');
    const hintText = _el('submit-hint');

    if (wordNumEl) wordNumEl.textContent = words;
    if (charNumEl) charNumEl.textContent = chars.toLocaleString();

    // Check minimum 250 words requirement
    const isRequirementMet = words >= 250;

    if (badge) {
      if (isRequirementMet) {
        // Success: 250+ words (Green)
        badge.classList.remove('warning');
        badge.classList.add('success');
      } else {
        // Warning: Under 250 words (Amber)
        badge.classList.remove('success');
        badge.classList.add('warning');
      }
    }

    if (submitBtn) {
      submitBtn.disabled = !isRequirementMet || _isLoading;
    }

    if (hintText) {
      if (isRequirementMet) {
        hintText.textContent = `Word count requirement met (${words} words). Ready for scoring.`;
        hintText.style.color = 'var(--accent-green)';
      } else {
        const needed = 250 - words;
        hintText.textContent = `Write ${needed} more word${needed === 1 ? '' : 's'} to meet the 250-word minimum requirement.`;
        hintText.style.color = 'var(--text-muted)';
      }
    }
  }

  /* ── Feature 3: handleSubmit() ───────────────────────── */
  async function handleSubmit() {
    if (_isLoading) return;

    const textarea = _el('essay-input');
    const essay = textarea ? textarea.value.trim() : '';
    const wordCount = countWords(essay);

    // 1. Validate word count (minimum 250 words)
    if (wordCount < 250) {
      showToast(`Your essay has ${wordCount} words. You need at least 250 words to submit.`, 'warning');

      // Highlight word count badge
      const badge = _el('word-count-badge');
      if (badge) {
        badge.style.transform = 'scale(1.1)';
        setTimeout(() => { badge.style.transform = 'none'; }, 300);
      }
      if (textarea) textarea.focus();
      return;
    }

    // Confirm submission if needed
    const topicText = _currentTopic ? _currentTopic.prompt : 'IELTS Writing Task 2';

    // 2. Show loading spinner and state
    _setLoading(true);

    try {
      console.log('[WritingApp] Submitting essay for scoring to /api/writing/score...');

      const response = await fetch('/api/writing/score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          essay: essay,
          topic: topicText
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status} (${response.statusText || 'Scoring Error'})`);
      }

      const resultData = await response.json();
      console.log('[WritingApp] Score received from server:', resultData);

      // Render results
      renderResults(resultData);

      // Save to local storage for persistent history display
      _saveLocalAttempt(resultData, essay, topicText);

      // Refresh history sidebar
      await loadHistory();

      showToast('Essay evaluated successfully!', 'success');

    } catch (err) {
      console.error('[WritingApp] Scoring error:', err);
      // Feature 7: Show toast notifications for errors
      showToast(err.message || 'Error communicating with scoring service.', 'error');
    } finally {
      _setLoading(false);
    }
  }

  /* ── Loading State Manager ───────────────────────────── */
  function _setLoading(loading) {
    _isLoading = loading;

    const loader = _el('scoring-loader');
    const submitBtn = _el('btn-submit-essay');
    const btnSpinner = _el('btn-spinner');
    const btnIcon = _el('btn-submit-icon');
    const btnText = _el('btn-submit-text');
    const resultsArea = _el('results-area');

    if (loading) {
      if (loader) loader.style.display = 'flex';
      if (btnSpinner) btnSpinner.style.display = 'inline-block';
      if (btnIcon) btnIcon.style.display = 'none';
      if (btnText) btnText.textContent = 'Analyzing Essay...';
      if (submitBtn) submitBtn.disabled = true;
      if (resultsArea) resultsArea.style.display = 'none';

      // Scroll smoothly to loader
      if (loader) {
        loader.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      if (loader) loader.style.display = 'none';
      if (btnSpinner) btnSpinner.style.display = 'none';
      if (btnIcon) btnIcon.style.display = 'inline-block';
      if (btnText) btnText.textContent = 'Submit for Scoring';
      updateWordCount();
    }
  }

  /* ── Feature 4: renderResults(data) ──────────────────── */
  function renderResults(data) {
    if (!data) return;

    const resultsArea = _el('results-area');
    if (!resultsArea) return;

    // 1. Overall Band Score & Label
    const overallBand = (data.overall_band !== undefined)
      ? Number(data.overall_band).toFixed(1)
      : (data.overallBand !== undefined)
        ? Number(data.overallBand).toFixed(1)
        : (data.band !== undefined ? Number(data.band).toFixed(1) : '6.5');

    const bandNum = parseFloat(overallBand);
    const bandLabel = data.bandLabel || _getBandDescriptorLabel(bandNum);
    const bandColor = _getColorHex(bandNum);
    const bandGlow = _getColorGlow(bandNum);

    const overallBandEl = _el('result-overall-band');
    const overallBandCircle = _el('result-band-circle');
    const bandLabelEl = _el('result-band-label');
    const wordCountEl = _el('result-word-count');
    const timestampEl = _el('result-timestamp');

    if (overallBandEl) overallBandEl.textContent = overallBand;
    if (overallBandCircle) {
      overallBandCircle.style.setProperty('--band-color', bandColor);
      overallBandCircle.style.setProperty('--band-glow', bandGlow);
    }
    if (bandLabelEl) bandLabelEl.textContent = bandLabel;

    const essayWords = data.wordCount || countWords(_el('essay-input') ? _el('essay-input').value : '');
    if (wordCountEl) wordCountEl.textContent = `${essayWords} words`;

    const now = new Date();
    if (timestampEl) {
      timestampEl.textContent = now.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    }

    // 2. Overall Feedback Paragraph
    const feedbackEl = _el('result-overall-feedback');
    const overallFeedback = data.overall_feedback || data.overallFeedback || data.feedback ||
      `Your essay scored an overall Band ${overallBand} (${bandLabel}). It demonstrates a solid grasp of the essay structure with clear points. Review the specific assessment criteria below to identify key areas for band score improvement.`;
    if (feedbackEl) feedbackEl.textContent = overallFeedback;

    // 3. 4 Criterion Cards in 2x2 Grid
    // Standard IELTS Writing Task 2 Criteria: TR, CC, LR, GRA
    const criteriaGrid = _el('criteria-grid');
    if (criteriaGrid) {
      criteriaGrid.innerHTML = '';

      // Normalize criteria from data (supports array or object format)
      const criteriaList = _normalizeCriteria(data);

      criteriaList.forEach(item => {
        const card = _createCriterionCard(item);
        criteriaGrid.appendChild(card);
      });
    }

    // 4. Suggestions List
    const suggestionsList = _el('suggestions-list');
    if (suggestionsList) {
      suggestionsList.innerHTML = '';
      const suggestions = Array.isArray(data.suggestions) && data.suggestions.length > 0
        ? data.suggestions
        : _generateDefaultSuggestions(data);

      suggestions.forEach(suggestion => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.innerHTML = `
          <div class="suggestion-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <span>${_escapeHtml(suggestion)}</span>
        `;
        suggestionsList.appendChild(li);
      });
    }

    // 5. Show results area with smooth fade-in
    resultsArea.style.display = 'flex';
    resultsArea.classList.remove('fade-in');
    void resultsArea.offsetWidth; // Trigger reflow
    resultsArea.classList.add('fade-in');

    // Smooth scroll to top of results
    resultsArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Normalize Criteria Data ─────────────────────────── */
  function _normalizeCriteria(data) {
    const defaultMeta = {
      TR: {
        name: 'Task Response',
        descriptor: 'Addresses all prompt requirements and develops relevant arguments.'
      },
      CC: {
        name: 'Coherence & Cohesion',
        descriptor: 'Logical paragraph structure and effective use of transitional devices.'
      },
      LR: {
        name: 'Lexical Resource',
        descriptor: 'Wide range of vocabulary with accurate academic collocations.'
      },
      GRA: {
        name: 'Grammatical Range & Accuracy',
        descriptor: 'Mix of complex sentences with high grammatical and punctuation precision.'
      }
    };

    if (Array.isArray(data.criteria) && data.criteria.length > 0) {
      return data.criteria.map(c => {
        const abbr = (c.abbreviation || c.abbr || 'CR').toUpperCase();
        const meta = defaultMeta[abbr] || {};
        return {
          abbreviation: abbr,
          name: c.name || meta.name || abbr,
          score: (c.score !== undefined) ? Number(c.score).toFixed(1) : '6.5',
          bandDescriptor: c.band_descriptor || c.bandDescriptor || c.descriptor || meta.descriptor || 'Criterion feedback',
          feedback: c.feedback || 'Good effort demonstrated in this criterion.'
        };
      });
    }

    if (data.criteria && typeof data.criteria === 'object') {
      const keys = ['TR', 'CC', 'LR', 'GRA'];
      return keys.map(k => {
        const c = data.criteria[k] || data.criteria[k.toLowerCase()] || {};
        const meta = defaultMeta[k];
        return {
          abbreviation: k,
          name: c.name || meta.name,
          score: (c.score !== undefined) ? Number(c.score).toFixed(1) : (data.overallBand ? Number(data.overallBand).toFixed(1) : '6.5'),
          bandDescriptor: c.bandDescriptor || c.descriptor || meta.descriptor,
          feedback: c.feedback || `Demonstrates competence in ${meta.name.toLowerCase()} with room for higher band precision.`
        };
      });
    }

    // Default mock criteria if not explicitly provided
    const baseBand = data.overallBand ? parseFloat(data.overallBand) : 6.5;
    return [
      {
        abbreviation: 'TR',
        name: 'Task Response',
        score: baseBand.toFixed(1),
        bandDescriptor: baseBand >= 7 ? 'Good User — Fully addresses all parts of the task' : 'Competent User — Addresses the main parts of the task',
        feedback: 'Your main points directly addressed the prompt. Ensure every body paragraph includes concrete supporting examples to strengthen your thesis.'
      },
      {
        abbreviation: 'CC',
        name: 'Coherence & Cohesion',
        score: (Math.max(5.0, baseBand - 0.5)).toFixed(1),
        bandDescriptor: 'Logical organization with clear paragraphing and cohesive progression',
        feedback: 'Ideas are organized logically into clear paragraphs. Vary cohesive devices (e.g., "Furthermore", "In contrast", "Consequently") to avoid repetition.'
      },
      {
        abbreviation: 'LR',
        name: 'Lexical Resource',
        score: baseBand.toFixed(1),
        bandDescriptor: 'Sufficient range of topic-related vocabulary and academic collocations',
        feedback: 'Good use of topic-specific vocabulary. Try incorporating more academic paraphrasing and less common lexical items with natural collocation.'
      },
      {
        abbreviation: 'GRA',
        name: 'Grammatical Range & Accuracy',
        score: (Math.min(9.0, baseBand + 0.5)).toFixed(1),
        bandDescriptor: 'Mix of simple and complex sentence structures with good accuracy',
        feedback: 'Complex sentence structures are used effectively. Pay close attention to relative clauses, articles, and punctuation in multi-clause sentences.'
      }
    ];
  }

  /* ── Create a Single Criterion Card ─────────────────── */
  function _createCriterionCard(item) {
    const card = document.createElement('div');
    const colorClass = _getColorClass(item.score);
    card.className = `criterion-card ${colorClass}`;

    card.innerHTML = `
      <div class="criterion-header">
        <div class="criterion-title-wrap">
          <div class="criterion-abbr-badge">${_escapeHtml(item.abbreviation)}</div>
          <div>
            <h3 class="criterion-name">${_escapeHtml(item.name)}</h3>
            <span class="criterion-descriptor">${_escapeHtml(item.bandDescriptor)}</span>
          </div>
        </div>
        <div class="criterion-score-badge">
          <span class="criterion-score-num">${item.score}</span>
          <span class="criterion-score-max">/ 9</span>
        </div>
      </div>
      <p class="criterion-feedback">${_escapeHtml(item.feedback)}</p>
    `;

    return card;
  }

  /* ── Generate Default Suggestions ────────────────────── */
  function _generateDefaultSuggestions(data) {
    return [
      "Paraphrase the prompt thoroughly in your opening sentence rather than copying key phrases verbatim.",
      "Ensure each body paragraph contains a single main idea supported by explanation and a real-world example.",
      "Expand your lexical range by using less common academic synonyms and idiomatic collocations.",
      "Reserve 3–5 minutes at the end of writing to proofread for articles, prepositions, and verb tenses."
    ];
  }

  /* ── Feature 5: loadHistory() ────────────────────────── */
  async function loadHistory() {
    let historyList = [];

    // 1. Attempt to fetch from /api/writing/history
    try {
      const response = await fetch('/api/writing/history');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          historyList = data;
        } else if (data.history && Array.isArray(data.history)) {
          historyList = data.history;
        }
      } else {
        throw new Error(`History API responded with ${response.status}`);
      }
    } catch (err) {
      // Fallback to local storage if API is not yet running
      historyList = _getLocalHistory();
    }

    _renderHistoryList(historyList);
  }

  /* ── Render History List in Sidebar ──────────────────── */
  function _renderHistoryList(items) {
    const listEl = _el('history-list');
    const pillEl = _el('history-count-pill');
    if (!listEl) return;

    if (pillEl) pillEl.textContent = items.length;

    if (!items || items.length === 0) {
      listEl.innerHTML = `
        <div class="history-empty-state">
          <div class="history-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </div>
          <p>No past essays yet. Complete your first submission to track your progress and review detailed criterion scores over time.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';

    items.forEach((item, index) => {
      const bandNum = parseFloat(item.overallBand || 6.5);
      const colorClass = _getColorClass(bandNum);

      let formattedDate = 'Recent';
      if (item.timestamp) {
        try {
          formattedDate = new Date(item.timestamp).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short'
          });
        } catch {}
      }

      const card = document.createElement('div');
      card.className = `history-item-card ${colorClass}`;
      card.title = 'Click to review this essay result';

      // Safe topic display
      const promptSnippet = _escapeHtml(item.topic || 'IELTS Writing Task 2 Essay');
      const words = item.wordCount || 250;

      // Extract criterion mini scores if available
      let miniCriteria = '';
      if (Array.isArray(item.criteria)) {
        miniCriteria = item.criteria.map(c => `
          <span class="criteria-mini-tag">${c.abbreviation || 'C'}: ${c.score}</span>
        `).join('');
      }

      card.innerHTML = `
        <div class="history-item-header">
          <span class="history-date">${formattedDate}</span>
          <span class="history-band-pill ${colorClass}">Band ${bandNum.toFixed(1)}</span>
        </div>
        <div class="history-prompt-preview">${promptSnippet}</div>
        <div class="history-item-footer">
          <span>${words} words</span>
          <div class="history-criteria-mini">${miniCriteria}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        renderResults(item);
        showToast(`Loaded review for attempt from ${formattedDate}.`, 'info');
      });

      listEl.appendChild(card);
    });
  }

  /* ── Local History Storage Fallback ──────────────────── */
  function _getLocalHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function _saveLocalAttempt(resultData, essayText, topicText) {
    try {
      const history = _getLocalHistory();
      const attempt = {
        id: 'attempt_' + Date.now(),
        timestamp: new Date().toISOString(),
        topic: topicText,
        essay: essayText,
        overallBand: resultData.overall_band || resultData.overallBand || 6.5,
        bandLabel: resultData.bandLabel || _getBandDescriptorLabel(resultData.overall_band || resultData.overallBand || 6.5),
        criteria: _normalizeCriteria(resultData),
        overallFeedback: resultData.overallFeedback || '',
        suggestions: resultData.suggestions || [],
        wordCount: countWords(essayText)
      };

      // Keep up to 20 past attempts
      history.unshift(attempt);
      if (history.length > 20) history.pop();

      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn('[WritingApp] Failed to save history to localStorage:', e);
    }
  }

  /* ── Feature 6: resetForm() ──────────────────────────── */
  function resetForm() {
    const textarea = _el('essay-input');
    if (textarea) {
      textarea.value = '';
    }

    // Hide results area
    const resultsArea = _el('results-area');
    if (resultsArea) {
      resultsArea.style.display = 'none';
    }

    // Hide loader
    const loader = _el('scoring-loader');
    if (loader) {
      loader.style.display = 'none';
    }

    // Pick a new random topic
    changeTopic();

    // Reset word count & buttons
    updateWordCount();

    // Reset timer
    _resetTimer();

    // Smooth scroll to top of topic card
    const topicSection = _el('topic-section');
    if (topicSection) {
      topicSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showToast('Ready for a fresh practice! New topic loaded.', 'info');
  }

  /* ── Clear Draft ─────────────────────────────────────── */
  function clearDraft() {
    const textarea = _el('essay-input');
    if (!textarea || !textarea.value) return;

    if (textarea.value.length > 30) {
      const confirmed = confirm('Are you sure you want to clear your current essay draft?');
      if (!confirmed) return;
    }

    textarea.value = '';
    updateWordCount();
    showToast('Essay draft cleared.', 'info');
  }

  /* ── Timer Management (40:00 Recommended) ────────────── */
  function _initTimer() {
    _timerSeconds = 40 * 60;
    _updateTimerDisplay();
  }

  function _updateTimerDisplay() {
    const timerDisplay = _el('writing-timer-display');
    if (!timerDisplay) return;

    const m = Math.floor(_timerSeconds / 60).toString().padStart(2, '0');
    const s = (_timerSeconds % 60).toString().padStart(2, '0');
    timerDisplay.textContent = `${m}:${s}`;
  }

  function _startTimerOnTyping() {
    if (_timerRunning) return;
    _timerRunning = true;

    _timerInterval = setInterval(() => {
      if (_timerSeconds > 0) {
        _timerSeconds--;
        _updateTimerDisplay();
      } else {
        clearInterval(_timerInterval);
        _timerRunning = false;
        showToast('40 minutes have passed! Wrap up your final conclusion.', 'warning');
      }
    }, 1000);
  }

  function _resetTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerRunning = false;
    _timerSeconds = 40 * 60;
    _updateTimerDisplay();
  }

  /* ── Helper: HTML Escaping ───────────────────────────── */
  function _escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    init,
    updateWordCount,
    handleSubmit,
    renderResults,
    loadHistory,
    resetForm,
    changeTopic,
    clearDraft,
    showToast,
    // Expose helpers for testing
    countWords,
    getCurrentTopic: () => _currentTopic,
    getTopics: () => _topics
  };

})();

/* ── DOM Ready Bootstrap ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', WritingApp.init);
