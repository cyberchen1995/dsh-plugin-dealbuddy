import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { getReportTool } from '../../src/tools/offers.js'
import { metaSessionId, resolvedSessionId, showSessionTool } from '../../src/tools/sessions.js'
import { createSession } from '../../src/services/sessions.js'
import { BindingStore } from '../../src/store/binding-store.js'
import { SessionStore } from '../../src/store/session-store.js'

/**
 * Calling a tool without naming a session.
 *
 * A conversation and a shopping session are one thing, so a call made inside a
 * bound conversation should not have to repeat which one it means — and a call
 * made outside one has to say so plainly rather than guess.
 */

let store: SessionStore
let bindings: BindingStore

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-fallback-'))
  store = new SessionStore(dataDir)
  bindings = new BindingStore(dataDir)
})

/**
 * Invoke a tool as a conversation would.
 * @param tool - the tool definition.
 * @param args - the arguments.
 * @param agentId - the conversation the call runs in, when there is one.
 * @returns the canonical value.
 */
async function run(
  tool: ToolDefinition,
  args: unknown,
  agentId?: string,
): Promise<Record<string, unknown>> {
  const exec = {
    signal: new AbortController().signal,
    ...(agentId === undefined ? {} : { agent: { id: agentId } }),
  } as never
  return (await tool.execute(args, exec)) as Record<string, unknown>
}

describe('session_id fallback', () => {
  it('uses the session this conversation is bound to', async () => {
    const created = await createSession(store, '电视', '')
    await bindings.bind(created.current_session_id, 'conv-1')

    const shown = await run(showSessionTool(store, bindings, () => 400), {}, 'conv-1')

    const session = shown['session'] as { session_id: string }
    expect(session.session_id).toBe(created.current_session_id)
  })

  it('still obeys an explicit session_id', async () => {
    const bound = await createSession(store, '电视', '')
    const other = await createSession(store, '手机', '')
    await bindings.bind(bound.current_session_id, 'conv-1')

    // The model may be answering about a session other than the one this
    // conversation belongs to.
    const shown = await run(
      showSessionTool(store, bindings, () => 400),
      { session_id: other.current_session_id },
      'conv-1',
    )

    const session = shown['session'] as { session_id: string }
    expect(session.session_id).toBe(other.current_session_id)
  })

  it('tells the model what to do when nothing is bound', async () => {
    await expect(run(getReportTool(store, bindings), {}, 'conv-9')).rejects.toThrow(
      'No shopping session is bound to this conversation',
    )
  })

  it('tells the model the same thing outside any conversation', async () => {
    await expect(run(getReportTool(store, bindings), {})).rejects.toThrow(
      'Pass session_id explicitly',
    )
  })

  it('titles the result card with the session the call resolved', async () => {
    const created = await createSession(store, '电视', '')
    await bindings.bind(created.current_session_id, 'conv-1')
    const tool = showSessionTool(store, bindings, () => 400)

    const value = await run(tool, {}, 'conv-1')
    // The arguments named no session, so a title built from them would read
    // "(未知)"; the projector carries what the call actually acted on.
    const meta = tool.output?.presentationMeta?.({}, value as never)

    expect(resolvedSessionId(value)).toBe(created.current_session_id)
    expect(metaSessionId(meta)).toBe(created.current_session_id)
  })

  it('falls back to a placeholder rather than a wrong id', () => {
    expect(metaSessionId(undefined)).toBe('(未知)')
    expect(metaSessionId({ session_id: '' })).toBe('(未知)')
    expect(resolvedSessionId(null)).toBe('')
  })
})
