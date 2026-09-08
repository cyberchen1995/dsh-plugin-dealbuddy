import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { addOfferTool, getReportTool, refineRequirementsTool, removeOfferTool } from '../../src/tools/offers.js'
import { createSessionTool, setCurrentSessionTool, showSessionTool } from '../../src/tools/sessions.js'
import { listSessionsTool } from '../../src/tools/list-sessions.js'
import { parseJson, type JsonObject } from '../../src/store/json.js'
import { SessionStore } from '../../src/store/session-store.js'

/**
 * Tool behaviour, exercised through the definitions the registry receives.
 *
 * `execute` is called directly with a stub run context: the registry's own
 * argument validation is the harness's concern, while the product semantics
 * are this plugin's.
 */

let dataDir: string
let store: SessionStore

/**
 * Invoke a tool's execute with a minimal run context.
 * @param tool - the tool definition.
 * @param args - the arguments.
 * @returns the canonical value.
 */
async function run(tool: ToolDefinition, args: unknown): Promise<Record<string, unknown>> {
  const exec = { signal: new AbortController().signal } as never
  return (await tool.execute(args, exec)) as Record<string, unknown>
}

/**
 * Read a session file straight from disk.
 * @param sessionId - the session id.
 * @returns the parsed document.
 */
async function readSession(sessionId: string): Promise<JsonObject> {
  return parseJson(
    await readFile(join(dataDir, 'sessions', `${sessionId}.json`), 'utf8'),
  ) as JsonObject
}

/** A self-authored product body for `dealbuddy_add_offer`. */
function offerArgs(sessionId: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    session_id: sessionId,
    offer: {
      platform: 'jd',
      url: 'https://item.jd.com/100000000001.html',
      title: '示例牌 DB-65A 65英寸 电视（自拟样例）',
      visible_price: '¥4,599.00',
      store_name: '示例牌官方旗舰店',
      sku_text: '65英寸 / 曜石黑 / 单机',
      specs: { 屏幕尺寸: '65英寸' },
      ocr_text: 'x'.repeat(1200),
      confidence: 'high',
      ...overrides,
    },
  }
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-tools-'))
  await mkdir(join(dataDir, 'sessions'), { recursive: true })
  store = new SessionStore(dataDir)
})

describe('dealbuddy_create_session', () => {
  it('creates a session, makes it current, and mines the request', async () => {
    const result = await run(createSessionTool(store), {
      category: '电视',
      request: '预算 5000 以内，65 英寸，主要看电影',
    })
    const sessionId = result['current_session_id'] as string
    expect(sessionId).toMatch(/^[0-9a-f]{12}$/u)
    await expect(store.currentSessionId()).resolves.toBe(sessionId)

    const session = await readSession(sessionId)
    const requirements = session.get('requirements') as JsonObject
    expect(requirements.get('budget_max')).toBe('5000')
    expect((requirements.get('must_have') as JsonObject).get('screen_size')).toBe('65英寸')
    expect(requirements.get('use_cases')).toEqual(['电影'])
    expect(session.get('phase')).toBe('created')
    // The file must carry pydantic's field order so Python rewrites it unchanged.
    expect([...session.keys()]).toEqual([
      'session_id',
      'requirements',
      'phase',
      'parameter_catalog',
      'search_plan',
      'candidates',
      'verified_offers',
      'report_markdown',
      'messages',
      'pending_action',
      'created_at',
      'updated_at',
    ])
  })
})

describe('dealbuddy_add_offer and dealbuddy_remove_offer', () => {
  it('records a product, rebuilds the report, then removes it again', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '预算 5000 以内' })
    const sessionId = created['current_session_id'] as string

    const added = await run(addOfferTool(store), offerArgs(sessionId))
    expect(added['verified_count']).toBe(1)
    expect(added['report_available']).toBe(true)

    const removed = await run(removeOfferTool(store), {
      session_id: sessionId,
      url: 'https://item.jd.com/100000000001.html',
    })
    expect(removed['verified_count']).toBe(0)
    // With no products left the report is cleared, not emptied to a string.
    expect(removed['report_available']).toBe(false)
    expect((await readSession(sessionId)).get('report_markdown')).toBeNull()
  })

  it('refuses to remove a product that is not there', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '' })
    await expect(
      run(removeOfferTool(store), {
        session_id: created['current_session_id'] as string,
        url: 'https://item.jd.com/nope.html',
      }),
    ).rejects.toThrow('该商品已不在当前会话中')
  })

  it('replaces the earlier record when the same URL is added twice', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '' })
    const sessionId = created['current_session_id'] as string
    await run(addOfferTool(store), offerArgs(sessionId))
    const second = await run(addOfferTool(store), offerArgs(sessionId, { visible_price: '3999' }))
    expect(second['verified_count']).toBe(1)
    const offers = (await readSession(sessionId)).get('verified_offers') as JsonObject[]
    expect(offers[0]?.get('visible_price')).toBe('3999')
  })
})

