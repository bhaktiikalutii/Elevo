/**
 * curriculumMapper.js
 *
 * Responsibility (and ONLY responsibility):
 * Given an array of curriculum day numbers, look up and return the full
 * curriculum detail for each valid day, including which module it belongs
 * to, from curriculum.json.
 *
 * This module does NOT:
 *  - analyze candidates
 *  - generate interview questions
 *  - call any AI model
 *  - build Express routes/APIs
 *
 * It is a pure function over curriculum.json: same input -> same output.
 */

const fs = require('fs');
const path = require('path');

// Location of the shared curriculum data file. Adjust here if the project
// structure changes; nothing else in this module needs to know the path.
const CURRICULUM_PATH = path.join(__dirname, '..', '..', 'shared', 'data', 'curriculum.json');

// ---------------------------------------------------------------------------
// Loading & caching
// ---------------------------------------------------------------------------

// Module-level cache so repeated calls to mapDaysToCurriculum() don't re-read
// and re-parse the file from disk every time.
let cachedCurriculum = null;

/**
 * Read and parse curriculum.json from disk.
 * Throws a clear, descriptive error if the file is missing or malformed,
 * rather than letting a cryptic fs/JSON error bubble up.
 *
 * @returns {Object} raw curriculum data ({ cohort, modules, days })
 */
function loadCurriculumFile() {
  let raw;
  try {
    raw = fs.readFileSync(CURRICULUM_PATH, 'utf-8');
  } catch (err) {
    throw new Error(`curriculumMapper: unable to read curriculum.json at ${CURRICULUM_PATH} (${err.message})`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`curriculumMapper: curriculum.json is not valid JSON (${err.message})`);
  }
}

/**
 * Get the parsed curriculum data, loading it from disk on first use and
 * reusing the cached copy afterward.
 *
 * @returns {Object} { cohort, modules, days }
 */
function getCurriculum() {
  if (!cachedCurriculum) {
    cachedCurriculum = loadCurriculumFile();
  }
  return cachedCurriculum;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------
/**
 * Build a Map of day number -> day detail object for O(1) lookups.
 * Skips any malformed day entries instead of throwing, since this data
 * ultimately comes from a hand-maintained JSON file.
 *
 * @param {Array<Object>} days - curriculum.days array
 * @returns {Map<number, Object>}
 */
function buildDayIndex(days) {
  const index = new Map();

  if (!Array.isArray(days)) {
    return index;
  }

  days.forEach((dayEntry) => {
    if (dayEntry && typeof dayEntry.day === 'number') {
      index.set(dayEntry.day, dayEntry);
    }
  });

  return index;
}

/**
 * Find which module a given day belongs to, based on each module's
 * [startDay, endDay] range in curriculum.modules.
 *
 * @param {number} day
 * @param {Array<Object>} modules - curriculum.modules array
 * @returns {{ number: number, title: string } | null}
 */
function findModuleForDay(day, modules) {
  if (!Array.isArray(modules)) {
    return null;
  }

  const match = modules.find((module) => {
    const range = Array.isArray(module.days) ? module.days : null;
    if (!range || range.length !== 2) {
      return false;
    }
    const [startDay, endDay] = range;
    return day >= startDay && day <= endDay;
  });

  if (!match) {
    return null;
  }

  return {
    number: typeof match.n === 'number' ? match.n : null,
    title: match.title || null,
  };
}

/**
 * Safely normalize a curriculum day entry + its module into the module's
 * public output shape. Falls back to safe defaults for any missing fields
 * so a partially-filled curriculum entry never breaks the caller.
 *
 * @param {number} day
 * @param {Object} dayEntry - entry from curriculum.days
 * @param {Object} modules - curriculum.modules array
 * @returns {{
 *   day: number,
 *   topic: string|null,
 *   module: { number: number|null, title: string|null }|null,
 *   learningObjectives: string[],
 *   toolsUsed: string[]
 * }}
 */
function buildCurriculumEntry(day, dayEntry, modules) {
  return {
    day,
    topic: dayEntry.title || null,
    module: findModuleForDay(day, modules),
    learningObjectives: Array.isArray(dayEntry.objectives) ? dayEntry.objectives : [],
    toolsUsed: Array.isArray(dayEntry.tools) ? dayEntry.tools : [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map an array of curriculum day numbers to their full curriculum details.
 *
 * Invalid entries (non-numbers, days not present in curriculum.json) are
 * silently ignored rather than throwing, since callers will typically pass
 * a mix of completed/skipped days straight from candidate data, which may
 * not perfectly align with the curriculum (e.g. typos, retired days).
 *
 * @param {number[]} dayNumbers - e.g. [1, 2, 5, 8]
 * @returns {Array<{
 *   day: number,
 *   topic: string|null,
 *   module: { number: number|null, title: string|null }|null,
 *   learningObjectives: string[],
 *   toolsUsed: string[]
 * }>}
 */
function mapDaysToCurriculum(dayNumbers) {
  if (!Array.isArray(dayNumbers)) {
    return [];
  }

  const { days, modules } = getCurriculum();
  const dayIndex = buildDayIndex(days);

  return dayNumbers
    .filter((day) => typeof day === 'number' && Number.isFinite(day)) // ignore invalid day numbers
    .filter((day) => dayIndex.has(day)) // ignore days not found in curriculum.json
    .map((day) => buildCurriculumEntry(day, dayIndex.get(day), modules));
}

module.exports = { mapDaysToCurriculum };