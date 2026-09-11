import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { registerBindingContext } from '../../src/context.js'
import { buildEvaluationMessage, renderBindingContext } from '../../src/services/binding-text.js'
import { readBoundContext, type BoundContext } from '../../src/services/bindings.js'
import { createSession, setCurrentSession } from '../../src/services/sessions.js'
import { BindingStore } from '../../src/store/binding-store.js'
import { SessionStore } from '../../src/store/session-store.js'

/**
 * What the model is told, and when it is told nothing.
 *
 * The context block is re-rendered on every model request in a bound
 * conversation, so a wrong word here repeats forever — which is why it is
 * asserted literally rather than by shape.
 */

let sessions: SessionStore
let bindings: BindingStore

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-bindctx-'))
  sessions = new SessionStore(dataDir)
  bindings = new BindingStore(dataDir)
})

/** A fully-populated set of facts, for the wording assertions. */
const FULL: BoundContext = {
  session_id: 'aaaaaaaaaaaa',
  category: '电视',
  raw_request: '预算5000以内，65英寸',
  version: 2,
  budget_min: null,
  budget_max: '5000',
  must_have: [['刷新率', '120Hz']],
  verified_count: 3,
  report_available: true,
  is_capture_target: true,
  capture_target: 'aaaaaaaaaaaa',
}

describe('bound-context reading', () => {
  it('says nothing at all for a conversation with no shopping session', async () => {
    await bindings.list()
    expect(readBoundContext(sessions, bindings, 'conv-1')).toBeUndefined()
    // An unbound conversation must carry no trace of this plugin.
    expect(renderBindingContext(undefined)).toBe('')
  })

  it('reads a binding written before this process started, without awaiting', async () => {
    const created = await createSession(sessions, '电视', '预算5000以内')
    await bindings.bind(created.current_session_id, 'conv-1')

    // A fresh store over the same directory, as a restart would build — the
    // provider must answer from it on the very first model request, with no
    // await anywhere in between.
    const restarted = new BindingStore(sessions.dataDir)
    const bound = readBoundContext(sessions, restarted, 'conv-1')

    expect(bound).toBeDefined()
    expect((bound as BoundContext).category).toBe('电视')
  })

  it('reads the bound session off the disk', async () => {
    const created = await createSession(sessions, '电视', '预算5000以内')
    await bindings.bind(created.current_session_id, 'conv-1')

    const bound = readBoundContext(sessions, bindings, 'conv-1')

    expect(bound).toBeDefined()
    expect(bound).not.toHaveProperty('missing')
    const facts = bound as BoundContext
    expect(facts.category).toBe('电视')
    expect(facts.verified_count).toBe(0)
    expect(facts.report_available).toBe(false)
    expect(facts.is_capture_target).toBe(true)
  })

  it('reports a binding whose session file is gone', async () => {
    await bindings.bind('ffffffffffff', 'conv-1')

    const bound = readBoundContext(sessions, bindings, 'conv-1')

    expect(bound).toEqual({ session_id: 'ffffffffffff', missing: true })
    expect(renderBindingContext(bound)).toContain('读不到了')
  })

  it('notices when captures land somewhere else', async () => {
    const mine = await createSession(sessions, '电视', '')
    const other = await createSession(sessions, '手机', '')
    await bindings.bind(mine.current_session_id, 'conv-1')
    await setCurrentSession(sessions, other.current_session_id)

    const facts = readBoundContext(sessions, bindings, 'conv-1') as BoundContext

    expect(facts.is_capture_target).toBe(false)
    expect(facts.capture_target).toBe(other.current_session_id)
  })
})

