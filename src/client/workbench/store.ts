import type { ClientContextLike } from '../scope.js'
import { RpcFailure, callWorkbench, describeFailure } from './rpc.js'
import { offersOf, type SessionSummaryView, type SessionView, type WorkbenchStatusView } from './types.js'

/**
 * The panel's state, outside React.
 *
 * The harness forwards no plugin-defined events to the browser, so the panel
 * learns about a capture the same way the Python workbench does: by asking
 * every few seconds. Polling stops while the drawer is closed, while the tab is
 * hidden, and while the delete confirmation is open — the last one matters,
 * because a list that reorders under an open dialog is how a delete lands on
 * the wrong product.
 */

/** How often an open, visible panel re-reads the current session. */
export const SYNC_INTERVAL_MS = 4000

/**
 * Whether the page is in front of someone.
 * @returns true when there is no document at all (tests) or the tab is visible.
 */
function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/** A product awaiting delete confirmation. */
export interface PendingDelete {
  url: string
  title: string
  /**
   * The session the card came from, captured when the dialog opened.
   *
   * Stopping the poll does not cancel a refresh already on the wire, so the
   * current-session pointer can still move while the dialog is up. Reading it
   * at confirmation time would pair this URL with whatever session is current
   * by then — and delete the wrong product when both sessions hold that URL.
   */
  sessionId: string
}

/** Everything the panel renders from. */
export interface WorkbenchState {
  open: boolean
  loading: boolean
  busy: boolean
  sessions: SessionSummaryView[]
  currentId: string | null
  session: SessionView | null
  status: WorkbenchStatusView | null
  error: string | null
  notice: { seq: number; text: string } | null
  openUrls: readonly string[]
  pendingDelete: PendingDelete | null
  draftCategory: string
  draftRequest: string
}

const INITIAL: WorkbenchState = {
  open: false,
  loading: false,
  busy: false,
  sessions: [],
  currentId: null,
  session: null,
  status: null,
  error: null,
  notice: null,
  openUrls: [],
  pendingDelete: null,
  draftCategory: '',
  draftRequest: '',
}

/**
 * Identify a session's contents cheaply.
 *
 * Same idea as the Python workbench's live sync: re-render only when the stored
 * document actually moved, so an idle panel does not rebuild every four
 * seconds.
 * @param session - the session view, or null.
 * @returns a key that changes whenever the panel's view would.
 */
export function syncKey(session: SessionView | null): string {
  if (session === null) return ''
  return `${String(session.updated_at ?? '')}|${offersOf(session).length}`
}

/** The panel's store. */
export class WorkbenchStore {
  #state: WorkbenchState = INITIAL
  readonly #listeners = new Set<() => void>()
  #timer: ReturnType<typeof setInterval> | undefined
  #notices = 0
  #trigger: HTMLElement | null = null
  /** Bumped by every refresh; a response from an older one is abandoned. */
  #generation = 0
  /** True while a refresh is on the wire, so a timer tick can stand down. */
  #refreshing = false
  /** Bumped by every status probe; an older answer is dropped. */
  #statusGeneration = 0
  /** Set by dispose(); nothing may arm a timer after it. */
  #disposed = false
  /** Identity of the session list currently in state, so an unchanged list keeps its array. */
  #sessionsKey = ''

  /**
   * @param ctx - the browser plugin context, used for RPC.
   */
  constructor(private readonly ctx: ClientContextLike) {}

  /**
   * @returns the current state; a stable reference until it changes.
   */
  readonly getSnapshot = (): WorkbenchState => this.#state

  /**
   * @param listener - invoked after every state change.
   * @returns the disposer removing the listener.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Remember the control that opened the panel, so focus can go back to it. */
  setTrigger(element: HTMLElement | null): void {
    this.#trigger = element
  }

  /** Open or close the drawer. */
  toggle(): void {
    if (this.#state.open) {
      this.close()
      return
    }
    this.#set({ open: true, error: null })
    this.#retimer()
    void this.refresh()
    void this.refreshStatus()
  }

  /** Close the drawer and return focus to the control that opened it. */
  close(): void {
    this.#set({ open: false, pendingDelete: null })
    this.#retimer()
    this.#trigger?.focus()
  }

