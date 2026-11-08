/**
 * IELTS Placement Test — Scoring Engine Module
 * 
 * Calculates scores, determines IELTS band estimates, and
 * identifies weak areas for downstream analytics.
 */

const ScoringEngine = (() => {

  /**
   * IELTS Band mapping based on percentage correct.
   * Approximate alignment with IELTS scoring rubric.
   */
  const BAND_THRESHOLDS = [
    { min: 93, band: '8.0+', label: 'Expert',              level: 'C1–C2' },
    { min: 80, band: '7.0',  label: 'Very Good',           level: 'B2–C1' },
    { min: 67, band: '6.0',  label: 'Competent',           level: 'B2'    },
    { min: 53, band: '5.5',  label: 'Modest',              level: 'B1–B2' },
    { min: 40, band: '5.0',  label: 'Limited',             level: 'B1'    },
    { min: 27, band: '4.0',  label: 'Very Limited',        level: 'A2–B1' },
    { min: 0,  band: '3.0',  label: 'Extremely Limited',   level: 'A1–A2' }
  ];

  /**
   * Evaluate a set of user answers against question data.
   * 
   * @param {Object}  answers   - Map of questionId → selectedOptionIndex.
   * @param {Array}   questions - Array of question objects from QuestionBank.
   * @returns {Object} Full scoring result ready for database storage.
   */
  function evaluate(answers, questions) {
    let totalCorrect = 0;
    let readingCorrect = 0;
    let readingTotal = 0;
    let listeningCorrect = 0;
    let listeningTotal = 0;
    const questionResults = [];
    const weakAreas = [];

    questions.forEach(q => {
      const userAnswer = answers[q.id];
      const isCorrect = userAnswer === q.correct;

      if (isCorrect) totalCorrect++;

      if (q.section === 'reading') {
        readingTotal++;
        if (isCorrect) readingCorrect++;
      } else {
        listeningTotal++;
        if (isCorrect) listeningCorrect++;
      }

      questionResults.push({
        id: q.id,
        section: q.section,
        difficulty: q.difficulty,
        correct: isCorrect,
        userAnswer,
        correctAnswer: q.correct
      });

      // Track wrong answers for weak-area analysis
      if (!isCorrect) {
        weakAreas.push({
          questionId: q.id,
          section: q.section,
          difficulty: q.difficulty
        });
      }
    });

    const totalQuestions = questions.length;
    const percentage = Math.round((totalCorrect / totalQuestions) * 100);
    const readingPct = readingTotal > 0 ? Math.round((readingCorrect / readingTotal) * 100) : 0;
    const listeningPct = listeningTotal > 0 ? Math.round((listeningCorrect / listeningTotal) * 100) : 0;

    const bandInfo = _getBand(percentage);

    return {
      answers,
      score: {
        correct: totalCorrect,
        total: totalQuestions,
        percentage
      },
      sectionBreakdown: {
        reading:   { correct: readingCorrect,   total: readingTotal,   percentage: readingPct },
        listening: { correct: listeningCorrect, total: listeningTotal, percentage: listeningPct }
      },
      estimatedBand: bandInfo.band,
      bandLabel: bandInfo.label,
      cefr: bandInfo.level,
      weakAreas,
      questionResults
    };
  }

  /**
   * Map a percentage score to an IELTS band.
   */
  function _getBand(percentage) {
    for (const threshold of BAND_THRESHOLDS) {
      if (percentage >= threshold.min) return threshold;
    }
    return BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1];
  }

  /**
   * Generate a textual recommendation based on band.
   */
  function getRecommendation(band) {
    const recommendations = {
      '8.0+': 'Excellent! You demonstrate near-native proficiency. Focus on refining academic writing and complex argumentation.',
      '7.0':  'Great level! Strengthen your academic vocabulary and practice timed writing for further improvement.',
      '6.0':  'Solid foundation. Work on paraphrasing skills, complex sentence structures, and expanding topic-specific vocabulary.',
      '5.5':  'Good start. Focus on grammar accuracy, reading speed, and listening for specific details.',
      '5.0':  'You have basic competence. Prioritize building core vocabulary and practicing reading comprehension strategies.',
      '4.0':  'Foundation level. Start with essential grammar patterns, high-frequency vocabulary, and basic listening exercises.',
      '3.0':  'Beginner level. We recommend starting with fundamental English courses before attempting IELTS preparation.'
    };
    return recommendations[band] || 'Continue practicing to improve your English skills.';
  }

  /* ── Public API ─────────────────────────────────────── */

  return { evaluate, getRecommendation };

})();
