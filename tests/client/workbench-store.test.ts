import { afterEach, describe, expect, it } from 'vitest'

import type { ClientContextLike, RpcResultLike } from '../../src/client/scope.js'
import { WorkbenchStore, syncKey } from '../../src/client/workbench/store.js'

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
  answers: Record<string, () => RpcResultLike> = {}

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
})
