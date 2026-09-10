import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClientContextLike, RpcResultLike } from '../../src/client/scope.js'
import { SYNC_INTERVAL_MS, WorkbenchStore, syncKey } from '../../src/client/workbench/store.js'
import { offersOf } from '../../src/client/workbench/types.js'

/**
 * The panel's state machine, driven by a stubbed Remote face.
 *
 * The behaviours worth pinning are the ones a browser check would not catch
 * reliably: what the panel does when a poll finds nothing new, when it finds a
 * capture, and when a write fails.
 */

/** One recorded call. */
interface Call {
  method: string
  args: Record<string, unknown>
}

/** A stubbed browser context whose answers the test supplies. */
class FakeContext {
  readonly calls: Call[] = []
  answers: Record<string, () => RpcResultLike | Promise<RpcResultLike>> = {}

  readonly connection = {
    rpc: {
      call: (_channel: string, endpoint: string, payload: unknown): Promise<RpcResultLike> => {
        const method = endpoint.replace('dealbuddy/', '')
        const args = (payload as { args: Record<string, unknown> }).args
        this.calls.push({ method, args })
        const answer = this.answers[method]
        if (answer === undefined) return Promise.resolve({ ok: true, value: null })
        return Promise.resolve(answer())
      },
    },
  }

  /**
   * @returns the context in the shape the store consumes.
   */
  asContext(): ClientContextLike {
    return this as unknown as ClientContextLike
  }
}

/**
 * Build a session document with the given products.
 * @param updatedAt - the stored timestamp.
 * @param urls - one product per URL.
 * @returns the session view.
 */
function session(updatedAt: string, urls: string[]): Record<string, unknown> {
  return {
    session_id: 'aaaaaaaaaaaa',
    requirements: { category: '电视', raw_request: '', version: 1 },
    updated_at: updatedAt,
    report_markdown: urls.length > 0 ? '# 报告' : null,
    verified_offers: urls.map((url) => ({ url, title: `商品 ${url}` })),
  }
}

/**
 * Answer the two reads a refresh performs.
 * @param context - the stub.
 * @param current - the current session id, or null.
 * @param document - the session document to return.
 */
function answerWith(
  context: FakeContext,
  current: string | null,
  document: Record<string, unknown>,
): void {
  context.answers['listSessions'] = () => ({
    ok: true,
    value: {
      current_session_id: current,
      data_dir: '/tmp/dealbuddy',
      sessions: [
        { session_id: 'aaaaaaaaaaaa', category: '电视', raw_request: '', version: 1, phase: 'created', verified_count: 0, report_available: false, created_at: '1', updated_at: '1' },
        { session_id: 'bbbbbbbbbbbb', category: '手机', raw_request: '', version: 1, phase: 'created', verified_count: 0, report_available: false, created_at: '2', updated_at: '2' },
      ],
    },
  })
  context.answers['showSession'] = () => ({ ok: true, value: document })
}

let store: WorkbenchStore | undefined

afterEach(() => {
  store?.dispose()
  store = undefined
})

/**
 * A promise whose settlement the test controls.
 * @returns the promise and the function that settles it.
 */
