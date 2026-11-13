import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// Initialize environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config;
try {
  const configFile = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(configFile);
  console.log(`[INFO] Loaded configuration from ${configPath} (Model: ${config.model})`);
} catch (err) {
  console.error(`[FATAL] Failed to read or parse config.json:`, err);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Results storage paths
const resultsDir = process.env.IELTS_RESULTS_DIR || path.join(__dirname, 'results');
const resultsFile = path.join(resultsDir, 'writing_results.json');
const placementResultsFile = path.join(resultsDir, 'placement_results.json');
const speakingResultsFile = path.join(resultsDir, 'speaking_results.json');
const runtimeKeysFile = path.join(resultsDir, 'gemini_keys.json');

// Ensure results directory exists
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Only publish application assets. Never expose source, environment, tests or results.
app.get(['/', '/index.html', '/writing.html', '/speaking.html', '/analytics.html'], (req, res) => {
  const page = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(path.join(__dirname, page));
});
app.get('/config.json', (req, res) => res.sendFile(configPath));
for (const directory of ['css', 'js', 'assets']) {
  app.use(`/${directory}`, express.static(path.join(__dirname, directory), { dotfiles: 'deny' }));
}

// One shared budget across all Gemini endpoints, including the study-plan alias.
// Express does not trust proxy headers by default, so clients cannot spoof req.ip.
const aiRateWindowMs = 15 * 60 * 1000;
const aiRateLimit = 10;
const aiRequestsByIp = new Map();
function limitAiRequests(req, res, next) {
  const now = Date.now();
  for (const [ip, entry] of aiRequestsByIp) {
    if (now >= entry.resetAt) aiRequestsByIp.delete(ip);
  }
  const ip = req.ip;
  const entry = aiRequestsByIp.get(ip) || { count: 0, resetAt: now + aiRateWindowMs };
  if (entry.count >= aiRateLimit) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many AI requests. Please try again later.' });
  }
  entry.count += 1;
  aiRequestsByIp.set(ip, entry);
  next();
}
app.post([
  '/api/writing/score', '/api/speaking/score',
  '/api/analytics/roadmap', '/api/analytics/study-plan'
], limitAiRequests);

/**
 * Helper to count words in a text string
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) return [];
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : [];
}

function writeJsonArray(filePath, records) {
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

function parseGeminiJson(response) {
  let rawText = (response.text || '').trim();
  if (rawText.startsWith('```json')) rawText = rawText.slice(7);
  else if (rawText.startsWith('```')) rawText = rawText.slice(3);
  if (rawText.endsWith('```')) rawText = rawText.slice(0, -3);
  return JSON.parse(rawText.trim());
}

/* ── Multi-Key Pool & Auto-Rotation Engine ────────────── */

const KEY_COOLDOWN_MS = 60 * 1000;
const keyCooldownUntil = new Map();
let roundRobinCursor = 0;

function splitKeyString(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(Boolean);
}

function maskApiKey(key) {
  const k = String(key || '').trim();
  if (k.length <= 10) return '••••' + k.slice(-3);
  return `${k.slice(0, 6)}••••••••${k.slice(-4)}`;
}

function getEnvApiKeys() {
  return [
    ...splitKeyString(process.env.GEMINI_API_KEYS || ''),
    ...splitKeyString(process.env.GEMINI_API_KEY || '')
  ];
}

function getRuntimeApiKeys() {
  try {
    return readJsonArray(runtimeKeysFile).filter(k => typeof k === 'string' && k.trim());
  } catch {
    return [];
  }
}

function saveRuntimeApiKeys(keys) {
  const unique = [...new Set(keys.map(k => String(k || '').trim()).filter(Boolean))];
  writeJsonArray(runtimeKeysFile, unique);
  return unique;
}

function collectAvailableKeys(req) {
  const headerKeys = splitKeyString(req?.headers?.['x-gemini-api-key'] || '');
  const bodyKeys = Array.isArray(req?.body?.apiKeys)
    ? req.body.apiKeys.flatMap(splitKeyString)
    : splitKeyString(req?.body?.apiKey || '');
  const runtimeKeys = getRuntimeApiKeys();
  const envKeys = getEnvApiKeys();

  return [...new Set([...headerKeys, ...bodyKeys, ...runtimeKeys, ...envKeys])];
}

