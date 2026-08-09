/**
 * followUpGenerator.js
 *
 * Responsibility (and ONLY responsibility):
 * Given the current question slot (from interviewPlanner.js), the
 * candidate's answer, and the conversation so far, decide whether a
 * follow-up question is warranted and, if so, build an AI-ready prompt for
 * generating exactly one follow-up.
 *
 * This module does NOT:
 *  - call any AI model
 *  - build Express routes/APIs
 *  - read curriculum.json directly (curriculum data arrives pre-resolved on
 *    the slot, via curriculumMapper.js -> interviewPlanner.js)
 *  - re-analyze the whole candidate profile (that's candidateAnalyzer.js's job)
 *  - generate final interview feedback or evaluate the whole interview
 *  - manage persistent sessions
 *
 * It deliberately does NOT try to perfectly judge the candidate's answer.
 * If the caller supplies `evaluationSignals` (e.g. from an evaluation layer
 * or the AI's own read of the answer), those drive the decision. Absent
 * that, this module falls back to light, transparent text heuristics and
 * is conservative by design: when it genuinely can't tell whether an answer
 * was strong or weak, it does NOT force a follow-up (see rule 2 in the spec
 * - a follow-up should never be automatic). The real conversational judgment
 * call stays with the downstream AI layer; this module only hands it
 * structured signal + a ready-to-use prompt when a follow-up is warranted.
 *
 * It is deterministic: no randomness anywhere in this file.
 */

// ---------------------------------------------------------------------------
// Follow-up type guidance, mirroring the style/spirit of promptBuilder.js's
// TYPE_GUIDANCE so the two modules read consistently to a downstream AI.
// ---------------------------------------------------------------------------
const FOLLOWUP_TYPE_GUIDANCE = {
  clarification:
    "CLARIFICATION: The candidate's answer was too brief, vague, or unclear to assess. Ask them to elaborate " +
    'or restate their approach in more concrete terms - do not hint at what you expect to hear.',
  depth:
    "DEPTH: The candidate's answer was on the right track but shallow. Ask a follow-up that pushes them to " +
    'explain the mechanism or reasoning behind their answer in more detail.',
  correction:
    "CORRECTION: The candidate's answer appears incorrect or has a flaw. Ask a follow-up that probes their " +
    'reasoning - e.g. walk them back through their logic or ask what would happen in a specific scenario - ' +
    'without stating that they are wrong or revealing the correct answer.',
  application:
    'APPLICATION: The candidate understood the concept but stopped short of applying it. Give them a slightly ' +
    'different or extended scenario and ask how they would apply what they just described.',
  tradeoff:
    "TRADEOFF: The candidate's answer was strong. Push into the trade-offs behind their approach - ask what " +
    'they would give up, or why they would choose it over a reasonable alternative.',
  edge_case:
    "EDGE_CASE: The candidate's answer was strong. Probe an edge case or failure scenario related to their " +
    'answer to see how far their understanding actually extends.',
};

const FOLLOWUP_TYPES = Object.keys(FOLLOWUP_TYPE_GUIDANCE);

// Words/phrases that heuristically signal hedging or uncertainty, used only
// when the caller does not supply evaluationSignals. Kept intentionally
// small and transparent rather than trying to be a real classifier.
const HEDGE_PATTERNS = [
  /\bnot sure\b/i,
  /\bi think\b/i,
  /\bmaybe\b/i,
  /\bkind of\b/i,
  /\bsort of\b/i,
  /\bi guess\b/i,
  /\bnot certain\b/i,
  /\bi don'?t know\b/i,
  /\bum+\b/i,
];

const MIN_SUBSTANTIVE_WORDS = 8;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the required inputs. Throws with a specific, actionable message.
 *
 * @param {Object} slot - current question slot (from interviewPlanner.js)
 * @param {string} candidateAnswer
 */
