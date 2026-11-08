# IELTS Master — Placement Test

A professional IELTS self-study platform starting with a **Placement Test** module. This page assesses learners' English proficiency through 15 multiple-choice Reading and Listening questions, estimates their IELTS band score, and stores results in a mock database for future analytics.

---

## 🏗️ Architecture Overview

The application follows a **modular architecture** pattern — each JavaScript file is a self-contained [IIFE (Immediately Invoked Function Expression)](https://developer.mozilla.org/en-US/docs/Glossary/IIFE) module exposing a clean public API. There are no external frameworks or dependencies; it is built with **vanilla HTML, CSS, and JavaScript**.

```
ielts-master/
│
├── index.html              # Entry point — loads CSS and JS modules
│
├── css/
│   └── main.css            # Complete design system (tokens, components, responsive)
│
├── js/
│   ├── questions.js        # QuestionBank — question data & passage content
│   ├── database.js         # MockDatabase — localStorage persistence layer
│   ├── scoring.js          # ScoringEngine — scoring logic & band estimation
│   ├── ui.js               # UI — DOM rendering, interaction handling
│   └── app.js              # App — application controller & lifecycle
│
├── assets/                 # (Reserved) Images, audio files, etc.
└── README.md               # This file
```

---

## 📦 Module Descriptions

### `QuestionBank` (`js/questions.js`)
- Stores all question data: passages, transcripts, and question objects.
- Each question has: `id`, `section`, `text`, `options[]`, `correct` (index), `explanation`, `difficulty`.
- Provides read-only accessors: `getReadingQuestions()`, `getListeningQuestions()`, `getAllQuestions()`, etc.
- **Extending**: Add new questions by appending objects to `readingQuestions` or `listeningQuestions` arrays.

### `MockDatabase` (`js/database.js`)
- Simulates a database using `localStorage` for persistence across sessions.
- API: `saveResult(result)`, `getAllResults()`, `getLatestResult()`, `clearAll()`, `exportJSON()`.
- Each record includes: auto-generated `id`, ISO `timestamp`, full answer map, score breakdown, and weak areas.
- **Migration path**: Replace localStorage calls with `fetch()` API calls to a real backend.

### `ScoringEngine` (`js/scoring.js`)
- Pure function `evaluate(answers, questions)` that produces a full scoring result.
- Calculates: total score, per-section breakdown (Reading/Listening), IELTS band estimate, CEFR level.
- Identifies weak areas (wrong answers with difficulty/section tags) for downstream analytics.
- `getRecommendation(band)` returns a study suggestion string based on the estimated band.

### `UI` (`js/ui.js`)
- Handles all DOM manipulation and user interactions.
- `renderTest()` — generates section headers, passage cards, and question cards.
- `renderResults(result)` — displays the results dashboard with animated score bars.
- `collectAnswers()` — reads selected radio button values into an answer map.
- Includes: timer management, progress tracking, toast notifications, answer review panel.

### `App` (`js/app.js`)
- Application controller orchestrating the test lifecycle: **Intro → Testing → Results**.
- Coordinates: `QuestionBank` → `UI.renderTest()` → `UI.collectAnswers()` → `ScoringEngine.evaluate()` → `MockDatabase.saveResult()` → `UI.renderResults()`.
- Handles: test start, submission with validation, retake, and JSON export.

---

## 🚀 Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge).
- No build tools, no `npm install`, no server required.

### Running Locally

**Option A: Simply open the file**
```
Open index.html in your browser.
```

**Option B: Use a local dev server** (recommended for best experience)
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using VS Code
# Install "Live Server" extension → Right-click index.html → Open with Live Server
```

Then navigate to `http://localhost:8000`.

---

## 🗄️ Mock Database Schema

Each test attempt is stored as a JSON object:

```json
{
  "id": "attempt_1730000000000_abc123",
  "timestamp": "2024-10-27T10:30:00.000Z",
  "answers": {
    "r1": 1,
    "r2": 2,
    "l1": 1
  },
  "score": {
    "correct": 12,
    "total": 15,
    "percentage": 80
  },
  "estimatedBand": "7.0",
  "timeSpentSeconds": 540,
  "sectionBreakdown": {
    "reading":   { "correct": 7, "total": 8, "percentage": 88 },
    "listening": { "correct": 5, "total": 7, "percentage": 71 }
  },
  "weakAreas": [
    { "questionId": "r4", "section": "reading", "difficulty": "B2" }
  ],
  "metadata": {
    "totalQuestions": 15,
    "version": "1.0.0"
  }
}
```

**Accessing data programmatically** (browser console):
```javascript
MockDatabase.getAllResults();       // All past attempts
MockDatabase.getLatestResult();    // Most recent attempt
MockDatabase.exportJSON();         // Full JSON export
MockDatabase.clearAll();           // Reset database
```

---

## 🎨 Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Minimalist** | Clean card-based layout, ample whitespace, clear typography |
| **Dark Theme** | Deep navy palette with indigo/teal accent gradients |
| **Glassmorphism** | Frosted glass header with `backdrop-filter` |
| **Micro-animations** | Smooth transitions on selections, progress bar, result bars |
| **Responsive** | Mobile-first design with breakpoints at 640px |
| **Accessible** | Semantic HTML, proper label associations, keyboard navigable |

---

## 🔧 Extending the Application

### Adding New Questions
Edit `js/questions.js` — append to the `readingQuestions` or `listeningQuestions` array:
```javascript
{
  id: 'r9',
  section: 'reading',
  text: 'Your question text here?',
  options: ['Option A', 'Option B', 'Option C', 'Option D'],
  correct: 0,           // Index of correct option (0-based)
  explanation: 'Why this answer is correct.',
  difficulty: 'B1'      // A1, A2, B1, B2, C1, C2
}
```

### Connecting a Real Backend
Replace `MockDatabase` methods with API calls:
```javascript
// Instead of localStorage
async saveResult(result) {
  const response = await fetch('/api/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  });
  return response.json();
}
```

### Future Modules (Planned)
- **Proficiency Analyzer** — Uses stored results to generate skill radar charts.
- **Adaptive Learning Path** — Recommends study materials based on weak areas.
- **Writing & Speaking Practice** — AI-powered feedback on open-ended responses.
- **Full Mock Tests** — Timed, section-complete IELTS simulations.

---

## 📝 Writing Task 2 — AI Scoring (Gemini)

Page `writing.html` lets learners paste an essay and get it scored by Gemini on the 4 official IELTS criteria: **TR, CC, LR, GRA**.

```
server.js           # Express backend: static files + /api/writing/* endpoints
config.json         # ⚙️ All scoring prompts & criteria — edit this to tune grading
writing.html        # Writing practice page (textarea, results, history sidebar)
js/writing.js       # WritingApp module — word count, submit, render results
css/writing.css     # Writing page styles
tests/smoke.test.js # API smoke tests (node:test)
results/            # Scoring log (writing_results.json), git-ignored
```

### Setup
```bash
npm install
cp .env.example .env      # then put your key in GEMINI_API_KEY
npm start                 # http://localhost:3000/writing.html
npm test                  # run smoke tests (live Gemini test runs only if key is set)
```

### Editing the grading prompts (`config.json`)
| Key | Purpose |
|-----|---------|
| `model` | Gemini model (default `gemini-2.5-flash`) |
| `systemInstruction` | Examiner persona / global rules |
| `scoringCriteria.<key>.prompt` | Instructions for each criterion (TR, CC, LR, GRA) |
| `responseFormat` | JSON schema Gemini must return |
| `sampleTopics` | Topics shown in the UI |
| `wordCountRequirements.min` | Minimum words accepted by the API |

Restart the server after editing `config.json`.

### API
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/writing/score` | Body `{ essay, topic }` → `{ criteria[4], overall_band, overall_feedback, suggestions[] }` |
| `GET`  | `/api/writing/history` | Past scored essays |
| `GET`  | `/api/writing/config` | Topics, criteria & word-count rules for the UI |

> The Placement Test (`index.html`) still works as a static page; the Writing page requires `npm start`.

---

## 📝 License

MIT — Free for personal and commercial use.
