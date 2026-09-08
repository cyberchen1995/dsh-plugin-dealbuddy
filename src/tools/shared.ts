import type { JsonObject, JsonValue } from '../store/json.js'
import { getString } from '../store/json.js'

/**
 * Helpers shared by the DealBuddy tools.
 *
 * Tool results must be lossless JSON, so the ordered `Map`s used on disk are
 * flattened to plain objects on the way out. That is safe here: the ordering
 * only has to survive inside the store and the ranking input, not in the view
 * the model reads.
 */

/** Plain JSON, structurally identical to the harness's own `JsonValue`. */
export type PlainJson =
  | null
  | boolean
  | number
  | string
  | PlainJson[]
  | { [key: string]: PlainJson }

/**
 * Convert an ordered node into a plain JSON value.
 * @param value - the value to convert.
 * @returns a structure of plain objects and arrays.
 */
export function toPlain(value: JsonValue): PlainJson {
  if (value instanceof Map) {
    const result: { [key: string]: PlainJson } = {}
    for (const [key, item] of value) result[key] = toPlain(item)
    return result
  }
  if (Array.isArray(value)) return value.map((item) => toPlain(item))
  return value
}

/**
 * Shorten each offer's recognised detail-image text for a session view.
 *
 * One captured product can carry thousands of characters of recognised text;
 * three of them already crowded out the useful part of a reply. The stored
 * file always keeps the full text — only the view is shortened, and it says so
 * in the record itself.
 * @param session - a *copy* of the parsed session node, mutated in place.
 * @param previewChars - how many characters of text to keep.
 * @param keepFullText - when true, nothing is shortened.
 * @returns the number of offers whose text was shortened.
 */
export function truncateOcrText(
  session: JsonObject,
  previewChars: number,
  keepFullText: boolean,
): number {
  if (keepFullText) return 0
  const offers = session.get('verified_offers')
  if (!Array.isArray(offers)) return 0
  let shortened = 0
  for (const offer of offers) {
    if (!(offer instanceof Map)) continue
    const parameters = offer.get('parameters')
    if (!(parameters instanceof Map)) continue
    const text = getString(parameters, 'ocr_text')
    if (text === undefined || text.length <= previewChars) continue
    parameters.set('ocr_text', text.slice(0, previewChars))
    parameters.set('ocr_text_truncated_from_chars', String(text.length))
    shortened += 1
  }
  return shortened
}

/**
 * Drop the message log from a session view.
 * @param session - the parsed session node.
 * @returns how many messages were dropped.
 */
export function dropMessages(session: JsonObject): number {
  const messages = session.get('messages')
  const count = Array.isArray(messages) ? messages.length : 0
  session.set('messages', [])
  return count
}

/**
 * Summarise the write result the way the workbench's routes do.
 * @param session - the parsed session node.
 * @param sessionId - the session id.
 * @returns the counts shared by several tools.
 */
export function writeSummary(
  session: JsonObject,
  sessionId: string,
): { session_id: string; verified_count: number; report_available: boolean } {
  const offers = session.get('verified_offers')
  const report = session.get('report_markdown')
  return {
    session_id: sessionId,
    verified_count: Array.isArray(offers) ? offers.length : 0,
    report_available: typeof report === 'string' && report.length > 0,
  }
}
