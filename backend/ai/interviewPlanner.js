/**
 * interviewPlanner.js
 *
 * Responsibility (and ONLY responsibility):
 * Turn a candidate's analysis (from candidateAnalyzer.js) into a concrete,
 * personalized interview PLAN: which curriculum days to ask about, how many
 * questions per day, what type each question should be, and how difficulty
 * should progress across the interview.
 *
 * This module does NOT:
 *  - re-derive candidate progress/signals (that's candidateAnalyzer.js's job)
 *  - re-implement curriculum lookups (that's curriculumMapper.js's job)
 *  - write actual question text
 *  - call any AI model
 *  - build Express routes/APIs
 *
 * It IS deterministic: the same candidateAnalysis will always produce the
 * same plan, which makes it easy to unit test and to reason about during
 * a live demo.
 */

const { mapDaysToCurriculum } = require('./curriculumMapper');

// ---------------------------------------------------------------------------
// Hackathon requirements, expressed as constants so the "why" is obvious
// and the numbers are easy to tune in one place.
// ---------------------------------------------------------------------------
const MIN_QUESTIONS = 8;
const MIN_DAYS_COVERED = 4;

// How many questions a day "earns" based on how the candidate performed on
// it. Days the candidate struggled with or never passed are more
// interview-worthy than days they breezed through, so they get more slots.
const CATEGORY_WEIGHT = {
  gap: 3, // attempted but never passed - real knowledge gap worth probing
  struggled: 2, // eventually passed, but only after several attempts
  confident: 1, // passed quickly/easily - worth a quick depth check
};

// Attempts count at/above this threshold on a passed mission counts as
// "struggled" rather than "confident".
const STRUGGLE_ATTEMPTS_THRESHOLD = 3;

// Question type rotation per category. The planner cycles through these in
// order for each additional question slot on a given day, so a "gap" day
// (3 slots) gets troubleshooting -> application -> conceptual, while a
// "confident" day (1 slot) just gets a design/depth check.
const TYPE_ROTATION = {
  gap: ['troubleshooting', 'application', 'conceptual'],
  struggled: ['application', 'troubleshooting'],
  confident: ['design', 'conceptual'],
  fallback: ['conceptual'], // used for skipped-day fallback slots
};

// Difficulty ladders: for a given overall candidate difficulty, this is the
// repeating pattern used to order questions so difficulty rises naturally
// across the interview instead of jumping around.
const DIFFICULTY_LADDERS = {
  Easy: ['Easy', 'Easy', 'Medium'],
  Medium: ['Easy', 'Medium', 'Medium', 'Hard'],
  Hard: ['Easy', 'Medium', 'Hard', 'Hard'],
};

// ---------------------------------------------------------------------------
// Step 1: classify each attempted day into a priority category
// ---------------------------------------------------------------------------

/**
 * Classify a single attempts entry (from candidateAnalysis.attempts) into
 * an interview-planning category.
 *
 * @param {{day:number, title:string|null, attempts:number, outcome:'passed'|'failed'|'skipped'}} attempt
 * @returns {'gap'|'struggled'|'confident'|'skipped'}
 */
function classifyAttempt(attempt) {
  if (attempt.outcome === 'skipped') {
    return 'skipped';
  }
  if (attempt.outcome === 'failed') {
    return 'gap';
  }
  // outcome === 'passed'
  return attempt.attempts >= STRUGGLE_ATTEMPTS_THRESHOLD ? 'struggled' : 'confident';
}

/**
 * Build a deterministically-ordered candidate list of days worth asking
 * about, ranked by how interview-worthy they are.
 *
 * Ordering (all deterministic, no randomness):
 *   1. category weight, descending (gap > struggled > confident)
 *   2. attempts count, descending (more attempts = more worth probing)
 *   3. day number, ascending (stable tie-break)
 *
 * @param {Array<Object>} attempts - candidateAnalysis.attempts
 * @returns {Array<{day:number, title:string|null, attempts:number, category:string, weight:number}>}
 */
function rankAttemptedDays(attempts) {
  return attempts
    .map((attempt) => ({
      day: attempt.day,
      title: attempt.title,
      attempts: attempt.attempts,
      category: classifyAttempt(attempt),
    }))
    .filter((entry) => entry.category !== 'skipped') // requirement 6: exclude skipped by default
    .map((entry) => ({ ...entry, weight: CATEGORY_WEIGHT[entry.category] }))
    .sort((a, b) => b.weight - a.weight || b.attempts - a.attempts || a.day - b.day);
}

/**
 * Fallback pool: skipped days, in case there aren't enough non-skipped days
 * to satisfy the minimum day/question requirements. Requirement 6 allows
 * testing skipped topics "if the existing candidate data/logic indicates
 * it's appropriate" - here, "appropriate" is defined narrowly as "there is
 * no other way to reach the hackathon's minimum coverage requirements".
 *
 * @param {Array<Object>} attempts - candidateAnalysis.attempts
 * @returns {Array<{day:number, title:string|null, attempts:number, category:'skipped', weight:number}>}
 */
