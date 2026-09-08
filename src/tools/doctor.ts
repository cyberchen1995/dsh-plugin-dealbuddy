import { access, constants, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import { SESSIONS_DIRNAME } from '../store/paths.js'
import type { SessionStore } from '../store/session-store.js'

/**
 * A self-check for the half-installed state.
 *
 * Installing the plugin is not enough to make DealBuddy work: the user still
 * has to load the capture extension in their browser and point it at this
 * listener's port. That gap is invisible from inside dsh, so this tool reports
 * what it can actually observe and says plainly what it cannot.
 */

/** One checked condition. */
interface Check {
  name: string
  ok: boolean
  detail: string
}

/**
 * Build `dealbuddy_doctor`.
 * @param store - the session store.
 * @param port - the configured intake port.
 * @returns the tool definition.
 */
export function doctorTool(store: SessionStore, port: number): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_doctor',
    description:
      'Check the DealBuddy setup: whether the data directory is writable, whether the capture listener answers, and whether a session is ready to receive captures. Use it when a capture does not arrive.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: render(value) }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const checks: Check[] = []

      checks.push(await checkDataDir(store.dataDir))
      checks.push(await checkSessions(store))
      checks.push(await checkListener(port, exec.signal))

      return {
        data_dir: store.dataDir,
        intake_url: `http://127.0.0.1:${port}/api/current/offers`,
        checks: checks.map((check) => ({ ...check })),
        all_ok: checks.every((check) => check.ok),
      }
    },
  })
}

/**
 * Check that the data directory exists and accepts writes.
 * @param dataDir - the resolved data directory.
 * @returns the check result.
 */
async function checkDataDir(dataDir: string): Promise<Check> {
  const sessions = join(dataDir, SESSIONS_DIRNAME)
  try {
    await mkdir(sessions, { recursive: true })
    await access(sessions, constants.W_OK)
    const probe = join(sessions, '.dealbuddy-doctor-probe')
    await writeFile(probe, '', 'utf8')
    await rm(probe, { force: true })
    return { name: 'data directory', ok: true, detail: `${dataDir} exists and is writable` }
  } catch (error) {
    return {
      name: 'data directory',
      ok: false,
      detail: `${dataDir} is not writable: ${String(error)}`,
    }
  }
}

/**
 * Check that a session is ready to receive captures.
 * @param store - the session store.
 * @returns the check result.
 */
async function checkSessions(store: SessionStore): Promise<Check> {
  try {
    const sessions = await store.listSummaries()
    const current = await store.currentSessionId()
    if (sessions.length === 0) {
      return {
        name: 'capture target',
        ok: false,
        detail: 'no sessions yet — create one with dealbuddy_create_session before capturing',
      }
    }
    if (current === undefined) {
      return {
        name: 'capture target',
        ok: false,
        detail: `${sessions.length} session(s) exist but none is current; captures would be refused with 404`,
      }
    }
    const known = sessions.some((session) => session.session_id === current)
    if (!known) {
      return {
        name: 'capture target',
        ok: false,
        detail: `the current session ${current} has no file; captures would be refused`,
      }
    }
    return { name: 'capture target', ok: true, detail: `captures land in session ${current}` }
  } catch (error) {
    return { name: 'capture target', ok: false, detail: `cannot read sessions: ${String(error)}` }
  }
}

/**
 * Check that the intake listener answers a preflight the way the extension needs.
 * @param port - the configured port.
 * @param signal - the tool's cancellation signal.
 * @returns the check result.
 */
async function checkListener(port: number, signal: AbortSignal): Promise<Check> {
  const url = `http://127.0.0.1:${port}/api/current/offers`
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://item.jd.com' },
      signal,
    })
    const pna = response.headers.get('access-control-allow-private-network')
    if (response.status !== 204) {
      return { name: 'capture listener', ok: false, detail: `${url} answered ${response.status}` }
    }
    if (pna !== 'true') {
      // Chrome refuses a shop page's request to a loopback address without it.
      return {
        name: 'capture listener',
        ok: false,
        detail: 'preflight is missing Access-Control-Allow-Private-Network',
      }
    }
    return { name: 'capture listener', ok: true, detail: `${url} answers preflight correctly` }
  } catch (error) {
    return {
      name: 'capture listener',
      ok: false,
      detail: `${url} is unreachable: ${String(error)}`,
    }
  }
}

/**
 * Render the checks, ending with what cannot be checked from here.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
function render(value: unknown): string {
  const record = value as {
    data_dir: string
    intake_url: string
    checks: Check[]
    all_ok: boolean
  }
  const lines = record.checks.map((check) => `${check.ok ? 'ok' : 'FAIL'}  ${check.name}: ${check.detail}`)
  lines.push('')
  lines.push(
    'Not checkable from here: whether the capture extension is loaded in the browser, ' +
      `and whether its delivery address points at ${record.intake_url}. ` +
      'If everything above passes and captures still do not arrive, have the user check the extension popup.',
  )
  return lines.join('\n')
}
