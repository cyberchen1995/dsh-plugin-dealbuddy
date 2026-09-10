import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { BINDINGS_FILENAME, BindingStore } from '../../src/store/binding-store.js'

/**
 * The one-to-one map between a shopping session and its conversation.
 *
 * One-to-one is the whole point of the feature, so it is enforced here rather
 * than assumed: both directions are checked, including the rebind that has to
 * take a session away from the conversation that held it.
 */

let dataDir: string
let store: BindingStore

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-bindings-'))
  store = new BindingStore(dataDir)
})

describe('binding store', () => {
  it('starts empty and survives a file that is not there', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.byConversation('conv-1')).toBeUndefined()
  })

  it('binds both directions', async () => {
    await store.bind('aaaaaaaaaaaa', 'conv-1')

    expect((await store.byConversation('conv-1'))?.session_id).toBe('aaaaaaaaaaaa')
    expect((await store.bySession('aaaaaaaaaaaa'))?.dsh_session_id).toBe('conv-1')
  })

  it('keeps one conversation to one session', async () => {
    await store.bind('aaaaaaaaaaaa', 'conv-1')
    await store.bind('bbbbbbbbbbbb', 'conv-1')

    // The conversation moved on, so its old session must not still claim it.
    expect(await store.list()).toHaveLength(1)
    expect((await store.byConversation('conv-1'))?.session_id).toBe('bbbbbbbbbbbb')
    expect(await store.bySession('aaaaaaaaaaaa')).toBeUndefined()
  })

  it('moves a session away from the conversation that held it', async () => {
    await store.bind('aaaaaaaaaaaa', 'conv-1')
    await store.bind('aaaaaaaaaaaa', 'conv-2')

    expect(await store.list()).toHaveLength(1)
    expect(await store.byConversation('conv-1')).toBeUndefined()
    expect((await store.byConversation('conv-2'))?.session_id).toBe('aaaaaaaaaaaa')
  })

  it('unbinds from either side', async () => {
    await store.bind('aaaaaaaaaaaa', 'conv-1')
    await store.bind('bbbbbbbbbbbb', 'conv-2')

    expect(await store.unbindConversation('conv-1')).toBe(true)
    expect(await store.unbindConversation('conv-1')).toBe(false)
    expect(await store.unbindSession('bbbbbbbbbbbb')).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('writes a file another reader can parse', async () => {
    await store.bind('aaaaaaaaaaaa', 'conv-1')

    const raw = await readFile(join(dataDir, BINDINGS_FILENAME), 'utf8')
    const parsed = JSON.parse(raw) as { version: number; bindings: unknown[] }

    expect(parsed.version).toBe(1)
    // An array, not an object: a session id can be all digits, and an engine
    // would reorder such keys on an object.
    expect(Array.isArray(parsed.bindings)).toBe(true)
    expect(await new BindingStore(dataDir).byConversation('conv-1')).toBeDefined()
  })

  it('treats a hand-mangled file as no bindings', async () => {
    await writeFile(join(dataDir, BINDINGS_FILENAME), '{ not json', 'utf8')
    expect(await store.list()).toEqual([])

    await writeFile(
      join(dataDir, BINDINGS_FILENAME),
      JSON.stringify({ version: 1, bindings: [null, { session_id: 'x' }, 3] }),
      'utf8',
    )
    // A binding is a convenience; refusing to load over a bad line would be
    // the wrong trade.
    expect(await new BindingStore(dataDir).list()).toEqual([])
  })

  it('holds the table in memory for the prompt provider', async () => {
    expect(store.cached()).toBeUndefined()
    await store.list()
    expect(store.cached()).toEqual([])

    await store.bind('aaaaaaaaaaaa', 'conv-1')
    expect(store.cached()).toHaveLength(1)
  })

  it('does not let a read started earlier undo a write', async () => {
    // The constructor fires an unawaited warm-up read, so this overlap is the
    // common case at startup rather than a corner one.
    const warming = store.list()
    await store.bind('aaaaaaaaaaaa', 'conv-1')
    await warming

    expect(store.cached()).toHaveLength(1)
    expect(await store.byConversation('conv-1')).toBeDefined()
  })

  it('keeps one write inside one data directory', async () => {
    await store.bind('aaaaaaaaaaaa', 'conv-1')
    const moved = await mkdtemp(join(tmpdir(), 'dealbuddy-bindings-moved-'))
    const other = new BindingStore(moved)
    await other.bind('bbbbbbbbbbbb', 'conv-2')

    // Point the first store at the second directory, then write.
    store.useDataDir(moved)
    await store.bind('cccccccccccc', 'conv-3')

    // The second directory's own binding must still be there: a write that
    // read the old directory and wrote the new one would have erased it.
    const reread = await new BindingStore(moved).list()
    expect(reread.map((entry) => entry.session_id).sort()).toEqual([
      'bbbbbbbbbbbb',
      'cccccccccccc',
    ])
  })
})
