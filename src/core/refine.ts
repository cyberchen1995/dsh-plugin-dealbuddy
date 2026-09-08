import { writeStringMap, type Requirements } from './domain.js'
import { mergeRequirements } from './requirements.js'
import { getObject, type JsonObject, type JsonValue } from '../store/json.js'
import { readRequirements } from './domain.js'

/**
 * Requirement refinement, ported from `SessionStore.refine` (`session.py:69-88`).
 *
 * Refinement is destructive by design: changing what you are looking for
 * invalidates the offers you gathered under the old requirements, so the
 * captured products and the report are cleared. Nothing warns the user about
 * that, which is why the tool description and the skill both have to.
 */

/** What a refinement removed, so a caller can say it out loud. */
export interface RefineOutcome {
  /** Offers discarded by the refinement. */
  clearedOffers: number
  /** Whether a report existed before the refinement. */
  clearedReport: boolean
  /** Whether the category changed, which resets the requirement version. */
  categoryChanged: boolean
  /** The session phase after refinement. */
  phase: string
}

/**
 * Apply requirement changes to a parsed session, in place.
 * @param session - the parsed session node.
 * @param changes - the requested changes.
 * @returns what the refinement discarded.
 */
export function refineSession(
  session: JsonObject,
  changes: ReadonlyMap<string, unknown>,
): RefineOutcome {
  const requirementsNode = getObject(session, 'requirements')
  const current: Requirements = requirementsNode
    ? readRequirements(requirementsNode)
    : { ...emptyLike() }
  const previousCategory = current.category
  const merged = mergeRequirements(current, changes)

  const offers = session.get('verified_offers')
  const clearedOffers = Array.isArray(offers) ? offers.length : 0
  const report = session.get('report_markdown')
  const clearedReport = typeof report === 'string' && report.length > 0

  session.set('requirements', writeRequirements(merged))
  session.set('search_plan', null)
  session.set('verified_offers', [])
  session.set('report_markdown', null)
  session.set('pending_action', null)

  const categoryChanged = merged.category !== previousCategory
  if (categoryChanged) {
    session.set('parameter_catalog', null)
    session.set('candidates', [])
    session.set('phase', 'created')
  } else {
    session.set('phase', 'ready_to_search')
  }

  return {
    clearedOffers,
    clearedReport,
    categoryChanged,
    phase: categoryChanged ? 'created' : 'ready_to_search',
  }
}

/**
 * Serialise a requirement set in the field order pydantic writes.
 * @param requirements - the requirement set.
 * @returns the object node.
 */
export function writeRequirements(requirements: Requirements): JsonObject {
  const node: JsonObject = new Map()
  const entries: [string, JsonValue][] = [
    ['category', requirements.category],
    ['raw_request', requirements.raw_request],
    ['version', requirements.version],
    ['budget_min', requirements.budget_min],
    ['budget_max', requirements.budget_max],
    ['use_cases', [...requirements.use_cases]],
    ['must_have', writeStringMap(requirements.must_have)],
    ['preferences', writeStringMap(requirements.preferences)],
    ['exclusions', [...requirements.exclusions]],
    ['brands', [...requirements.brands]],
    ['after_sales', [...requirements.after_sales]],
  ]
  for (const [key, value] of entries) node.set(key, value)
  return node
}

/**
 * A requirement set with pydantic's defaults and no category.
 * @returns the empty requirement set.
 */
function emptyLike(): Requirements {
  return {
    category: '',
    raw_request: '',
    version: 1,
    budget_min: null,
    budget_max: null,
    use_cases: [],
    must_have: new Map(),
    preferences: new Map(),
    exclusions: [],
    brands: [],
    after_sales: [],
  }
}
