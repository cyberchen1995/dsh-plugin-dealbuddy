import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'

import { DealbuddyRemote } from '../../src/remote.js'
import { createSession } from '../../src/services/sessions.js'
import { BindingStore } from '../../src/store/binding-store.js'
import { SessionStore } from '../../src/store/session-store.js'

/**
 * The Host's half of binding, where the one-to-one rule is actually enforced.
 *
 * The panel asks the question, but it asks from a view that can be seconds old
 * — another browser tab shares this Host. So the write carries what the caller
 * believed, and the Host refuses when that no longer holds.
 */

let sessions: SessionStore
let bindings: BindingStore
let remote: DealbuddyRemote
let sessionId: string

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-remote-'))
  sessions = new SessionStore(dataDir)
  bindings = new BindingStore(dataDir)
  remote = new DealbuddyRemote(new Context(), sessions, bindings, () => 8766)
  sessionId = (await createSession(sessions, '电视', '')).current_session_id
})

describe('bind', () => {
  it('binds when nobody owns the session', async () => {
    const result = await remote.bind(sessionId, 'conv-1', '')

    expect(result.binding.dsh_session_id).toBe('conv-1')
  })

  it('moves a session when the caller named its real owner', async () => {
    await remote.bind(sessionId, 'conv-1', '')

    const result = await remote.bind(sessionId, 'conv-2', 'conv-1')

    expect(result.binding.dsh_session_id).toBe('conv-2')
    expect(await bindings.byConversation('conv-1')).toBeUndefined()
  })

  it('refuses when someone else moved the session first', async () => {
    await remote.bind(sessionId, 'conv-1', '')
    // Another tab moves it while this caller still sees conv-1.
    await remote.bind(sessionId, 'conv-2', 'conv-1')

    // Displacing a conversation the user was never shown is not theirs to
    // confirm, so the stale caller is refused rather than obeyed.
    await expect(remote.bind(sessionId, 'conv-3', 'conv-1')).rejects.toMatchObject({
      code: 'dealbuddy/binding-moved',
    })
    expect((await bindings.bySession(sessionId))?.dsh_session_id).toBe('conv-2')
  })

  it('refuses a caller who believed the session was free', async () => {
    await remote.bind(sessionId, 'conv-1', '')

    await expect(remote.bind(sessionId, 'conv-3', '')).rejects.toMatchObject({
      code: 'dealbuddy/binding-moved',
    })
  })

  it('still binds unconditionally when no expectation is stated', async () => {
    await remote.bind(sessionId, 'conv-1', '')

    // The create path states no expectation — a session it just made cannot
    // already belong to anyone — so the check is opt-in rather than mandatory.
    const result = await remote.bind(sessionId, 'conv-9')

    expect(result.binding.dsh_session_id).toBe('conv-9')
  })
})
