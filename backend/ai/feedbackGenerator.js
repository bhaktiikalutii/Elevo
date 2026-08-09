/**
 * feedbackGenerator.js
 *
 * Responsibility (and ONLY responsibility):
 * Take the completed (or partially completed) interview - the plan from
 * interviewPlanner.js and the per-question results already normalized by
 * evaluationEngine.js - and produce one structured, deterministic feedback
 * object summarizing the candidate's performance.
 *
 * This module does NOT:
 *  - call any AI model
 *  - make HTTP/API calls
 *  - read candidates.json or curriculum.json
 *  - generate interview questions or follow-up questions
 *  - manage interview sessions
 *  - create Express routes
 *  - access databases
 *  - use randomness
 *
 * It only aggregates and formats data it is given. Where it needs to
 * produce prose (e.g. the top-level `summary` string), that prose is built
 * from a fixed template filled in with computed numbers/labels - never
 * invented commentary about the candidate.
 *
 * It is deterministic: the same input always produces the same output.
 */

// ---------------------------------------------------------------------------
// Tunable thresholds, named so the "why" behind a bucket is obvious.
// ---------------------------------------------------------------------------

// A turn's overallScore below this is treated as a "gap" worth surfacing,
// regardless of its raw correctness/completeness enum values.
const GAP_SCORE_THRESHOLD = 60;

// Caps on how many items land in the top-level strengths/gaps/next arrays,
// so feedback stays readable rather than dumping every data point.
const MAX_STRENGTHS = 5;
const MAX_GAPS = 5;
const MAX_NEXT_STEPS = 5;