  /** Stop the timer; called when the plugin unloads. */
  dispose(): void {
    // The flag, not the timer, is what makes this final: a write settling
    // after disposal still runs its `finally`, and a listener that has not
    // been torn down yet can still call resume().
    this.#disposed = true
    this.#generation += 1
    if (this.#timer !== undefined) clearInterval(this.#timer)
    this.#timer = undefined
    this.#listeners.clear()
  }

  /** Re-read after a reconnect. */
  resume(): void {
    if (this.#disposed || !this.#state.open) return
    this.#retimer()
    void this.refresh({ silent: true })
    void this.refreshStatus()
  }

  /**
   * Follow the tab's visibility, in both directions.
   *
   * The arming check reads `document.visibilityState`, so something has to call
   * it when that changes — including on the way to hidden, or an already-armed
   * interval keeps pulling the whole current session for a tab nobody is
   * looking at.
   */
  syncVisibility(): void {
    if (this.#disposed) return
    this.#retimer()
    if (!this.#state.open || !isPageVisible()) return
    void this.refresh({ silent: true })
    void this.refreshStatus()
  }

  /** Expand or collapse one product card. */
  toggleOffer(url: string): void {
    const open = this.#state.openUrls
    this.#set({
      openUrls: open.includes(url) ? open.filter((entry) => entry !== url) : [...open, url],
    })
  }

  /** Stage the new-session form. */
  setDraft(field: 'draftCategory' | 'draftRequest', value: string): void {
    this.#set({ [field]: value } as Partial<WorkbenchState>)
  }

  /**
   * Open the delete confirmation for one product, or close it.
   * @param pending - the product the card is showing, or null to dismiss.
   */
  askDelete(pending: { url: string; title: string } | null): void {
    if (pending === null) {
      this.#set({ pendingDelete: null })
      this.#retimer()
      return
    }
    const sessionId = this.#state.currentId
    if (sessionId === null) return
    this.#set({ pendingDelete: { ...pending, sessionId } })
    this.#retimer()
  }

  /**
   * Show a message in the panel's own notice line.
   * @param text - the message.
   */
  announce(text: string): void {
    this.#notice(text)
  }

  /** Dismiss the transient notice. */
  dismissNotice(): void {
    this.#set({ notice: null })
  }

  /**
   * Read the listener's state; called on open, not on every poll.
   * @returns settlement once the probe answered.
   */
  async refreshStatus(): Promise<void> {
    // Probes overlap — opening, a reconnect and a visibility change can each
    // start one — and nothing else refreshes this line, so an older answer
    // landing last would leave a wrong address on screen indefinitely.
    const generation = ++this.#statusGeneration
    try {
      const status = await callWorkbench<WorkbenchStatusView>(this.ctx, 'status', {})
      if (generation !== this.#statusGeneration) return
      this.#set({ status })
    } catch {
      if (generation !== this.#statusGeneration) return
      // The header shows nothing rather than the last answer: a stale line
      // would keep claiming the old address is listening after a Host restart.
      this.#set({ status: null })
    }
  }

  /**
   * Re-read the session list and the current session.
   *
   * Two round trips with no ordering guarantee between them, so every refresh
   * takes a generation and abandons itself if a newer one started while it was
   * waiting. Without that, a poll issued before a delete can land after it and
   * write the deleted product back — and then count it as a fresh capture.
   * @param options - `silent` swallows failures, as the poll does.
   * @returns settlement once the state reflects the Host.
   */
  async refresh(options: { silent?: boolean } = {}): Promise<void> {
    const generation = ++this.#generation
    // A poll must not clear an error the user has not read yet; only an
    // explicit refresh or a new action does that.
    const settled = options.silent ? {} : { error: null }
    if (!options.silent) this.#set({ loading: true })
    this.#refreshing = true
    // Set once the list read has established where the Host now points, so a
    // failure below can tell "could not read the document" from "did not get
    // as far as asking".
    let pointer: string | null | undefined
    try {
      const listed = await callWorkbench<{
        current_session_id: string | null
        sessions: SessionSummaryView[]
      }>(this.ctx, 'listSessions', {})
      if (generation !== this.#generation) return
      // Newest first: the session someone is capturing into is the one they
      // just made.
      const sessions = this.#keepSessions([...listed.sessions].reverse())
      const currentId = listed.current_session_id
      pointer = currentId
      if (currentId === null) {
        this.#set({ sessions, currentId, session: null, loading: false, ...settled })
        return
      }
      // The list is committed before the document read so a failing read does
      // not throw away a list that arrived fine. The pointer is NOT committed
      // here: `currentId` and `session` have to move together, or a delete
      // could carry a card's URL into a different session.
      this.#set({ sessions })
      const session = await callWorkbench<SessionView>(this.ctx, 'showSession', {
        sessionId: currentId,
      })
      if (generation !== this.#generation) return
      const sameSession = currentId === this.#state.currentId
      const changed = syncKey(session) !== syncKey(this.#state.session)
      if (!sameSession || changed) {
        const before = sameSession ? offersOf(this.#state.session).length : 0
        const after = offersOf(session).length
        this.#set({ currentId, session, loading: false, ...settled })
        if (sameSession && after > before) {
          this.#notice(`已同步 ${after - before} 个新采集商品`)
        }
        return
      }
      this.#set({ currentId, loading: false, ...settled })
    } catch (error) {
      if (generation !== this.#generation) return
      // A session whose file is gone must not keep rendering its products.
      if (error instanceof RpcFailure && error.code === 'dealbuddy/session-not-found') {
        this.#set({ session: null, currentId: null })
      } else if (pointer !== undefined && pointer !== this.#state.currentId) {
        // The pointer moved but its document would not read (unreadable or
        // malformed file). Keeping the old pair would leave the rail claiming
        // captures still land in the session on screen, which is now false.
        this.#set({ currentId: pointer, session: null })
      }
      if (options.silent) {
        // A failed poll retries on the next tick, exactly as the Python
        // workbench does; only explicit actions report — and a poll must not
        // clear an error the user has not read yet.
        this.#set({ loading: false })
        return
      }
      this.#set({ loading: false, error: describeFailure(error) })
    } finally {
      if (generation === this.#generation) this.#refreshing = false
    }
  }

  /**
   * Create a session from the staged form and make it current.
   * @returns settlement once the panel shows the new session.
   */
  async createSession(): Promise<void> {
    // Sent as typed, validated on the trimmed value: the tool face does not
    // trim either, and both faces have to write the same file.
    const category = this.#state.draftCategory
    const request = this.#state.draftRequest
    if (category.trim() === '') return
    await this.#write(async () => {
      await callWorkbench(this.ctx, 'createSession', { category, request })
      // Clear only what was actually submitted. The inputs stay live during
      // the call, so anything typed since belongs to the next session.
      this.#set({
        ...(this.#state.draftCategory === category ? { draftCategory: '' } : {}),
        ...(this.#state.draftRequest === request ? { draftRequest: '' } : {}),
      })
      this.#notice('会话已创建，采集会投递到这里')
    })
  }

  /**
   * Point captures at another session.
   * @param sessionId - the session to select.
   * @returns settlement once the panel shows it.
   */
  async selectSession(sessionId: string): Promise<void> {
    if (sessionId === this.#state.currentId) return
    await this.#write(async () => {
      await callWorkbench(this.ctx, 'setCurrentSession', { sessionId })
    })
  }

  /**
   * Remove the product awaiting confirmation.
   * @returns settlement once the panel reflects the removal.
   */
  async confirmDelete(): Promise<void> {
    const pending = this.#state.pendingDelete
    this.#set({ pendingDelete: null })
    if (pending === null) {
      this.#retimer()
      return
    }
    await this.#write(async () => {
      // Deleting by URL, in the session the card came from: the Host resolves
      // identity to position inside that session's own lock, so a capture
      // during the confirmation cannot make this remove a different product.
      await callWorkbench(this.ctx, 'removeOffer', {
        sessionId: pending.sessionId,
        url: pending.url,
      })
      this.#notice('商品已删除')
    })
  }

  /**
   * Run one write, then re-read.
   * @param write - the write to perform.
   */
  async #write(write: () => Promise<void>): Promise<void> {
    this.#set({ busy: true, error: null })
    try {
      await write()
      await this.refresh()
    } catch (error) {
      this.#set({ error: describeFailure(error) })
    } finally {
      this.#set({ busy: false })
      this.#retimer()
    }
  }

  /**
   * Show a transient notice.
   * @param text - the message.
   */
  #notice(text: string): void {
    this.#notices += 1
    this.#set({ notice: { seq: this.#notices, text } })
  }

  /** Start or stop the poll for the current conditions. */
  #retimer(): void {
    const wanted =
      !this.#disposed &&
      this.#state.open &&
      this.#state.pendingDelete === null &&
      isPageVisible()
    if (wanted && this.#timer === undefined) {
      this.#timer = setInterval(() => {
        // Checked again per tick, as the Python workbench does: a missed
        // visibility transition then costs nothing instead of polling forever.
        if (this.#disposed || !isPageVisible()) return
        // A session whose two reads take longer than the interval would
        // otherwise have every tick start another refresh and invalidate the
        // one before it, so nothing would ever commit.
        if (this.#refreshing) return
        void this.refresh({ silent: true })
      }, SYNC_INTERVAL_MS)
      return
    }
    if (!wanted && this.#timer !== undefined) {
      clearInterval(this.#timer)
      this.#timer = undefined
    }
  }

  /**
   * Replace the state and notify — but only when something actually moved.
   *
   * An idle panel polls every four seconds and almost always finds the same
   * document; without this check each poll would allocate a fresh snapshot and
   * re-render the whole drawer for nothing.
   * @param patch - the fields that moved.
   */
  #set(patch: Partial<WorkbenchState>): void {
    const keys = Object.keys(patch) as (keyof WorkbenchState)[]
    if (keys.every((key) => Object.is(this.#state[key], patch[key]))) return
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  /**
   * Keep the previous session array when the list did not change.
   *
   * The Host returns fresh objects every poll, so identity has to be re-derived
   * from the contents for {@link #set}'s check to mean anything.
   * @param sessions - the newly read list, already in display order.
   * @returns the list to store, reusing the current array when equivalent.
   */
  #keepSessions(sessions: SessionSummaryView[]): SessionSummaryView[] {
    const key = sessions
      .map((entry) => `${entry.session_id}|${entry.updated_at}|${entry.verified_count}|${entry.category}`)
      .join('\u0000')
    if (key === this.#sessionsKey) return this.#state.sessions
    this.#sessionsKey = key
    return sessions
  }
}