function validateInputs(slot, candidateAnswer) {
  if (!slot || typeof slot !== 'object') {
    throw new Error('followUpGenerator: a valid question slot is required (see interviewPlanner.planInterview output)');
  }
  if (typeof slot.day !== 'number') {
    throw new Error('followUpGenerator: question slot is missing a valid "day"');
  }
  if (!slot.type) {
    throw new Error('followUpGenerator: question slot is missing a "type"');
  }
  if (typeof candidateAnswer !== 'string') {
    throw new Error('followUpGenerator: candidateAnswer is required and must be a string (use "" for a blank/no-answer response)');
  }
}

// ---------------------------------------------------------------------------
// Step 1: classify the answer
// ---------------------------------------------------------------------------

/**
 * Classify the candidate's answer into one of the categories this module
 * knows how to act on. Prefers caller-supplied evaluationSignals; falls
 * back to light text heuristics when signals aren't provided.
 *
 * @param {string} candidateAnswer
 * @param {Object|null} evaluationSignals - optional, e.g. { correctness: 'correct'|'partial'|'incorrect', completeness: 'complete'|'incomplete'|'vague', noteworthy: boolean }
 * @returns {{classification: 'blank'|'vague'|'incorrect'|'partial'|'strong'|'unknown', source: 'signals'|'heuristic', noteworthy: boolean}}
 */
function classifyAnswer(candidateAnswer, evaluationSignals) {
  const noteworthy = Boolean(evaluationSignals && evaluationSignals.noteworthy === true);
  const trimmed = candidateAnswer.trim();

  if (trimmed.length === 0) {
    return { classification: 'blank', source: 'heuristic', noteworthy };
  }

  // Prefer explicit evaluation signals when the caller provides them.
  if (evaluationSignals && (evaluationSignals.correctness || evaluationSignals.completeness)) {
    const { correctness, completeness } = evaluationSignals;
    if (completeness === 'vague') {
      return { classification: 'vague', source: 'signals', noteworthy };
    }
    if (correctness === 'incorrect') {
      return { classification: 'incorrect', source: 'signals', noteworthy };
    }
    if (correctness === 'partial' || completeness === 'incomplete') {
      return { classification: 'partial', source: 'signals', noteworthy };
    }
    if (correctness === 'correct' && (completeness === 'complete' || completeness === undefined)) {
      return { classification: 'strong', source: 'signals', noteworthy };
    }
    // Signals were present but incomplete/ambiguous - fall through to heuristic.
  }

  // Fallback heuristic: transparent, conservative, text-only.
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const hasHedge = HEDGE_PATTERNS.some((pattern) => pattern.test(trimmed));

  if (wordCount < MIN_SUBSTANTIVE_WORDS || hasHedge) {
    return { classification: 'vague', source: 'heuristic', noteworthy };
  }

  // Without real evaluation, this module cannot responsibly claim to know
  // whether a substantive-sounding answer is actually correct - that
  // judgment belongs to the downstream AI or an evaluation layer.
  return { classification: 'unknown', source: 'heuristic', noteworthy };
}

// ---------------------------------------------------------------------------
// Step 2: pick a follow-up type based on classification + current slot
// ---------------------------------------------------------------------------

/**
 * For a "partial" answer, pick the follow-up type that best matches the
 * kind of question being asked, so the follow-up stays natural rather than
 * generically "tell me more".
 *
 * @param {Object} slot
 * @returns {'depth'|'application'}
 */
function partialFollowUpType(slot) {
  if (slot.type === 'application') return 'application';
  return 'depth'; // conceptual, troubleshooting, design all benefit from "explain further"
}

/**
 * For a "strong" answer that still earns a follow-up (budget allows and the
 * topic is worth confirming depth on), pick between trade-off and edge-case
 * framing based on the question type.
 *
 * @param {Object} slot
 * @returns {'tradeoff'|'edge_case'}
 */
function strongFollowUpType(slot) {
  return slot.type === 'design' ? 'tradeoff' : 'edge_case';
}

