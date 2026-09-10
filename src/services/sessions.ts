import { nowIso } from '../core/clock.js'
import { writeRequirements } from '../core/refine.js'
import { initialRequirements } from '../core/requirements.js'
import { newSession, rebuildReport, removeOffer } from '../core/session.js'
import type { SessionSummary } from '../core/models.js'
import { parseJson, stringifyJson, type JsonObject } from '../store/json.js'
import { SessionNotFoundError, SessionStore } from '../store/session-store.js'
import { dropMessages, toPlain, truncateOcrText, writeSummary, type PlainJson } from '../tools/shared.js'

/**
 * Session operations shared by the model-facing tools and the workbench panel.
 *
 * Both faces have to behave identically — the panel's delete and the model's
 * `dealbuddy_remove_offer` are the same edit — so the semantics live here once
 * and each face only adds its own presentation and error mapping.
 */

/** Raised when a URL matches no offer in the session. */
export class OfferNotFoundError extends Error {
  /**
   * @param url - the product URL that matched nothing.
   */
  constructor(readonly url: string) {
    // The user sees this text; it is the workbench's own wording.
    super('该商品已不在当前会话中')
    this.name = 'OfferNotFoundError'
  }
}

/** How much of a session view to keep. */
export interface ShowSessionOptions {
  /** Keep the full recognised detail-image text instead of a preview. */
  includeOcrText: boolean
  /** Keep the stored follow-up message log. */
  includeMessages: boolean
  /** Preview length applied when `includeOcrText` is false. */
  ocrPreviewChars: number
}

/** One session as a view, with what was left out of it. */
export type ShowSessionResult = {
  session: PlainJson
  ocr_text_shortened_offers: number
  omitted_messages: number
}

/** The counts every write returns. */
export type WriteSummary = {
  session_id: string
  verified_count: number
  report_available: boolean
}

/**
 * List every session as a summary plus the current capture target.
 * @param store - the session store.
 * @returns the summaries, the pointer, and the directory they came from.
 */
export async function listSessions(store: SessionStore): Promise<{
  current_session_id: string | null
  data_dir: string
  sessions: SessionSummary[]
}> {
  const [sessions, currentSessionId] = await Promise.all([
    store.listSummaries(),
    store.currentSessionId(),
  ])
  return {
    current_session_id: currentSessionId ?? null,
    data_dir: store.dataDir,
    sessions,
  }
}

/**
 * Read one session as a view.
 * @param store - the session store.
 * @param sessionId - the session to show.
 * @param options - how much of it to keep.
 * @returns the view and what it left out.
 * @throws SessionNotFoundError when the session has no file.
 */
export async function showSession(
  store: SessionStore,
  sessionId: string,
  options: ShowSessionOptions,
): Promise<ShowSessionResult> {
  const session = await store.load(sessionId)
  if (session === undefined) throw new SessionNotFoundError(sessionId)
  // Work on a copy so the view's truncation never reaches the file.
  const view = parseJson(stringifyJson(session)) as JsonObject
  const shortened = truncateOcrText(view, options.ocrPreviewChars, options.includeOcrText)
  const omitted = options.includeMessages ? 0 : dropMessages(view)
  return {
    session: toPlain(view),
    ocr_text_shortened_offers: shortened,
    omitted_messages: omitted,
  }
}

/**
 * Create a session and make it the capture target (`web.py:872-881`).
 * @param store - the session store.
 * @param category - the product category.
 * @param request - the user's request in their own words.
 * @returns the new session and the pointer now aimed at it.
 */
export async function createSession(
  store: SessionStore,
  category: string,
  request: string,
): Promise<{ session: PlainJson; current_session_id: string }> {
  const sessionId = SessionStore.newSessionId()
  const requirements = initialRequirements(category, request)
  const now = nowIso()
  const session = newSession(sessionId, writeRequirements(requirements), now)
  await store.create(sessionId, session)
  await store.setCurrentSessionId(sessionId)
  return { session: toPlain(session), current_session_id: sessionId }
}

/**
 * Point extension captures at an existing session.
 * @param store - the session store.
 * @param sessionId - the session to make current.
 * @returns the pointer that was written.
 * @throws SessionNotFoundError when the session has no file.
 */
export async function setCurrentSession(
  store: SessionStore,
  sessionId: string,
): Promise<{ current_session_id: string }> {
  const session = await store.load(sessionId)
  if (session === undefined) throw new SessionNotFoundError(sessionId)
  await store.setCurrentSessionId(sessionId)
  return { current_session_id: sessionId }
}

/**
 * Remove one product by URL and rebuild the report.
 *
 * The identity-to-position translation happens inside the session's own lock,
 * so a capture that reorders the list while a confirmation dialog is open
 * cannot make this delete the wrong product.
 * @param store - the session store.
 * @param sessionId - the session to remove from.
 * @param url - the product URL, which is the identity.
 * @returns the new counts and the record that was removed.
 * @throws SessionNotFoundError or OfferNotFoundError.
 */
export async function removeOfferByUrl(
  store: SessionStore,
  sessionId: string,
  url: string,
): Promise<WriteSummary & { removed_offer: PlainJson }> {
  return store.update(sessionId, (session) => {
    const removed = removeOffer(session, url)
    const first = removed[0]
    if (first === undefined) throw new OfferNotFoundError(url)
    rebuildReport(session)
    return { ...writeSummary(session, sessionId), removed_offer: toPlain(first) }
  })
}

/**
 * Read a session's Markdown report.
 * @param store - the session store.
 * @param sessionId - the session to read.
 * @returns the report, or an empty string when there is none.
 * @throws SessionNotFoundError when the session has no file.
 */
export async function getReport(
  store: SessionStore,
  sessionId: string,
): Promise<{ session_id: string; report: string }> {
  const session = await store.load(sessionId)
  if (session === undefined) throw new SessionNotFoundError(sessionId)
  const report = session.get('report_markdown')
  return { session_id: sessionId, report: typeof report === 'string' ? report : '' }
}
