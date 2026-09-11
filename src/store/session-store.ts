import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { nowIso } from '../core/clock.js'
import { compareTimestamps } from '../core/time.js'
import { toSummary, type SessionSummary, type StoredSession } from '../core/models.js'
import { parseJson, stringifyJson, type JsonObject, type JsonValue } from './json.js'
import { CONFIG_FILENAME, SESSIONS_DIRNAME, configPath, sessionPath } from './paths.js'
import { KeyedMutex } from './lock.js'

/** Sentinel key serialising writes to `config.json`. */
const CONFIG_LOCK_KEY = '\u0000config'

/** Read and write access to the DealBuddy data directory. */
export class SessionStore {
  private readonly mutex = new KeyedMutex()

  /** The resolved data directory; a settings change may move it. */
  #dataDir: string

  /**
   * @param dataDir - the resolved absolute data directory.
   */
  constructor(dataDir: string) {
    this.#dataDir = dataDir
  }

  /**
   * @returns the directory sessions are currently read from and written to.
   */
  get dataDir(): string {
    return this.#dataDir
  }

  /**
   * Point the store at another directory.
   *
   * The instance is kept rather than replaced so registered tools, which hold
   * this object, follow a settings change without re-registering.
   * @param dataDir - the new resolved absolute data directory.
   */
  useDataDir(dataDir: string): void {
    this.#dataDir = dataDir
  }

  /**
   * Generate a session id in the Python store's shape (`session.py:31`).
   * @returns twelve lowercase hexadecimal characters.
   */
  static newSessionId(): string {
    return randomBytes(6).toString('hex')
  }

  /**
   * Read `current_session_id` from `config.json`.
   * @returns the current session id, or `undefined` when unset or absent.
   */
  async currentSessionId(): Promise<string | undefined> {
    const parsed = await this.readConfig()
    if (parsed === undefined) return undefined
    const value = parsed.get('current_session_id')
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /**
   * Point extension captures at a session.
   *
   * Every other key — including the plaintext `llm` block — is written back
   * exactly as it was read.
   * @param sessionId - the session to make current, or null to clear it.
   */
  async setCurrentSessionId(sessionId: string | null): Promise<void> {
    await this.mutex.run(CONFIG_LOCK_KEY, async () => {
      const config = (await this.readConfig()) ?? newConfig()
      config.set('current_session_id', sessionId)
      await atomicWrite(configPath(this.dataDir), stringifyJson(config))
    })
  }

  /**
   * Load one session document.
   * @param sessionId - the session id.
   * @returns the parsed session, or `undefined` when the file is absent.
   * @throws when the id is invalid or the file is malformed.
   */
  async load(sessionId: string, expectDataDir?: string): Promise<JsonObject | undefined> {
    this.#assertDataDir(expectDataDir)
    return readJsonObject(sessionPath(this.dataDir, sessionId))
  }

  /**
   * Refuse to act on a directory the caller did not mean.
   *
   * An id resolved from the binding table names a session in the directory it
   * was read from. Two directories can hold the same id — a restored or copied
   * data set — so acting on one with an id from the other is how a destructive
   * call lands on the wrong session.
   * @param expectDataDir - the directory the caller resolved against, if any.
   * @throws when the store has moved since.
   */
  #assertDataDir(expectDataDir: string | undefined): void {
    if (expectDataDir === undefined || expectDataDir === this.dataDir) return
    throw new Error(
      `the data directory changed while this call was running (expected ${expectDataDir}, now ${this.dataDir})`,
    )
  }

  /**
   * Read one session as a summary.
   * @param sessionId - the session id.
   * @returns the summary, or `undefined` when the session is absent.
   */
  async summary(sessionId: string): Promise<SessionSummary | undefined> {
    const session = await this.load(sessionId)
    if (session === undefined) return undefined
    return toSummary(sessionId, mapToStored(session))
  }