function rankSkippedDaysAsFallback(attempts) {
  return attempts
    .filter((attempt) => attempt.outcome === 'skipped')
    .map((attempt) => ({
      day: attempt.day,
      title: attempt.title,
      attempts: 0,
      category: 'skipped',
      weight: 0,
    }))
    .sort((a, b) => a.day - b.day);
}

// ---------------------------------------------------------------------------
// Step 2: decide how many days and questions-per-day to use
// ---------------------------------------------------------------------------

/**
 * Select which days make it into the plan and how many question slots each
 * one gets, guaranteeing MIN_QUESTIONS total across at least MIN_DAYS_COVERED
 * distinct days.
 *
 * Strategy: walk the ranked (highest-priority-first) day list, taking every
 * day at least one slot, using each day's category weight as its question
 * count. Once both minimums are satisfied, stop - unless we've covered
 * enough days but not enough questions yet, in which case keep adding one
 * extra slot per remaining day (round-robin) until MIN_QUESTIONS is hit.
 * If the ranked pool itself has fewer than MIN_DAYS_COVERED entries, the
 * skipped-day fallback pool is appended (requirement 6).
 *
 * @param {Array<Object>} rankedDays - output of rankAttemptedDays()
 * @param {Array<Object>} fallbackDays - output of rankSkippedDaysAsFallback()
 * @returns {Array<{day:number, title:string|null, attempts:number, category:string, questionCount:number}>}
 */
