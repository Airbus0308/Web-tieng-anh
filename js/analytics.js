/** IELTS Master analytics dashboard. No third-party chart dependency required. */
const AnalyticsApp = (() => {
  const PLACEMENT_KEY = 'ielts_placement_results';
  const WRITING_KEY = 'ielts_writing_history';
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
    return { placement, writing, attempts, weakCounts, averageBand: average(attempts.map(a => a.band)), reading: average(reading), listening: average(listening), writingBand: average(writingBands) };
  }

  function renderMetrics(data) {
    document.getElementById('average-band').textContent = data.averageBand == null ? '—' : data.averageBand.toFixed(1);
    document.getElementById('reading-score').textContent = data.reading == null ? '—' : `${Math.round(data.reading)}%`;
    document.getElementById('listening-score').textContent = data.listening == null ? '—' : `${Math.round(data.listening)}%`;
    document.getElementById('writing-score').textContent = data.writingBand == null ? '—' : data.writingBand.toFixed(1);
    document.getElementById('attempt-count').textContent = data.attempts.length ? `${data.attempts.length} scored attempt${data.attempts.length === 1 ? '' : 's'}` : 'No attempts yet';
  }

  function renderWeakAreas(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    document.getElementById('weak-areas').innerHTML = ['A2', 'B1', 'B2'].map(level => {
      const percent = total ? Math.round(counts[level] / total * 100) : 0;
      return `<div class="weak-row"><span class="cefr-badge">${level}</span><div><strong>${level} questions</strong><div class="weak-track"><div class="weak-fill" style="width:${percent}%"></div></div></div><span class="weak-count">${counts[level]} gap${counts[level] === 1 ? '' : 's'}</span></div>`;
    }).join('');
  }

  function renderChart(attempts) {
    const canvas = document.getElementById('progress-chart');
    const empty = document.getElementById('chart-empty');
    if (!attempts.length) { canvas.hidden = true; empty.hidden = false; return; }
    canvas.hidden = false; empty.hidden = true;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
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
    const weakAreas = Object.entries(snapshot.weakCounts).filter(([, count]) => count > 0).map(([cefr, count]) => ({ cefr, count }));
    if (!weakAreas.length) { content.innerHTML = '<div class="roadmap-error">Complete a Placement Test first so the coach can identify your weak areas.</div>'; return; }
    button.disabled = true; button.textContent = 'Generating…'; content.innerHTML = '<div class="roadmap-placeholder">Gemini is building your study plan…</div>';
    try {
      const response = await fetch('/api/analytics/roadmap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weakAreas, summary: { averageBand: snapshot.averageBand, reading: snapshot.reading, listening: snapshot.listening, writing: snapshot.writingBand } }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not generate roadmap.'); renderRoadmap(data);
    } catch (error) { content.innerHTML = `<div class="roadmap-error">${escapeHtml(error.message)}</div>`; }
    finally { button.disabled = false; button.textContent = 'Regenerate roadmap'; }
  }

  async function init() {
    const [placement, writing] = await Promise.all([fetchHistory('/api/placement/history', PLACEMENT_KEY), fetchHistory('/api/writing/history', WRITING_KEY)]);
    snapshot = aggregate(placement.data, writing.data); renderMetrics(snapshot); renderWeakAreas(snapshot.weakCounts); renderChart(snapshot.attempts);
    const online = placement.online && writing.online; const status = document.getElementById('sync-status'); status.textContent = online ? 'Server data synced' : 'Offline data'; status.className = `sync-status ${online ? 'online' : 'offline'}`;
    document.getElementById('roadmap-button').addEventListener('click', generateRoadmap);
    window.addEventListener('resize', () => renderChart(snapshot.attempts));
  }
  return { init };
})();
document.addEventListener('DOMContentLoaded', AnalyticsApp.init);
