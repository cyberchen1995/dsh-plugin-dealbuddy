import type { ClientContextLike } from '../scope.js'
import { callWorkbench, describeFailure } from './rpc.js'
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

/** A product awaiting delete confirmation. */
export interface PendingDelete {
  url: string
  title: string
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
    if (this.#timer !== undefined) clearInterval(this.#timer)
    this.#timer = undefined
    this.#listeners.clear()
  }

  /** Re-read after a reconnect or a tab becoming visible again. */
  resume(): void {
    if (!this.#state.open) return
    this.#retimer()
    void this.refresh({ silent: true })
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

  /** Open the delete confirmation for one product. */
  askDelete(pending: PendingDelete | null): void {
    this.#set({ pendingDelete: pending })
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
    try {
      const status = await callWorkbench<WorkbenchStatusView>(this.ctx, 'status', {})
      this.#set({ status })
    } catch {
      // The header simply shows nothing when the probe itself is unreachable.
    }
  }

  /**
   * Re-read the session list and the current session.
   * @param options - `silent` swallows failures, as the poll does.
   * @returns settlement once the state reflects the Host.
   */
  async refresh(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) this.#set({ loading: true })
    try {
      const listed = await callWorkbench<{
        current_session_id: string | null
        sessions: SessionSummaryView[]
      }>(this.ctx, 'listSessions', {})
      // Newest first: the session someone is capturing into is the one they
      // just made.
      const sessions = [...listed.sessions].reverse()
      const currentId = listed.current_session_id
      if (currentId === null) {
        this.#set({ sessions, currentId, session: null, loading: false, error: null })
        return
      }
      const session = await callWorkbench<SessionView>(this.ctx, 'showSession', {
        sessionId: currentId,
      })
      const sameSession = currentId === this.#state.currentId
      const changed = syncKey(session) !== syncKey(this.#state.session)
      if (!sameSession || changed) {
        const before = sameSession ? offersOf(this.#state.session).length : 0
        const after = offersOf(session).length
        this.#set({ sessions, currentId, session, loading: false, error: null })
        if (sameSession && after > before) {
          this.#notice(`已同步 ${after - before} 个新采集商品`)
        }
        return
      }
      this.#set({ sessions, currentId, loading: false, error: null })
    } catch (error) {
      if (options.silent) {
        // A failed poll retries on the next tick, exactly as the Python
        // workbench does; only explicit actions report.
        this.#set({ loading: false })
        return
      }
      this.#set({ loading: false, error: describeFailure(error) })
    }
  }

  /**
   * Create a session from the staged form and make it current.
   * @returns settlement once the panel shows the new session.
   */
  async createSession(): Promise<void> {
    const category = this.#state.draftCategory.trim()
    if (category === '') return
    await this.#write(async () => {
      await callWorkbench(this.ctx, 'createSession', {
        category,
        request: this.#state.draftRequest,
      })
      this.#set({ draftCategory: '', draftRequest: '' })
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
    const sessionId = this.#state.currentId
    this.#set({ pendingDelete: null })
    if (pending === null || sessionId === null) {
      this.#retimer()
      return
    }
    await this.#write(async () => {
      // Deleting by URL: the Host resolves identity to position inside the
      // session's own lock, so a capture during the confirmation cannot make
      // this remove a different product.
      await callWorkbench(this.ctx, 'removeOffer', { sessionId, url: pending.url })
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
      this.#state.open &&
      this.#state.pendingDelete === null &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')
    if (wanted && this.#timer === undefined) {
      this.#timer = setInterval(() => {
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
   * Replace the state and notify.
   * @param patch - the fields that moved.
   */
  #set(patch: Partial<WorkbenchState>): void {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }
}
