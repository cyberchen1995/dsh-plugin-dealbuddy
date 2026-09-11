import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'

import type { SessionSummary } from './core/models.js'
import { buildEvaluationMessage } from './services/binding-text.js'
import { readBoundContext } from './services/bindings.js'
import {
  OfferNotFoundError,
  createSession,
  getReport,
  listSessions,
  removeOfferByUrl,
  setCurrentSession,
  showSession,
} from './services/sessions.js'
import { probeIntakeListener } from './services/status.js'
import type { Binding, BindingStore } from './store/binding-store.js'
import { isValidSessionId } from './store/paths.js'
import { SessionNotFoundError, type SessionStore } from './store/session-store.js'
import type { PlainJson } from './tools/shared.js'

/**
 * The part of a live conversation this plugin uses.
 *
 * Declared rather than imported from `@deepseek-ai/dsh-agent`: the Gateway
 * resolves a parameter named `agent` into one of these, and this is every
 * member the evaluate action touches.
 */
interface AgentLike {
  readonly id: string
  followup(message: ReturnType<typeof createUserMessage>): void
}

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
    /** The conversation has no shopping session behind it. */
    'dealbuddy/not-bound': { readonly dshSessionId: string }
    /** The bound session has nothing to evaluate yet. */
    'dealbuddy/no-report': { readonly sessionId: string }
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

/** The session list, the pointer captures land in, and who owns what. */
export interface WorkbenchSessions {
  current_session_id: string | null
  data_dir: string
  sessions: SessionSummary[]
  /** Which conversation each shopping session belongs to. */
  bindings: Binding[]
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
  bindings: BindingStore,
  port: () => number,
): void {
  // eslint-disable-next-line no-new -- a Service registers itself on construction.
  new DealbuddyRemote(ctx, store, bindings, port)
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
    private readonly bindings: BindingStore,
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
    const [listed, bindings] = await Promise.all([listSessions(this.store), this.bindings.list()])
    return { ...listed, bindings }
  }

  /**
   * Make a conversation and a shopping session the same thing.
   *
   * Neither parameter may be called `agent` or `session`: those names are
   * Gateway lookups that would resume the conversation just to record a note
   * about it.
   * @param sessionId - the shopping session.
   * @param dshSessionId - the conversation it belongs to.
   * @returns the binding that was written.
   */
  @Remote
  async bind(sessionId: string, dshSessionId: string): Promise<{ binding: Binding }> {
    this.assertSessionId(sessionId)
    this.assertConversationId(dshSessionId)
    const session = await this.store.load(sessionId)
    if (session === undefined) {
      throw new RemoteError('dealbuddy/session-not-found', `Unknown session: ${sessionId}`, {
        sessionId,
      })
    }
    return { binding: await this.bindings.bind(sessionId, dshSessionId) }
  }

  /**
   * Forget whatever a conversation was about.
   * @param dshSessionId - the conversation.
   * @returns whether anything was removed.
   */
  @Remote
  async unbind(dshSessionId: string): Promise<{ removed: boolean }> {
    this.assertConversationId(dshSessionId)
    return { removed: await this.bindings.unbindConversation(dshSessionId) }
  }

  /**
   * Ask the model in this conversation to go through its report.
   *
   * The parameter is named `agent` on purpose: the Gateway turns it into the
   * live conversation, resuming a cold one, which is exactly what sending it a
   * message requires.
   * @param agent - the conversation, resolved by the Gateway.
   * @returns the session whose report was sent.
   */
  @Remote
  async evaluateReport(agent: AgentLike): Promise<{ session_id: string }> {
    const bound = readBoundContext(this.store, this.bindings, agent.id)
    if (bound === undefined || 'missing' in bound) {
      throw new RemoteError(
        'dealbuddy/not-bound',
        'this conversation has no shopping session behind it',
        { dshSessionId: agent.id },
      )
    }
    const report = await getReport(this.store, bound.session_id)
    if (report.report === '') {
      throw new RemoteError('dealbuddy/no-report', 'this session has no report yet', {
        sessionId: bound.session_id,
      })
    }
    const message = buildEvaluationMessage(report.report, bound)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: message.text }],
        source: {
          kind: 'plugin',
          plugin: 'dealbuddy',
          form: 'notice',
          summary: boundContextSummary(message.summary),
        },
      }),
    )
    return { session_id: bound.session_id }
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
   * Create a session, point captures at it, and bind it to a conversation.
   *
   * One call rather than two: a create that succeeded followed by a bind that
   * failed would leave an unbound session behind and a form the user is bound
   * to submit again, which is how duplicate shopping sessions appear.
   * @param category - the product category.
   * @param request - the user's request in their own words; may be omitted.
   * @param dshSessionId - the conversation to bind it to; may be omitted.
   * @returns the new session's id.
   */
  @Remote
  async createSession(
    category: string,
    request?: string,
    dshSessionId?: string,
  ): Promise<{ session_id: string }> {
    // Validated on the trimmed value but stored as sent: the tool face does
    // not trim either, and the two faces have to write the same file.
    if (typeof category !== 'string' || category.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'category is required', {})
    }
    if (request !== undefined && typeof request !== 'string') {
      throw new RemoteError('gateway/bad-request', 'request must be a string', {})
    }
    if (dshSessionId !== undefined && typeof dshSessionId !== 'string') {
      throw new RemoteError('gateway/bad-request', 'dshSessionId must be a string', {})
    }
    const created = await createSession(this.store, category, request ?? '')
    if (dshSessionId !== undefined && dshSessionId.trim() !== '') {
      await this.bindings.bind(created.current_session_id, dshSessionId)
    }
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
   * Reject a conversation id that could not be one.
   * @param dshSessionId - the caller's id.
   * @throws RemoteError when it is not a usable identity.
   */
  private assertConversationId(dshSessionId: string): void {
    if (typeof dshSessionId !== 'string' || dshSessionId.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'dshSessionId is required', {})
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
