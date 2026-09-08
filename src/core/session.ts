import { getArray, getObject, getString, type JsonObject, type JsonValue } from '../store/json.js'
import { readRequirements, readVerifiedOffer, type VerifiedOffer } from './domain.js'
import { rankOffers } from './ranking.js'
import { buildMarkdownReport } from './reporting.js'

/**
 * Whole-session operations that work on the parsed document.
 *
 * Mutating the parsed node instead of rebuilding it from typed structs keeps
 * every field the plugin does not understand — and every untouched offer's
 * exact bytes, including the position Python's background summariser puts
 * `llm_summary` in.
 */

/** Session fields in the order pydantic writes them (`session.py:15-27`). */
const SESSION_FIELD_ORDER = [
  'session_id',
  'requirements',
  'phase',
  'parameter_catalog',
  'search_plan',
  'candidates',
  'verified_offers',
  'report_markdown',
  'messages',
  'pending_action',
  'created_at',
  'updated_at',
] as const

/**
 * Read the offers of a parsed session.
 * @param session - the parsed session node.
 * @returns the offer nodes, or an empty array when absent.
 */
export function offerNodes(session: JsonObject): JsonValue[] {
  return getArray(session, 'verified_offers') ?? []
}

/**
 * Replace an offer with the same URL, then append the new one.
 *
 * Python removes and appends rather than replacing in place, so a re-captured
 * product moves to the end of the list (`intake.py:83-86`).
 * @param session - the parsed session node, mutated in place.
 * @param url - the product URL used as identity; compared by exact equality.
 * @param offer - the new offer node.
 */
export function upsertOffer(session: JsonObject, url: string, offer: JsonObject): void {
  const kept = offerNodes(session).filter((node) => {
    if (!(node instanceof Map)) return true
    return getString(node, 'url') !== url
  })
  kept.push(offer)
  session.set('verified_offers', kept)
}

/**
 * Remove every offer with the given URL.
 * @param session - the parsed session node, mutated in place.
 * @param url - the product URL.
 * @returns the removed nodes.
 */
export function removeOffer(session: JsonObject, url: string): JsonObject[] {
  const removed: JsonObject[] = []
  const kept = offerNodes(session).filter((node) => {
    if (node instanceof Map && getString(node, 'url') === url) {
      removed.push(node)
      return false
    }
    return true
  })
  session.set('verified_offers', kept)
  return removed
}

/**
 * Rebuild `report_markdown` from the current offers (`intake.py:92-101`).
 *
 * An empty offer list clears the report to null rather than writing an empty
 * document, which is what `report_available` keys off.
 * @param session - the parsed session node, mutated in place.
 */
export function rebuildReport(session: JsonObject): void {
  const requirementsNode = getObject(session, 'requirements')
  const offers = parseOffers(session)
  if (requirementsNode === undefined || offers.length === 0) {
    session.set('report_markdown', null)
    return
  }
  const requirements = readRequirements(requirementsNode)
  session.set('report_markdown', buildMarkdownReport(requirements, rankOffers(offers, requirements)))
}

/**
 * Parse every offer of a session into the typed shape.
 * @param session - the parsed session node.
 * @returns the typed offers, skipping malformed entries.
 */
export function parseOffers(session: JsonObject): VerifiedOffer[] {
  return offerNodes(session)
    .filter((node): node is JsonObject => node instanceof Map)
    .map((node) => readVerifiedOffer(node))
}

/**
 * Build a new session document in pydantic's field order.
 * @param sessionId - the generated session id.
 * @param requirements - the initial requirement node.
 * @param now - the creation timestamp.
 * @returns the session node.
 */
export function newSession(
  sessionId: string,
  requirements: JsonObject,
  now: string,
): JsonObject {
  const session: JsonObject = new Map()
  const values: Record<(typeof SESSION_FIELD_ORDER)[number], JsonValue> = {
    session_id: sessionId,
    requirements,
    phase: 'created',
    parameter_catalog: null,
    search_plan: null,
    candidates: [],
    verified_offers: [],
    report_markdown: null,
    messages: [],
    pending_action: null,
    created_at: now,
    updated_at: now,
  }
  for (const field of SESSION_FIELD_ORDER) session.set(field, values[field])
  return session
}