describe('dealbuddy_show_session', () => {
  it('shortens recognised detail-image text by default', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '' })
    const sessionId = created['current_session_id'] as string
    await run(addOfferTool(store), offerArgs(sessionId))

    const shown = await run(showSessionTool(store, 400), { session_id: sessionId })
    expect(shown['ocr_text_shortened_offers']).toBe(1)
    const session = shown['session'] as Record<string, unknown>
    const offers = session['verified_offers'] as Record<string, unknown>[]
    const parameters = offers[0]?.['parameters'] as Record<string, string>
    expect(parameters['ocr_text']).toHaveLength(400)
    expect(parameters['ocr_text_truncated_from_chars']).toBe('1200')

    // Truncation is a view concern; the stored file keeps the full text.
    const stored = (await readSession(sessionId)).get('verified_offers') as JsonObject[]
    const storedParams = stored[0]?.get('parameters') as JsonObject
    expect((storedParams.get('ocr_text') as string).length).toBe(1200)
  })

  it('keeps the full text when asked', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '' })
    const sessionId = created['current_session_id'] as string
    await run(addOfferTool(store), offerArgs(sessionId))
    const shown = await run(showSessionTool(store, 400), {
      session_id: sessionId,
      include_ocr_text: true,
    })
    const session = shown['session'] as Record<string, unknown>
    const offers = session['verified_offers'] as Record<string, unknown>[]
    expect((offers[0]?.['parameters'] as Record<string, string>)['ocr_text']).toHaveLength(1200)
  })
})

describe('dealbuddy_refine_requirements', () => {
  it('reports exactly what it destroyed', async () => {
    const created = await run(createSessionTool(store), {
      category: '电视',
      request: '预算 5000 以内',
    })
    const sessionId = created['current_session_id'] as string
    await run(addOfferTool(store), offerArgs(sessionId))

    const refined = await run(refineRequirementsTool(store), {
      session_id: sessionId,
      changes: { budget_max: '3000', must_have: { 刷新率: '120Hz' } },
    })
    // The count is what the tool must tell the user about before being called.
    expect(refined['cleared_offers']).toBe(1)
    expect(refined['cleared_report']).toBe(true)
    expect(refined['category_changed']).toBe(false)
    expect(refined['phase']).toBe('ready_to_search')

    const session = await readSession(sessionId)
    expect(session.get('verified_offers')).toEqual([])
    expect(session.get('report_markdown')).toBeNull()
    const requirements = session.get('requirements') as JsonObject
    expect(requirements.get('version')).toBe(2)
    expect(requirements.get('budget_max')).toBe('3000')
  })

  it('resets the version and phase when the category changes', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '预算 5000 以内' })
    const sessionId = created['current_session_id'] as string
    const refined = await run(refineRequirementsTool(store), {
      session_id: sessionId,
      changes: { category: '投影仪' },
    })
    expect(refined['category_changed']).toBe(true)
    expect(refined['phase']).toBe('created')
    const requirements = (await readSession(sessionId)).get('requirements') as JsonObject
    expect(requirements.get('version')).toBe(1)
    expect(requirements.get('budget_max')).toBeNull()
  })
})

describe('read-only tools', () => {
  it('lists sessions with the current one marked and reads the report', async () => {
    const first = await run(createSessionTool(store), { category: '电视', request: '' })
    const second = await run(createSessionTool(store), { category: '电饭煲', request: '' })
    const firstId = first['current_session_id'] as string
    const secondId = second['current_session_id'] as string
    await run(addOfferTool(store), offerArgs(firstId))

    const listed = await run(listSessionsTool(store), {})
    expect(listed['current_session_id']).toBe(secondId)
    const sessions = listed['sessions'] as Record<string, unknown>[]
    expect(sessions).toHaveLength(2)

    const report = await run(getReportTool(store), { session_id: firstId })
    expect(report['report']).toContain('# DealBuddy 选品报告：电视')
    expect(report['report']).toContain('不代表结算价格')

    const empty = await run(getReportTool(store), { session_id: secondId })
    expect(empty['report']).toBe('')
  })

  it('switches the capture target only to a session that exists', async () => {
    const created = await run(createSessionTool(store), { category: '电视', request: '' })
    const other = await run(createSessionTool(store), { category: '电饭煲', request: '' })
    const firstId = created['current_session_id'] as string
    expect(await store.currentSessionId()).toBe(other['current_session_id'])

    await run(setCurrentSessionTool(store), { session_id: firstId })
    expect(await store.currentSessionId()).toBe(firstId)

    await expect(
      run(setCurrentSessionTool(store), { session_id: 'ffffffffffff' }),
    ).rejects.toThrow('Unknown session')
  })
})
