import { readFileSync } from 'node:fs'

import { getArray, getObject, getString, parseJson, type JsonObject } from '../store/json.js'
import { configPath, isValidSessionId, sessionPath } from '../store/paths.js'
import type { BindingStore } from '../store/binding-store.js'
import type { SessionStore } from '../store/session-store.js'

/**
 * What the model is told about the shopping session its conversation is about.
 *
 * The prompt assembly runs on every step of every conversation and its text
 * provider must answer synchronously, so this module is built around that: the
 * binding table is held in memory and consulted first, which costs an unbound
 * conversation nothing, and only a bound one reads its session file.
 */

/** The facts the context line is rendered from. */
export interface BoundContext {
  session_id: string
  category: string
  raw_request: string
  version: number
  budget_min: string | null
  budget_max: string | null
  must_have: [string, string][]
  verified_count: number
  report_available: boolean
  /** Whether browser captures currently land in this session. */
  is_capture_target: boolean
  /** Where they land instead; null when no session is the target. */
  capture_target: string | null
}

/** What a session file could not tell us. */
export interface MissingBinding {
  session_id: string
  missing: true
}

/**
 * Read the shopping session a conversation is bound to, synchronously.
 * @param sessions - the session store, for its data directory.
 * @param bindings - the binding store; only its in-memory table is consulted.
 * @param dshSessionId - the dsh conversation.
 * @returns the facts, a missing marker, or undefined when nothing is bound.
 */
export function readBoundContext(
  sessions: SessionStore,
  bindings: BindingStore,
  dshSessionId: string,
): BoundContext | MissingBinding | undefined {
  const table = bindings.cached()
  if (table === undefined) return undefined
  const binding = table.find((entry) => entry.dsh_session_id === dshSessionId)
  if (binding === undefined) return undefined
  if (!isValidSessionId(binding.session_id)) return { session_id: binding.session_id, missing: true }
  let session: JsonObject
  try {
    const parsed = parseJson(readFileSync(sessionPath(sessions.dataDir, binding.session_id), 'utf8'))
    if (!(parsed instanceof Map)) return { session_id: binding.session_id, missing: true }
    session = parsed
  } catch {
    return { session_id: binding.session_id, missing: true }
  }
  const captureTarget = readCaptureTarget(sessions.dataDir) ?? null
  const requirements = getObject(session, 'requirements') ?? new Map()
  const offers = getArray(session, 'verified_offers') ?? []
  const report = session.get('report_markdown')
  return {
    session_id: binding.session_id,
    category: getString(requirements, 'category') ?? '',
    raw_request: getString(requirements, 'raw_request') ?? '',
    version: typeof requirements.get('version') === 'number' ? (requirements.get('version') as number) : 1,
    budget_min: getString(requirements, 'budget_min') ?? null,
    budget_max: getString(requirements, 'budget_max') ?? null,
    must_have: readPairs(requirements, 'must_have'),
    verified_count: offers.length,
    report_available: typeof report === 'string' && report.length > 0,
    is_capture_target: captureTarget === binding.session_id,
    capture_target: captureTarget,
  }
}

/**
 * Read `current_session_id` synchronously.
 * @param dataDir - the resolved data directory.
 * @returns the pointer, or undefined.
 */
function readCaptureTarget(dataDir: string): string | undefined {
  try {
    const parsed = parseJson(readFileSync(configPath(dataDir), 'utf8'))
    if (!(parsed instanceof Map)) return undefined
    const value = parsed.get('current_session_id')
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Read one requirement field as string pairs.
 * @param requirements - the parsed requirement node.
 * @param field - the field holding an object of pairs.
 * @returns the pairs in stored order.
 */
function readPairs(requirements: JsonObject, field: string): [string, string][] {
  const node = getObject(requirements, field)
  if (node === undefined) return []
  const pairs: [string, string][] = []
  for (const [key, value] of node) {
    if (typeof value === 'string' && value !== '') pairs.push([key, value])
  }
  return pairs
}
