/**
 * evaluationEngine.js
 *
 * Responsibility (and ONLY responsibility):
 * Take whatever evaluation of a candidate's answer is available (typically
 * produced by the AI model layer, since actual semantic judgment of a
 * technical answer requires understanding language, not string matching)
 * and turn it into a clean, validated, normalized set of evaluation
 * signals that followUpGenerator.js, feedbackGenerator.js, and the session
 * layer can all safely consume.
 *
 * This module does NOT:
 *  - call any AI model
 *  - build Express routes/APIs
 *  - read curriculum.json directly
 *  - analyze the entire candidate profile
 *  - generate interview questions or follow-up questions
 *  - generate final interview feedback
 *  - manage sessions or persistent state
 *
 * IMPORTANT: this module never pretends that JavaScript text heuristics can
 * determine whether a technical answer is actually correct. When no
 * semantic evaluation is supplied (via `evaluationResult`), every signal
 * defaults to a neutral, clearly-flagged-as-uncertain value rather than an
 * invented judgment - see buildFallbackSignals() below.
 *
 * It is deterministic: the same input always produces the same output.
 */

// ---------------------------------------------------------------------------
// Enum definitions
// ---------------------------------------------------------------------------
const VALID_CORRECTNESS = ['correct', 'partial', 'incorrect', 'unknown'];
const VALID_COMPLETENESS = ['complete', 'incomplete', 'vague'];
const VALID_CONFIDENCE = ['high', 'medium', 'low'];

// Weights used to combine the five per-dimension signals into a single
// overallScore. correctness carries the most weight since it's the closest
// thing to a pass/fail signal; the rest are quality-of-answer modifiers.
const SCORE_WEIGHTS = {
  correctness: 0.4,
  completeness: 0.15,
  technicalDepth: 0.15,
  reasoningQuality: 0.15,
  communicationClarity: 0.15,
};

// Numeric value each enum state contributes to the 0..1 scoring scale.
const CORRECTNESS_SCORE_MAP = { correct: 1, partial: 0.5, incorrect: 0, unknown: 0.5 };
const COMPLETENESS_SCORE_MAP = { complete: 1, incomplete: 0.5, vague: 0 };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the required inputs and the shape of optional ones.
 * Throws with a specific, actionable message rather than failing deep
 * inside normalization logic.
 *
 * @param {*} question
 * @param {*} candidateAnswer
 * @param {*} questionSlot
 * @param {*} curriculumContext
 * @param {*} evaluationResult
 */
