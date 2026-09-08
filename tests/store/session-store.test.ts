import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { SessionStore } from '../../src/store/session-store.js'

const roots: string[] = []

/**
 * Create a data directory holding self-authored session fixtures.
 * @param files - file name to raw JSON text.
 * @returns the data directory path.
 */
async function makeDataDir(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dealbuddy-test-'))
  roots.push(root)
  await mkdir(join(root, 'sessions'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    const target = name === 'config.json' ? join(root, name) : join(root, 'sessions', name)
    await writeFile(target, body, 'utf8')
  }
  return root
}

/**
 * Build a minimal session body in the on-disk shape.
 * @param overrides - fields to override.
 * @returns the serialised session JSON.
 */
function sessionJson(overrides: Record<string, unknown>): string {
  return JSON.stringify(
    {
      session_id: 'aaaaaaaaaaaa',
      requirements: { category: '电视', raw_request: '预算 5000 以内', version: 1 },
      phase: 'created',
      parameter_catalog: null,
      search_plan: null,
      candidates: [],
      verified_offers: [],
      report_markdown: null,
      messages: [],
      pending_action: null,
      created_at: '2026-09-08T05:00:00.000000Z',
      updated_at: '2026-09-08T05:00:00.000000Z',
      ...overrides,
    },
    null,
    2,
  )
}

afterEach(() => {
  roots.length = 0
})

describe('SessionStore', () => {
  it('returns no summaries when the data directory does not exist', async () => {
    const store = new SessionStore(join(tmpdir(), 'dealbuddy-absent-dir-xyz'))
    await expect(store.listSummaries()).resolves.toEqual([])
    await expect(store.currentSessionId()).resolves.toBeUndefined()
  })

  it('summarises a session without loading offer or report bodies', async () => {
    const root = await makeDataDir({
      'aaaaaaaaaaaa.json': sessionJson({
        verified_offers: [{ url: 'https://example.invalid/1' }, { url: 'https://example.invalid/2' }],
        report_markdown: '# 报告',
      }),
    })
    const [summary] = await new SessionStore(root).listSummaries()
    expect(summary).toEqual({
      session_id: 'aaaaaaaaaaaa',
      category: '电视',
      raw_request: '预算 5000 以内',
      version: 1,
      phase: 'created',
      verified_count: 2,
      report_available: true,
      created_at: '2026-09-08T05:00:00.000000Z',
      updated_at: '2026-09-08T05:00:00.000000Z',
    })
  })

  it('orders summaries by updated_at ascending, like the Python store', async () => {
    const root = await makeDataDir({
      'bbbbbbbbbbbb.json': sessionJson({
        session_id: 'bbbbbbbbbbbb',
        updated_at: '2026-09-08T06:00:00.000000Z',
      }),
      'aaaaaaaaaaaa.json': sessionJson({ updated_at: '2026-09-08T05:00:00.000000Z' }),
      'cccccccccccc.json': sessionJson({
        session_id: 'cccccccccccc',
        updated_at: '2026-09-08T05:30:00.000000Z',
      }),
    })
    const ids = (await new SessionStore(root).listSummaries()).map((s) => s.session_id)
    expect(ids).toEqual(['aaaaaaaaaaaa', 'cccccccccccc', 'bbbbbbbbbbbb'])
  })

  it('ignores half-written .json.tmp files', async () => {
    const root = await makeDataDir({
      'aaaaaaaaaaaa.json': sessionJson({}),
      'aaaaaaaaaaaa.json.tmp': '{ truncated',
    })
    await expect(new SessionStore(root).listSummaries()).resolves.toHaveLength(1)
  })

  it('reads current_session_id and treats an empty value as unset', async () => {
    const set = await makeDataDir({
      'config.json': JSON.stringify({ current_session_id: 'aaaaaaaaaaaa', llm: { api_key: 'placeholder-not-a-real-key' } }),
    })
    await expect(new SessionStore(set).currentSessionId()).resolves.toBe('aaaaaaaaaaaa')

    const unset = await makeDataDir({ 'config.json': JSON.stringify({ current_session_id: null }) })
    await expect(new SessionStore(unset).currentSessionId()).resolves.toBeUndefined()
  })

  it('reports a malformed session file instead of skipping it silently', async () => {
    const root = await makeDataDir({ 'aaaaaaaaaaaa.json': '{ not json' })
    await expect(new SessionStore(root).listSummaries()).rejects.toThrow('not valid JSON')
  })
})
