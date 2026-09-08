import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startIntakeServer } from '../../src/intake/server.js'
import { parseJson, type JsonObject } from '../../src/store/json.js'
import { SessionStore } from '../../src/store/session-store.js'

/**
 * The wire contract the unmodified Chrome extension depends on.
 *
 * Every assertion here mirrors the FastAPI workbench: `web.py:932-993` for the
 * CORS and Private Network Access headers, `web.py:1035-1052` for the routes,
 * and `intake.py:18-89` for validation and the upsert.
 */

let dataDir: string
let close: () => Promise<void>
let baseUrl: string

/** A capture body shaped like the extension's first delivery. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: 'jd',
    url: 'https://item.jd.com/100000000001.html',
    title: '示例牌 DB-65A 65英寸 电视（自拟样例）',
    visible_price: '¥4,599.00',
    store_name: '示例牌京东自营旗舰店',
    sku_id: '60870229',
    sku_text: '65英寸 / 曜石黑 / 单机',
    selected_sku_text: '65英寸 / 曜石黑 / 单机',
    specs: { 屏幕尺寸: '65英寸' },
    ocr_text: '',
    confidence: 'medium',
    // Extension-only keys the workbench ignores rather than rejects.
    image_url: 'https://example.invalid/a.jpg',
    gallery_image_urls: ['https://example.invalid/b.jpg'],
    detail_text: '详情文本',
    ocr_status: 'not_started',
    ocr_items: [],
    captured_at: '2026-09-08T05:00:00.000Z',
    warnings: [],
    ...overrides,
  }
}

/**
 * Post a capture body the way the content script does.
 * @param body - the JSON body.
 * @param origin - the Origin header to send, if any.
 * @param path - the route to post to.
 * @returns the response and its parsed body.
 */
async function post(
  body: unknown,
  origin?: string,
  path = '/api/current/offers',
): Promise<{ response: Response; json: JsonObject }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (origin !== undefined) headers['Origin'] = origin
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { response, json: text === '' ? new Map() : (parseJson(text) as JsonObject) }
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dealbuddy-intake-'))
  await mkdir(join(dataDir, 'sessions'), { recursive: true })
  const store = new SessionStore(dataDir)
  const started = await startIntakeServer(store, {
    port: 0,
    legacyOffersRoute: true,
    extraAllowedDomains: [],
  })
  close = started.close
  baseUrl = `http://127.0.0.1:${started.port}`
})

afterEach(async () => {
  await close()
})

/**
 * Seed one session and make it current.
 * @param sessionId - the session id to create.
 */
async function seedCurrentSession(sessionId = 'aaaaaaaaaaaa'): Promise<void> {
  const session = {
    session_id: sessionId,
    requirements: {
      category: '电视',
      raw_request: '预算 5000 以内，65 英寸',
      version: 1,
      budget_min: null,
      budget_max: '5000',
      use_cases: [],
      must_have: { screen_size: '65英寸' },
      preferences: {},
      exclusions: [],
      brands: [],
      after_sales: [],
    },
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
  }
  await writeFile(
    join(dataDir, 'sessions', `${sessionId}.json`),
    JSON.stringify(session, null, 2),
    'utf8',
  )
  await writeFile(
    join(dataDir, 'config.json'),
    JSON.stringify({ current_session_id: sessionId, llm: { enabled: false, api_key: 'secret' } }, null, 2),
    'utf8',
  )
}

