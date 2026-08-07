/**
 * candidateAnalyzer.js
 *
 * Responsibility (and ONLY responsibility):
 * Analyze a single candidate profile (as shaped in candidates.json) and
 * produce a normalized summary of their progress, attempts, and a
 * recommended interview difficulty.
 *
 * This module does NOT:
 *  - read curriculum.json
 *  - generate interview questions
 *  - call any AI model
 *  - build Express routes/APIs
 *
 * It is a pure function: same input -> same output, no side effects.
 */

// ---------------------------------------------------------------------------
// Tunable constants for the difficulty heuristic.
// Keeping these named/exported makes the scoring logic easy to reason about
// and easy to adjust later without touching the calculation itself.
// ---------------------------------------------------------------------------
const DIFFICULTY_WEIGHTS = {
  experience: 0.35, // years of professional experience
  firstTryRate: 0.25, // % of missions passed on first attempt
  passRate: 0.25, // % of attempted missions that were ultimately passed
  lowSkipRate: 0.15, // rewards candidates who skipped fewer missions
};

// Years of experience are capped for scoring purposes so a 30-year veteran
// doesn't dominate the score the same way a 30-year-old bug would.
const MAX_SCORED_EXPERIENCE_YEARS = 12;

const DIFFICULTY_THRESHOLDS = {
  hard: 0.7, // score >= 0.7  -> Hard
  medium: 0.4, // score >= 0.4  -> Medium
  // anything below "medium" -> Easy
};

/**
 * Safely coerce a value to a finite number, falling back to 0.
 * @param {*} value
 * @returns {number}
 */
function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract the list of days the candidate fully completed (passed).
 * @param {Array<Object>} missions
 * @returns {number[]} sorted list of completed day numbers
 */
function extractCompletedDays(missions) {
  return missions
    .filter((mission) => mission.passed === true)
    .map((mission) => mission.day)
    .sort((a, b) => a - b);
}

/**
 * Extract the list of days the candidate explicitly skipped.
 * @param {Array<Object>} missions
 * @returns {number[]} sorted list of skipped day numbers
 */
function extractSkippedDays(missions) {
  return missions
    .filter((mission) => mission.skipped === true)
    .map((mission) => mission.day)
    .sort((a, b) => a - b);
}

/**
 * Build a per-day attempts map so downstream modules can see exactly how
 * many tries each mission took, and whether it was ultimately passed,
 * failed, or skipped.
 *
 * @param {Array<Object>} missions
 * @returns {Array<{day: number, title: string, attempts: number, outcome: 'passed'|'failed'|'skipped'}>}
 */
function extractAttempts(missions) {
  return missions.map((mission) => {
    let outcome = 'skipped';
    if (mission.skipped === true) {
      outcome = 'skipped';
    } else if (mission.passed === true) {
      outcome = 'passed';
    } else if (mission.passed === false) {
      outcome = 'failed';
    }

    return {
      day: mission.day,
      title: mission.title || null,
      attempts: toFiniteNumber(mission.attempts),
      outcome,
    };
  });
}

/**
 * Normalize the candidate's raw "signals" block and layer in a few derived
 * ratios that are useful for difficulty scoring (pass rate, first-try rate,
 * skip rate). Falls back gracefully if signals are missing or incomplete.
 *
 * @param {Object} candidate
 * @param {Array<Object>} missions
 * @returns {Object} learningSignals
 */
