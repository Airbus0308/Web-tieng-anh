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
const resultsDir = path.join(__dirname, 'results');
const resultsFile = path.join(resultsDir, 'writing_results.json');

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

// Serve static files from project root
app.use(express.static(__dirname));

/**
 * Helper to count words in a text string
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
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

/**
 * POST /api/writing/score
 * Evaluates an IELTS Writing Task 2 essay using Google GenAI SDK
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

    // Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[ERROR] GEMINI_API_KEY is not defined in environment variables.');
      return res.status(500).json({
        error: 'Server configuration error: GEMINI_API_KEY is missing.'
      });
    }

    console.log(`[INFO] Evaluating essay (${wordCount} words) using model: ${config.model}...`);

    // Initialize Google GenAI client
    const ai = new GoogleGenAI({ apiKey });
    const promptText = buildEvaluationPrompt(essay, topic);

    // Call Gemini API (retries transient 429/503 errors with exponential backoff)
    const response = await generateWithRetry(ai, {
      model: config.model,
      contents: promptText,
      config: { responseMimeType: 'application/json' }
    });

    let rawText = response.text || '';

    // Clean potential markdown delimiters if present
    rawText = rawText.trim();
    if (rawText.startsWith('```json')) {
      rawText = rawText.slice(7);
    } else if (rawText.startsWith('```')) {
      rawText = rawText.slice(3);
    }
    if (rawText.endsWith('```')) {
      rawText = rawText.slice(0, -3);
    }
    rawText = rawText.trim();

    let result;
    try {
      result = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[ERROR] Failed to parse Gemini response as JSON. Raw output:', rawText);
      return res.status(502).json({
        error: 'Failed to parse assessment result from Gemini as JSON.',
        raw: rawText
      });
    }

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
      let history = [];
      if (fs.existsSync(resultsFile)) {
        const fileContent = fs.readFileSync(resultsFile, 'utf-8');
        if (fileContent.trim()) {
          const parsedHistory = JSON.parse(fileContent);
          if (Array.isArray(parsedHistory)) {
            history = parsedHistory;
          }
        }
      }
      history.push(record);
      fs.writeFileSync(resultsFile, JSON.stringify(history, null, 2), 'utf-8');
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
    if (!fs.existsSync(resultsFile)) {
      return res.json([]);
    }
    const fileContent = fs.readFileSync(resultsFile, 'utf-8');
    if (!fileContent.trim()) {
      return res.json([]);
    }
    const history = JSON.parse(fileContent);
    return res.json(Array.isArray(history) ? history : []);
  } catch (err) {
    console.error('[ERROR] Failed to fetch writing history:', err);
    return res.status(500).json({
      error: 'Failed to retrieve writing evaluation history.',
      details: err.message
    });
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
  console.log(`====================================================`);
});
