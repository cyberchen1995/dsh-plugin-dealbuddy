import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { startIntakeServer } from '../../src/intake/server.js'
import { doctorTool } from '../../src/tools/doctor.js'
import { createSessionTool } from '../../src/tools/sessions.js'
import { SessionStore } from '../../src/store/session-store.js'

let dataDir: string
let store: SessionStore
const closers: (() => Promise<void>)[] = []

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
 * Read one named check from a doctor result.
 * @param result - the doctor result.
 * @param name - the check name.
 * @returns the check record.
 */
function check(result: Record<string, unknown>, name: string): { ok: boolean; detail: string } {
  const checks = result['checks'] as { name: string; ok: boolean; detail: string }[]
  const found = checks.find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`no check named ${name}`)
  return found
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-doctor-'))
  await mkdir(join(dataDir, 'sessions'), { recursive: true })
  store = new SessionStore(dataDir)
})

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

describe('dealbuddy_doctor', () => {
  it('names the missing piece when nothing is set up yet', async () => {
    const result = await run(doctorTool(store, 59999), {})
    expect(result['all_ok']).toBe(false)
    expect(check(result, 'data directory').ok).toBe(true)
    expect(check(result, 'capture target').detail).toContain('no sessions yet')
    expect(check(result, 'capture listener').ok).toBe(false)
  })

  it('passes once a session exists and the listener answers', async () => {
    await run(createSessionTool(store), { category: '电视', request: '' })
    const started = await startIntakeServer(store, {
      port: 0,
      legacyOffersRoute: true,
      extraAllowedDomains: [],
    })
    closers.push(started.close)

    const result = await run(doctorTool(store, started.port), {})
    expect(result['all_ok']).toBe(true)
    expect(check(result, 'capture listener').detail).toContain('answers preflight correctly')
    expect(result['intake_url']).toBe(`http://127.0.0.1:${started.port}/api/current/offers`)
  })

  it('reports a dangling current-session pointer', async () => {
    await run(createSessionTool(store), { category: '电视', request: '' })
    await store.setCurrentSessionId('ffffffffffff')
    const result = await run(doctorTool(store, 59999), {})
    expect(check(result, 'capture target').ok).toBe(false)
    expect(check(result, 'capture target').detail).toContain('has no file')
  })
})