function buildKeyPoolStatus() {
  const now = Date.now();
  const envKeys = getEnvApiKeys();
  const runtimeKeys = getRuntimeApiKeys();
  const seen = new Set();
  const list = [];

  for (const k of [...runtimeKeys, ...envKeys]) {
    if (seen.has(k)) continue;
    seen.add(k);
    const cooldownAt = keyCooldownUntil.get(k) || 0;
    list.push({
      masked: maskApiKey(k),
      source: runtimeKeys.includes(k) ? 'runtime' : 'env',
      status: cooldownAt > now ? 'cooldown' : 'ready'
    });
  }

  return {
    totalKeys: list.length,
    activeKeys: list.filter(x => x.status === 'ready').length,
    keys: list
  };
}

/**
 * GET /api/settings/keys
 * Returns masked status of all configured Gemini API keys in the rotation pool.
 */
app.get('/api/settings/keys', (req, res) => {
  res.json(buildKeyPoolStatus());
});

/**
 * POST /api/settings/keys
 * Adds one or multiple Gemini API keys to the server's runtime rotation pool.
 */
app.post('/api/settings/keys', (req, res) => {
  const rawInput = req.body?.keys ?? req.body?.apiKey ?? '';
  const incoming = Array.isArray(rawInput)
    ? rawInput.flatMap(splitKeyString)
    : splitKeyString(String(rawInput));

  if (!incoming.length) {
    return res.status(400).json({ error: 'At least one valid Gemini API key is required.' });
  }

  const existing = getRuntimeApiKeys();
  saveRuntimeApiKeys([...existing, ...incoming]);
  return res.status(200).json(buildKeyPoolStatus());
});

/**
 * DELETE /api/settings/keys
 * Clears runtime-added Gemini API keys.
 */
app.delete('/api/settings/keys', (req, res) => {
  saveRuntimeApiKeys([]);
  keyCooldownUntil.clear();
  return res.status(200).json(buildKeyPoolStatus());
});

/**
 * Call Gemini using the key pool.
 * Automatically rotates to the next key immediately if a key hits 429 rate limit,
 * quota exhaustion, or invalid key errors.
 */
