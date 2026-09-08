import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { compareTimestamps } from '../core/time.js'
import {
  asString,
  toSummary,
  type SessionSummary,
  type StoredConfig,
  type StoredSession,
} from '../core/models.js'
import { CONFIG_FILENAME, SESSIONS_DIRNAME, configPath, sessionPath } from './paths.js'

/** Read-only access to the DealBuddy data directory. */
export class SessionStore {
  /**
   * @param dataDir - the resolved absolute data directory.
   */
  constructor(readonly dataDir: string) {}

  /**
   * Read `current_session_id` from `config.json`.
   *
   * A missing file means "no config yet" — Python returns in-memory defaults
   * without writing (`config.py:44-49`) — so this returns `undefined` rather
   * than throwing.
   * @returns the current session id, or `undefined` when unset.
   */
  async currentSessionId(): Promise<string | undefined> {
    const parsed = await readJson<StoredConfig>(configPath(this.dataDir))
    if (parsed === undefined) return undefined
    const value = parsed.current_session_id
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /**
   * Load one session by id.
   * @param sessionId - the session id.
   * @returns the parsed session, or `undefined` when the file is absent.
   * @throws when the id is invalid or the file is unreadable or malformed.
   */
  async load(sessionId: string): Promise<StoredSession | undefined> {
    return readJson<StoredSession>(sessionPath(this.dataDir, sessionId))
  }

  /**
   * List every session as a summary, oldest `updated_at` first.
   *
   * The ordering mirrors `session.py:61-67`. Timestamps are compared as parsed
   * instants: Python writes microseconds, so a lexicographic compare would
   * misorder a millisecond-precision value written by another writer.
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
      const sessionId = entry.slice(0, -'.json'.length)
      const parsed = await readJson<StoredSession>(join(dir, entry))
      if (parsed === undefined) continue
      summaries.push(toSummary(sessionId, parsed))
    }
    summaries.sort((left, right) => compareTimestamps(left.updated_at, right.updated_at))
    return summaries
  }
}

/**
 * Read and parse one JSON file.
 * @param path - the absolute file path.
 * @returns the parsed value, or `undefined` when the file does not exist.
 * @throws when the file exists but cannot be read or parsed.
 */
async function readJson<T>(path: string): Promise<T | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${String(error)}`)
  }
}

/**
 * Test whether a filesystem error is a missing-path error.
 * @param error - the thrown value.
 * @returns whether the path was absent.
 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export { CONFIG_FILENAME, asString }