function selectPlanDays(rankedDays, fallbackDays) {
  let pool = [...rankedDays];

  // Only reach into skipped days if there truly aren't enough attempted
  // days to hit the minimum day coverage requirement.
  if (pool.length < MIN_DAYS_COVERED) {
    pool = pool.concat(fallbackDays);
  }

  // Start every selected day off with one slot per weight point (min 1),
  // capped so a single "gap" day can't alone bloat the plan.
  const selected = pool.map((entry) => ({
    ...entry,
    questionCount: Math.max(1, Math.min(entry.weight, 3)),
  }));

  let totalQuestions = selected.reduce((sum, d) => sum + d.questionCount, 0);
  const daysCovered = selected.length;

  // If we don't even have enough distinct days, that's a data problem this
  // module can't manufacture its way out of - return what we have rather
  // than fabricating days that don't exist in the candidate's journey.
  if (daysCovered < MIN_DAYS_COVERED) {
    return selected;
  }

  // Top up question count (round-robin across days, most interview-worthy
  // first) until the minimum question count is satisfied.
  let i = 0;
  while (totalQuestions < MIN_QUESTIONS && selected.length > 0) {
    const day = selected[i % selected.length];
    day.questionCount += 1;
    totalQuestions += 1;
    i += 1;
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Step 3: expand selected days into individual question slots
// ---------------------------------------------------------------------------

/**
 * Expand a single selected day into N question slot descriptors (without
 * difficulty yet - that's assigned globally in step 4 so difficulty can
 * progress naturally across the whole interview, not just within one day).
 *
 * @param {Object} selectedDay - one entry from selectPlanDays()
 * @param {Map<number, Object>} curriculumByDay - day -> curriculumMapper entry
 * @returns {Array<Object>} raw question slots (no difficulty assigned yet)
 */
function expandDayIntoSlots(selectedDay, curriculumByDay) {
  const curriculumEntry = curriculumByDay.get(selectedDay.day) || null;
  const typeRotation = TYPE_ROTATION[selectedDay.category] || TYPE_ROTATION.fallback;

  const objectives = curriculumEntry ? curriculumEntry.learningObjectives : [];
  const tools = curriculumEntry ? curriculumEntry.toolsUsed : [];

  const slots = [];
  for (let i = 0; i < selectedDay.questionCount; i += 1) {
    const type = typeRotation[i % typeRotation.length];
    slots.push({
      day: selectedDay.day,
      topic: curriculumEntry ? curriculumEntry.topic : selectedDay.title,
      module: curriculumEntry ? curriculumEntry.module : null,
      type,
      category: selectedDay.category,
      focusObjective: objectives.length > 0 ? objectives[i % objectives.length] : null,
      relevantTools: tools,
      candidateAttempts: selectedDay.attempts,
      rationale: buildRationale(selectedDay.category, selectedDay.attempts),
      allowFollowUp: true, // reserves room for followUpGenerator.js to extend this slot later
      followUpBudget: selectedDay.category === 'gap' ? 2 : 1,
    });
  }
  return slots;
}

/**
 * Human-readable reason this day/category was selected, useful for
 * debugging the plan and for logging in PROMPTS.md-style traceability.
 *
 * @param {string} category
 * @param {number} attempts
 * @returns {string}
 */
function buildRationale(category, attempts) {
  switch (category) {
    case 'gap':
      return `Candidate attempted this topic ${attempts} time(s) but never passed - probe understanding of the gap.`;
    case 'struggled':
      return `Candidate passed after ${attempts} attempts - verify depth beyond eventual success.`;
    case 'confident':
      return `Candidate passed quickly (${attempts} attempt(s)) - check for genuine depth vs. surface familiarity.`;
    case 'skipped':
      return 'Candidate skipped this topic; included only as fallback to meet minimum interview coverage.';
    default:
      return 'Selected for interview coverage.';
  }
}

// ---------------------------------------------------------------------------
// Step 4: assign difficulty so it progresses naturally across the interview
// ---------------------------------------------------------------------------

/**
 * Assign a difficulty to each slot, in place, using the ladder for the
 * candidate's overall recommended difficulty. The ladder repeats as needed
 * to cover every slot, so difficulty rises and resets in waves rather than
 * jumping randomly - "natural progression" across a longer interview.
 *
 * Slots are also stably re-ordered so difficulty genuinely trends upward
 * over the course of the interview (gap/struggled slots are nudged later
 * since they carry more weight, without breaking the day grouping needed
 * for a coherent conversation).
 *
 * @param {Array<Object>} slots - flat list from expandDayIntoSlots(), all days
 * @param {'Easy'|'Medium'|'Hard'} overallDifficulty
 * @returns {Array<Object>} same slots, each with a `difficulty` field, reordered
 */
function assignDifficultyProgression(slots, overallDifficulty) {
  const ladder = DIFFICULTY_LADDERS[overallDifficulty] || DIFFICULTY_LADDERS.Medium;

  // Order slots so easier categories (confident, struggled) lead and the
  // toughest (gap) trail - this is what makes difficulty "progress
  // naturally" rather than front-loading the hardest gap questions first.
  const categoryOrder = { confident: 0, struggled: 1, skipped: 1.5, gap: 2 };
  const ordered = [...slots].sort((a, b) => {
    const catDiff = (categoryOrder[a.category] ?? 3) - (categoryOrder[b.category] ?? 3);
    if (catDiff !== 0) return catDiff;
    return a.day - b.day; // stable, deterministic tie-break
  });

  return ordered.map((slot, index) => ({
    ...slot,
    difficulty: ladder[index % ladder.length],
    sequence: index + 1,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a personalized, deterministic interview plan.
 *
 * @param {Object} candidateAnalysis - output of candidateAnalyzer.analyzeCandidate()
 * @returns {{
 *   candidateId: string|null,
 *   candidateName: string|null,
 *   overallDifficulty: 'Easy'|'Medium'|'Hard',
 *   totalQuestions: number,
 *   daysCovered: number[],
 *   questions: Array<Object>,
 *   meetsMinimumRequirements: boolean
 * }}
 */
function planInterview(candidateAnalysis) {
  if (!candidateAnalysis || typeof candidateAnalysis !== 'object') {
    throw new Error('planInterview: candidateAnalysis must be a valid object (see candidateAnalyzer.analyzeCandidate)');
  }

  const attempts = Array.isArray(candidateAnalysis.attempts) ? candidateAnalysis.attempts : [];
  const overallDifficulty = candidateAnalysis.recommendedDifficulty || 'Medium';

  // Step 1: rank days by how interview-worthy they are.
  const rankedDays = rankAttemptedDays(attempts);
  const fallbackDays = rankSkippedDaysAsFallback(attempts);

  // Step 2: pick days + question counts to satisfy the hackathon minimums.
  const selectedDays = selectPlanDays(rankedDays, fallbackDays);

  // Look up full curriculum detail for exactly the days we selected.
  const curriculumEntries = mapDaysToCurriculum(selectedDays.map((d) => d.day));
  const curriculumByDay = new Map(curriculumEntries.map((entry) => [entry.day, entry]));

  // Step 3: expand each selected day into individual question slots.
  const rawSlots = selectedDays.flatMap((day) => expandDayIntoSlots(day, curriculumByDay));

  // Step 4: assign difficulty so it progresses naturally, and finalize order.
  const questions = assignDifficultyProgression(rawSlots, overallDifficulty);

  const daysCovered = [...new Set(questions.map((q) => q.day))].sort((a, b) => a - b);

  return {
    candidateId: candidateAnalysis.candidateId || null,
    candidateName: candidateAnalysis.candidateName || null,
    overallDifficulty,
    totalQuestions: questions.length,
    daysCovered,
    questions,
    meetsMinimumRequirements: questions.length >= MIN_QUESTIONS && daysCovered.length >= MIN_DAYS_COVERED,
  };
}

module.exports = { planInterview };