  /**
   * List every session as a summary, oldest `updated_at` first.
   * @returns the summaries in ascending `updated_at` order.
   */
  async listSummaries(): Promise<SessionSummary[]> {
    const dir = join(this.dataDir, SESSIONS_DIRNAME)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const summaries: SessionSummary[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.endsWith('.json.tmp')) continue
      const parsed = await readJsonObject(join(dir, entry))
      if (parsed === undefined) continue
      summaries.push(toSummary(entry.slice(0, -'.json'.length), mapToStored(parsed)))
    }
    summaries.sort((left, right) => compareTimestamps(left.updated_at, right.updated_at))
    return summaries
  }

  /**
   * Read, mutate and write one session under its own lock.
   *
   * The mutator receives the parsed document so unknown fields and untouched
   * offers keep their exact bytes. `updated_at` is stamped on every write, as
   * `session.py:46` does.
   * @param sessionId - the session id.
   * @param mutate - the critical section; it may return a value to pass through.
   * @param expectDataDir - refuse if the store has moved directories since the
   *   caller resolved this id.
   * @returns whatever the mutator returned.
   * @throws when the session does not exist.
   */
  async update<T>(
    sessionId: string,
    mutate: (session: JsonObject) => T | Promise<T>,
    expectDataDir?: string,
  ): Promise<T> {
    return this.mutex.run(sessionId, async () => {
      // Checked inside the lock: the lock defers this body, so a check made at
      // the call site is a check made against a directory that can still move
      // before the write.
      this.#assertDataDir(expectDataDir)
      const session = await this.load(sessionId)
      if (session === undefined) throw new SessionNotFoundError(sessionId)
      const result = await mutate(session)
      session.set('updated_at', nowIso())
      await atomicWrite(sessionPath(this.dataDir, sessionId), stringifyJson(session))
      return result
    })
  }

  /**
   * Write a brand-new session document.
   * @param sessionId - the generated id.
   * @param session - the session node.
   */
  async create(sessionId: string, session: JsonObject): Promise<void> {
    await this.mutex.run(sessionId, async () => {
      await atomicWrite(sessionPath(this.dataDir, sessionId), stringifyJson(session))
    })
  }

  /**
   * Read `config.json` if it exists.
   * @returns the parsed config, or `undefined` when absent.
   */
  private async readConfig(): Promise<JsonObject | undefined> {
    return readJsonObject(join(this.dataDir, CONFIG_FILENAME))
  }
}

/** Raised when a session id resolves to no file. */
export class SessionNotFoundError extends Error {
  /**
   * @param sessionId - the missing session id.
   */
  constructor(readonly sessionId: string) {
    super(`Unknown session: ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

/**
 * Build the default config document.
 * @returns a config node with only the session pointer set.
 */
function newConfig(): JsonObject {
  const config: JsonObject = new Map()
  config.set('current_session_id', null)
  return config
}

/**
 * View a parsed session as the loose record the summary projection reads.
 * @param session - the parsed session node.
 * @returns the record view.
 */
function mapToStored(session: JsonObject): StoredSession {
  const requirements = session.get('requirements')
  return {
    session_id: session.get('session_id'),
    requirements: requirements instanceof Map ? Object.fromEntries(requirements) : {},
    phase: session.get('phase'),
    verified_offers: session.get('verified_offers'),
    report_markdown: session.get('report_markdown'),
    messages: session.get('messages'),
    created_at: session.get('created_at'),
    updated_at: session.get('updated_at'),
  }
}

/**
 * Write a file atomically: temp file, then rename (`session.py:45-53`).
 * @param path - the destination path.
 * @param contents - the text to write, without a trailing newline.
 */
async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path.replace(/\.json$/u, '')}.json.tmp`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, path)
}

/**
 * Read and parse one JSON object file.
 * @param path - the absolute file path.
 * @returns the parsed object, or `undefined` when the file does not exist.
 * @throws when the file exists but is unreadable or not a JSON object.
 */
async function readJsonObject(path: string): Promise<JsonObject | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
  let parsed: JsonValue
  try {
    parsed = parseJson(raw)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${String(error)}`)
  }
  if (!(parsed instanceof Map)) throw new Error(`${path} is not a JSON object`)
  return parsed
}

/**
 * Test whether a filesystem error is a missing-path error.
 * @param error - the thrown value.
 * @returns whether the path was absent.
 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  )
}
