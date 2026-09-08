import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Data-directory and session-id rules shared with the Python workbench.
 *
 * Python resolves the home as `os.environ.get("DEALBUDDY_HOME", Path.home() /
 * ".dealbuddy")` in two independent places (`config.py:26-27` and
 * `session.py:36`), reading it once when the stores are constructed. Node adds
 * two wrinkles: it never expands `~` itself, and dsh's working directory is not
 * the shell's, so a relative value must be anchored explicitly.
 */

/** Sessions live one directory below the data root. */
export const SESSIONS_DIRNAME = 'sessions'

/** The config file holding `current_session_id`. */
export const CONFIG_FILENAME = 'config.json'

/**
 * Resolve the effective data directory.
 * @param configured - the plugin's `dataDir` setting; empty means "unset".
 * @param env - the environment to read `DEALBUDDY_HOME` from.
 * @param home - the user's home directory.
 * @returns an absolute path.
 */
export function resolveDataDir(
  configured: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const raw = configured.trim() !== '' ? configured.trim() : (env['DEALBUDDY_HOME'] ?? '').trim()
  if (raw === '') return join(home, '.dealbuddy')
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw
  return isAbsolute(expanded) ? expanded : resolve(home, expanded)
}

/**
 * Reject session ids the Python store would refuse.
 *
 * Python's guard is `session_id.replace("-", "").isalnum()`
 * (`session.py:40-43`), which is Unicode-aware: `"会话1"` passes. An
 * all-hyphen id collapses to the empty string and fails, so the emptiness
 * check is load-bearing rather than defensive.
 * @param sessionId - the candidate id.
 * @returns whether the id is addressable.
 */
export function isValidSessionId(sessionId: string): boolean {
  const stripped = sessionId.replaceAll('-', '')
  return stripped.length > 0 && /^[\p{L}\p{N}]+$/u.test(stripped)
}

/**
 * Build the absolute path of one session file.
 * @param dataDir - the resolved data directory.
 * @param sessionId - the session id.
 * @returns the session file path.
 * @throws when the id would escape the sessions directory.
 */
export function sessionPath(dataDir: string, sessionId: string): string {
  if (!isValidSessionId(sessionId)) throw new Error('Invalid session id')
  return join(dataDir, SESSIONS_DIRNAME, `${sessionId}.json`)
}

/**
 * Build the absolute path of the config file.
 * @param dataDir - the resolved data directory.
 * @returns the config file path.
 */
export function configPath(dataDir: string): string {
  return join(dataDir, CONFIG_FILENAME)
}
