/**
 * IELTS Placement Test — Mock Database Module
 * 
 * Simulates a persistent data store using localStorage.
 * Stores test attempts, user scores, and analytics-ready data.
 * Designed to be replaced by a real backend in production.
 */

const MockDatabase = (() => {
  const STORAGE_KEY = 'ielts_placement_results';

  /**
   * Generate a unique ID for each test attempt.
   */
  function _generateId() {
    return 'attempt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Retrieve all stored results from localStorage.
   * @returns {Array} Array of test result objects.
   */
  function _getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      console.warn('[MockDB] Failed to read localStorage, returning empty array.');
      return [];
    }
  }

  /**
   * Persist the full results array to localStorage.
   */
  function _saveAll(results) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
    } catch {
      console.error('[MockDB] Failed to write to localStorage.');
    }
  }

  /* ── Public API ─────────────────────────────────────── */

  return {

    /**
     * Save a completed test attempt.
     * @param {Object} result - The test result to store.
     * @param {Object} result.answers       - Map of questionId → selectedIndex.
     * @param {Object} result.score         - Scoring breakdown object.
     * @param {string} result.estimatedBand - Estimated IELTS band (e.g. "5.5").
     * @returns {Object} The stored record, including generated id and timestamp.
     */
    saveResult(result) {
      const record = {
        id: _generateId(),
        timestamp: new Date().toISOString(),
        answers: result.answers,
        score: result.score,
        estimatedBand: result.estimatedBand,
        timeSpentSeconds: result.timeSpentSeconds || null,
        sectionBreakdown: result.sectionBreakdown || null,
        weakAreas: result.weakAreas || [],
        metadata: {
          totalQuestions: result.score.total,
          version: '1.0.0'
        }
      };

      const all = _getAll();
      all.push(record);
      _saveAll(all);

      console.log('[MockDB] Result saved:', record.id);
      return record;
    },

    /**
     * Retrieve all past test results.
     * @returns {Array} All stored test result records.
     */
    getAllResults() {
      return _getAll();
    },

    /**
     * Retrieve the most recent test result.
     * @returns {Object|null} The latest result or null.
     */
    getLatestResult() {
      const all = _getAll();
      return all.length > 0 ? all[all.length - 1] : null;
    },

    /**
     * Get the total number of stored attempts.
     * @returns {number}
     */
    getAttemptCount() {
      return _getAll().length;
    },

    /**
     * Clear all stored results (useful for testing).
     */
    clearAll() {
      localStorage.removeItem(STORAGE_KEY);
      console.log('[MockDB] All results cleared.');
    },

    /**
     * Export all data as a downloadable JSON string.
     * @returns {string} JSON string of all results.
     */
    exportJSON() {
      return JSON.stringify(_getAll(), null, 2);
    }
  };

})();
