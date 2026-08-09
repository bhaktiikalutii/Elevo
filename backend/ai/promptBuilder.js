/**
 * promptBuilder.js
 *
 * Responsibility (and ONLY responsibility):
 * Convert a structured interview plan (from interviewPlanner.js) into
 * AI-ready prompt objects: one system prompt defining interviewer behavior,
 * plus one question prompt per plan slot, each carrying enough curriculum
 * and candidate context for a downstream AI layer to conduct a natural,
 * adaptive conversation.
 *
 * This module does NOT:
 *  - call any AI model (Claude, OpenAI, Groq, OpenRouter, or otherwise)
 *  - build Express routes/APIs
 *  - manage interview sessions
 *  - evaluate candidate answers or generate feedback
 *  - read curriculum.json directly (curriculum data arrives pre-resolved
 *    inside interviewPlan.questions, via curriculumMapper.js)
 *  - re-derive candidate progress/signals (that's candidateAnalyzer.js's job)
 *
 * It is deterministic: the same interviewPlan + candidateAnalysis +
 * conversationContext will always produce the same prompt text.
 */

// ---------------------------------------------------------------------------
// Question-type style guidance. Each block tells the AI HOW to shape a
// question of that type, without ever supplying the actual question or its
// answer - that stays entirely up to the downstream AI call.
// ---------------------------------------------------------------------------
const TYPE_GUIDANCE = {
  conceptual:
    'CONCEPTUAL: Test whether the candidate understands the underlying concept and can explain why it works, ' +
    'not just recite a definition. Ask them to reason about the "why", not just the "what".',
  application:
    'APPLICATION: Describe a realistic engineering situation related to this topic and ask how the candidate ' +
    'would apply the concept to solve it. Ground it in a concrete scenario, not an abstract question.',
  troubleshooting:
    'TROUBLESHOOTING: Present a realistic technical problem or failure related to this topic and ask the ' +
    'candidate how they would diagnose and fix it. Focus on their diagnostic process, not just the fix.',
  design:
    'DESIGN: Ask the candidate to reason about architecture, trade-offs, scalability, reliability, or production ' +
    'decisions related to this topic. Push for justification of choices, not just a description of options.',
};

const SUPPORTED_TYPES = Object.keys(TYPE_GUIDANCE);