// ---------------------------------------------------------------------------
// Step 3: the core decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a follow-up is warranted, and if so, which type.
 * This is the deterministic heart of the module - everything else is
 * formatting around this decision.
 *
 * @param {Object} slot
 * @param {string} candidateAnswer
 * @param {number} remainingBudget
 * @param {Object|null} evaluationSignals
 * @returns {{shouldFollowUp: boolean, type: string|null, reason: string, classification: string}}
 */
function decideFollowUp(slot, candidateAnswer, remainingBudget, evaluationSignals) {
  if (remainingBudget <= 0) {
    return {
      shouldFollowUp: false,
      type: null,
      reason: 'Follow-up budget for this topic has been exhausted.',
      classification: 'n/a',
    };
  }

  const { classification, source, noteworthy } = classifyAnswer(candidateAnswer, evaluationSignals);

  // A noteworthy answer (candidate raised something worth exploring)
  // overrides a plain "strong -> maybe skip" outcome, but still respects budget.
  if (noteworthy && classification !== 'blank') {
    return {
      shouldFollowUp: true,
      type: strongFollowUpType(slot),
      reason: "Candidate's answer raised something technically interesting worth probing further.",
      classification,
    };
  }

  switch (classification) {
    case 'blank':
      return {
        shouldFollowUp: true,
        type: 'clarification',
        reason: 'No substantive answer was given - ask the candidate to clarify or restate their approach.',
        classification,
      };

    case 'vague':
      return {
        shouldFollowUp: true,
        type: 'clarification',
        reason: `Answer was too brief or hedged to assess understanding (${source} classification).`,
        classification,
      };

    case 'incorrect':
      return {
        shouldFollowUp: true,
        type: 'correction',
        reason: 'Answer appears incorrect - probe the reasoning behind it without revealing the correct answer.',
        classification,
      };

    case 'partial':
      return {
        shouldFollowUp: true,
        type: partialFollowUpType(slot),
        reason: 'Answer was partially correct or incomplete - ask a targeted follow-up on the missing piece.',
        classification,
      };

    case 'strong':
      // Rule: a strong answer CAN earn a deeper follow-up, but doesn't have
      // to. Reserve the budget for topics already flagged as risk areas
      // (gap/struggled) rather than spending it on already-confident days.
      if (slot.category === 'gap' || slot.category === 'struggled') {
        return {
          shouldFollowUp: true,
          type: strongFollowUpType(slot),
          reason: `Strong answer on a "${slot.category}" topic - worth confirming depth with a trade-off/edge-case probe.`,
          classification,
        };
      }
      return {
        shouldFollowUp: false,
        type: null,
        reason: 'Answer was strong and complete on a topic the candidate was already confident in - no follow-up needed.',
        classification,
      };

    case 'unknown':
    default:
      return {
        shouldFollowUp: false,
        type: null,
        reason: 'No evaluation signals were provided and answer heuristics were inconclusive - defaulting to no ' +
          'follow-up rather than probing unnecessarily. Provide evaluationSignals for a more informed decision.',
        classification,
      };
  }
}

// ---------------------------------------------------------------------------
// Step 4: prompt building
// ---------------------------------------------------------------------------

/**
 * Format the portion of conversationContext relevant to the current topic
 * only (per spec rule 9: follow-ups must stay on the current curriculum
 * topic), so the AI has what it needs without dragging in unrelated turns.
 *
 * @param {Array<Object>} conversationContext
 * @param {number} day
 * @returns {string}
 */
function formatTopicContext(conversationContext, day) {
  const relevant = Array.isArray(conversationContext)
    ? conversationContext.filter((turn) => turn.day === day)
    : [];

  if (relevant.length === 0) {
    return 'No prior exchange recorded on this topic yet.';
  }

  const lines = relevant.map((turn) => {
    const question = turn.question || '(question text not recorded)';
    const answer = turn.candidateAnswer || turn.answer || '(no answer recorded)';
    const followUpLines = Array.isArray(turn.followUps)
      ? turn.followUps.map((f) => `    - Follow-up already asked: "${f.question || ''}" -> Candidate: "${f.answer || ''}"`).join('\n')
      : '';
    return `  Q: "${question}"\n    Candidate: "${answer}"` + (followUpLines ? `\n${followUpLines}` : '');
  });

  return lines.join('\n');
}

