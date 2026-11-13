/** IELTS Master analytics dashboard. No third-party chart dependency required. */
const AnalyticsApp = (() => {
  const PLACEMENT_KEY = 'ielts_placement_results';
  const WRITING_KEY = 'ielts_writing_history';
  const WRITING_CRITERIA_META = [
    { key: 'TR', name: 'Task Response' },
    { key: 'CC', name: 'Coherence & Cohesion' },
    { key: 'LR', name: 'Lexical Resource' },
    { key: 'GRA', name: 'Grammatical Range & Accuracy' }
  ];
  let snapshot = null;

  const readLocal = (key) => {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  };

  async function fetchHistory(url, fallbackKey) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { data: Array.isArray(data) ? data : [], online: true };
    } catch {
      return { data: readLocal(fallbackKey), online: false };
    }
  }

  const placementBand = record => parseFloat(String(record.estimatedBand || '').replace('+', ''));
  const writingBand = record => Number(record.result?.overall_band ?? record.overall_band ?? record.overallBand);
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  /**
   * Extract criterion scores (TR, CC, LR, GRA) from a writing history record.
   * Supports both backend records (`record.result.criteria`) and localStorage records (`record.criteria`).
   */
  function extractCriteriaList(record) {
    const raw = record?.result?.criteria || record?.criteria;
    return Array.isArray(raw) ? raw : [];
  }

  function aggregateWritingCriteria(writingRecords) {
    const buckets = { TR: [], CC: [], LR: [], GRA: [] };
    writingRecords.forEach(record => {
      extractCriteriaList(record).forEach(item => {
        const abbr = String(item?.abbreviation || '').toUpperCase().trim();
        const score = Number(item?.score);
        if (abbr in buckets && Number.isFinite(score)) {
          buckets[abbr].push(score);
        }
      });
    });

    const averages = {};
    WRITING_CRITERIA_META.forEach(({ key }) => {
      averages[key] = average(buckets[key]);
    });

    const scoredCriteria = WRITING_CRITERIA_META
      .map(meta => ({ ...meta, average: averages[meta.key], count: buckets[meta.key].length }))
      .filter(item => item.average != null);

    scoredCriteria.sort((a, b) => a.average - b.average);
    const weakestCriterion = scoredCriteria.length ? scoredCriteria[0] : null;

    return { averages, weakestCriterion, totalCriteriaSamples: scoredCriteria.length };
  }

  function formatPracticeTime(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0m total practice';
    const minutes = Math.max(1, Math.round(totalSeconds / 60));
    if (minutes < 60) return `${minutes}m total practice`;
    const hours = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    return remMins ? `${hours}h ${remMins}m total practice` : `${hours}h total practice`;
  }

  function aggregate(placement, writing) {
    const reading = placement.map(r => Number(r.sectionBreakdown?.reading?.percentage)).filter(Number.isFinite);
    const listening = placement.map(r => Number(r.sectionBreakdown?.listening?.percentage)).filter(Number.isFinite);
    const writingBands = writing.map(writingBand).filter(Number.isFinite);
    const attempts = [
      ...placement.map(r => ({ date: r.timestamp, band: placementBand(r), type: 'Placement' })),
      ...writing.map(r => ({ date: r.timestamp, band: writingBand(r), type: 'Writing' }))
    ].filter(a => Number.isFinite(a.band)).sort((a, b) => new Date(a.date) - new Date(b.date));

    const weakCounts = { A2: 0, B1: 0, B2: 0 };
    placement.flatMap(r => r.weakAreas || []).forEach(area => {
      const level = String(area.difficulty || '').toUpperCase();
      if (level in weakCounts) weakCounts[level]++;
    });

    const writingCriteria = aggregateWritingCriteria(writing);

    // Calculate total practice time (actual placement timeSpentSeconds + ~20m per scored essay if not recorded)
    const placementSeconds = placement.reduce((acc, r) => acc + (Number(r.timeSpentSeconds) || 600), 0);
    const writingSeconds = writing.reduce((acc, r) => acc + (Number(r.timeSpentSeconds) || 1200), 0);
    const totalPracticeSeconds = (placement.length ? placementSeconds : 0) + (writing.length ? writingSeconds : 0);

    return {
      placement,
      writing,
      attempts,
      weakCounts,
      writingCriteria,
      totalPracticeSeconds,
      averageBand: average(attempts.map(a => a.band)),
      reading: average(reading),
      listening: average(listening),
      writingBand: average(writingBands)
    };
  }

  function renderMetrics(data) {
    document.getElementById('average-band').textContent = data.averageBand == null ? '—' : data.averageBand.toFixed(1);
    document.getElementById('reading-score').textContent = data.reading == null ? '—' : `${Math.round(data.reading)}%`;
    document.getElementById('listening-score').textContent = data.listening == null ? '—' : `${Math.round(data.listening)}%`;
    document.getElementById('writing-score').textContent = data.writingBand == null ? '—' : data.writingBand.toFixed(1);
    document.getElementById('attempt-count').textContent = data.attempts.length
      ? `${data.attempts.length} scored attempt${data.attempts.length === 1 ? '' : 's'}`
      : 'No attempts yet';
    const practiceEl = document.getElementById('practice-time');
    if (practiceEl) {
      practiceEl.textContent = formatPracticeTime(data.totalPracticeSeconds);
    }
  }

  function renderWeakAreas(data) {
    const counts = data.weakCounts;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const cefrRows = ['A2', 'B1', 'B2'].map(level => {
      const percent = total ? Math.round(counts[level] / total * 100) : 0;
      return `<div class="weak-row"><span class="cefr-badge">${level}</span><div><strong>${level} questions</strong><div class="weak-track"><div class="weak-fill" style="width:${percent}%"></div></div></div><span class="weak-count">${counts[level]} gap${counts[level] === 1 ? '' : 's'}</span></div>`;
    }).join('');

    const weakestWriting = data.writingCriteria?.weakestCriterion;
    const writingDiagnosisHtml = weakestWriting
      ? `<div class="weak-divider"></div>
         <div class="weak-sublabel">Lowest Writing Criterion</div>
         <div class="weak-row" id="weakest-writing-criterion">
           <span class="cefr-badge writing-weak-badge">${escapeHtml(weakestWriting.key)}</span>
           <div>
             <strong>${escapeHtml(weakestWriting.name)}</strong>
             <div class="weak-track"><div class="weak-fill writing-weak-fill" style="width:${Math.round((weakestWriting.average / 9) * 100)}%"></div></div>
           </div>
           <span class="weak-count">Band ${weakestWriting.average.toFixed(1)}</span>
         </div>`
      : `<div class="weak-divider"></div>
         <div class="weak-sublabel">Lowest Writing Criterion</div>
         <div class="weak-row" id="weakest-writing-criterion">
           <span class="cefr-badge writing-weak-badge">W</span>
           <div>
             <strong>No Writing attempts yet</strong>
             <div class="weak-track"><div class="weak-fill writing-weak-fill" style="width:0%"></div></div>
           </div>
           <span class="weak-count">—</span>
         </div>`;

    document.getElementById('weak-areas').innerHTML = cefrRows + writingDiagnosisHtml;
  }

  function renderSkillBreakdown(data) {
    const container = document.getElementById('skill-breakdown');
    if (!container) return;

    const badge = document.getElementById('writing-attempt-badge');
    if (badge) {
      badge.textContent = data.writing.length
        ? `Based on ${data.placement.length} Placement & ${data.writing.length} Writing attempt${data.writing.length === 1 ? '' : 's'}`
        : 'Submit a Writing Task 2 essay to unlock TR, CC, LR, GRA breakdown';
    }

    const readingPct = data.reading == null ? 0 : Math.round(data.reading);
    const listeningPct = data.listening == null ? 0 : Math.round(data.listening);
    const weakestKey = data.writingCriteria?.weakestCriterion?.key;

    const coreSkills = [
      {
        pill: 'R',
        pillClass: 'pill-teal',
        name: 'Reading Comprehension',
        valueText: data.reading == null ? '—' : `${readingPct}%`,
        percent: readingPct,
        fillClass: '',
        metaLeft: 'Placement Test Accuracy',
        metaRight: `${data.placement.length} attempt${data.placement.length === 1 ? '' : 's'}`,
        isWeakest: false
      },
      {
        pill: 'L',
        pillClass: 'pill-teal',
        name: 'Listening Comprehension',
        valueText: data.listening == null ? '—' : `${listeningPct}%`,
        percent: listeningPct,
        fillClass: '',
        metaLeft: 'Placement Test Accuracy',
        metaRight: `${data.placement.length} attempt${data.placement.length === 1 ? '' : 's'}`,
        isWeakest: false
      }
    ];

    const criteriaSkills = WRITING_CRITERIA_META.map(({ key, name }) => {
      const avgScore = data.writingCriteria?.averages?.[key];
      const pct = avgScore == null ? 0 : Math.round((avgScore / 9) * 100);
      const isWeakest = Boolean(weakestKey && weakestKey === key && data.writing.length > 0);
      return {
        pill: key,
        pillClass: isWeakest ? 'pill-amber' : '',
        name: `${name} (${key})`,
        valueText: avgScore == null ? '—' : `Band ${avgScore.toFixed(1)} / 9.0`,
        percent: pct,
        fillClass: isWeakest ? 'fill-weakest' : 'fill-writing',
        metaLeft: isWeakest ? 'Priority focus area (lowest criterion)' : 'Official IELTS Writing Criterion (25%)',
        metaRight: avgScore == null ? 'No data' : `${pct}% of Band 9`,
        isWeakest
      };
    });

    const allBars = [...coreSkills, ...criteriaSkills];
    container.innerHTML = allBars.map(item => `
      <article class="skill-bar-card ${item.isWeakest ? 'is-weakest' : ''}" data-skill="${escapeHtml(item.pill)}">
        <div class="skill-bar-header">
          <div class="skill-bar-title">
            <span class="skill-pill ${item.pillClass}">${escapeHtml(item.pill)}</span>
            <span>${escapeHtml(item.name)}</span>
          </div>
          <span class="skill-bar-value">${escapeHtml(item.valueText)}</span>
        </div>
        <div class="skill-bar-track">
          <div class="skill-bar-fill ${item.fillClass}" style="width:${item.percent}%"></div>
        </div>
        <div class="skill-bar-meta">
          <span>${escapeHtml(item.metaLeft)}</span>
          <span>${escapeHtml(item.metaRight)}</span>
        </div>
      </article>
    `).join('');
  }

  function renderChart(attempts) {
    const canvas = document.getElementById('progress-chart');
    const empty = document.getElementById('chart-empty');
    if (!attempts.length) { canvas.hidden = true; empty.hidden = false; return; }
    canvas.hidden = false; empty.hidden = true;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600, height = canvas.clientHeight || 260;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    const pad = { l: 36, r: 18, t: 18, b: 34 }, plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
    ctx.font = '11px Inter'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let band = 3; band <= 9; band++) {
      const y = pad.t + (9 - band) / 6 * plotH;
      ctx.strokeStyle = 'rgba(148,163,184,.12)'; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.fillText(String(band), pad.l - 8, y);
    }
    const xAt = i => attempts.length === 1 ? pad.l + plotW / 2 : pad.l + i / (attempts.length - 1) * plotW;
    const yAt = band => pad.t + (9 - Math.max(3, Math.min(9, band))) / 6 * plotH;
    const gradient = ctx.createLinearGradient(0, pad.t, 0, height - pad.b); gradient.addColorStop(0, 'rgba(99,102,241,.28)'); gradient.addColorStop(1, 'rgba(99,102,241,0)');
    ctx.beginPath(); attempts.forEach((a, i) => i ? ctx.lineTo(xAt(i), yAt(a.band)) : ctx.moveTo(xAt(i), yAt(a.band))); ctx.lineTo(xAt(attempts.length - 1), height - pad.b); ctx.lineTo(xAt(0), height - pad.b); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); attempts.forEach((a, i) => i ? ctx.lineTo(xAt(i), yAt(a.band)) : ctx.moveTo(xAt(i), yAt(a.band))); ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 3; ctx.stroke();
    attempts.forEach((a, i) => { const x = xAt(i), y = yAt(a.band); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#a5b4fc'; ctx.fill(); ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(new Date(a.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), x, height - pad.b + 10); });
  }

  function renderRoadmap(plan) {
    const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];
    document.getElementById('roadmap-content').innerHTML = `<div class="roadmap-overview">${escapeHtml(plan.overview || 'Your personalized roadmap is ready.')} ${plan.dailyMinutes ? `<strong>${plan.dailyMinutes} minutes/day.</strong>` : ''}</div><div class="week-grid">${weeks.map(week => `<article class="week-card"><span class="eyebrow">Week ${week.week}</span><h3>${escapeHtml(week.focus || '')}</h3><ul>${(week.activities || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><div class="milestone">Milestone: ${escapeHtml(week.milestone || '')}</div></article>`).join('')}</div>`;
  }

  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

  async function generateRoadmap() {
    const button = document.getElementById('roadmap-button');
    const content = document.getElementById('roadmap-content');
    const weakAreas = Object.entries(snapshot.weakCounts)
      .filter(([, count]) => count > 0)
      .map(([cefr, count]) => ({ cefr, count }));

    if (snapshot.writingCriteria?.weakestCriterion) {
      const w = snapshot.writingCriteria.weakestCriterion;
      weakAreas.push({
        skill: 'Writing',
        criterion: w.key,
        name: w.name,
        averageBand: Number(w.average.toFixed(1))
      });
    }

    // If the learner achieved 100% on Placement Test (0 wrong answers), still allow generating an advanced roadmap
    if (!weakAreas.length && snapshot.attempts.length > 0) {
      weakAreas.push({
        cefr: 'C1',
        focus: 'Advanced Band 7.5+ Mastery & Exam Stamina',
        count: 1
      });
    }

    if (!weakAreas.length) {
      content.innerHTML = '<div class="roadmap-error">Complete a Placement Test or Writing Practice first so the coach can analyze your performance.</div>';
      return;
    }

    button.disabled = true; button.textContent = 'Generating…'; content.innerHTML = '<div class="roadmap-placeholder">Gemini is building your study plan…</div>';
    try {
      const response = await fetch('/api/analytics/roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weakAreas,
          summary: {
            averageBand: snapshot.averageBand,
            reading: snapshot.reading,
            listening: snapshot.listening,
            writing: snapshot.writingBand,
            writingCriteria: snapshot.writingCriteria?.averages || {}
          }
        })
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not generate roadmap.'); renderRoadmap(data);
    } catch (error) { content.innerHTML = `<div class="roadmap-error">${escapeHtml(error.message)}</div>`; }
    finally { button.disabled = false; button.textContent = 'Regenerate roadmap'; }
  }

  async function init() {
    const [placement, writing] = await Promise.all([fetchHistory('/api/placement/history', PLACEMENT_KEY), fetchHistory('/api/writing/history', WRITING_KEY)]);
    snapshot = aggregate(placement.data, writing.data);
    renderMetrics(snapshot);
    renderWeakAreas(snapshot);
    renderSkillBreakdown(snapshot);
    renderChart(snapshot.attempts);
    const online = placement.online && writing.online; const status = document.getElementById('sync-status'); status.textContent = online ? 'Server data synced' : 'Offline data'; status.className = `sync-status ${online ? 'online' : 'offline'}`;
    document.getElementById('roadmap-button').addEventListener('click', generateRoadmap);
    window.addEventListener('resize', () => renderChart(snapshot.attempts));
  }
  return { init };
})();
document.addEventListener('DOMContentLoaded', AnalyticsApp.init);
