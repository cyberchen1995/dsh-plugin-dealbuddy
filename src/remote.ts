import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { SessionSummary } from './core/models.js'
import {
  OfferNotFoundError,
  createSession,
  listSessions,
  removeOfferByUrl,
  setCurrentSession,
  showSession,
} from './services/sessions.js'
import { probeIntakeListener } from './services/status.js'
import { isValidSessionId } from './store/paths.js'
import { SessionNotFoundError, type SessionStore } from './store/session-store.js'
import type { PlainJson } from './tools/shared.js'

/**
 * Host half of the workbench panel: the same session operations the tools
 * expose, reachable from the browser.
 *
 * The Gateway has no per-endpoint access control, so every method validates its
 * own arguments and the destructive operations stay out of this surface
 * entirely: refining requirements wipes a session's captures, and that belongs
 * in the conversation where the model can ask first.
 *
 * Without the Typert build pipeline these endpoints resolve through the
 * Gateway's source fallback, which reads parameter NAMES off the compiled
 * method. The Host bundle is emitted by tsc and never minified, so the names
 * survive — but that is the reason no method here may use destructuring,
 * default values or rest parameters.
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    dealbuddyController: DealbuddyRemote
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The named session has no file in the data directory. */
    'dealbuddy/session-not-found': { readonly sessionId: string }
    /** No captured product in that session carries the given URL. */
    'dealbuddy/offer-not-found': { readonly url: string }
  }
}

/** What the panel shows about the capture path itself. */
export interface WorkbenchStatus {
  /** The directory sessions are read from and written to. */
  data_dir: string
  /** The address the browser extension has to deliver to. */
  intake_url: string
  /** Whether the listener answers the extension's preflight. */
  listening: boolean
  /** Why it does not; absent while it does. */
  reason?: string
}

/** The session list plus the pointer captures land in. */
export interface WorkbenchSessions {
  current_session_id: string | null
  data_dir: string
  sessions: SessionSummary[]
}

/**
 * Mount the workbench RPC namespace.
 *
 * Registration happens by construction: a cordis `Service` provides itself on
 * the context it is given and is withdrawn when that fiber unloads, so the
 * panel's endpoints disappear cleanly with the plugin.
 * @param ctx - the child fiber's context.
 * @param store - the session store, shared with the tools.
 * @param port - reads the configured intake port.
 */
export function registerRemote(
  ctx: Context,
  store: SessionStore,
  port: () => number,
): void {
  // eslint-disable-next-line no-new -- a Service registers itself on construction.
  new DealbuddyRemote(ctx, store, port)
}

/** The `dealbuddy` Remote namespace. */
export class DealbuddyRemote extends TypertRemoteService {
  /**
   * @param ctx - the owning context; the service is provided on it.
   * @param store - the session store.
   * @param port - reads the configured intake port.
   */
  constructor(
    ctx: Context,
    private readonly store: SessionStore,
    private readonly port: () => number,
  ) {
    super(ctx, 'dealbuddyController', { namespace: 'dealbuddy' })
  }

  /**
   * List every session as a summary.
   * @returns the summaries and the current capture target.
   */
  @Remote
  async listSessions(): Promise<WorkbenchSessions> {
    return listSessions(this.store)
  }

  /**
   * Read one session in full.
   *
   * The panel shows the recognised detail-image text, so unlike the model-facing
   * tool this keeps it whole; the stored message log is dropped because the
   * panel has nowhere to show it.
   * @param sessionId - the session to read.
   * @returns the session view.
   */
  @Remote
  async showSession(sessionId: string): Promise<PlainJson> {
    this.assertSessionId(sessionId)
    try {
      const result = await showSession(this.store, sessionId, {
        includeOcrText: true,
        includeMessages: false,
        ocrPreviewChars: 0,
      })
      return result.session
    } catch (error) {
      throw this.translate(error, sessionId)
    }
  }

  /**
   * Create a session and point captures at it.
   * @param category - the product category.
   * @param request - the user's request in their own words; may be omitted.
   * @returns the new session's id.
   */
  @Remote
  async createSession(category: string, request?: string): Promise<{ session_id: string }> {
    const trimmed = typeof category === 'string' ? category.trim() : ''
    if (trimmed === '') {
      throw new RemoteError('gateway/bad-request', 'category is required', {})
    }
    if (request !== undefined && typeof request !== 'string') {
      throw new RemoteError('gateway/bad-request', 'request must be a string', {})
    }
    const created = await createSession(this.store, trimmed, request ?? '')
    return { session_id: created.current_session_id }
  }

  /**
   * Point captures at an existing session.
   * @param sessionId - the session to make current.
   * @returns the pointer that was written.
   */
  @Remote
  async setCurrentSession(sessionId: string): Promise<{ current_session_id: string }> {
    this.assertSessionId(sessionId)
    try {
      return await setCurrentSession(this.store, sessionId)
    } catch (error) {
      throw this.translate(error, sessionId)
    }
  }

  /**
   * Remove one captured product and rebuild the report.
   * @param sessionId - the session to remove from.
   * @param url - the product URL, which is its identity.
   * @returns the counts after the removal.
   */
  @Remote
  async removeOffer(
    sessionId: string,
    url: string,
  ): Promise<{ session_id: string; verified_count: number; report_available: boolean }> {
    this.assertSessionId(sessionId)
    if (typeof url !== 'string' || url.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'url is required', {})
    }
    try {
      const result = await removeOfferByUrl(this.store, sessionId, url)
      return {
        session_id: result.session_id,
        verified_count: result.verified_count,
        report_available: result.report_available,
      }
    } catch (error) {
      throw this.translate(error, sessionId)
    }
  }

  /**
   * Report whether a capture would arrive at all.
   * @param signal - cancellation injected by the Gateway.
   * @returns the data directory, the delivery address, and the listener's state.
   */
  @Remote
  async status(signal: AbortSignal): Promise<WorkbenchStatus> {
    const probe = await probeIntakeListener(this.port(), signal)
    return {
      data_dir: this.store.dataDir,
      intake_url: probe.url,
      listening: probe.ok,
      ...(probe.reason === undefined ? {} : { reason: probe.reason }),
    }
  }

  /**
   * Reject an id that could not name a session file.
   * @param sessionId - the caller's id.
   * @throws RemoteError when the id is not a session id.
   */
  private assertSessionId(sessionId: string): void {
    if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) {
      throw new RemoteError('gateway/bad-request', 'session_id is not a session id', {})
    }
  }

  /**
   * Map a service failure onto its wire code.
   * @param error - the caught failure.
   * @param sessionId - the session the call named.
   * @returns the failure to throw.
   */
  private translate(error: unknown, sessionId: string): unknown {
    if (error instanceof SessionNotFoundError) {
      return new RemoteError('dealbuddy/session-not-found', error.message, { sessionId })
    }
    if (error instanceof OfferNotFoundError) {
      return new RemoteError('dealbuddy/offer-not-found', error.message, { url: error.url })
    }
    return error
  }
}
