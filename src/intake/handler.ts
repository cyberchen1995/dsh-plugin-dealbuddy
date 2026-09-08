import { captureToVerifiedOffer, CONFIDENCES, PLATFORMS, type CapturePayload } from '../core/capture.js'
import { nowIso } from '../core/clock.js'
import { writeVerifiedOffer, type StringMap } from '../core/domain.js'
import { offerNodes, rebuildReport, upsertOffer } from '../core/session.js'
import { getString, type JsonObject, type JsonValue } from '../store/json.js'
import type { SessionStore } from '../store/session-store.js'

/**
 * The capture-ingestion pipeline behind `POST /api/current/offers`.
 *
 * The wire contract is fixed by the extension, which only accepts a 2xx whose
 * body carries `status: "ok"` and reads `verified_count` from it
 * (`content-script.js:1404-1422`).
 */

/** The successful response body (`web.py:1043-1048`). */
export interface IntakeResult {
  status: 'ok'
  session_id: string
  verified_count: number
  report_available: boolean
}

/** A refusal carrying the status code the workbench would return. */
export class IntakeError extends Error {
  /**
   * @param status - the HTTP status code.
   * @param detail - the value for the `detail` field.
   */
  constructor(
    readonly status: number,
    readonly detail: JsonValue,
  ) {
    super(typeof detail === 'string' ? detail : 'invalid request')
    this.name = 'IntakeError'
  }
}

/**
 * Validate a request body into a capture payload (`intake.py:18-37`).
 *
 * Unknown keys are ignored rather than rejected: the extension sends twenty
 * fields and the workbench stores eleven, so refusing the extras would break
 * delivery outright.
 * @param body - the parsed request body.
 * @returns the validated payload.
 * @throws IntakeError with status 422 when a field is missing or malformed.
 */
export function validateCapture(body: JsonValue): CapturePayload {
  if (!(body instanceof Map)) {
    throw new IntakeError(422, [violation(['body'], 'Input should be a valid dictionary')])
  }
  const violations: JsonValue[] = []

  const platform = getString(body, 'platform')
  if (platform === undefined || !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    violations.push(
      violation(['body', 'platform'], `Input should be ${PLATFORMS.map((p) => `'${p}'`).join(', ')}`),
    )
  }
  const url = requireText(body, 'url', violations)
  const title = requireText(body, 'title', violations)

  const confidence = getString(body, 'confidence') ?? 'medium'
  if (!CONFIDENCES.includes(confidence as (typeof CONFIDENCES)[number])) {
    violations.push(
      violation(
        ['body', 'confidence'],
        `Input should be ${CONFIDENCES.map((c) => `'${c}'`).join(', ')}`,
      ),
    )
  }

  if (violations.length > 0) throw new IntakeError(422, violations)

  return {
    platform: platform as string,
    url: url as string,
    title: title as string,
    visible_price: getString(body, 'visible_price') ?? null,
    store_name: getString(body, 'store_name') ?? null,
    sku_id: getString(body, 'sku_id') ?? null,
    sku_text: getString(body, 'sku_text') ?? null,
    selected_sku_text: getString(body, 'selected_sku_text') ?? null,
    specs: readSpecs(body),
    ocr_text: getString(body, 'ocr_text') ?? null,
    confidence,
  }
}

/**
 * Ingest one capture into a session.
 * @param store - the session store.
 * @param sessionId - the target session.
 * @param capture - the validated payload.
 * @returns the response body the extension expects.
 * @throws IntakeError with status 404 when the session file is gone.
 */
export async function ingestCapture(
  store: SessionStore,
  sessionId: string,
  capture: CapturePayload,
): Promise<IntakeResult> {
  const offer = captureToVerifiedOffer(capture, nowIso())
  try {
    return await store.update(sessionId, (session: JsonObject) => {
      upsertOffer(session, capture.url.trim(), writeVerifiedOffer(offer))
      rebuildReport(session)
      const report = session.get('report_markdown')
      return {
        status: 'ok' as const,
        session_id: sessionId,
        verified_count: offerNodes(session).length,
        report_available: typeof report === 'string' && report.length > 0,
      }
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'SessionNotFoundError') {
      // The Python workbench lets this surface as a 500; a 404 is the honest
      // answer for a config pointer aimed at a deleted file.
      throw new IntakeError(404, `Unknown session: ${sessionId}`)
    }
    throw error
  }
}

/**
 * Read the `specs` map, keeping only string values and their order.
 * @param body - the request body.
 * @returns the specs map.
 */
function readSpecs(body: JsonObject): StringMap {
  const raw = body.get('specs')
  const specs: StringMap = new Map()
  if (!(raw instanceof Map)) return specs
  for (const [key, value] of raw) {
    if (typeof value === 'string') specs.set(key, value)
  }
  return specs
}

/**
 * Require a non-blank string field, recording a violation otherwise.
 * @param body - the request body.
 * @param field - the field name.
 * @param violations - the accumulating violation list.
 * @returns the trimmed value, or undefined when invalid.
 */
function requireText(
  body: JsonObject,
  field: string,
  violations: JsonValue[],
): string | undefined {
  const value = getString(body, field)
  if (value === undefined) {
    violations.push(violation(['body', field], 'Field required'))
    return undefined
  }
  if (value.trim() === '') {
    violations.push(violation(['body', field], 'Value error, must not be blank'))
    return undefined
  }
  return value.trim()
}

/**
 * Build one FastAPI-shaped validation violation.
 * @param loc - the field location path.
 * @param msg - the human-readable message.
 * @returns the violation node.
 */
function violation(loc: string[], msg: string): JsonObject {
  const node: JsonObject = new Map()
  node.set('loc', [...loc])
  node.set('msg', msg)
  node.set('type', 'value_error')
  return node
}