async function generateWithKeyPool(req, promptText) {
  const allKeys = collectAvailableKeys(req);
  if (!allKeys.length) {
    return { missingKey: true };
  }

  const now = Date.now();
  // Order keys starting from roundRobinCursor, prioritizing non-cooldown keys
  const rotated = [];
  for (let i = 0; i < allKeys.length; i++) {
    rotated.push(allKeys[(roundRobinCursor + i) % allKeys.length]);
  }
  roundRobinCursor = (roundRobinCursor + 1) % allKeys.length;

  const readyKeys = rotated.filter(k => (keyCooldownUntil.get(k) || 0) <= now);
  const cooldownKeys = rotated.filter(k => (keyCooldownUntil.get(k) || 0) > now);
  const orderedKeys = [...readyKeys, ...cooldownKeys];

  let lastError = null;

  for (let idx = 0; idx < orderedKeys.length; idx++) {
    const apiKey = orderedKeys[idx];
    const ai = new GoogleGenAI({ apiKey });
    // If multiple keys exist, rotate immediately on 429; if only 1 key exists, retry with backoff
    const maxAttemptsForThisKey = orderedKeys.length > 1 ? 1 : 3;

    try {
      const response = await generateWithRetry(ai, {
        model: config.model,
        contents: promptText,
        config: { responseMimeType: 'application/json' }
      }, maxAttemptsForThisKey);

      keyCooldownUntil.delete(apiKey);
      return { response, usedKeyMasked: maskApiKey(apiKey) };
    } catch (err) {
      lastError = err;
      const status = err?.status ?? err?.code;
      const msg = String(err?.message || '');
      const isRateOrQuota = status === 429 || status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate/i.test(msg);
      const isAuthError = status === 400 || status === 401 || status === 403 || /API_KEY_INVALID|permission/i.test(msg);

      if (isRateOrQuota || isAuthError) {
        keyCooldownUntil.set(apiKey, Date.now() + KEY_COOLDOWN_MS);
        console.warn(`[WARN] Key ${maskApiKey(apiKey)} hit limit/error (${status || msg}). Rotating to next key (${idx + 1}/${orderedKeys.length})...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All configured Gemini API keys exhausted their quota.');
}

/**
 * Call Gemini, retrying temporary failures (HTTP 429 rate limit / 503 overloaded).
 * Waits 2s, 4s, 8s between attempts.
 */
async function generateWithRetry(ai, request, maxAttempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ai.models.generateContent(request);
    } catch (err) {
      const status = err?.status ?? err?.code;
      const retryable = status === 429 || status === 503 || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(err?.message || '');
      if (!retryable || attempt >= maxAttempts) throw err;
      const delay = 2000 * 2 ** (attempt - 1);
      console.warn(`[WARN] Gemini busy (${status}), retry ${attempt}/${maxAttempts - 1} in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Helper to build evaluation prompt for Gemini
 */
function buildEvaluationPrompt(essay, topic) {
  const criteriaList = Object.entries(config.scoringCriteria)
    .map(([key, item]) => {
      return `### ${item.name} (${item.abbreviation}) [Weight: ${Math.round(item.weight * 100)}%]:\n${item.prompt}`;
    })
    .join('\n\n');

  const responseFormatStr = typeof config.responseFormat === 'string'
    ? config.responseFormat
    : JSON.stringify(config.responseFormat, null, 2);

  return `
${config.systemInstruction}

============================================================
CRITERIA FOR EVALUATION:
============================================================
${criteriaList}

============================================================
RESPONSE FORMAT INSTRUCTIONS:
============================================================
${responseFormatStr}

Respond ONLY with a valid JSON object matching the requested schema. Do NOT enclose in markdown code block markers (like \`\`\`json) and do not output any conversational prelude or epilogue.

============================================================
ESSAY SUBMISSION FOR EVALUATION:
============================================================
Topic / Writing Task:
${topic ? topic.trim() : 'IELTS Writing Task 2 Essay'}

Candidate's Essay (${countWords(essay)} words):
"""
${essay.trim()}
"""
`.trim();
}

/**
 * GET /api/writing/config
 * Exposes prompt config, sample topics, and requirements for UI consumption
 */
app.get('/api/writing/config', (req, res) => {
  res.json({
    model: config.model,
    wordCountRequirements: config.wordCountRequirements,
    sampleTopics: config.sampleTopics,
    criteria: Object.values(config.scoringCriteria).map(c => ({
      name: c.name,
      abbreviation: c.abbreviation,
      weight: c.weight
    }))
  });
});

/** Save a Placement Test attempt, de-duplicated by its client-generated id. */
app.post('/api/placement/results', (req, res) => {
  try {
    const result = req.body;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return res.status(400).json({ error: 'A placement result object is required.' });
    }
    if (!result.score || !Number.isFinite(Number(result.score.total)) ||
        !Number.isFinite(Number(result.score.correct)) || result.estimatedBand == null) {
      return res.status(400).json({ error: 'score and estimatedBand are required.' });
    }

    const history = readJsonArray(placementResultsFile);
    const requestedId = typeof result.id === 'string' && result.id.trim() ? result.id.trim() : null;
    const existing = requestedId && history.find(item => item.id === requestedId);
    if (existing) return res.status(200).json(existing);

    const record = {
      ...result,
      id: requestedId || `attempt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: result.timestamp || new Date().toISOString()
    };
    history.push(record);
    writeJsonArray(placementResultsFile, history);
    return res.status(201).json(record);
  } catch (err) {
    console.error('[ERROR] Failed to save placement result:', err);
    return res.status(500).json({ error: 'Failed to save placement result.', details: err.message });
  }
});

/** Return all Placement Test attempts. */
app.get('/api/placement/history', (req, res) => {
  try {
    return res.json(readJsonArray(placementResultsFile));
  } catch (err) {
    console.error('[ERROR] Failed to fetch placement history:', err);
    return res.status(500).json({ error: 'Failed to retrieve placement history.', details: err.message });
  }
});

/** Generate a personalized study roadmap from the learner's aggregated weaknesses. */
async function handleAnalyticsRoadmap(req, res) {
  try {
    const { weakAreas, summary = {} } = req.body || {};
    if (!Array.isArray(weakAreas) || weakAreas.length === 0) {
      return res.status(400).json({ error: 'weakAreas must be a non-empty array.' });
    }

    const basePrompt = config.studyPlanPrompt || config.analyticsRoadmapPrompt;
    const prompt = `${basePrompt}\n\nLearner summary:\n${JSON.stringify(summary, null, 2)}\n\nWeak areas:\n${JSON.stringify(weakAreas, null, 2)}`;

    const gen = await generateWithKeyPool(req, prompt);
    if (gen.missingKey) {
      return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
    }

    return res.json(parseGeminiJson(gen.response));
  } catch (err) {
    console.error('[ERROR] Failed to generate analytics roadmap:', err);
    return res.status(500).json({ error: 'Failed to generate a study roadmap.', details: err.message });
  }
}

app.post('/api/analytics/roadmap', handleAnalyticsRoadmap);
app.post('/api/analytics/study-plan', handleAnalyticsRoadmap);

/**
 * POST /api/writing/score
 * Evaluates an IELTS Writing Task 2 essay using Google GenAI SDK with Multi-Key Rotation
 */
app.post('/api/writing/score', async (req, res) => {
  try {
    const { essay, topic } = req.body;

    // Validate essay presence
    if (!essay || typeof essay !== 'string' || !essay.trim()) {
      return res.status(400).json({
        error: 'Essay text is required.'
      });
    }

    // Validate word count
    const wordCount = countWords(essay);
    const minWords = config.wordCountRequirements?.min || 250;
    if (wordCount < minWords) {
      return res.status(400).json({
        error: `Essay does not meet the minimum word count of ${minWords} words (current: ${wordCount} words).`,
        wordCount,
        minRequired: minWords
      });
    }

    const promptText = buildEvaluationPrompt(essay, topic);
    const gen = await generateWithKeyPool(req, promptText);
    if (gen.missingKey) {
      console.error('[ERROR] No Gemini API keys available in environment or key pool.');
      return res.status(500).json({
        error: 'Server configuration error: GEMINI_API_KEY is missing.'
      });
    }

    console.log(`[INFO] Evaluated essay (${wordCount} words) using key ${gen.usedKeyMasked} (Model: ${config.model})`);

    let result;
    try {
      result = parseGeminiJson(gen.response);
    } catch (parseErr) {
      console.error('[ERROR] Failed to parse Gemini response as JSON.');
      return res.status(502).json({
        error: 'Failed to parse assessment result from Gemini as JSON.',
        raw: gen.response?.text || ''
      });
    }

    // Keep only corrections that point to text actually present in this essay.
    result.inline_corrections = Array.isArray(result.inline_corrections)
      ? result.inline_corrections.filter(item =>
        item && typeof item.original === 'string' && item.original.trim() &&
        essay.includes(item.original) && typeof item.correction === 'string' &&
        item.correction.trim() && typeof item.explanation === 'string')
      : [];

    // Prepare log record
    const record = {
      id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      topic: topic ? topic.trim() : null,
      wordCount,
      essay: essay.trim(),
      result
    };

    // Append to local results/writing_results.json
    try {
      const history = readJsonArray(resultsFile);
      history.push(record);
      writeJsonArray(resultsFile, history);
      console.log(`[INFO] Saved evaluation record ${record.id} to ${resultsFile}`);
    } catch (storageErr) {
      console.warn(`[WARN] Failed to save evaluation to ${resultsFile}:`, storageErr.message);
    }

    // Return the parsed scoring result along with metadata
    return res.status(200).json({
      ...result,
      id: record.id,
      timestamp: record.timestamp,
      wordCount
    });

  } catch (error) {
    console.error('[ERROR] Error processing writing evaluation:', error);
    return res.status(500).json({
      error: 'An error occurred while evaluating the essay.',
      details: error.message
    });
  }
});

/**
 * GET /api/writing/history
 * Returns past writing results from results/writing_results.json
 */
app.get('/api/writing/history', (req, res) => {
  try {
    return res.json(readJsonArray(resultsFile));
  } catch (err) {
    console.error('[ERROR] Failed to fetch writing history:', err);
    return res.status(500).json({
      error: 'Failed to retrieve writing evaluation history.',
      details: err.message
    });
  }
});

/**
 * Build the Gemini prompt for IELTS Speaking Part 2/3 evaluation (all text lives in config.json)
 */
function buildSpeakingPrompt(transcript, topic, part) {
  const criteriaList = Object.values(config.speakingCriteria)
    .map(item => `### ${item.name} (${item.abbreviation}) [Weight: ${Math.round(item.weight * 100)}%]:\n${item.prompt}`)
    .join('\n\n');
  const responseFormatStr = typeof config.speakingResponseFormat === 'string'
    ? config.speakingResponseFormat
    : JSON.stringify(config.speakingResponseFormat, null, 2);

  return `
${config.speakingSystemInstruction}

============================================================
CRITERIA FOR EVALUATION:
============================================================
${criteriaList}

============================================================
RESPONSE FORMAT INSTRUCTIONS:
============================================================
${responseFormatStr}

Respond ONLY with a valid JSON object matching the requested schema. Do NOT enclose in markdown code block markers and do not output any conversational prelude or epilogue.

============================================================
SPEAKING SUBMISSION FOR EVALUATION:
============================================================
Part: ${part || 'Part 2 (Cue Card) & Part 3'}
Topic / Cue Card:
${topic ? topic.trim() : 'IELTS Speaking Part 2'}

Candidate's transcript (${countWords(transcript)} words):
"""
${transcript.trim()}
"""
`.trim();
}

/**
 * GET /api/speaking/config
 */
app.get('/api/speaking/config', (req, res) => {
  res.json({
    model: config.model,
    wordCountRequirements: config.speakingWordCountRequirements,
    sampleTopics: config.sampleSpeakingTopics,
    criteria: Object.values(config.speakingCriteria).map(c => ({
      name: c.name,
      abbreviation: c.abbreviation,
      weight: c.weight
    }))
  });
});

/**
 * POST /api/speaking/score
 * Evaluates an IELTS Speaking transcript (min 40 words) with Gemini and stores the result.
 */
app.post('/api/speaking/score', async (req, res) => {
  try {
    const { transcript, topic, part, durationSeconds } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Speaking transcript is required.' });
    }
    const wordCount = countWords(transcript);
    const minWords = config.speakingWordCountRequirements?.min || 40;
    if (wordCount < minWords) {
      return res.status(400).json({
        error: `Transcript does not meet the minimum word count of ${minWords} words (current: ${wordCount} words).`,
        wordCount,
        minRequired: minWords
      });
    }

    const gen = await generateWithKeyPool(req, buildSpeakingPrompt(transcript, topic, part));
    if (gen.missingKey) {
      console.error('[ERROR] No Gemini API keys available in environment or key pool.');
      return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
    }

    console.log(`[INFO] Evaluated speaking transcript (${wordCount} words) using key ${gen.usedKeyMasked} (Model: ${config.model})`);

    let result;
    try {
      result = parseGeminiJson(gen.response);
    } catch (parseErr) {
      console.error('[ERROR] Failed to parse Gemini speaking response as JSON.');
      return res.status(502).json({ error: 'Failed to parse assessment result from Gemini as JSON.', raw: gen.response?.text });
    }

    const record = {
      id: `speak_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      topic: topic ? String(topic).trim() : null,
      part: part ? String(part) : null,
      wordCount,
      durationSeconds: Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : null,
      transcript: transcript.trim(),
      result
    };
    try {
      const history = readJsonArray(speakingResultsFile);
      history.push(record);
      writeJsonArray(speakingResultsFile, history);
    } catch (storageErr) {
      console.warn(`[WARN] Failed to save speaking evaluation:`, storageErr.message);
    }

    return res.status(200).json({ ...result, id: record.id, timestamp: record.timestamp, wordCount });
  } catch (error) {
    console.error('[ERROR] Error processing speaking evaluation:', error);
    return res.status(500).json({ error: 'An error occurred while evaluating the speaking response.', details: error.message });
  }
});

/**
 * GET /api/speaking/history
 */
app.get('/api/speaking/history', (req, res) => {
  try {
    return res.json(readJsonArray(speakingResultsFile));
  } catch (err) {
    console.error('[ERROR] Failed to fetch speaking history:', err);
    return res.status(500).json({ error: 'Failed to retrieve speaking evaluation history.', details: err.message });
  }
});

// Export the app so tests can mount it in-process
export default app;

// Start listening only when run directly (node server.js), not when imported by tests
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` IELTS Master Server is running on port ${PORT}`);
  console.log(` Static files served from: ${__dirname}`);
  console.log(` Health & endpoints:`);
  console.log(` - POST http://localhost:${PORT}/api/writing/score`);
  console.log(` - GET  http://localhost:${PORT}/api/writing/history`);
  console.log(` - GET  http://localhost:${PORT}/api/writing/config`);
  console.log(` - POST http://localhost:${PORT}/api/speaking/score`);
  console.log(` - GET  http://localhost:${PORT}/api/speaking/history`);
  console.log(` - GET  http://localhost:${PORT}/api/speaking/config`);
  console.log(` - POST http://localhost:${PORT}/api/placement/results`);
  console.log(` - GET  http://localhost:${PORT}/api/placement/history`);
  console.log(` - POST http://localhost:${PORT}/api/analytics/roadmap`);
  console.log(` - POST http://localhost:${PORT}/api/analytics/study-plan`);
  console.log(` - GET/POST/DELETE http://localhost:${PORT}/api/settings/keys`);
  console.log(`====================================================`);
});
