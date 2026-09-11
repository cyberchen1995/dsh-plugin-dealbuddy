import type { BindingStore } from '../store/binding-store.js'
import type { SessionStore } from '../store/session-store.js'
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

/** The part of a tool's run context this plugin reads. */
export interface ExecLike {
  readonly agent?: { readonly id: string } | undefined
}

/**
 * Resolve which shopping session a call is about.
 *
 * A conversation and a shopping session are one thing, so a call made inside a
 * bound conversation does not have to name it. Passing `session_id` explicitly
 * still wins: the model may be answering about a session other than the one
 * this conversation belongs to.
 * @param sessionId - the argument, when the caller gave one.
 * @param exec - the run context, which names the conversation.
 * @param bindings - the binding table.
 * @param store - the session store the caller will act on.
 * @returns the session id to act on.
 * @throws when neither the argument nor a binding names one, or when the data
 *   directory moved while the binding was being read.
 */
export async function resolveSessionId(
  sessionId: string | undefined,
  exec: ExecLike,
  bindings: BindingStore,
  store: SessionStore,
): Promise<string> {
  if (typeof sessionId === 'string' && sessionId !== '') return sessionId
  const agentId = exec.agent?.id
  if (agentId !== undefined) {
    const dataDir = store.dataDir
    const binding = await bindings.byConversation(agentId)
    if (binding !== undefined) {
      // The binding names a session in the directory it was read from. Acting
      // on it after the setting moved would address a different directory, and
      // a restored or copied data set can hold the same id — which is how a
      // destructive refinement would land on the wrong session.
      if (store.dataDir !== dataDir || bindings.dataDir !== dataDir) {
        throw new Error(
          'The data directory changed while resolving this conversation\'s shopping session. Try again.',
        )
      }
      return binding.session_id
    }
  }
  throw new Error(
    'No shopping session is bound to this conversation. Pass session_id explicitly, or ask the user to bind one in the DealBuddy drawer.',
  )
}