// ---------------------------------------------------------------------------
// Interviewer behavior rules, shared across the whole interview via the
// system prompt. Kept as a list (rather than inline prose) so it's easy to
// audit and easy to extend.
// ---------------------------------------------------------------------------
const INTERVIEWER_BEHAVIOR_RULES = [
  'Behave like a senior technical interviewer conducting a real, live interview.',
  'Be conversational and professional - never robotic, never a quiz show.',
  'Ask ONE question at a time. Never bundle multiple unrelated questions into one turn.',
  'Never reveal the expected answer, directly or indirectly, before the candidate responds.',
  "Adapt based on the candidate's previous response - do not ignore what they just said.",
  'When an answer is incomplete, vague, incorrect, or unexpectedly interesting, ask a natural follow-up ' +
    'that digs deeper before moving to the next planned question.',
  'Challenge strong candidates - if an answer is confident and correct, push into edge cases or trade-offs.',
  'Provide clarification only when the candidate genuinely seems confused about the question itself, ' +
    'not as a way to hint at the answer.',
  'Never turn the interview into a teaching session. You are assessing, not instructing.',
  'Test understanding, not memorization - phrase questions so a memorized definition alone is not sufficient.',
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the incoming interview plan has the shape promptBuilder needs.
 * Throws with a specific, actionable message rather than failing deep
 * inside string-building code.
 *
 * @param {Object} interviewPlan - output of interviewPlanner.planInterview()
 */
function validateInterviewPlan(interviewPlan) {
  if (!interviewPlan || typeof interviewPlan !== 'object') {
    throw new Error('promptBuilder: interviewPlan is required (see interviewPlanner.planInterview)');
  }
  if (!Array.isArray(interviewPlan.questions) || interviewPlan.questions.length === 0) {
    throw new Error('promptBuilder: interviewPlan.questions must be a non-empty array');
  }

  interviewPlan.questions.forEach((slot, i) => {
    if (typeof slot.day !== 'number') {
      throw new Error(`promptBuilder: question at index ${i} is missing a valid "day"`);
    }
    if (!SUPPORTED_TYPES.includes(slot.type)) {
      throw new Error(
        `promptBuilder: question for day ${slot.day} has unsupported type "${slot.type}" ` +
          `(expected one of: ${SUPPORTED_TYPES.join(', ')})`
      );
    }
    if (!slot.difficulty) {
      throw new Error(`promptBuilder: question for day ${slot.day} is missing a "difficulty"`);
    }
  });
}

// ---------------------------------------------------------------------------
// Conversation context formatting
// ---------------------------------------------------------------------------

/**
 * Format prior conversation turns into a readable context block for the
 * downstream AI, restricted to turns that happened before the given
 * question's sequence number. Never fabricates turns - if none are
 * available it says so explicitly.
 *
 * Expected shape of each conversationContext entry (all fields optional
 * except questionNumber, so this stays tolerant of a partially-filled
 * session history):
 *   {
 *     questionNumber: number,
 *     topic: string,
 *     question: string,
 *     candidateAnswer: string,
 *     followUps: [{ question: string, answer: string }]
 *   }
 *
 * @param {Array<Object>} conversationContext
 * @param {number} currentSequence
 * @returns {string}
 */
function formatConversationContext(conversationContext, currentSequence) {
  const priorTurns = Array.isArray(conversationContext)
    ? conversationContext.filter((turn) => typeof turn.questionNumber === 'number' && turn.questionNumber < currentSequence)
    : [];

  if (priorTurns.length === 0) {
    return 'CONVERSATION CONTEXT: This is the first question of the interview. There is no prior context yet.';
  }

  const lines = priorTurns.map((turn) => {
    const topic = turn.topic || `Day ${turn.day ?? '?'}`;
    const question = turn.question || '(question text not recorded)';
    const answer = turn.candidateAnswer || '(no answer recorded)';
    const followUpLines = Array.isArray(turn.followUps)
      ? turn.followUps.map((f) => `    - Follow-up: "${f.question || ''}" -> Candidate: "${f.answer || ''}"`).join('\n')
      : '';

    return (
      `  Q${turn.questionNumber} [${topic}]: "${question}"\n` +
      `    Candidate answered: "${answer}"` +
      (followUpLines ? `\n${followUpLines}` : '')
    );
  });

  return (
    'CONVERSATION CONTEXT (use this to avoid repeating questions and to keep follow-ups relevant; ' +
    "do not re-ask anything already covered below):\n" +
    lines.join('\n')
  );
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Build the single system prompt that frames the AI's role for the entire
 * interview. Only uses fields actually present on interviewPlan/candidateAnalysis
 * - never invents a job role, name, or experience level that wasn't provided.
 *
 * @param {Object} interviewPlan
 * @param {Object|null} candidateAnalysis - optional, output of candidateAnalyzer.analyzeCandidate()
 * @returns {string}
 */
function buildSystemPrompt(interviewPlan, candidateAnalysis) {
  const candidateName = interviewPlan.candidateName || (candidateAnalysis && candidateAnalysis.candidateName) || 'the candidate';
  const overallDifficulty = interviewPlan.overallDifficulty || 'Medium';
  const totalQuestions = interviewPlan.totalQuestions || interviewPlan.questions.length;
  const daysCovered = Array.isArray(interviewPlan.daysCovered) ? interviewPlan.daysCovered.length : null;

  const signalLines = [];
  if (candidateAnalysis && candidateAnalysis.progress) {
    const { completed, totalMissions } = candidateAnalysis.progress;
    if (typeof completed === 'number' && typeof totalMissions === 'number') {
      signalLines.push(`- Completed ${completed} of ${totalMissions} curriculum missions.`);
    }
  }
  if (candidateAnalysis && candidateAnalysis.learningSignals) {
    const { passRate, firstTryRate } = candidateAnalysis.learningSignals;
    if (typeof passRate === 'number') {
      signalLines.push(`- Overall mission pass rate: ${Math.round(passRate * 100)}%.`);
    }
    if (typeof firstTryRate === 'number') {
      signalLines.push(`- First-try success rate: ${Math.round(firstTryRate * 100)}%.`);
    }
  }

  return [
    `You are conducting a live technical interview for ${candidateName}, part of the ABTalks AI Engineering Cohort.`,
    `Based on their learning journey, they have been assessed at an overall ${overallDifficulty} difficulty level, ` +
      `and this interview will cover ${totalQuestions} question(s) across ${daysCovered ?? 'several'} curriculum day(s).`,
    signalLines.length > 0 ? `Candidate signals on record:\n${signalLines.join('\n')}` : null,
    'INTERVIEWER RULES:',
    INTERVIEWER_BEHAVIOR_RULES.map((rule) => `- ${rule}`).join('\n'),
    'You will be given one question slot at a time, with its curriculum context, selection rationale, ' +
      'and any prior conversation context. Use all of it to conduct one coherent, natural interview - not a ' +
      'series of disconnected quiz questions.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Per-question prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for a single question slot from the interview plan.
 *
 * @param {Object} slot - one entry from interviewPlan.questions
 * @param {Array<Object>} conversationContext - prior turns, see formatConversationContext
 * @returns {string}
 */
function buildQuestionPrompt(slot, conversationContext) {
  const topicLine = slot.topic
    ? `Topic: "${slot.topic}"`
    : `Topic: (no curriculum topic on record for day ${slot.day} - do not invent one; ask generally about this day's work).`;

  const moduleLine = slot.module && slot.module.title
    ? `Module ${slot.module.number ?? '?'}: ${slot.module.title}`
    : 'Module: (not on record)';

  const objectiveLine = slot.focusObjective
    ? `Learning objective to probe: "${slot.focusObjective}"`
    : 'Learning objective: (none on record - focus generally on the topic above).';

  const toolsLine = Array.isArray(slot.relevantTools) && slot.relevantTools.length > 0
    ? `Relevant tools/technologies: ${slot.relevantTools.join(', ')}`
    : null;

  const followUpBudget = typeof slot.followUpBudget === 'number' ? slot.followUpBudget : 1;

  const contextBlock = formatConversationContext(conversationContext, slot.sequence ?? 0);

  return [
    `You are about to ask question ${slot.sequence ?? '?'} of the interview (Day ${slot.day}).`,
    `CURRICULUM CONTEXT:\n  ${moduleLine}\n  ${topicLine}\n  ${objectiveLine}` + (toolsLine ? `\n  ${toolsLine}` : ''),
    `QUESTION TYPE - ${TYPE_GUIDANCE[slot.type]}`,
    `DIFFICULTY: ${slot.difficulty}. Calibrate phrasing and depth to this level.`,
    `SELECTION RATIONALE (why this topic was chosen for this candidate): ${slot.rationale || 'Selected for interview coverage.'}`,
    `FOLLOW-UP ALLOWANCE: You may ask up to ${followUpBudget} natural follow-up question(s) on this topic if the ` +
      'candidate\'s answer is incomplete, incorrect, vague, or opens up something worth probing further. ' +
      'Do not force a follow-up if the answer was strong and complete.',
    contextBlock,
    'INSTRUCTION: Ask ONE question now, phrased naturally as part of a live conversation - do not read the topic ' +
      'or learning objective verbatim, do not preview what a good answer looks like, and do not ask more than one ' +
      'question in this turn.',
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full set of AI-ready prompts for an interview.
 *
 * @param {Object} interviewPlan - output of interviewPlanner.planInterview()
 * @param {Object|null} [candidateAnalysis] - optional, output of candidateAnalyzer.analyzeCandidate(),
 *   used only to personalize the system prompt. Never required, never invented if absent.
 * @param {Array<Object>} [conversationContext] - optional prior turns, see formatConversationContext()
 * @returns {{
 *   systemPrompt: string,
 *   questionPrompts: Array<{
 *     questionNumber: number,
 *     day: number,
 *     topic: string|null,
 *     type: 'conceptual'|'application'|'troubleshooting'|'design',
 *     difficulty: string,
 *     prompt: string
 *   }>
 * }}
 */
function buildInterviewPrompts(interviewPlan, candidateAnalysis = null, conversationContext = []) {
  validateInterviewPlan(interviewPlan);

  const systemPrompt = buildSystemPrompt(interviewPlan, candidateAnalysis);

  const questionPrompts = interviewPlan.questions.map((slot, index) => ({
    questionNumber: slot.sequence ?? index + 1,
    day: slot.day,
    topic: slot.topic,
    type: slot.type,
    difficulty: slot.difficulty,
    prompt: buildQuestionPrompt(slot, conversationContext),
  }));

  return { systemPrompt, questionPrompts };
}

module.exports = { buildInterviewPrompts };