import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { nowIso } from '../core/clock.js'
import { KeyedMutex } from './lock.js'

/**
 * Which dsh conversation each shopping session belongs to.
 *
 * A shopping session and the conversation about it are one thing, so the map is
 * one-to-one in both directions and this file is the only place that says so.
 * It lives beside the sessions rather than inside dsh's own session log: dsh
 * has no writable per-session field, and keeping the record here means it
 * follows the data directory, survives a plugin reload, and can be rewritten
 * for a conversation that is not currently loaded.
 *
 * The Python workbench neither reads nor writes this file, so the two tracks
 * stay compatible: to Python it is an unknown file in the data directory.
 */

/** The file's name inside the data directory. */
export const BINDINGS_FILENAME = 'dsh-bindings.json'

/** Serialised as an array so an all-digit session id cannot be reordered by the engine. */
const FORMAT_VERSION = 1

/** One shopping session and the conversation it belongs to. */
export interface Binding {
  /** The DealBuddy shopping session. */
  session_id: string
  /** The dsh conversation, which dsh itself also calls a session. */
  dsh_session_id: string
  /** When the pair was established. */
  bound_at: string
}

/** Read and write the binding file. */
export class BindingStore {
  readonly #mutex = new KeyedMutex()
  #dataDir: string
  /** Last read table, so a prompt assembly does not touch the disk. */
  #cache: Binding[] | undefined

  /**
   * @param dataDir - the resolved absolute data directory.
   */
  constructor(dataDir: string) {
    this.#dataDir = dataDir
  }

  /**
   * Point the store at another directory, dropping the cached table.
   * @param dataDir - the new resolved absolute data directory.
   */
  useDataDir(dataDir: string): void {
    this.#dataDir = dataDir
    this.#cache = undefined
  }

  /**
   * Read every binding.
   * @returns the bindings, oldest first.
   */
  async list(): Promise<Binding[]> {
    if (this.#cache !== undefined) return this.#cache
    // Filled under the write lock: an unlocked read started before a bind can
    // otherwise finish after it and put the pre-write table back, which loses
    // a binding made moments after startup — the constructor's warm-up read
    // makes exactly that overlap the common case.
    return this.#mutex.run(BINDINGS_FILENAME, async () => {
      if (this.#cache !== undefined) return this.#cache
      const dataDir = this.#dataDir
      const parsed = await this.#read(dataDir)
      if (dataDir === this.#dataDir) this.#cache = parsed
      return parsed
    })
  }

  /**
   * Read the bindings already in memory, without touching the disk.
   *
   * The prompt assembly runs on every model request, including in
   * conversations that have nothing to do with shopping, so it must not read a
   * file to discover it has nothing to say.
   * @returns the cached table, or undefined before the first read.
   */
  cached(): Binding[] | undefined {
    return this.#cache
  }

  /**
   * Find the shopping session one conversation is about.
   * @param dshSessionId - the dsh conversation.
   * @returns the binding, or undefined.
   */
  async byConversation(dshSessionId: string): Promise<Binding | undefined> {
    return (await this.list()).find((entry) => entry.dsh_session_id === dshSessionId)
  }

  /**
   * Find the conversation one shopping session belongs to.
   * @param sessionId - the shopping session.
   * @returns the binding, or undefined.
   */
  async bySession(sessionId: string): Promise<Binding | undefined> {
    return (await this.list()).find((entry) => entry.session_id === sessionId)
  }

  /**
   * Bind a shopping session to a conversation, replacing both sides.
   *
   * One-to-one is enforced here rather than trusted: binding a session that
   * already belongs to another conversation moves it, and binding into a
   * conversation that already holds another session replaces that one.
   * @param sessionId - the shopping session.
   * @param dshSessionId - the dsh conversation.
   * @returns the binding that was written.
   */
  async bind(sessionId: string, dshSessionId: string): Promise<Binding> {
    return this.#write((entries) => {
      const kept = entries.filter(
        (entry) => entry.session_id !== sessionId && entry.dsh_session_id !== dshSessionId,
      )
      const binding: Binding = {
        session_id: sessionId,
        dsh_session_id: dshSessionId,
        bound_at: nowIso(),
      }
      return { next: [...kept, binding], result: binding }
    })
  }

  /**
   * Drop whatever a conversation was bound to.
   * @param dshSessionId - the dsh conversation.
   * @returns whether a binding was removed.
   */
  async unbindConversation(dshSessionId: string): Promise<boolean> {
    return this.#write((entries) => {
      const next = entries.filter((entry) => entry.dsh_session_id !== dshSessionId)
      return { next, result: next.length !== entries.length }
    })
  }

  /**
   * Drop whatever a shopping session was bound to.
   * @param sessionId - the shopping session.
   * @returns whether a binding was removed.
   */
  async unbindSession(sessionId: string): Promise<boolean> {
    return this.#write((entries) => {
      const next = entries.filter((entry) => entry.session_id !== sessionId)
      return { next, result: next.length !== entries.length }
    })
  }

  /**
   * Read, change and write the table under one lock.
   * @param mutate - receives the current table and returns the next one.
   * @returns whatever the mutator returned.
   */
  async #write<T>(mutate: (entries: Binding[]) => { next: Binding[]; result: T }): Promise<T> {
    return this.#mutex.run(BINDINGS_FILENAME, async () => {
      // One directory for the whole operation. Reading the old directory and
      // writing the new one would merge two unrelated tables and overwrite
      // whatever the new directory already held.
      const dataDir = this.#dataDir
      const entries = await this.#read(dataDir)
      const { next, result } = mutate(entries)
      const path = join(dataDir, BINDINGS_FILENAME)
      const body = `${JSON.stringify({ version: FORMAT_VERSION, bindings: next }, null, 2)}\n`
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, path)
      if (dataDir === this.#dataDir) this.#cache = next
      return result
    })
  }

  /**
   * Parse the file, treating anything unreadable as an empty table.
   *
   * A binding is a convenience, not data anyone typed: refusing to load the
   * plugin because this file was hand-edited would be the wrong trade.
   * @param dataDir - the directory this operation belongs to.
   * @returns the bindings on disk.
   */
  async #read(dataDir: string): Promise<Binding[]> {
    let raw: string
    try {
      raw = await readFile(join(dataDir, BINDINGS_FILENAME), 'utf8')
    } catch {
      return []
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return []
      const list = (parsed as { bindings?: unknown }).bindings
      if (!Array.isArray(list)) return []
      return list.filter(isBinding)
    } catch {
      return []
    }
  }
}

/**
 * Accept only entries naming both sides.
 * @param value - one parsed array element.
 * @returns whether it is a usable binding.
 */
function isBinding(value: unknown): value is Binding {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Partial<Binding>
  return (
    typeof entry.session_id === 'string' &&
    entry.session_id !== '' &&
    typeof entry.dsh_session_id === 'string' &&
    entry.dsh_session_id !== ''
  )
}