// Overall-rating label buckets, based on the interview's average score.
const RATING_BUCKETS = [
  { min: 80, label: 'Strong' },
  { min: 60, label: 'Solid' },
  { min: 40, label: 'Developing' },
  { min: 0, label: 'Needs Improvement' },
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the required inputs. Throws with a specific, actionable message.
 *
 * @param {Object} interviewPlan
 * @param {Array<Object>} turns
 */
function validateInputs(interviewPlan, turns) {
  if (!interviewPlan || typeof interviewPlan !== 'object') {
    throw new Error('feedbackGenerator: "interviewPlan" is required (see interviewPlanner.planInterview output)');
  }
  if (!Array.isArray(interviewPlan.questions) || interviewPlan.questions.length === 0) {
    throw new Error('feedbackGenerator: interviewPlan.questions must be a non-empty array');
  }
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error('feedbackGenerator: "turns" is required and must be a non-empty array of answered question turns');
  }

  turns.forEach((turn, i) => {
    if (!turn || typeof turn !== 'object') {
      throw new Error(`feedbackGenerator: turn at index ${i} must be an object`);
    }
    if (typeof turn.day !== 'number') {
      throw new Error(`feedbackGenerator: turn at index ${i} is missing a valid "day"`);
    }
    if (!turn.evaluation || typeof turn.evaluation !== 'object') {
      throw new Error(`feedbackGenerator: turn at index ${i} (day ${turn.day}) is missing "evaluation" (see evaluationEngine.evaluateAnswer output)`);
    }
    if (typeof turn.evaluation.overallScore !== 'number') {
      throw new Error(`feedbackGenerator: turn at index ${i} (day ${turn.day}) evaluation is missing a numeric "overallScore"`);
    }
  });
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/**
 * @param {number[]} values
 * @returns {number} rounded mean, or 0 for an empty array
 */
function average(values) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * @param {number} score
 * @returns {string}
 */
function ratingLabelForScore(score) {
  const bucket = RATING_BUCKETS.find((b) => score >= b.min);
  return bucket ? bucket.label : RATING_BUCKETS[RATING_BUCKETS.length - 1].label;
}

/**
 * Build a readable "Day N: Topic" label, gracefully falling back when
 * topic info wasn't available on the turn.
 *
 * @param {Object} turn
 * @returns {string}
 */
function topicLabel(turn) {
  return turn.topic ? `Day ${turn.day} (${turn.topic})` : `Day ${turn.day}`;
}

/**
 * Case-insensitive de-duplication that preserves first-seen order, so the
 * result is deterministic and doesn't depend on sort stability quirks.
 *
 * @param {string[]} items
 * @returns {string[]}
 */
function dedupePreserveOrder(items) {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    const key = item.trim().toLowerCase();
    if (key.length > 0 && !seen.has(key)) {
      seen.add(key);
      result.push(item.trim());
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Step 1: normalize each turn into a per-topic breakdown entry
// ---------------------------------------------------------------------------

/**
 * @param {Object} turn - one entry from the `turns` input
 * @returns {Object} a per-topic summary row
 */
function buildTopicRow(turn) {
  const followUps = Array.isArray(turn.followUps) ? turn.followUps : [];

  return {
    day: turn.day,
    topic: turn.topic || null,
    module: turn.module || null,
    type: turn.type || null,
    difficulty: turn.difficulty || null,
    category: turn.category || null, // gap / struggled / confident, as assigned by interviewPlanner
    answered: typeof turn.candidateAnswer === 'string' && turn.candidateAnswer.trim().length > 0,
    correctness: turn.evaluation.correctness,
    completeness: turn.evaluation.completeness,
    score: turn.evaluation.overallScore,
    confidence: turn.evaluation.confidence,
    strengths: Array.isArray(turn.evaluation.strengths) ? turn.evaluation.strengths : [],
    weaknesses: Array.isArray(turn.evaluation.weaknesses) ? turn.evaluation.weaknesses : [],
    followUpsAsked: followUps.length,
  };
}

// ---------------------------------------------------------------------------
// Step 2: aggregate stats across all topic rows
// ---------------------------------------------------------------------------

/**
 * @param {Array<Object>} topicRows
 * @param {Object} interviewPlan
 * @returns {Object} interviewSummary block
 */
function buildInterviewSummary(topicRows, interviewPlan) {
  const scores = topicRows.map((row) => row.score);
  const averageScore = average(scores);

  const correctnessBreakdown = { correct: 0, partial: 0, incorrect: 0, unknown: 0 };
  const completenessBreakdown = { complete: 0, incomplete: 0, vague: 0 };
  topicRows.forEach((row) => {
    correctnessBreakdown[row.correctness] = (correctnessBreakdown[row.correctness] || 0) + 1;
    completenessBreakdown[row.completeness] = (completenessBreakdown[row.completeness] || 0) + 1;
  });

  const plannedDays = interviewPlan.questions.map((q) => q.day);
  const coveredDays = [...new Set(topicRows.map((row) => row.day))].sort((a, b) => a - b);
  const plannedButNotCovered = [...new Set(plannedDays)].filter((day) => !coveredDays.includes(day)).sort((a, b) => a - b);

  const totalFollowUpsAsked = topicRows.reduce((sum, row) => sum + row.followUpsAsked, 0);

  return {
    totalQuestionsPlanned: interviewPlan.totalQuestions || interviewPlan.questions.length,
    questionsCovered: topicRows.length,
    questionsAnswered: topicRows.filter((row) => row.answered).length,
    daysCovered: coveredDays,
    plannedButNotCovered,
    averageScore,
    overallRating: ratingLabelForScore(averageScore),
    correctnessBreakdown,
    completenessBreakdown,
    totalFollowUpsAsked,
  };
}

// ---------------------------------------------------------------------------
// Step 3: derive strengths / gaps / next-steps from the topic rows
// ---------------------------------------------------------------------------

/**
 * Collect and dedupe strength statements, ordered by the score of the turn
 * they came from (highest first) so the strongest evidence leads.
 *
 * @param {Array<Object>} topicRows
 * @returns {string[]}
 */
function deriveStrengths(topicRows) {
  const byScoreDesc = [...topicRows].sort((a, b) => b.score - a.score);
  const collected = [];

  byScoreDesc.forEach((row) => {
    if (row.strengths.length > 0) {
      row.strengths.forEach((s) => collected.push(s));
    } else if (row.correctness === 'correct' && row.completeness === 'complete') {
      // No detailed evidence supplied, but the normalized signals themselves
      // are a fact we were given - report that fact plainly rather than
      // inventing a specific reason.
      collected.push(`Answered ${topicLabel(row)} correctly and completely.`);
    }
  });

  return dedupePreserveOrder(collected).slice(0, MAX_STRENGTHS);
}

/**
 * Collect and dedupe gap statements for turns that scored below threshold
 * or were flagged incorrect/incomplete, ordered weakest-first.
 *
 * @param {Array<Object>} topicRows
 * @returns {string[]}
 */
function deriveGaps(topicRows) {
  const weakRows = topicRows
    .filter((row) => row.score < GAP_SCORE_THRESHOLD || row.correctness === 'incorrect' || row.completeness === 'vague')
    .sort((a, b) => a.score - b.score);

  const collected = [];
  weakRows.forEach((row) => {
    if (row.weaknesses.length > 0) {
      row.weaknesses.forEach((w) => collected.push(w));
    } else {
      collected.push(`${topicLabel(row)}: scored ${row.score}/100 (${row.correctness}, ${row.completeness}).`);
    }
  });

  return dedupePreserveOrder(collected).slice(0, MAX_GAPS);
}

/**
 * Turn the weakest topics into concrete "review this" next steps.
 * Deterministic ordering: weakest score first, day ascending as tie-break.
 *
 * @param {Array<Object>} topicRows
 * @returns {string[]}
 */
function deriveNextSteps(topicRows) {
  const weakRows = topicRows
    .filter((row) => row.score < GAP_SCORE_THRESHOLD)
    .sort((a, b) => a.score - b.score || a.day - b.day);

  const steps = weakRows.map((row) => {
    const moduleLabel = row.module && row.module.title ? ` (Module: ${row.module.title})` : '';
    return `Review ${topicLabel(row)}${moduleLabel} - scored ${row.score}/100.`;
  });

  return dedupePreserveOrder(steps).slice(0, MAX_NEXT_STEPS);
}

// ---------------------------------------------------------------------------
// Step 4: build the templated summary string
// ---------------------------------------------------------------------------

/**
 * @param {Object} interviewSummary
 * @param {Array<Object>} topicRows
 * @param {string} candidateName
 * @returns {string}
 */
function buildSummaryText(interviewSummary, topicRows, candidateName) {
  const name = candidateName || 'The candidate';
  const byScoreDesc = [...topicRows].sort((a, b) => b.score - a.score);
  const strongest = byScoreDesc[0];
  const weakest = byScoreDesc[byScoreDesc.length - 1];

  const coverageClause = `answered ${interviewSummary.questionsAnswered} of ${interviewSummary.questionsCovered} ` +
    `covered question(s) across ${interviewSummary.daysCovered.length} curriculum day(s), ` +
    `averaging ${interviewSummary.averageScore}/100 (${interviewSummary.overallRating}).`;

  const highlightClause = strongest && weakest && strongest.day !== weakest.day
    ? ` Performance was strongest on ${topicLabel(strongest)} (${strongest.score}/100) and showed the most ` +
      `room for growth on ${topicLabel(weakest)} (${weakest.score}/100).`
    : strongest
      ? ` Performance on ${topicLabel(strongest)} scored ${strongest.score}/100.`
      : '';

  return `${name} ${coverageClause}${highlightClause}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate structured final interview feedback.
 *
 * @param {Object} params
 * @param {Object} params.interviewPlan - output of interviewPlanner.planInterview()
 * @param {Array<Object>} params.turns - one entry per question actually asked/answered, each:
 *   {
 *     day, topic, module, type, difficulty, category,       // mirrors the matching interviewPlan.questions slot
 *     questionText,                                          // the actual question text that was asked (optional)
 *     candidateAnswer,                                        // the candidate's answer text (optional; blank = unanswered)
 *     evaluation,                                             // REQUIRED: output of evaluationEngine.evaluateAnswer()
 *     followUps: [{ type, question, answer, evaluation }]     // optional
 *   }
 * @param {Object} [params.candidateAnalysis] - optional, output of candidateAnalyzer.analyzeCandidate(), used only for name/id fallback
 * @param {Object} [params.sessionMeta] - optional session metadata (e.g. { sessionId, startedAt, endedAt }), passed through untouched
 * @returns {{
 *   candidateId: string|null,
 *   candidateName: string|null,
 *   overallDifficulty: string,
 *   summary: string,
 *   strengths: string[],
 *   gaps: string[],
 *   next: string[],
 *   interviewSummary: Object,
 *   topicBreakdown: Array<Object>,
 *   sessionMeta: Object|null
 * }}
 */
function generateFeedback({ interviewPlan, turns, candidateAnalysis = null, sessionMeta = null } = {}) {
  validateInputs(interviewPlan, turns);

  const candidateId = interviewPlan.candidateId || (candidateAnalysis && candidateAnalysis.candidateId) || null;
  const candidateName = interviewPlan.candidateName || (candidateAnalysis && candidateAnalysis.candidateName) || null;
  const overallDifficulty = interviewPlan.overallDifficulty || 'Medium';

  // Sort turns by day for stable, deterministic downstream ordering,
  // regardless of the order they were passed in.
  const orderedTurns = [...turns].sort((a, b) => a.day - b.day);

  const topicBreakdown = orderedTurns.map(buildTopicRow);
  const interviewSummary = buildInterviewSummary(topicBreakdown, interviewPlan);

  const strengths = deriveStrengths(topicBreakdown);
  const gaps = deriveGaps(topicBreakdown);
  const next = deriveNextSteps(topicBreakdown);
  const summary = buildSummaryText(interviewSummary, topicBreakdown, candidateName);

  return {
    candidateId,
    candidateName,
    overallDifficulty,
    summary,
    strengths,
    gaps,
    next,
    interviewSummary,
    topicBreakdown,
    sessionMeta: sessionMeta || null,
  };
}

module.exports = { generateFeedback };