function validateInputs(question, candidateAnswer, questionSlot, curriculumContext, evaluationResult) {
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('evaluationEngine: "question" is required and must be a non-empty string (the question that was asked)');
  }
  if (typeof candidateAnswer !== 'string') {
    throw new Error('evaluationEngine: "candidateAnswer" is required and must be a string (use "" for a blank/no-answer response)');
  }
  if (questionSlot !== undefined && questionSlot !== null && typeof questionSlot !== 'object') {
    throw new Error('evaluationEngine: "questionSlot", if provided, must be an object');
  }
  if (curriculumContext !== undefined && curriculumContext !== null && typeof curriculumContext !== 'object') {
    throw new Error('evaluationEngine: "curriculumContext", if provided, must be an object');
  }
  if (evaluationResult !== undefined && evaluationResult !== null && typeof evaluationResult !== 'object') {
    throw new Error('evaluationEngine: "evaluationResult", if provided, must be an object');
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * @param {*} value
 * @returns {'correct'|'partial'|'incorrect'|'unknown'}
 */
function normalizeCorrectness(value) {
  return VALID_CORRECTNESS.includes(value) ? value : 'unknown';
}

/**
 * Completeness has no "unknown" enum value, so when the supplied value is
 * missing/invalid we fall back on the one structural (non-semantic) signal
 * this module is allowed to use: whether the candidate gave any text at
 * all. A genuinely blank answer is "vague" by definition; anything else
 * defaults to "incomplete" as the more conservative of the two remaining
 * options (never claim "complete" without evidence).
 *
 * @param {*} value
 * @param {string} candidateAnswer
 * @returns {'complete'|'incomplete'|'vague'}
 */
function normalizeCompleteness(value, candidateAnswer) {
  if (VALID_COMPLETENESS.includes(value)) {
    return value;
  }
  return candidateAnswer.trim().length === 0 ? 'vague' : 'incomplete';
}

/**
 * Clamp a numeric 0..1 signal, falling back to a neutral 0.5 ("unknown",
 * not "bad") when the value is missing or not a finite number.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeUnitScore(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return 0.5;
}

/**
 * @param {*} value
 * @param {boolean} hadEvaluationResult - whether the caller supplied any evaluationResult object at all
 * @returns {'high'|'medium'|'low'}
 */
function normalizeConfidence(value, hadEvaluationResult) {
  if (VALID_CONFIDENCE.includes(value)) {
    return value;
  }
  // Some real signal was supplied but confidence wasn't stated - "medium"
  // is a fairer default than "low", but we never upgrade to "high" ourselves.
  return hadEvaluationResult ? 'medium' : 'low';
}

/**
 * @param {*} arr
 * @returns {string[]}
 */
function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function normalizeBoolean(value) {
  return value === true;
}

// ---------------------------------------------------------------------------
// Derived signals
// ---------------------------------------------------------------------------

/**
 * Combine the normalized dimensions into a single 0..100 score. Uses the
 * same weighted formula whether values came from a real evaluationResult or
 * from neutral fallbacks - fallback inputs are all ~0.5, so the formula
 * naturally lands near 50 (conservative/neutral) rather than inventing a
 * confident-looking number.
 *
 * @param {{correctness: string, completeness: string, technicalDepth: number, reasoningQuality: number, communicationClarity: number}} signals
 * @returns {number} 0..100, rounded
 */
function computeOverallScore(signals) {
  const raw =
    CORRECTNESS_SCORE_MAP[signals.correctness] * SCORE_WEIGHTS.correctness +
    COMPLETENESS_SCORE_MAP[signals.completeness] * SCORE_WEIGHTS.completeness +
    signals.technicalDepth * SCORE_WEIGHTS.technicalDepth +
    signals.reasoningQuality * SCORE_WEIGHTS.reasoningQuality +
    signals.communicationClarity * SCORE_WEIGHTS.communicationClarity;

  const score = Math.round(raw * 100);
  return Math.min(100, Math.max(0, score));
}

/**
 * A simple, transparent derived hint for whether a follow-up may be useful.
 * This does NOT decide anything on its own - followUpGenerator.js makes the
 * real, budget-aware decision. This is just a convenience flag for callers
 * that want a quick read before invoking it.
 *
 * @param {{correctness: string, completeness: string, noteworthy: boolean}} signals
 * @returns {boolean}
 */
function computeNeedsFollowUp(signals) {
  if (signals.noteworthy) {
    return true;
  }
  return signals.correctness !== 'correct' || signals.completeness !== 'complete';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a candidate's answer to a single interview question by
 * normalizing whatever evaluation data is available. Never performs its
 * own semantic judgment of correctness.
 *
 * @param {Object} params
 * @param {string} params.question - the question text that was asked
 * @param {string} params.candidateAnswer - the candidate's answer ("" for blank/no answer)
 * @param {Object} [params.questionSlot] - current slot from interviewPlanner.js (day, topic, type, difficulty, category, rationale, ...)
 * @param {Object} [params.curriculumContext] - curriculum detail (topic, module, learningObjectives, toolsUsed), e.g. from curriculumMapper.js
 * @param {Array<Object>} [params.conversationContext] - prior turns, passed through untouched for callers that need it; not used in scoring
 * @param {Object} [params.evaluationResult] - optional pre-computed semantic evaluation (typically from the AI layer), see module docs for shape
 * @returns {{
 *   correctness: 'correct'|'partial'|'incorrect'|'unknown',
 *   completeness: 'complete'|'incomplete'|'vague',
 *   technicalDepth: number,
 *   reasoningQuality: number,
 *   communicationClarity: number,
 *   confidence: 'high'|'medium'|'low',
 *   overallScore: number,
 *   strengths: string[],
 *   weaknesses: string[],
 *   noteworthy: boolean,
 *   needsFollowUp: boolean
 * }}
 */
function evaluateAnswer({
  question,
  candidateAnswer,
  questionSlot = null,
  curriculumContext = null,
  conversationContext = [],
  evaluationResult = null,
} = {}) {
  validateInputs(question, candidateAnswer, questionSlot, curriculumContext, evaluationResult);

  const hadEvaluationResult = evaluationResult !== null && typeof evaluationResult === 'object';
  const source = hadEvaluationResult ? evaluationResult : {};

  const correctness = normalizeCorrectness(source.correctness);
  const completeness = normalizeCompleteness(source.completeness, candidateAnswer);
  const technicalDepth = normalizeUnitScore(source.technicalDepth);
  const reasoningQuality = normalizeUnitScore(source.reasoningQuality);
  const communicationClarity = normalizeUnitScore(source.communicationClarity);
  const confidence = normalizeConfidence(source.confidence, hadEvaluationResult);
  const strengths = normalizeStringArray(source.strengths);
  const weaknesses = normalizeStringArray(source.weaknesses);
  const noteworthy = normalizeBoolean(source.noteworthy);

  const overallScore = computeOverallScore({ correctness, completeness, technicalDepth, reasoningQuality, communicationClarity });
  const needsFollowUp = computeNeedsFollowUp({ correctness, completeness, noteworthy });

  return {
    correctness,
    completeness,
    technicalDepth,
    reasoningQuality,
    communicationClarity,
    confidence,
    overallScore,
    strengths,
    weaknesses,
    noteworthy,
    needsFollowUp,
  };
}

module.exports = { evaluateAnswer };