/**
 * Build the AI-ready prompt instructing the downstream AI to ask exactly
 * one follow-up question of the given type.
 *
 * @param {Object} slot
 * @param {string} candidateAnswer
 * @param {string} type
 * @param {string} reason
 * @param {Array<Object>} conversationContext
 * @returns {string}
 */
function buildFollowUpPrompt(slot, candidateAnswer, type, reason, conversationContext) {
  const topicLine = slot.topic ? `Topic: "${slot.topic}"` : `Topic: (no curriculum topic on record for day ${slot.day}).`;
  const topicContext = formatTopicContext(conversationContext, slot.day);

  return [
    `The candidate just answered the current question on Day ${slot.day} (${slot.type} question, difficulty ${slot.difficulty || 'unspecified'}).`,
    `${topicLine}`,
    `CANDIDATE'S ANSWER: "${candidateAnswer}"`,
    `WHY A FOLLOW-UP IS WARRANTED: ${reason}`,
    `FOLLOW-UP TYPE - ${FOLLOWUP_TYPE_GUIDANCE[type]}`,
    `PRIOR EXCHANGE ON THIS TOPIC (do not repeat any question already asked below):\n${topicContext}`,
    'INSTRUCTION: Ask exactly ONE follow-up question now. Refer naturally to what the candidate just said, ' +
      'stay strictly on this topic, do not reveal the correct answer, do not sound robotic or scripted, ' +
      'probe their reasoning rather than memorization, and calibrate the depth of the question to how much ' +
      'understanding the candidate has already demonstrated. Do not turn this into an explanation or lesson - ' +
      'you are asking a question, not teaching.',
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide whether the candidate's answer warrants a follow-up, and if so,
 * build the AI-ready prompt for asking it.
 *
 * @param {Object} params
 * @param {Object} params.slot - current question slot (from interviewPlanner.planInterview().questions[i])
 * @param {string} params.candidateAnswer - the candidate's answer text ("" for no/blank answer)
 * @param {Array<Object>} [params.conversationContext] - prior turns; entries with a matching `day` are used for topic context
 * @param {number} [params.remainingBudget] - follow-ups left for this slot; defaults to slot.followUpBudget, then 1
 * @param {Object} [params.evaluationSignals] - optional pre-computed read of the answer, e.g.
 *   { correctness: 'correct'|'partial'|'incorrect', completeness: 'complete'|'incomplete'|'vague', noteworthy: boolean }
 * @returns {{
 *   shouldFollowUp: boolean,
 *   reason: string,
 *   type: 'clarification'|'depth'|'correction'|'application'|'tradeoff'|'edge_case'|null,
 *   remainingBudget: number,
 *   prompt: string|null
 * }}
 */
function generateFollowUp({
  slot,
  candidateAnswer,
  conversationContext = [],
  remainingBudget,
  evaluationSignals = null,
} = {}) {
  validateInputs(slot, candidateAnswer);

  const effectiveBudget = typeof remainingBudget === 'number' ? remainingBudget : (typeof slot.followUpBudget === 'number' ? slot.followUpBudget : 1);

  const decision = decideFollowUp(slot, candidateAnswer, effectiveBudget, evaluationSignals);

  if (!decision.shouldFollowUp) {
    return {
      shouldFollowUp: false,
      reason: decision.reason,
      type: null,
      remainingBudget: effectiveBudget,
      prompt: null,
    };
  }

  const prompt = buildFollowUpPrompt(slot, candidateAnswer, decision.type, decision.reason, conversationContext);

  return {
    shouldFollowUp: true,
    reason: decision.reason,
    type: decision.type,
    remainingBudget: Math.max(0, effectiveBudget - 1), // never exceed budget: this follow-up consumes one slot
    prompt,
  };
}

module.exports = { generateFollowUp };