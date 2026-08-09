# PROMPTS

This file contains the AI prompts used during the development of ELEVO for the ABTalks Vibe Code Hackathon.

__________________________________________________________________

## Prompt 1 – Project Architecture

**Tool Used:** ChatGPT

### Objective
Design the project architecture and divide responsibilities among a 3-member team.

### Prompt
Design a scalable folder structure for an AI Interview Agent built using React, Node.js, and JavaScript. The project should support three team members working simultaneously with separate responsibilities for Backend, Frontend, and AI Engine.

### Outcome
- Designed project folder structure
- Created AI module plan
- Divided work among team members
- Planned Git branching strategy

_____________________________________________________________________________

## Prompt 2 – Candidate Analyzer Module

**Tool Used:** Claude

### Objective
Implement the `backend/ai/candidateAnalyzer.js` module.

### Prompt
Implement ONLY `backend/ai/candidateAnalyzer.js`.

Its ONLY responsibility is to analyze a candidate profile.

Input:
A single candidate object from `candidates.json`.

Output:

```javascript
{
  candidateId,
  candidateName,
  completedDays,
  skippedDays,
  progress,
  learningSignals,
  attempts,
  recommendedDifficulty
}
```

Requirements:

- Create a function called `analyzeCandidate(candidate)`.
- Extract candidate ID, name, completed days, skipped days, attempts, and learning signals.
- Calculate a recommended interview difficulty (`Easy`, `Medium`, `Hard`).
- Do NOT read `curriculum.json`.
- Do NOT generate interview questions.
- Do NOT call any AI model.
- Do NOT build Express APIs.
- Use clean ES6 JavaScript.
- Export using `module.exports`.

### Outcome

Generated a modular JavaScript module that:
- Analyzes a candidate profile
- Extracts progress and performance metrics
- Computes interview difficulty
- Returns a structured summary object
- Uses helper functions for clean, maintainable code
_____________________________________________________________

## Prompt 3 – Curriculum Mapper

**Tool Used:** Claude

### Objective
Implement the `backend/ai/curriculumMapper.js` module to map curriculum day numbers to their corresponding curriculum information.

### Prompt

Implement ONLY `backend/ai/curriculumMapper.js`.

Responsibility (and ONLY responsibility):

Map curriculum day numbers to their corresponding curriculum details using `curriculum.json`.

Input:
- An array of curriculum day numbers (e.g. `[1, 2, 5, 8]`)

Output:
A structured array where each item contains:
- day
- topic
- module
- learningObjectives
- toolsUsed

Requirements:

1. Read `curriculum.json`.
2. Accept an array of completed or skipped day numbers.
3. Return only matching curriculum entries.
4. Ignore invalid day numbers safely.
5. Use clean helper functions.
6. Handle missing or incomplete data gracefully.
7. Use modern ES6 JavaScript.
8. Export using `module.exports`.
9. Add comments explaining the code.

Do NOT analyze candidates.
Do NOT generate interview questions.
Do NOT call any AI model.
Do NOT build Express routes or APIs.

Focus ONLY on curriculum mapping.

### Outcome

Implemented a curriculum mapping module that:
- Loads and parses `curriculum.json`
- Caches curriculum data for efficient reuse
- Maps curriculum day numbers to their corresponding topics
- Returns module information, learning objectives, and tools used
- Ignores invalid or missing day numbers gracefully
- Provides clean, modular, and reusable JavaScript code