function extractLearningSignals(candidate, missions) {
  const rawSignals = candidate.signals || {};

  const commitDays = toFiniteNumber(rawSignals.commitDays);
  const missionsCompleted = toFiniteNumber(rawSignals.missionsCompleted);
  const missionsFirstTry = toFiniteNumber(rawSignals.missionsFirstTry);

  const totalMissions = missions.length;
  const attemptedMissions = missions.filter((m) => m.skipped !== true).length;
  const passedMissions = missions.filter((m) => m.passed === true).length;
  const skippedMissions = missions.filter((m) => m.skipped === true).length;

  const passRate = attemptedMissions > 0 ? passedMissions / attemptedMissions : 0;
  const firstTryRate = missionsCompleted > 0 ? missionsFirstTry / missionsCompleted : 0;
  const skipRate = totalMissions > 0 ? skippedMissions / totalMissions : 0;

  return {
    commitDays,
    missionsCompleted,
    missionsFirstTry,
    totalMissions,
    passedMissions,
    skippedMissions,
    passRate: Number(passRate.toFixed(2)),
    firstTryRate: Number(firstTryRate.toFixed(2)),
    skipRate: Number(skipRate.toFixed(2)),
  };
}

/**
 * Calculate a 0..1 composite score and map it to Easy / Medium / Hard.
 *
 * The heuristic rewards:
 *  - more professional experience (capped, diminishing importance beyond it)
 *  - a higher first-try success rate (signals strong intuitive understanding)
 *  - a higher overall pass rate (signals reliability, not just persistence)
 *  - a lower skip rate (signals thoroughness / fewer knowledge gaps)
 *
 * @param {Object} candidate
 * @param {Object} learningSignals
 * @returns {'Easy'|'Medium'|'Hard'}
 */
function calculateRecommendedDifficulty(candidate, learningSignals) {
  const yearsExperience = toFiniteNumber(candidate.member && candidate.member.yearsExperience);

  const experienceScore = Math.min(yearsExperience, MAX_SCORED_EXPERIENCE_YEARS) / MAX_SCORED_EXPERIENCE_YEARS;
  const firstTryScore = learningSignals.firstTryRate;
  const passScore = learningSignals.passRate;
  const lowSkipScore = 1 - learningSignals.skipRate;

  const compositeScore =
    experienceScore * DIFFICULTY_WEIGHTS.experience +
    firstTryScore * DIFFICULTY_WEIGHTS.firstTryRate +
    passScore * DIFFICULTY_WEIGHTS.passRate +
    lowSkipScore * DIFFICULTY_WEIGHTS.lowSkipRate;

  if (compositeScore >= DIFFICULTY_THRESHOLDS.hard) {
    return 'Hard';
  }
  if (compositeScore >= DIFFICULTY_THRESHOLDS.medium) {
    return 'Medium';
  }
  return 'Easy';
}

/**
 * Analyze a single candidate profile.
 *
 * @param {Object} candidate - A single entry from candidates.json's
 *   `candidates` array, e.g. { member: {...}, missions: [...], signals: {...} }
 * @returns {{
 *   candidateId: string|null,
 *   candidateName: string|null,
 *   completedDays: number[],
 *   skippedDays: number[],
 *   progress: { totalMissions: number, completed: number, skipped: number, completionRate: number },
 *   learningSignals: Object,
 *   attempts: Array<Object>,
 *   recommendedDifficulty: 'Easy'|'Medium'|'Hard'
 * }}
 */
function analyzeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('analyzeCandidate: candidate must be a valid object');
  }

  const member = candidate.member || {};
  const missions = Array.isArray(candidate.missions) ? candidate.missions : [];

  const completedDays = extractCompletedDays(missions);
  const skippedDays = extractSkippedDays(missions);
  const attempts = extractAttempts(missions);
  const learningSignals = extractLearningSignals(candidate, missions);

  const totalMissions = missions.length;
  const completionRate = totalMissions > 0 ? Number((completedDays.length / totalMissions).toFixed(2)) : 0;

  const recommendedDifficulty = calculateRecommendedDifficulty(candidate, learningSignals);

  return {
    candidateId: member.id || null,
    candidateName: member.name || null,
    completedDays,
    skippedDays,
    progress: {
      totalMissions,
      completed: completedDays.length,
      skipped: skippedDays.length,
      completionRate,
    },
    learningSignals,
    attempts,
    recommendedDifficulty,
  };
}

module.exports = { analyzeCandidate };