describe('CORS and Private Network Access', () => {
  it('answers preflight from a shop page with all five headers', async () => {
    const response = await fetch(`${baseUrl}/api/current/offers`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://item.jd.com', 'Access-Control-Request-Method': 'POST' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://item.jd.com')
    expect(response.headers.get('vary')).toBe('Origin')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type')
    // Without this header Chrome blocks the request outright.
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('answers preflight on an unknown path too, before routing', async () => {
    const response = await fetch(`${baseUrl}/nope`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://detail.tmall.com' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://detail.tmall.com')
  })

  it('trusts the whole chrome-extension scheme', async () => {
    await seedCurrentSession()
    const { response } = await post(payload(), 'chrome-extension://abcdefghijklmnop')
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'chrome-extension://abcdefghijklmnop',
    )
  })

  it('echoes a subdomain of an allowed shop but refuses a lookalike', async () => {
    await seedCurrentSession()
    const allowed = await post(payload(), 'https://detail.tmall.com')
    expect(allowed.response.headers.get('access-control-allow-origin')).toBe(
      'https://detail.tmall.com',
    )
    const refused = await post(payload(), 'https://eviltaobao.com')
    expect(refused.response.headers.get('access-control-allow-origin')).toBeNull()
    // The request still succeeds; only the headers are withheld.
    expect(refused.response.status).toBe(200)
  })

  it('adds no headers when the Origin is absent', async () => {
    await seedCurrentSession()
    const { response } = await post(payload())
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('keeps the headers on an error response', async () => {
    const { response } = await post(payload(), 'https://item.jd.com')
    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
  })
})

describe('capture ingestion', () => {
  it('returns the exact body the content script checks for', async () => {
    await seedCurrentSession()
    const { response, json } = await post(payload(), 'https://item.jd.com')
    expect(response.status).toBe(200)
    // The extension treats anything but `status === "ok"` as a failure.
    expect(json.get('status')).toBe('ok')
    expect(json.get('session_id')).toBe('aaaaaaaaaaaa')
    expect(json.get('verified_count')).toBe(1)
    expect(json.get('report_available')).toBe(true)
  })

  it('accepts the legacy /offers alias', async () => {
    await seedCurrentSession()
    const { response, json } = await post(payload(), undefined, '/offers')
    expect(response.status).toBe(200)
    expect(json.get('status')).toBe('ok')
  })

  it('answers 404 with the workbench wording when no session is current', async () => {
    const { response, json } = await post(payload())
    expect(response.status).toBe(404)
    expect(json.get('detail')).toBe('No current DealBuddy session')
  })

  it('rejects an unsupported platform', async () => {
    await seedCurrentSession()
    const { response } = await post(payload({ platform: 'unknown' }))
    expect(response.status).toBe(422)
  })

  it('rejects a blank title or url', async () => {
    await seedCurrentSession()
    expect((await post(payload({ title: '   ' }))).response.status).toBe(422)
    expect((await post(payload({ url: '' }))).response.status).toBe(422)
  })

  it('upserts the second delivery by url and moves it to the end', async () => {
    await seedCurrentSession()
    const other = payload({
      url: 'https://item.jd.com/100000000002.html',
      title: '另一台电视（自拟样例）',
    })
    await post(payload())
    await post(other)
    // The OCR stage re-posts the same url with the text filled in.
    const { json } = await post(payload({ ocr_text: '自拟 OCR 文本', confidence: 'high' }))
    expect(json.get('verified_count')).toBe(2)

    const session = parseJson(
      await readFile(join(dataDir, 'sessions', 'aaaaaaaaaaaa.json'), 'utf8'),
    ) as JsonObject
    const offers = session.get('verified_offers') as JsonObject[]
    expect(offers.map((offer) => offer.get('url'))).toEqual([
      'https://item.jd.com/100000000002.html',
      'https://item.jd.com/100000000001.html',
    ])
    const parameters = offers[1]?.get('parameters') as JsonObject
    expect(parameters.get('ocr_text')).toBe('自拟 OCR 文本')
  })

  it('accepts the OCR-failure delivery the extension fires and forgets', async () => {
    await seedCurrentSession()
    const { response, json } = await post(payload({ ocr_status: 'failed' }))
    expect(response.status).toBe(200)
    expect(json.get('status')).toBe('ok')
  })

  it('does not lose a capture when two deliveries race', async () => {
    await seedCurrentSession()
    const bodies = Array.from({ length: 8 }, (_, index) =>
      payload({
        url: `https://item.jd.com/10000000000${index}.html`,
        title: `并发样例 ${index}`,
      }),
    )
    const results = await Promise.all(bodies.map((body) => post(body)))
    expect(results.every((r) => r.response.status === 200)).toBe(true)

    const session = parseJson(
      await readFile(join(dataDir, 'sessions', 'aaaaaaaaaaaa.json'), 'utf8'),
    ) as JsonObject
    expect((session.get('verified_offers') as JsonObject[]).length).toBe(8)
  })

  it('leaves config.json and its llm block untouched', async () => {
    await seedCurrentSession()
    const before = await readFile(join(dataDir, 'config.json'), 'utf8')
    await post(payload())
    expect(await readFile(join(dataDir, 'config.json'), 'utf8')).toBe(before)
  })

  it('rejects other methods and unknown paths', async () => {
    const notFound = await fetch(`${baseUrl}/whatever`, { method: 'POST' })
    expect(notFound.status).toBe(404)
    const wrongMethod = await fetch(`${baseUrl}/api/current/offers`, { method: 'GET' })
    expect(wrongMethod.status).toBe(405)
  })
})

describe('listener lifecycle', () => {
  it('reports an occupied port with an actionable message', async () => {
    const store = new SessionStore(dataDir)
    const first = await startIntakeServer(store, {
      port: 0,
      legacyOffersRoute: true,
      extraAllowedDomains: [],
    })
    await expect(
      startIntakeServer(store, {
        port: first.port,
        legacyOffersRoute: true,
        extraAllowedDomains: [],
      }),
    ).rejects.toThrow(/already in use/u)
    await first.close()
  })

  it('frees the port on close', async () => {
    const store = new SessionStore(dataDir)
    const first = await startIntakeServer(store, {
      port: 0,
      legacyOffersRoute: true,
      extraAllowedDomains: [],
    })
    const port = first.port
    await first.close()
    const second = await startIntakeServer(store, {
      port,
      legacyOffersRoute: true,
      extraAllowedDomains: [],
    })
    expect(second.port).toBe(port)
    await second.close()
  })
})
