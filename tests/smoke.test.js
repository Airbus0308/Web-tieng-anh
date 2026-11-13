/**
 * Smoke tests for the IELTS Master server.
 * Run with: npm test
 *
 * Starts server.js on a test port, then checks:
 *  - static pages and config.json are served
 *  - /api/writing/config and /api/writing/history respond
 *  - /api/placement/results and /api/placement/history sync & deduplicate
 *  - /api/analytics/roadmap and /api/analytics/study-plan validate input
 *  - /speaking.html, /api/speaking/config, /api/speaking/history and
 *    /api/speaking/score validation (empty / under 40 words)
 *  - /api/writing/score validates input (empty / under 250 words)
 *  - /api/writing/score returns a full result when GEMINI_API_KEY is set
 *    (skipped otherwise)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testResultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-master-test-'));
process.env.IELTS_RESULTS_DIR = testResultsDir;
const { default: app } = await import('../server.js');

let server;
let BASE;

before(async () => {
  // Mount the Express app in-process on a random free port
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server?.close(resolve));
  fs.rmSync(testResultsDir, { recursive: true, force: true });
});

const sampleEssay = (words) =>
  Array.from({ length: words }, (_, i) => (i % 12 === 11 ? 'technology.' : 'education')).join(' ');

test('serves all application pages and analytics skill breakdown section', async () => {
  for (const page of ['/writing.html', '/index.html', '/analytics.html', '/speaking.html']) {
    const res = await fetch(BASE + page);
    assert.equal(res.status, 200, page);
  }
  const analyticsHtml = await (await fetch(`${BASE}/analytics.html`)).text();
  assert.ok(analyticsHtml.includes('id="skill-breakdown"'), 'analytics.html should include #skill-breakdown');
  assert.ok(analyticsHtml.includes('TR, CC, LR, GRA'), 'analytics.html should mention 4 Writing criteria');
});

test('config.json contains the 4 IELTS criteria and study plan prompts', async () => {
  const res = await fetch(`${BASE}/config.json`);
  const cfg = await res.json();
  const abbrs = Object.values(cfg.scoringCriteria).map(c => c.abbreviation).sort();
  assert.deepEqual(abbrs, ['CC', 'GRA', 'LR', 'TR']);
  assert.ok(cfg.systemInstruction && cfg.responseFormat && cfg.model);
  assert.ok(cfg.analyticsRoadmapPrompt && cfg.studyPlanPrompt);
});

test('GET /api/writing/config returns topics and criteria', async () => {
  const data = await (await fetch(`${BASE}/api/writing/config`)).json();
  assert.ok(data.sampleTopics.length > 0);
  assert.equal(data.criteria.length, 4);
});

test('GET /api/writing/history returns an array', async () => {
  const data = await (await fetch(`${BASE}/api/writing/history`)).json();
  assert.ok(Array.isArray(data));
});

test('POST /api/placement/results saves and de-duplicates a valid result', async () => {
  const result = {
    id: 'attempt_smoke_test', timestamp: '2026-01-01T00:00:00.000Z', answers: { r1: 0 },
    score: { correct: 1, total: 2, percentage: 50 }, estimatedBand: '5.0',
    sectionBreakdown: { reading: { percentage: 50 }, listening: { percentage: 50 } },
    weakAreas: [{ questionId: 'r2', section: 'reading', difficulty: 'B1' }]
  };
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  assert.equal((await fetch(`${BASE}/api/placement/results`, options)).status, 201);
  assert.equal((await fetch(`${BASE}/api/placement/results`, options)).status, 200);

  const history = await (await fetch(`${BASE}/api/placement/history`)).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, result.id);
});

test('POST /api/placement/results rejects incomplete data', async () => {
  const res = await fetch(`${BASE}/api/placement/results`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimatedBand: '5.0' })
  });
  assert.equal(res.status, 400);
});

test('POST /api/analytics/roadmap and /api/analytics/study-plan validate weak areas before calling Gemini', async () => {
  for (const endpoint of ['/api/analytics/roadmap', '/api/analytics/study-plan']) {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weakAreas: [] })
    });
    assert.equal(res.status, 400, endpoint);
  }
});

test('POST /api/writing/score rejects an empty essay', async () => {
  const res = await fetch(`${BASE}/api/writing/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ essay: '' })
  });
  assert.equal(res.status, 400);
});

test('POST /api/writing/score rejects essays under 250 words', async () => {
  const res = await fetch(`${BASE}/api/writing/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ essay: sampleEssay(100) })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.wordCount, 100);
});

test('POST /api/writing/score scores a valid essay with Gemini',
  { skip: !process.env.GEMINI_API_KEY && 'GEMINI_API_KEY not set — live Gemini call skipped' },
  async () => {
    const essay = `In recent years, online learning has grown rapidly, and some people argue that it will eventually replace traditional university classrooms. While I accept that digital education offers clear benefits, I disagree that it will completely replace face-to-face teaching.

On the one hand, online courses are flexible and affordable. Students can watch lectures at any time, which allows working adults and people in remote areas to gain qualifications without relocating. Furthermore, universities can reach thousands of learners at a fraction of the cost of running physical campuses. For example, platforms such as Coursera now offer degrees from well-known institutions entirely online.

On the other hand, traditional classrooms provide experiences that are difficult to reproduce on a screen. Direct interaction with lecturers and classmates encourages discussion, critical thinking and teamwork, which are essential skills in most careers. In addition, many subjects, including medicine, engineering and the natural sciences, require laboratory work and hands-on practice that cannot be delivered remotely. Campus life also helps young people develop independence and build professional networks.

In my view, the most likely future is a blended model in which universities combine online materials with in-person seminars and practical sessions. This approach keeps the convenience of digital tools while preserving the social and practical value of physical classrooms.

In conclusion, although online education will continue to expand and transform universities, I believe it will complement rather than replace traditional classroom learning, because human interaction and practical training remain central to higher education. Universities that successfully balance both approaches will be best placed to serve the next generation of students.`;
    const res = await fetch(`${BASE}/api/writing/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ essay, topic: 'Online education will replace traditional classrooms.' })
    });
    assert.equal(res.status, 200, await res.clone().text());
    const data = await res.json();
    assert.equal(data.criteria.length, 4);
    assert.ok(data.overall_band >= 0 && data.overall_band <= 9);
  }
);

test('speaking.html has 4-item nav, timer, textarea and loads its assets; all pages share the nav', async () => {
  const html = await (await fetch(`${BASE}/speaking.html`)).text();
  for (const id of ['speaking-input', 'btn-record', 'timer-big', 'history-list', 'btn-submit']) {
    assert.ok(html.includes(`id="${id}"`), `speaking.html should include #${id}`);
  }
  assert.ok(html.includes('js/speaking.js') && html.includes('css/speaking.css'));
  for (const page of ['/index.html', '/writing.html', '/speaking.html', '/analytics.html']) {
    const text = await (await fetch(BASE + page)).text();
    for (const label of ['Placement Test', 'Writing Practice', 'Speaking Practice', 'Analytics']) {
      assert.ok(text.includes(`>${label}</a>`), `${page} nav should include ${label}`);
    }
  }
  for (const asset of ['/js/speaking.js', '/css/speaking.css']) {
    assert.equal((await fetch(BASE + asset)).status, 200, asset);
  }
});

test('analytics page and script include Speaking integration', async () => {
  const html = await (await fetch(`${BASE}/analytics.html`)).text();
  assert.ok(html.includes('id="speaking-score"'));
  const js = await (await fetch(`${BASE}/js/analytics.js`)).text();
  assert.ok(js.includes('/api/speaking/history') && js.includes('ielts_speaking_history'));
});

test('config.json contains the 4 Speaking criteria and speaking settings', async () => {
  const cfg = await (await fetch(`${BASE}/config.json`)).json();
  const abbrs = Object.values(cfg.speakingCriteria).map(c => c.abbreviation).sort();
  assert.deepEqual(abbrs, ['FC', 'GRA', 'LR', 'PR']);
  assert.ok(cfg.speakingSystemInstruction && cfg.speakingResponseFormat);
  assert.ok(cfg.sampleSpeakingTopics.length >= 3);
  assert.equal(cfg.speakingWordCountRequirements.min, 40);
});

test('GET /api/speaking/config returns topics, criteria and word requirements', async () => {
  const data = await (await fetch(`${BASE}/api/speaking/config`)).json();
  assert.ok(data.sampleTopics.length >= 3);
  assert.equal(data.criteria.length, 4);
  assert.equal(data.wordCountRequirements.min, 40);
  assert.ok(data.model);
});

test('GET /api/speaking/history returns an array', async () => {
  const data = await (await fetch(`${BASE}/api/speaking/history`)).json();
  assert.ok(Array.isArray(data));
});

test('POST /api/speaking/score rejects an empty transcript', async () => {
  const res = await fetch(`${BASE}/api/speaking/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: '   ' })
  });
  assert.equal(res.status, 400);
});

test('POST /api/speaking/score rejects transcripts under 40 words', async () => {
  const res = await fetch(`${BASE}/api/speaking/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: sampleEssay(20), topic: 'Describe a teacher.' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.wordCount, 20);
  assert.equal(body.minRequired, 40);
});

test('POST /api/speaking/score scores a valid transcript with Gemini',
  { skip: !process.env.GEMINI_API_KEY && 'GEMINI_API_KEY not set — live Gemini call skipped' },
  async () => {
    const transcript = 'I would like to talk about my English teacher, Ms Lan, who really inspired me when I was in high school. She taught me that making mistakes is a normal part of learning a language. Every lesson she used songs and short stories, so I never felt bored. Because of her encouragement I started speaking in front of the class, and my confidence grew a lot. I still remember how proud I felt after my first presentation, and that is why she influenced me so much.';
    const res = await fetch(`${BASE}/api/speaking/score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, topic: 'Describe a teacher who has influenced you.' })
    });
    assert.equal(res.status, 200, await res.clone().text());
    const data = await res.json();
    assert.equal(data.criteria.length, 4);
    const history = await (await fetch(`${BASE}/api/speaking/history`)).json();
    assert.ok(history.length >= 1);
  }
);