function deferred(): { promise: Promise<RpcResultLike>; settle: (value: RpcResultLike) => void } {
  let settle: (value: RpcResultLike) => void = () => undefined
  const promise = new Promise<RpcResultLike>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

describe('workbench store', () => {
  it('changes its sync key only when the document moves', () => {
    expect(syncKey(null)).toBe('')
    expect(syncKey(session('t1', ['a']))).toBe(syncKey(session('t1', ['a'])))
    expect(syncKey(session('t1', ['a']))).not.toBe(syncKey(session('t2', ['a'])))
    expect(syncKey(session('t1', ['a']))).not.toBe(syncKey(session('t1', ['a', 'b'])))
  })

  it('shows the sessions newest first', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', []))
    store = new WorkbenchStore(context.asContext())

    await store.refresh()

    expect(store.getSnapshot().sessions.map((entry) => entry.session_id)).toEqual([
      'bbbbbbbbbbbb',
      'aaaaaaaaaaaa',
    ])
  })

  it('announces newly captured products and stays quiet otherwise', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    store = new WorkbenchStore(context.asContext())

    await store.refresh()
    // The first read is not a capture: there is nothing to compare it against.
    expect(store.getSnapshot().notice).toBeNull()

    answerWith(context, 'aaaaaaaaaaaa', session('t2', ['a', 'b', 'c']))
    await store.refresh({ silent: true })

    expect(store.getSnapshot().notice?.text).toBe('已同步 2 个新采集商品')
    store.dismissNotice()

    await store.refresh({ silent: true })
    expect(store.getSnapshot().notice).toBeNull()
  })

  it('keeps a failed poll silent but reports a failed action', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    context.answers['listSessions'] = () => ({
      ok: false,
      error: { code: 'gateway/internal', message: 'boom' },
    })
    await store.refresh({ silent: true })
    expect(store.getSnapshot().error).toBeNull()

    await store.refresh()
    expect(store.getSnapshot().error).toBe('boom')
  })

  it('deletes by URL inside the session that was current when asked', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a', 'b']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    store.askDelete({ url: 'a', title: '商品 a' })
    answerWith(context, 'aaaaaaaaaaaa', session('t2', ['b']))
    await store.confirmDelete()

    const removal = context.calls.find((call) => call.method === 'removeOffer')
    expect(removal?.args).toEqual({ sessionId: 'aaaaaaaaaaaa', url: 'a' })
    expect(store.getSnapshot().pendingDelete).toBeNull()
    expect(store.getSnapshot().notice?.text).toBe('商品已删除')
  })

  it('names its arguments the way the Host declares its parameters', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', []))
    store = new WorkbenchStore(context.asContext())
    store.setDraft('draftCategory', ' 电视 ')
    store.setDraft('draftRequest', '预算5000以内')

    await store.createSession()

    // The source-mode Gateway matches these keys against the Host method's
    // parameter names and refuses anything else, so the names are a contract.
    expect(context.calls[0]).toEqual({
      method: 'createSession',
      args: { category: '电视', request: '预算5000以内' },
    })
    expect(store.getSnapshot().draftCategory).toBe('')
  })

  it('clears the staged form only after the session is created', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', []))
    context.answers['createSession'] = () => ({
      ok: false,
      error: { code: 'gateway/bad-request', message: 'category is required' },
    })
    store = new WorkbenchStore(context.asContext())
    store.setDraft('draftCategory', '电视')

    await store.createSession()

    expect(store.getSnapshot().draftCategory).toBe('电视')
    expect(store.getSnapshot().error).toBe('category is required')
  })

  it('abandons a refresh that a newer one overtook', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a', 'b', 'c']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    // A poll reads the three-offer document, then stalls on the wire.
    const stalled = deferred()
    context.answers['showSession'] = () => stalled.promise
    const poll = store.refresh({ silent: true })

    // Meanwhile a delete lands and its own refresh completes.
    answerWith(context, 'aaaaaaaaaaaa', session('t2', ['a', 'b']))
    await store.refresh()
    expect(offersOf(store.getSnapshot().session)).toHaveLength(2)
    store.dismissNotice()

    // The stalled poll now answers with the pre-delete document.
    stalled.settle({ ok: true, value: session('t1', ['a', 'b', 'c']) })
    await poll

    // The deleted product must not come back, and nothing was captured.
    expect(offersOf(store.getSnapshot().session)).toHaveLength(2)
    expect(store.getSnapshot().notice).toBeNull()
  })

  it('keeps an error on screen through a successful poll', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    context.answers['setCurrentSession'] = () => ({
      ok: false,
      error: { code: 'dealbuddy/session-not-found', message: 'gone' },
    })
    await store.selectSession('bbbbbbbbbbbb')
    const reported = store.getSnapshot().error
    expect(reported).toBe('这个会话的文件已经不在了。')

    await store.refresh({ silent: true })
    expect(store.getSnapshot().error).toBe(reported)
  })

  it('does not re-render when a poll finds nothing new', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    await store.refresh({ silent: true })

    expect(notifications).toBe(0)
  })

  it('stops answering once disposed', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    store = new WorkbenchStore(context.asContext())
    store.toggle()
    await store.refresh()

    store.dispose()
    const calls = context.calls.length
    store.resume()
    await Promise.resolve()

    // Nothing may re-arm the four-second poll after the fiber unloaded.
    expect(context.calls).toHaveLength(calls)
  })

  it('polls while the tab is in front and stops when it goes behind', async () => {
    // The store reads `document.visibilityState`; the node environment has no
    // document at all, so the test supplies just that much of one.
    const fake = { visibilityState: 'visible' }
    const globals = globalThis as { document?: unknown }
    const had = 'document' in globals
    globals.document = fake
    vi.useFakeTimers()
    try {
      const context = new FakeContext()
      answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
      const polling = new WorkbenchStore(context.asContext())
      polling.toggle()
      await vi.advanceTimersByTimeAsync(0)
      const opened = context.calls.length

      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS + 100)
      const whileVisible = context.calls.length
      expect(whileVisible).toBeGreaterThan(opened)

      // Going to the background has to stop the interval that is already armed.
      fake.visibilityState = 'hidden'
      polling.syncVisibility()
      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 3)

      expect(context.calls).toHaveLength(whileVisible)

      // Coming back to the front re-reads at once and re-arms the interval,
      // which is what proves the timer was really taken down rather than just
      // skipping its ticks.
      fake.visibilityState = 'visible'
      polling.syncVisibility()
      await vi.advanceTimersByTimeAsync(0)
      const onReturn = context.calls.length
      expect(onReturn).toBeGreaterThan(whileVisible)

      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS + 100)
      expect(context.calls.length).toBeGreaterThan(onReturn)
      polling.dispose()
    } finally {
      vi.useRealTimers()
      if (had) globals.document = fake
      else delete globals.document
    }
  })

  it('deletes from the session the card came from, not whatever is current later', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['shared-url']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    // The dialog opens against session A.
    store.askDelete({ url: 'shared-url', title: '商品' })

    // Something outside the panel points the Host at session B while the
    // dialog is up; a refresh already on the wire commits that pointer.
    answerWith(context, 'bbbbbbbbbbbb', session('t2', ['shared-url']))
    await store.refresh()
    expect(store.getSnapshot().currentId).toBe('bbbbbbbbbbbb')

    await store.confirmDelete()

    const removal = context.calls.find((call) => call.method === 'removeOffer')
    expect(removal?.args).toEqual({ sessionId: 'aaaaaaaaaaaa', url: 'shared-url' })
  })

  it('shows nothing in the header when the status probe fails', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    context.answers['status'] = () => ({
      ok: true,
      value: { data_dir: '/tmp/dealbuddy', intake_url: 'http://127.0.0.1:8766/api/current/offers', listening: true },
    })
    store = new WorkbenchStore(context.asContext())
    await store.refreshStatus()
    expect(store.getSnapshot().status?.listening).toBe(true)

    // A Host restart: the old line would keep claiming that address listens.
    context.answers['status'] = () => ({
      ok: false,
      error: { code: 'gateway/service-unavailable', message: 'gone' },
    })
    await store.refreshStatus()

    expect(store.getSnapshot().status).toBeNull()
  })

  it('drops the session on screen when the pointer moved but its file will not read', async () => {
    const context = new FakeContext()
    answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
    store = new WorkbenchStore(context.asContext())
    await store.refresh()

    answerWith(context, 'bbbbbbbbbbbb', session('t2', ['b']))
    context.answers['showSession'] = () => ({
      ok: false,
      error: { code: 'gateway/internal', message: 'malformed session file' },
    })
    await store.refresh({ silent: true })

    // The rail must not keep marking the old session as the capture target.
    expect(store.getSnapshot().currentId).toBe('bbbbbbbbbbbb')
    expect(store.getSnapshot().session).toBeNull()
  })

  it('skips a timer tick while a refresh is still on the wire', async () => {
    const fake = { visibilityState: 'visible' }
    const globals = globalThis as { document?: unknown }
    const had = 'document' in globals
    globals.document = fake
    vi.useFakeTimers()
    try {
      const context = new FakeContext()
      answerWith(context, 'aaaaaaaaaaaa', session('t1', ['a']))
      const slow = new WorkbenchStore(context.asContext())
      slow.toggle()
      await vi.advanceTimersByTimeAsync(0)

      // A session big enough that its two reads outlast the interval.
      const stalled = deferred()
      context.answers['showSession'] = () => stalled.promise
      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS + 100)
      const started = context.calls.filter((call) => call.method === 'listSessions').length

      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 3)

      // Every tick starting another refresh would invalidate the one before it,
      // so nothing would ever commit.
      expect(context.calls.filter((call) => call.method === 'listSessions')).toHaveLength(started)

      stalled.settle({ ok: true, value: session('t2', ['a', 'b']) })
      await vi.advanceTimersByTimeAsync(0)
      expect(offersOf(slow.getSnapshot().session)).toHaveLength(2)
      slow.dispose()
    } finally {
      vi.useRealTimers()
      if (!had) delete globals.document
    }
  })
})
