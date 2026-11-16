/**
 * IELTS Master — Writing Practice Module (Task 2 Essay + Phase 10B Task 1 Academic / General)
 *
 * Phase 10B: 3 practice modes (#writing-task-tabs) with their own timer, word minimum, topic and
 * draft; renderTask1Visual() draws bar / line / pie charts as SVG, data tables, process diagrams and
 * letter briefs from config.sampleTask1Topics; #writing-overall-banner shows
 * roundToHalf((Task 1 + 2 × Task 2) / 3) from GET /api/writing/summary (local fallback).
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
  let _lastResult = null; // last rendered score, used by "Learn From My Mistakes"
  let _isLoading = false;
  let _timerSeconds = 40 * 60; // 40 minutes for Task 2
  let _timerInterval = null;
  let _timerRunning = false;

  /* Phase 10B: practice modes. Each keeps its own topic, draft and remaining time. */
  const MODES = {
    'task2': {
      taskNumber: 2, subType: 'essay', minWords: 250, minutes: 40,
      badge: 'Writing Task 2', title: 'Task 2 Essay Practice & Scoring',
      desc: 'Practice IELTS Writing Task 2 prompts under realistic exam conditions. Get real-time word counting and detailed AI scoring across all 4 official assessment criteria.',
      editor: 'Your Essay Response',
      placeholder: 'Write your essay here...\n\nRecommended Essay Structure:\n• Introduction: Paraphrase the prompt & state your clear thesis statement\n• Body Paragraph 1: First main idea, supported by detailed explanation and relevant examples\n• Body Paragraph 2: Second main idea or counter-perspective with supporting evidence\n• Conclusion: Summarize the main points and restate your final position\n\nAim for 250 - 320 words. Remember to check your spelling, punctuation, and paragraph transitions.',
      loader: 'Analyzing your essay against official IELTS Task 2 criteria: Task Response, Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy...',
      guide: ['TR — Task Response (25%)', 'Address all prompt parts, develop supported arguments, and state a clear position throughout.'],
      strategy: ['40-Minute Strategy',
        ['00–05 min: Planning', 'Analyze the prompt, identify keywords, and outline 2 main arguments.'],
        ['05–35 min: Writing', 'Write intro, 2 body paragraphs, and conclusion (approx. 270 words).'],
        ['35–40 min: Proofreading', 'Review spelling, subject-verb agreement, and cohesive transition words.']]
    },
    'task1-academic': {
      taskNumber: 1, subType: 'academic', minWords: 150, minutes: 20,
      badge: 'Writing Task 1 · Academic', title: 'Task 1 Academic Report Practice & Scoring',
      desc: 'Describe a chart, table or process diagram in at least 150 words. Select the main features, write a clear overview, and support comparisons with accurate figures.',
      editor: 'Your Report',
      placeholder: 'Write your report here...\n\nRecommended Structure:\n• Introduction: Paraphrase what the visual shows (what, where, when)\n• Overview: 1–2 sentences on the main trends or biggest differences — no numbers needed\n• Body Paragraph 1: Key features with accurate figures and comparisons\n• Body Paragraph 2: Remaining key features with figures\n\nAim for 160 - 190 words. Do not give personal opinions.',
      loader: 'Analyzing your report against official IELTS Task 1 criteria: Task Achievement (overview & accurate data), Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy...',
      guide: ['TA — Task Achievement (25%)', 'Give a clear overview of the main trends, select key features, and report figures accurately with comparisons. No personal opinion.'],
      strategy: ['20-Minute Strategy',
        ['00–03 min: Analyse', 'Read the visual: units, time period, highest/lowest values and the overall trend.'],
        ['03–17 min: Writing', 'Introduction, overview, then 2 body paragraphs grouping the key features (approx. 170 words).'],
        ['17–20 min: Checking', 'Check figures against the visual, tenses, and comparison language (respectively, whereas).']]
    },
    'task1-general': {
      taskNumber: 1, subType: 'general', minWords: 150, minutes: 20,
      badge: 'Writing Task 1 · General Training', title: 'Task 1 Letter Practice & Scoring',
      desc: 'Write a letter of at least 150 words for an everyday situation. Cover all three bullet points and keep the tone consistent with the reader.',
      editor: 'Your Letter',
      placeholder: 'Write your letter here...\n\nRecommended Structure:\n• Greeting: Dear Sir or Madam, / Dear Mr Smith, / Dear Anna,\n• Opening: State why you are writing\n• Paragraphs 2–4: One paragraph for each bullet point\n• Closing line + sign-off (Yours faithfully / Yours sincerely / Best wishes)\n\nAim for 160 - 190 words with a consistent tone.',
      loader: 'Analyzing your letter against official IELTS Task 1 criteria: Task Achievement (purpose, bullet points & tone), Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy...',
      guide: ['TA — Task Achievement (25%)', 'Make the purpose clear, fully cover all three bullet points, and keep the tone (formal / semi-formal / informal) consistent.'],
      strategy: ['20-Minute Strategy',
        ['00–03 min: Planning', 'Identify the reader, the tone and one idea for each bullet point.'],
        ['03–17 min: Writing', 'Greeting, purpose, one paragraph per bullet point, closing (approx. 170 words).'],
        ['17–20 min: Checking', 'Check the tone, the sign-off, spelling and punctuation.']]
    }
  };
  const MODE_KEYS = Object.keys(MODES);
  let _mode = 'task2';
  let _task1Topics = [];
  const _modeState = Object.fromEntries(MODE_KEYS.map(k => [k, { topic: null, draft: '', seconds: null }]));
  const _modeCfg = () => MODES[_mode];
  const _minWords = () => _modeCfg().minWords;
  const _isTask1 = () => _modeCfg().taskNumber === 1;

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

    // Phase 10B: mode tabs (deep link: writing.html#task1-academic) + Overall Writing banner
    _setupTaskTabs();
    const hashMode = location.hash.slice(1);
    if (hashMode !== 'task2' && MODES[hashMode]) setTaskMode(hashMode);
    loadWritingSummary();

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
      _task1Topics = Array.isArray(data.sampleTask1Topics) ? data.sampleTask1Topics.filter(t => t && t.id && t.prompt) : [];
      const t1Min = Number(data.task1WordCountRequirements?.min);
      if (t1Min > 0) { MODES['task1-academic'].minWords = t1Min; MODES['task1-general'].minWords = t1Min; }
      const t1Minutes = Number(data.task1WordCountRequirements?.timeMinutes);
      if (t1Minutes > 0) { MODES['task1-academic'].minutes = t1Minutes; MODES['task1-general'].minutes = t1Minutes; }
      console.log(`[WritingApp] Loaded ${_topics.length} topics from config.json`);
    } catch (err) {
      console.warn('[WritingApp] config.json fetch failed, using built-in topic bank:', err.message);
      _topics = _DEFAULT_TOPICS;
    }
  }

  /* ── Topic Selection ─────────────────────────────────── */
  /** Topics for the active mode: Task 2 essays, Task 1 Academic visuals or Task 1 General letters. */
  function _topicPool() {
    if (!_isTask1()) {
      if (!_topics || _topics.length === 0) _topics = _DEFAULT_TOPICS;
      return _topics;
    }
    return _task1Topics.filter(t => (t.subType === 'general') === (_mode === 'task1-general'));
  }

  function changeTopic() {
    const pool = _topicPool();
    if (!pool.length) { _currentTopic = null; _renderTopic(null); return; }

    // Pick a topic different from current if possible
    let newTopic = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && _currentTopic && newTopic.id === _currentTopic.id) {
      const filtered = pool.filter(t => t.id !== _currentTopic.id);
      newTopic = filtered[Math.floor(Math.random() * filtered.length)];
    }

    _selectTopic(newTopic);
  }

  function _selectTopic(topic) {
    _currentTopic = topic;
    _modeState[_mode].topic = topic;
    _renderTopic(topic);
  }

  function _renderTopic(topic) {
    _renderTask1Filter();
    const visual = _el('task1-visual-container');
    if (!topic) {
      if (_el('topic-prompt')) _el('topic-prompt').textContent = 'Task 1 topics could not be loaded. Please refresh the page or try Task 2.';
      if (_el('topic-instructions-text')) _el('topic-instructions-text').textContent = '';
      if (visual) { visual.hidden = true; visual.replaceChildren(); }
      return;
    }
    if (visual) {
      visual.hidden = !_isTask1();
      if (_isTask1()) renderTask1Visual(topic); else visual.replaceChildren();
    }

    const catEl = _el('topic-category');
    const typeEl = _el('topic-type');
    const promptEl = _el('topic-prompt');
    const instEl = _el('topic-instructions-text');

    if (catEl) catEl.textContent = topic.category || (_isTask1() ? 'Writing Task 1' : 'Writing Task 2');
    if (typeEl) typeEl.textContent = topic.taskType || (_isTask1() ? 'Task 1' : 'Academic Essay');
    if (promptEl) promptEl.textContent = topic.prompt || 'Prompt unavailable.';
    if (instEl) {
      instEl.textContent = topic.instructions || (_isTask1()
        ? `Write at least ${_minWords()} words.`
        : 'Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words.');
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

    // Check the minimum for the active mode (Task 2: 250 words, Task 1: 150 words)
    const minWords = _minWords();
    const isRequirementMet = words >= minWords && Boolean(_currentTopic);

    if (badge) {
      if (isRequirementMet) {
        // Success: minimum reached (Green)
        badge.classList.remove('warning');
        badge.classList.add('success');
      } else {
        // Warning: under the minimum (Amber)
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
      } else if (words >= minWords) {
        hintText.textContent = 'No topic is loaded for this task type yet.';
        hintText.style.color = 'var(--text-muted)';
      } else {
        const needed = minWords - words;
        hintText.textContent = `Write ${needed} more word${needed === 1 ? '' : 's'} to meet the ${minWords}-word minimum requirement.`;
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

    // 1. Validate word count (Task 2: 250 words, Task 1: 150 words)
    const minWords = _minWords();
    if (wordCount < minWords) {
      showToast(`Your response has ${wordCount} words. You need at least ${minWords} words to submit.`, 'warning');

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
    const mode = _modeCfg();
    const submittedTopic = _currentTopic;

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
          topic: topicText,
          ...(mode.taskNumber === 1 ? {
            taskNumber: 1,
            subType: mode.subType,
            topicId: submittedTopic?.id || null,
            visualSummary: _visualSummary(submittedTopic)
          } : {}),
          integrity: typeof ExamSecurity !== 'undefined' ? ExamSecurity.snapshot() : null
        })
      });

      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch {}
        throw new Error(detail || `Server returned ${response.status} (${response.statusText || 'Scoring Error'})`);
      }

      const resultData = await response.json();
      console.log('[WritingApp] Score received from server:', resultData);
      const scored = {
        ...resultData,
        topic: resultData.topic || topicText,
        taskNumber: resultData.taskNumber || mode.taskNumber,
        subType: resultData.subType || mode.subType,
        topicId: resultData.topicId || submittedTopic?.id || null,
        taskType: submittedTopic?.taskType || ''
      };

      // Render results
      renderResults(scored);

      // Save to local storage for persistent history display
      _saveLocalAttempt(scored, essay, topicText);

      // Refresh history sidebar + Overall Writing banner
      await loadHistory();
      if (resultData.writingBandSummary) renderWritingSummary(resultData.writingBandSummary);
      else loadWritingSummary();

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
    _lastResult = data;

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

    // 1b. Phase 10B: task badge + Task 1 Academic overview flag
    const taskChip = _el('result-task-chip');
    if (taskChip) taskChip.textContent = _taskLabel(data);
    const overviewChip = _el('result-overview-chip');
    if (overviewChip) {
      const hasFlag = typeof data.has_clear_overview === 'boolean';
      overviewChip.hidden = !hasFlag;
      overviewChip.classList.toggle('is-ok', data.has_clear_overview === true);
      overviewChip.classList.toggle('is-missing', data.has_clear_overview === false);
      overviewChip.textContent = data.has_clear_overview ? '✓ Có Overview rõ ràng' : '⚠️ Cần bổ sung đoạn Overview';
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

    // 4. Exact phrase corrections returned by Gemini (older results may omit them).
    const correctionsSection = _el('inline-corrections');
    const correctionsList = _el('inline-corrections-list');
    if (correctionsSection && correctionsList) {
      correctionsList.replaceChildren();
      const corrections = Array.isArray(data.inline_corrections) ? data.inline_corrections : [];
      corrections.forEach(item => {
        if (!item || typeof item.original !== 'string' || !item.original.trim() ||
            typeof item.correction !== 'string' || !item.correction.trim()) return;
        const card = document.createElement('div');
        card.className = 'inline-correction-item';
        const pair = document.createElement('div');
        pair.className = 'inline-correction-pair';
        for (const [tag, className, value] of [
          ['del', 'inline-correction-original', item.original],
          ['span', 'inline-correction-arrow', '→'],
          ['ins', 'inline-correction-revised', item.correction]
        ]) {
          const element = document.createElement(tag);
          element.className = className;
          element.textContent = value;
          pair.appendChild(element);
        }
        card.appendChild(pair);
        if (typeof item.explanation === 'string' && item.explanation.trim()) {
          const explanation = document.createElement('p');
          explanation.className = 'inline-correction-explanation';
          explanation.textContent = item.explanation;
          card.appendChild(explanation);
        }
        correctionsList.appendChild(card);
      });
      correctionsSection.hidden = correctionsList.childElementCount === 0;
    }

    // 5. Suggestions List
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

    // 6. Show results area with smooth fade-in
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
      TA: {
        name: 'Task Achievement',
        descriptor: 'Overview & accurate key data, or all bullet points & tone.'
      },
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

    // Newest first (the API appends records in submission order).
    items = [...items].sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));

    items.forEach((item, index) => {
      const savedResult = item.result || item;
      const bandNum = parseFloat(savedResult.overall_band ?? savedResult.overallBand ?? 6.5);
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
      const promptSnippet = _escapeHtml(item.topic || 'IELTS Writing Essay');
      const words = item.wordCount || 250;

      // Extract criterion mini scores if available
      let miniCriteria = '';
      if (Array.isArray(savedResult.criteria)) {
        miniCriteria = savedResult.criteria.map(c => `
          <span class="criteria-mini-tag">${_escapeHtml(c.abbreviation || 'C')}: ${_escapeHtml(String(c.score))}</span>
        `).join('');
      }

      const taskLabel = _taskLabel(item);
      card.innerHTML = `
        <div class="history-item-header">
          <span class="history-date">${formattedDate}<span class="history-task-badge ${Number(item.taskNumber) === 1 ? 'is-task1' : 'is-task2'}">[${_escapeHtml(taskLabel)}]</span></span>
          <span class="history-band-pill ${colorClass}">Band ${bandNum.toFixed(1)}</span>
        </div>
        <div class="history-prompt-preview">${promptSnippet}</div>
        <div class="history-item-footer">
          <span>${words} words</span>
          <div class="history-criteria-mini">${miniCriteria}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        renderResults({ ...savedResult, id: savedResult.id || item.id, topic: item.topic, timestamp: item.timestamp, wordCount: item.wordCount,
          taskNumber: item.taskNumber, subType: item.subType, topicId: item.topicId, taskType: item.taskType });
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
        overallFeedback: resultData.overall_feedback || resultData.overallFeedback || '',
        suggestions: resultData.suggestions || [],
        inline_corrections: Array.isArray(resultData.inline_corrections) ? resultData.inline_corrections : [],
        wordCount: countWords(essayText),
        taskNumber: Number(resultData.taskNumber) === 1 ? 1 : 2,
        subType: resultData.subType || 'essay',
        topicId: resultData.topicId || null,
        taskType: resultData.taskType || '',
        ...(typeof resultData.has_clear_overview === 'boolean' ? { has_clear_overview: resultData.has_clear_overview } : {})
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

    // Pick a new random topic (within the active task mode)
    _modeState[_mode].draft = '';
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
    _modeState[_mode].draft = '';
    updateWordCount();
    showToast('Draft cleared.', 'info');
  }

  /* ── Timer Management (40:00 Recommended) ────────────── */
  function _initTimer() {
    _timerSeconds = _modeCfg().minutes * 60;
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
        showToast(`${_modeCfg().minutes} minutes have passed! Wrap up your final paragraph.`, 'warning');
      }
    }, 1000);
  }

  function _resetTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerRunning = false;
    _timerSeconds = _modeCfg().minutes * 60;
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

  /* ══ Phase 10B: Task modes, Task 1 visuals & Overall Writing Band ═══════ */

  function _setText(id, text) { const el = _el(id); if (el) el.textContent = text; }
  const _modeOf = rec => Number(rec?.taskNumber) === 1
    ? (rec?.subType === 'general' ? 'task1-general' : 'task1-academic')
    : 'task2';

  /** "Task 1 · Bar Chart" / "Task 2 · Essay" for results and history (old records count as Task 2). */
  function _taskLabel(rec) {
    if (Number(rec?.taskNumber) !== 1) return 'Task 2 · Essay';
    const topic = _task1Topics.find(t => t.id === rec.topicId);
    return `Task 1 · ${rec.taskType || topic?.taskType || (rec.subType === 'general' ? 'Letter' : 'Academic')}`;
  }

  function _setupTaskTabs() {
    const tabs = [...document.querySelectorAll('#writing-task-tabs [data-task-mode]')];
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => setTaskMode(tab.dataset.taskMode));
      tab.addEventListener('keydown', e => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const target = tabs[(next + tabs.length) % tabs.length];
        setTaskMode(target.dataset.taskMode);
        target.focus();
      });
    });
    _el('task1-visual-filter')?.addEventListener('click', e => {
      const chip = e.target.closest('[data-topic-id]');
      const topic = chip && _topicPool().find(t => t.id === chip.dataset.topicId);
      if (topic && topic !== _currentTopic) { _selectTopic(topic); updateWordCount(); }
    });
    _el('wob-cta')?.addEventListener('click', e => {
      const mode = e.currentTarget.dataset.targetMode;
      if (!MODES[mode]) return;
      setTaskMode(mode);
      _el('writing-task-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      _el(mode === 'task2' ? 'tab-task2' : `tab-${mode}`)?.focus({ preventScroll: true });
    });
  }

  /**
   * Switch between Task 2 / Task 1 Academic / Task 1 General. The draft, topic and remaining time
   * of the mode being left are kept in memory so learners can compare tasks without losing text.
   */
  function setTaskMode(mode) {
    if (!MODES[mode]) return;
    const textarea = _el('essay-input');
    if (mode !== _mode) {
      if (textarea) _modeState[_mode].draft = textarea.value;
      if (_timerInterval) clearInterval(_timerInterval);
      _timerRunning = false;
      _modeState[_mode].seconds = _timerSeconds;
      _mode = mode;
    }
    const cfg = _modeCfg();

    document.querySelectorAll('#writing-task-tabs [data-task-mode]').forEach(tab => {
      const on = tab.dataset.taskMode === mode;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) _el('topic-section')?.setAttribute('aria-labelledby', tab.id);
    });

    _setText('writing-mode-badge', cfg.badge);
    _setText('writing-time-chip', `${cfg.minutes} Minutes`);
    _setText('writing-words-chip', `Min ${cfg.minWords} Words`);
    _setText('writing-page-title', cfg.title);
    _setText('writing-page-desc', cfg.desc);
    _setText('editor-title', cfg.editor);
    _setText('char-limit-text', `Minimum ${cfg.minWords} words`);
    _setText('word-count-min', String(cfg.minWords));
    _setText('loader-subtitle', cfg.loader);
    _setText('guide-first-title', cfg.guide[0]);
    _setText('guide-first-desc', cfg.guide[1]);
    _setText('strategy-title', cfg.strategy[0]);
    for (let i = 1; i <= 3; i++) {
      _setText(`strategy-${i}-title`, cfg.strategy[i][0]);
      _setText(`strategy-${i}-desc`, cfg.strategy[i][1]);
    }
    _el('writing-timer')?.setAttribute('title', `Recommended time for Writing ${cfg.taskNumber === 1 ? 'Task 1' : 'Task 2'} is ${cfg.minutes} minutes`);
    if (textarea) {
      textarea.placeholder = cfg.placeholder;
      textarea.setAttribute('aria-label', `IELTS ${cfg.badge} draft`);
    }

    const state = _modeState[mode];
    if (state.topic && _topicPool().some(t => t.id === state.topic.id)) {
      _currentTopic = state.topic;
      _renderTopic(state.topic);
    } else {
      changeTopic();
    }
    if (textarea) textarea.value = state.draft;
    _timerSeconds = state.seconds ?? cfg.minutes * 60;
    _updateTimerDisplay();

    // A result from another task type no longer matches the editor; it stays available in History.
    const results = _el('results-area');
    if (results && _lastResult && _modeOf(_lastResult) !== mode) results.style.display = 'none';

    updateWordCount();
    try {
      const url = location.pathname + location.search + (mode === 'task2' ? '' : `#${mode}`);
      history.replaceState(null, '', url);
    } catch {}
  }

  const VISUAL_ICONS = { bar: '📊', line: '📈', pie: '🥧', table: '🧮', process: '🔄', map: '🗺️', letter: '✉️' };

  function _renderTask1Filter() {
    const filter = _el('task1-visual-filter');
    if (!filter) return;
    const pool = _isTask1() ? _topicPool() : [];
    filter.hidden = pool.length === 0;
    filter.innerHTML = pool.map(t => {
      const on = _currentTopic && t.id === _currentTopic.id;
      const tone = t.visualType === 'letter' && t.tone && !String(t.taskType || '').includes(t.tone) ? ` · ${t.tone}` : '';
      return `<button type="button" class="t1-filter-chip${on ? ' active' : ''}" data-topic-id="${_esc(t.id)}" aria-pressed="${on ? 'true' : 'false'}">` +
        `<span aria-hidden="true">${VISUAL_ICONS[t.visualType] || '📝'}</span> ${_esc(t.taskType || t.visualType || 'Task 1')}${_esc(tone)}</button>`;
    }).join('');
  }

  /* ── Task 1 visual renderer (pure SVG / HTML, every label escaped) ── */

  /* Categorical palette, fixed order, validated for CVD/contrast on the dark card surface (#1a2035). */
  const VIZ_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
  const VB_W = 680, VB_H = 300, M = { l: 48, r: 14, t: 22, b: 38 };
  const PLOT_W = VB_W - M.l - M.r, PLOT_H = VB_H - M.t - M.b;

  const _esc = v => _escapeHtml(String(v ?? ''));
  const _num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const _fmt = n => n == null ? '—' : (Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100));
  const _r = n => Math.round(n * 10) / 10;

  function _niceMax(max) {
    if (!(max > 0)) return 10;
    const pow = 10 ** Math.floor(Math.log10(max));
    for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
    return 10 * pow;
  }

  /** Normalised chart data: categories (x / slices) and up to 6 numeric series. */
  function _chartData(vd) {
    const categories = (Array.isArray(vd?.categories) ? vd.categories : []).slice(0, 12).map(String);
    const series = (Array.isArray(vd?.series) ? vd.series : []).slice(0, VIZ_COLORS.length).map((s, i) => ({
      label: String(s?.label ?? `Series ${i + 1}`),
      color: VIZ_COLORS[i],
      values: categories.map((_, j) => _num(Array.isArray(s?.values) ? s.values[j] : null))
    }));
    return { categories, series, unit: typeof vd?.unit === 'string' ? vd.unit : '' };
  }

  function _yAxis(max, unit) {
    let out = '';
    for (let i = 0; i <= 5; i++) {
      const v = (max / 5) * i;
      const y = _r(M.t + PLOT_H - (v / max) * PLOT_H);
      out += `<line class="t1-grid" x1="${M.l}" x2="${VB_W - M.r}" y1="${y}" y2="${y}"/>` +
        `<text class="t1-axis" x="${M.l - 8}" y="${y + 4}" text-anchor="end">${_esc(_fmt(v))}${_esc(unit)}</text>`;
    }
    return out;
  }

  function _legend(items) {
    return `<ul class="t1-legend">${items.map(it =>
      `<li><span class="t1-swatch" style="background:${it.color}"></span>${_esc(it.label)}</li>`).join('')}</ul>`;
  }

  /** Category × series value table (also the accessible view of every chart). */
  function _seriesTable(cd, open) {
    const head = `<tr><th scope="col"></th>${cd.series.map(s => `<th scope="col">${_esc(s.label)}</th>`).join('')}</tr>`;
    const rows = cd.categories.map((c, i) => `<tr><th scope="row">${_esc(c)}</th>${cd.series.map(s =>
      `<td>${s.values[i] == null ? '—' : `${_esc(_fmt(s.values[i]))}${_esc(cd.unit)}`}</td>`).join('')}</tr>`).join('');
    return `<details class="t1-table-details"${open ? ' open' : ''}><summary>Bảng số liệu</summary>` +
      `<div class="t1-table-scroll"><table class="task1-data-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div></details>`;
  }

  function _barSvg(cd, title) {
    const max = _niceMax(Math.max(0, ...cd.series.flatMap(s => s.values.filter(v => v != null))));
    const n = cd.series.length, groupW = PLOT_W / Math.max(1, cd.categories.length), gap = 2;
    const barW = Math.max(4, Math.min(24, (groupW * 0.72 - gap * (n - 1)) / Math.max(1, n)));
    const clusterW = n * barW + gap * (n - 1), base = M.t + PLOT_H;
    let marks = '';
    cd.categories.forEach((cat, i) => {
      const x0 = M.l + i * groupW + (groupW - clusterW) / 2;
      cd.series.forEach((s, j) => {
        const v = s.values[i];
        if (v == null) return;
        const h = Math.max(0, (v / max) * PLOT_H), x = x0 + j * (barW + gap), y = base - h, r = Math.min(4, barW / 2, h);
        marks += `<g class="t1-mark"><title>${_esc(s.label)} · ${_esc(cat)}: ${_esc(_fmt(v))}${_esc(cd.unit)}</title>` +
          `<path fill="${s.color}" d="M${_r(x)},${_r(base)} V${_r(y + r)} Q${_r(x)},${_r(y)} ${_r(x + r)},${_r(y)} H${_r(x + barW - r)} Q${_r(x + barW)},${_r(y)} ${_r(x + barW)},${_r(y + r)} V${_r(base)} Z"/>` +
          `<text class="t1-val" x="${_r(x + barW / 2)}" y="${_r(y - 5)}" text-anchor="middle">${_esc(_fmt(v))}</text></g>`;
      });
      marks += `<text class="t1-axis" x="${_r(M.l + i * groupW + groupW / 2)}" y="${base + 22}" text-anchor="middle">${_esc(cat)}</text>`;
    });
    return `<svg class="t1-svg" viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="${_esc(title)}">${_yAxis(max, cd.unit)}` +
      `<line class="t1-baseline" x1="${M.l}" x2="${VB_W - M.r}" y1="${base}" y2="${base}"/>${marks}</svg>`;
  }

  function _lineSvg(cd, title) {
    const max = _niceMax(Math.max(0, ...cd.series.flatMap(s => s.values.filter(v => v != null))));
    const pad = 40, count = cd.categories.length, base = M.t + PLOT_H;
    const xAt = i => M.l + pad + (count > 1 ? i * (PLOT_W - 2 * pad) / (count - 1) : (PLOT_W - 2 * pad) / 2);
    const yAt = v => base - (v / max) * PLOT_H;
    let lines = '', dots = '';
    cd.series.forEach(s => {
      const pts = s.values.map((v, i) => v == null ? null : [_r(xAt(i)), _r(yAt(v))]).filter(Boolean);
      if (pts.length > 1) lines += `<polyline class="t1-line" stroke="${s.color}" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
      s.values.forEach((v, i) => {
        if (v == null) return;
        const x = _r(xAt(i)), y = _r(yAt(v));
        // Label only the start and end values beside the dot (middle values: tooltip + data table),
        // so close series never stack their labels on top of each other.
        const edge = i === 0 ? 'end' : i === count - 1 ? 'start' : '';
        const label = edge ? `<text class="t1-val" x="${_r(edge === 'end' ? x - 10 : x + 10)}" y="${_r(y + 4)}" text-anchor="${edge}">${_esc(_fmt(v))}</text>` : '';
        dots += `<g class="t1-mark"><title>${_esc(s.label)} · ${_esc(cd.categories[i])}: ${_esc(_fmt(v))}${_esc(cd.unit)}</title>` +
          `<circle class="t1-dot" cx="${x}" cy="${y}" r="5" fill="${s.color}"/>${label}</g>`;
      });
    });
    const xLabels = cd.categories.map((c, i) => `<text class="t1-axis" x="${_r(xAt(i))}" y="${base + 22}" text-anchor="middle">${_esc(c)}</text>`).join('');
    return `<svg class="t1-svg" viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="${_esc(title)}">${_yAxis(max, cd.unit)}` +
      `<line class="t1-baseline" x1="${M.l}" x2="${VB_W - M.r}" y1="${base}" y2="${base}"/>${lines}${dots}${xLabels}</svg>`;
  }

  /** One pie per series (e.g. 2005 vs 2025); slices are the categories. */
  function _pieSvg(cd, title) {
    const pies = cd.series.slice(0, 2), R = 108, cy = 168;
    const centers = pies.length === 1 ? [VB_W / 2] : [VB_W * 0.27, VB_W * 0.73];
    let out = '';
    pies.forEach((s, p) => {
      const cx = centers[p], total = s.values.reduce((a, v) => a + (v > 0 ? v : 0), 0);
      out += `<text class="t1-pie-title" x="${_r(cx)}" y="34" text-anchor="middle">${_esc(s.label)}</text>`;
      if (!(total > 0)) return;
      let angle = -Math.PI / 2;
      cd.categories.forEach((cat, i) => {
        const v = s.values[i];
        if (!(v > 0)) return;
        const share = v / total, sweep = share * Math.PI * 2, end = angle + sweep, mid = angle + sweep / 2;
        const color = VIZ_COLORS[i % VIZ_COLORS.length];
        const tip = `<title>${_esc(s.label)} · ${_esc(cat)}: ${_esc(_fmt(v))}${_esc(cd.unit)}</title>`;
        const shape = share >= 0.9999
          ? `<circle class="t1-slice" cx="${_r(cx)}" cy="${cy}" r="${R}" fill="${color}"/>`
          : `<path class="t1-slice" fill="${color}" d="M${_r(cx)},${cy} L${_r(cx + R * Math.cos(angle))},${_r(cy + R * Math.sin(angle))} ` +
            `A${R},${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${_r(cx + R * Math.cos(end))},${_r(cy + R * Math.sin(end))} Z"/>`;
        const label = share >= 0.06
          ? `<text class="t1-slice-label" x="${_r(cx + R * 0.64 * Math.cos(mid))}" y="${_r(cy + R * 0.64 * Math.sin(mid) + 4)}" text-anchor="middle">${_esc(_fmt(v))}${_esc(cd.unit)}</text>`
          : '';
        out += `<g class="t1-mark">${tip}${shape}${label}</g>`;
        angle = end;
      });
    });
    return `<svg class="t1-svg" viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="${_esc(title)}">${out}</svg>`;
  }

  /** <table class="task1-data-table"> with the highest / lowest value of each numeric column marked. */
  function _dataTable(vd) {
    const columns = (Array.isArray(vd?.columns) ? vd.columns : []).slice(0, 10).map(String);
    const rows = (Array.isArray(vd?.rows) ? vd.rows : []).slice(0, 30).filter(Array.isArray);
    const extremes = columns.map((_, c) => {
      const nums = rows.map(r => _num(r[c]));
      if (c === 0 || nums.some(v => v == null) || nums.length < 2) return null;
      return { max: Math.max(...nums), min: Math.min(...nums) };
    });
    const body = rows.map(r => `<tr>${columns.map((_, c) => {
      const raw = r[c], v = _num(raw), ex = extremes[c];
      if (c === 0) return `<th scope="row">${_esc(raw)}</th>`;
      const cls = ex && v === ex.max ? 'is-max' : ex && v === ex.min ? 'is-min' : '';
      const mark = cls === 'is-max' ? '<span class="t1-ext" aria-label="highest" title="Highest">▲</span>'
        : cls === 'is-min' ? '<span class="t1-ext" aria-label="lowest" title="Lowest">▼</span>' : '';
      const text = v == null || /^(year|opened)\b/i.test(columns[c]) ? _esc(raw) : _esc(_fmt(v));
      return `<td class="${cls}">${text}${mark}</td>`;
    }).join('')}</tr>`).join('');
    return `<div class="t1-table-scroll"><table class="task1-data-table"><thead><tr>${columns.map(c => `<th scope="col">${_esc(c)}</th>`).join('')}</tr></thead>` +
      `<tbody>${body}</tbody></table></div><p class="t1-legend-note"><span class="t1-ext">▲</span> cao nhất · <span class="t1-ext">▼</span> thấp nhất trong cột</p>`;
  }

  function _processHtml(vd) {
    const steps = (Array.isArray(vd?.steps) ? vd.steps : []).slice(0, 12);
    return `<ol class="task1-process">${steps.map((s, i) => `<li class="t1-step">` +
      `<span class="t1-step-no">Step ${_esc(_num(s?.step) ?? i + 1)}</span>` +
      `<strong class="t1-step-title">${_esc(s?.title)}</strong>` +
      `<span class="t1-step-detail">${_esc(s?.detail)}</span></li>`).join('')}</ol>`;
  }

  /** Map comparison: each zone's before → after state with its type of change. */
  function _mapHtml(vd) {
    const zones = (Array.isArray(vd?.zones) ? vd.zones : []).slice(0, 12);
    const before = vd?.beforeLabel || 'Before', after = vd?.afterLabel || 'After';
    return `<ol class="t1-map-zones">${zones.map(z => `<li class="t1-zone">` +
      `<div class="t1-zone-head"><strong>${_esc(z?.area)}</strong>${z?.changeType ? `<span class="t1-change">${_esc(z.changeType)}</span>` : ''}</div>` +
      `<div class="t1-zone-states">` +
      `<div class="t1-zone-state"><span class="t1-zone-year">${_esc(before)}</span>${_esc(z?.before)}</div>` +
      `<span class="t1-zone-arrow" aria-hidden="true">➔</span>` +
      `<div class="t1-zone-state is-after"><span class="t1-zone-year">${_esc(after)}</span>${_esc(z?.after)}</div>` +
      `</div></li>`).join('')}</ol>`;
  }

  /** Gemini content: useful phrases as chips; the model overview stays folded so learners try first. */
  function _hintsHtml(topic) {
    const phrases = (Array.isArray(topic.usefulPhrases) ? topic.usefulPhrases : []).filter(p => typeof p === 'string' && p.trim()).slice(0, 8);
    const sample = typeof topic.overviewSample === 'string' ? topic.overviewSample.trim() : '';
    if (!phrases.length && !sample) return '';
    const sampleLabel = topic.visualType === 'letter' ? 'Xem câu mở đầu mẫu (Band 8+)' : 'Xem đoạn Overview mẫu (Band 8+)';
    return `<div class="t1-hints">` +
      (phrases.length ? `<p class="t1-hints-label">💡 Cụm từ hữu ích</p><ul class="t1-phrases">${phrases.map(p => `<li>${_esc(p)}</li>`).join('')}</ul>` : '') +
      (sample ? `<details class="t1-sample"><summary>${sampleLabel} — nên tự viết trước rồi mới mở</summary><p>${_esc(sample)}</p></details>` : '') +
      `</div>`;
  }

  function _letterHtml(topic) {
    const bullets = (Array.isArray(topic.bulletPoints) ? topic.bulletPoints : []).slice(0, 5);
    return `<div class="t1-letter">` +
      `<div class="t1-letter-head"><span class="t1-letter-icon" aria-hidden="true">✉️</span>` +
      `<strong>${_esc(topic.taskType || 'Letter')}</strong>` +
      `<span class="t1-tone">Tone: ${_esc(topic.tone || 'Formal')}</span></div>` +
      `<p class="t1-letter-lead">In your letter, you should:</p>` +
      `<ul class="t1-letter-bullets">${bullets.map(b => `<li>${_esc(b)}</li>`).join('')}</ul></div>`;
  }

  /**
   * Draw the Task 1 visual for a topic into #task1-visual-container.
   * bar / line / pie → SVG + legend + data table; table → <table class="task1-data-table">;
   * process → numbered steps joined by arrows; letter → situation brief with bullet points and tone.
   */
  function renderTask1Visual(topic) {
    const box = _el('task1-visual-container');
    if (!box) return null;
    if (!topic) { box.replaceChildren(); return box; }
    const vd = topic.visualData || {};
    const type = topic.visualType;
    const title = vd.title || topic.taskType || 'Task 1 visual';
    let body = '';
    if (type === 'bar' || type === 'line' || type === 'pie') {
      const cd = _chartData(vd);
      const svg = type === 'bar' ? _barSvg(cd, title) : type === 'line' ? _lineSvg(cd, title) : _pieSvg(cd, title);
      const legendItems = type === 'pie'
        ? cd.categories.map((c, i) => ({ label: c, color: VIZ_COLORS[i % VIZ_COLORS.length] }))
        : cd.series.map(s => ({ label: s.label, color: s.color }));
      body = `<div class="t1-svg-scroll">${svg}</div>${_legend(legendItems)}${_seriesTable(cd, type === 'pie')}`;
    } else if (type === 'table') {
      body = _dataTable(vd);
    } else if (type === 'process') {
      body = _processHtml(vd);
    } else if (type === 'map') {
      body = _mapHtml(vd);
    } else if (type === 'letter') {
      body = _letterHtml(topic);
    } else {
      body = '<p class="t1-note">This visual type is not supported yet.</p>';
    }
    const caption = type === 'letter' ? '' : `<figcaption class="t1-title">${_esc(title)}</figcaption>`;
    const note = vd.note ? `<p class="t1-note">${_esc(vd.note)}</p>` : '';
    box.innerHTML = `<figure class="t1-figure t1-${_esc(type || 'unknown')}">${caption}${body}${note}</figure>${_hintsHtml(topic)}`;
    return box;
  }

  /** Plain-text version of the visual (sent as visualSummary for the examiner prompt). */
  function _visualSummary(topic) {
    if (!topic) return '';
    const vd = topic.visualData || {}, lines = [];
    if (vd.title) lines.push(String(vd.title));
    if (Array.isArray(vd.series)) vd.series.forEach(s => lines.push(`${s?.label}: ${(vd.categories || []).map((c, i) =>
      `${c} ${Array.isArray(s?.values) ? s.values[i] : ''}${vd.unit || ''}`).join(', ')}`));
    if (Array.isArray(vd.rows)) { lines.push((vd.columns || []).join(' | ')); vd.rows.forEach(r => Array.isArray(r) && lines.push(r.join(' | '))); }
    if (Array.isArray(vd.zones)) vd.zones.forEach(z => lines.push(`${z?.area}: ${vd.beforeLabel || 'Before'} ${z?.before} -> ${vd.afterLabel || 'After'} ${z?.after} (${z?.changeType || 'changed'})`));
    if (Array.isArray(vd.steps)) vd.steps.forEach((s, i) => lines.push(`Step ${s?.step ?? i + 1}: ${s?.title} - ${s?.detail}`));
    if (Array.isArray(topic.bulletPoints)) {
      lines.push(`Tone: ${topic.tone || ''}`);
      topic.bulletPoints.forEach(b => lines.push(`- ${b}`));
    }
    return lines.join('\n').slice(0, 6000);
  }

  /* ── Overall Writing Band banner ──────────────────────────────────── */

  /** Same rules as the server's computeWritingBandSummary (used when the API is unreachable). */
  function computeWritingSummary(history) {
    const groups = { 1: [], 2: [] };
    (Array.isArray(history) ? history : []).forEach((rec, index) => {
      const n = Number(rec?.taskNumber);
      const task = n === 1 ? 1 : (rec?.taskNumber == null || n === 2 ? 2 : null);
      if (!task) return;
      const raw = rec?.result?.overall_band ?? rec?.overall_band ?? rec?.overallBand;
      const band = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      groups[task].push({ band: Number.isFinite(band) && band >= 0 && band <= 9 ? band : null, time: Date.parse(rec?.timestamp), index });
    });
    const latest = rows => {
      const valid = rows.filter(r => r.band !== null);
      if (!valid.length) return null;
      const dated = valid.filter(r => Number.isFinite(r.time));
      return (dated.length ? dated.reduce((a, b) => b.time > a.time || (b.time === a.time && b.index > a.index) ? b : a) : valid[valid.length - 1]).band;
    };
    const avg = rows => { const b = rows.map(r => r.band).filter(v => v !== null); return b.length ? Number((b.reduce((x, y) => x + y, 0) / b.length).toFixed(2)) : null; };
    const t1 = latest(groups[1]), t2 = latest(groups[2]);
    const combined = t1 !== null && t2 !== null ? Math.round(((t1 + 2 * t2) / 3) * 2) / 2 : null;
    return { task1Count: groups[1].length, task2Count: groups[2].length, latestTask1Band: t1, latestTask2Band: t2,
      avgTask1Band: avg(groups[1]), avgTask2Band: avg(groups[2]), combinedOverallBand: combined,
      estimatedSingleTaskBand: combined === null ? (t2 ?? t1) : null, formula: '(Task1 + 2 * Task2) / 3' };
  }

  async function loadWritingSummary() {
    try {
      const response = await fetch('/api/writing/summary');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderWritingSummary(await response.json());
    } catch {
      renderWritingSummary(computeWritingSummary(_getLocalHistory()));
    }
  }

  function renderWritingSummary(summary) {
    const banner = _el('writing-overall-banner');
    if (!banner || !summary) return;
    const n = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
    const t1 = n(summary.latestTask1Band), t2 = n(summary.latestTask2Band), overall = n(summary.combinedOverallBand);
    const band = v => v == null ? '—' : `Band ${v.toFixed(1)}`;
    _setText('wob-task1', band(t1));
    _setText('wob-task2', band(t2));
    _setText('wob-overall', band(overall));
    banner.classList.toggle('is-complete', overall != null);

    const cta = _el('wob-cta');
    let hint, target = null, ctaText = '';
    if (overall != null) {
      hint = `Tính từ bài mới nhất mỗi Task: (${t1.toFixed(1)} + 2 × ${t2.toFixed(1)}) / 3 = ${((t1 + 2 * t2) / 3).toFixed(2)} → làm tròn ${overall.toFixed(1)}.`;
    } else if (t2 != null) {
      hint = 'Hãy hoàn thành thêm 1 bài Writing Task 1 (150 từ) để mở khóa điểm Overall Writing chính thức theo công thức 1/3 Task 1 + 2/3 Task 2!';
      target = 'task1-academic'; ctaText = '📊 Làm bài Task 1 ngay';
    } else if (t1 != null) {
      hint = 'Hãy hoàn thành thêm 1 bài Writing Task 2 (250 từ) để mở khóa điểm Overall Writing chính thức theo công thức 1/3 Task 1 + 2/3 Task 2!';
      target = 'task2'; ctaText = '📝 Làm bài Task 2 ngay';
    } else {
      hint = 'Hoàn thành 1 bài Task 1 và 1 bài Task 2 để có điểm Overall Writing (Task 2 được tính gấp đôi Task 1).';
    }
    _setText('wob-hint', hint);
    if (cta) {
      cta.hidden = !target;
      cta.dataset.targetMode = target || '';
      cta.textContent = ctaText;
    }
  }

  /* ── Phase 9B: Learn From My Mistakes ─────────────────── */
  /** Send this essay's inline corrections + weakest criterion to Study Hub as a personalised 5-step unit. */
  async function createMistakeUnit(button) {
    const data = _lastResult;
    if (!data || typeof AuthProfile === 'undefined') { showToast('Hãy chấm một bài viết trước.', 'error'); return; }
    const weakest = AuthProfile.weakestCriterion(_normalizeCriteria(data));
    const corrections = (Array.isArray(data.inline_corrections) ? data.inline_corrections : [])
      .filter(c => c && typeof c.original === 'string' && typeof c.correction === 'string')
      .slice(0, 10)
      .map(c => ({ original: c.original, correction: c.correction, explanation: c.explanation || '' }));
    const mistakeContext = {
      source: 'writing',
      recordId: String(data.id || data.timestamp || `local_${Date.now()}`),
      prompt: (Number(data.taskNumber) === 1 ? `[Writing ${_taskLabel(data)}] ` : '') + (data.topic || _el('topic-prompt')?.textContent.trim() || ''),
      overallBand: Number(data.overall_band ?? data.overallBand) || null,
      weakestCriterion: weakest || undefined,
      corrections,
      suggestions: (data.suggestions || data.result?.suggestions || []).slice(0, 6)
    };
    try { await AuthProfile.createMistakeUnit(mistakeContext, button); }
    catch (e) { showToast(e.message, 'error'); }
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    createMistakeUnit,
    init,
    setTaskMode,
    renderTask1Visual,
    computeWritingSummary,
    renderWritingSummary,
    getTaskMode: () => _mode,
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
