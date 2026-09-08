/**
 * Read-only views over the DealBuddy session format on disk.
 *
 * The authority is the Python package's pydantic models
 * (`src/dealbuddy/session.py:15-27` and `models.py:109-127`). This round only
 * reads, so the types stay deliberately loose: unknown keys are preserved by
 * carrying the parsed record itself, and prices remain strings exactly as
 * pydantic serialises `Decimal`.
 */

/** Requirement set stored under `session.requirements`. */
export interface StoredRequirements {
  readonly category?: unknown
  readonly raw_request?: unknown
  readonly version?: unknown
  readonly [key: string]: unknown
}

/** One session file's parsed contents. */
export interface StoredSession {
  readonly session_id?: unknown
  readonly requirements?: StoredRequirements
  readonly phase?: unknown
  readonly verified_offers?: unknown
  readonly report_markdown?: unknown
  readonly messages?: unknown
  readonly created_at?: unknown
  readonly updated_at?: unknown
  readonly [key: string]: unknown
}

/** `config.json` contents; the `llm` section is read but never surfaced. */
export interface StoredConfig {
  readonly current_session_id?: unknown
  readonly [key: string]: unknown
}

/** The compact session view returned by `dealbuddy_list_sessions`. */
export interface SessionSummary {
  readonly session_id: string
  readonly category: string
  readonly raw_request: string
  readonly version: number
  readonly phase: string
  readonly verified_count: number
  readonly report_available: boolean
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Read a string field, falling back when the stored value is absent or of an
 * unexpected type.
 * @param value - the raw parsed value.
 * @param fallback - the value to use when `value` is not a string.
 * @returns the string to surface.
 */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Project one parsed session onto the summary shape.
 * @param sessionId - the id taken from the file name, used when the body omits it.
 * @param session - the parsed session record.
 * @returns the summary surfaced by the list tool.
 */
export function toSummary(
  sessionId: string,
  session: StoredSession,
): SessionSummary {
  const requirements = session.requirements ?? {}
  const offers = session.verified_offers
  const report = session.report_markdown
  const version = requirements['version']
  return {
    session_id: asString(session.session_id, sessionId),
    category: asString(requirements['category']),
    raw_request: asString(requirements['raw_request']),
    version: typeof version === 'number' ? version : 1,
    phase: asString(session.phase, 'created'),
    verified_count: Array.isArray(offers) ? offers.length : 0,
    report_available: typeof report === 'string' && report.length > 0,
    created_at: asString(session.created_at),
    updated_at: asString(session.updated_at),
  }
}