describe('context wording', () => {
  it('renders every stated fact', () => {
    expect(renderBindingContext(FULL)).toBe(
      [
        'DealBuddy 购物会话 aaaaaaaaaaaa · 电视',
        '需求 v2：预算5000以内，65英寸',
        '预算：–5000',
        '硬性要求：刷新率=120Hz',
        '已采集 3 件 · 报告可用',
        '投递目标是本会话',
        '工具 dealbuddy_show_session / dealbuddy_get_report，session_id 省略即本会话。',
        'estimated_payable 是估算应付，不是结算价，以结算页为准。',
      ].join('\n'),
    )
  })

  it('drops the lines it has nothing to say on', () => {
    const bare = renderBindingContext({
      ...FULL,
      budget_min: null,
      budget_max: null,
      must_have: [],
      report_available: false,
    })

    expect(bare).not.toContain('预算：')
    expect(bare).not.toContain('硬性要求')
    expect(bare).toContain('报告不可用')
  })

  it('warns when captures do not land in this session', () => {
    const text = renderBindingContext({
      ...FULL,
      is_capture_target: false,
      capture_target: 'bbbbbbbbbbbb',
    })

    expect(text).toContain('投递目标不是本会话（当前投递到 bbbbbbbbbbbb）')
  })

  it('keeps the price wording the product requires', () => {
    const text = renderBindingContext(FULL)
    expect(text).toContain('估算应付')
    for (const banned of ['结算价格', '到手价', '最低价']) {
      expect(text.replace('不是结算价，以结算页为准', '')).not.toContain(banned)
    }
  })
})

describe('evaluation request', () => {
  it('carries the report and what to do with it', () => {
    const message = buildEvaluationMessage('# 报告\n\n正文', FULL)

    expect(message.text).toContain('购物会话 aaaaaaaaaaaa（电视）')
    expect(message.text).toContain('# 报告')
    expect(message.text).toContain('最符合需求、最低预算、综合性价比、值得加预算')
    expect(message.text).toContain('可信度为 low')
    expect(message.text).toContain('「估算应付」')
    expect(message.summary).toBe('电视选品报告 · 评估请求')
  })

  it('names the session even when the category was never filled in', () => {
    // The collapsed row is all a reader sees until they open it, so it has to
    // say which report this is. The harness ellipsizes the line past 120
    // characters, which is why the caller passes it through its bound.
    expect(buildEvaluationMessage('x', { ...FULL, category: '' }).summary).toBe(
      '未填品类选品报告 · 评估请求',
    )
  })

  it('leaves no interpolation group in a request full of braces', async () => {
    const created = await createSession(sessions, '电视', '要 {{name}} 和 {{{deep}}} 这种')
    await bindings.bind(created.current_session_id, 'conv-1')
    let provider: ((assemble: { agent?: { id: string } }) => string) | undefined
    const ctx = {
      systemPrompt: {
        context(contribution: {
          text: (assemble: { agent?: { id: string } }) => string
        }): () => void {
          provider = contribution.text
          return () => undefined
        },
      },
    }
    registerBindingContext(ctx as never, sessions, bindings)

    const text = provider?.({ agent: { id: 'conv-1' } }) ?? ''

    // The assembly interpolates `{{name}}` groups and rejects malformed ones,
    // so a user's own braces must not survive into it in any run length.
    expect(text).toContain('要')
    expect(text).not.toContain('{{')
  })

  it('says nothing for a conversation the provider was not asked about', async () => {
    let provider: ((assemble: { agent?: { id: string } }) => string) | undefined
    const ctx = {
      systemPrompt: {
        context(contribution: {
          text: (assemble: { agent?: { id: string } }) => string
        }): () => void {
          provider = contribution.text
          return () => undefined
        },
      },
    }
    registerBindingContext(ctx as never, sessions, bindings)

    expect(provider?.({})).toBe('')
  })

  it('binds a session to its conversation as it is created', async () => {
    const created = await createSession(sessions, '电视', '预算5000以内')
    // What the Host's createSession does when a conversation is named: the two
    // halves cannot be separated, so a created session is never left unbound.
    await bindings.bind(created.current_session_id, 'conv-1')

    const fresh = new BindingStore(sessions.dataDir)
    expect(fresh.cached()?.[0]).toMatchObject({
      session_id: created.current_session_id,
      dsh_session_id: 'conv-1',
    })
  })
})
