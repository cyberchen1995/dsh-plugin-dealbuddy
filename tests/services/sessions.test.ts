import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { captureToVerifiedOffer } from '../../src/core/capture.js'
import { writeVerifiedOffer } from '../../src/core/domain.js'
import { rebuildReport, upsertOffer } from '../../src/core/session.js'
import {
  OfferNotFoundError,
  createSession,
  getReport,
  listSessions,
  removeOfferByUrl,
  setCurrentSession,
  showSession,
} from '../../src/services/sessions.js'
import { SessionNotFoundError, SessionStore } from '../../src/store/session-store.js'

/**
 * The session operations the tools and the workbench panel share.
 *
 * Both faces call exactly these functions, so a behaviour asserted here holds
 * for a model calling `dealbuddy_remove_offer` and for a person pressing 删除
 * in the panel.
 */

let store: SessionStore

beforeEach(async () => {
  store = new SessionStore(await mkdtemp(join(tmpdir(), 'dealbuddy-services-')))
})

/**
 * Put one captured product into a session.
 * @param sessionId - the session to add to.
 * @param url - the product URL.
 * @param price - the price the page showed.
 */
async function addOffer(sessionId: string, url: string, price: string): Promise<void> {
  const offer = captureToVerifiedOffer(
    {
      platform: 'taobao',
      url,
      title: `示例商品 ${url}`,
      visible_price: price,
      store_name: '示例店铺',
      sku_id: null,
      sku_text: null,
      selected_sku_text: null,
      specs: new Map(),
      ocr_text: null,
      confidence: 'high',
    },
    '2026-01-01T00:00:00Z',
  )
  await store.update(sessionId, (session) => {
    upsertOffer(session, url, writeVerifiedOffer(offer))
    rebuildReport(session)
  })
}

describe('session services', () => {
  it('creates a session and points captures at it', async () => {
    const created = await createSession(store, '电视', '预算5000以内')

    expect(await store.currentSessionId()).toBe(created.current_session_id)
    const listed = await listSessions(store)
    expect(listed.current_session_id).toBe(created.current_session_id)
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0]?.category).toBe('电视')
  })

  it('refuses to point captures at a session with no file', async () => {
    await expect(setCurrentSession(store, 'ffffffffffff')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    )
    expect(await store.currentSessionId()).toBeUndefined()
  })

  it('keeps the full recognised text when the caller asks for it', async () => {
    const created = await createSession(store, '电视', '')
    const sessionId = created.current_session_id
    const longText = 'あ'.repeat(900)
    const offer = captureToVerifiedOffer(
      {
        platform: 'taobao',
        url: 'https://item.taobao.com/item.htm?id=1',
        title: '示例电视',
        visible_price: '4599.00',
        store_name: null,
        sku_id: null,
        sku_text: null,
        selected_sku_text: null,
        specs: new Map(),
        ocr_text: longText,
        confidence: 'high',
      },
      '2026-01-01T00:00:00Z',
    )
    await store.update(sessionId, (session) => {
      upsertOffer(session, 'https://item.taobao.com/item.htm?id=1', writeVerifiedOffer(offer))
      rebuildReport(session)
    })

    const shortened = await showSession(store, sessionId, {
      includeOcrText: false,
      includeMessages: false,
      ocrPreviewChars: 100,
    })
    const full = await showSession(store, sessionId, {
      includeOcrText: true,
      includeMessages: false,
      ocrPreviewChars: 100,
    })

    expect(shortened.ocr_text_shortened_offers).toBe(1)
    expect(full.ocr_text_shortened_offers).toBe(0)
    expect(ocrTextOf(full)).toHaveLength(900)
    expect(ocrTextOf(shortened)).toHaveLength(100)
  })

  it('removes a product by URL and rebuilds the report', async () => {
    const created = await createSession(store, '电视', '预算5000以内')
    const sessionId = created.current_session_id
    await addOffer(sessionId, 'https://item.taobao.com/item.htm?id=1', '4599.00')
    await addOffer(sessionId, 'https://item.taobao.com/item.htm?id=2', '3999.00')

    const removed = await removeOfferByUrl(store, sessionId, 'https://item.taobao.com/item.htm?id=1')

    expect(removed.verified_count).toBe(1)
    expect(removed.report_available).toBe(true)
    const report = await getReport(store, sessionId)
    expect(report.report).not.toContain('id=1')
    expect(report.report).toContain('id=2')
  })

  it('clears the report when the last product is removed', async () => {
    const created = await createSession(store, '电视', '')
    const sessionId = created.current_session_id
    await addOffer(sessionId, 'https://item.taobao.com/item.htm?id=1', '4599.00')

    const removed = await removeOfferByUrl(store, sessionId, 'https://item.taobao.com/item.htm?id=1')

    expect(removed.verified_count).toBe(0)
    expect(removed.report_available).toBe(false)
    expect((await getReport(store, sessionId)).report).toBe('')
  })

  it('reports a URL that matches no product', async () => {
    const created = await createSession(store, '电视', '')
    await expect(
      removeOfferByUrl(store, created.current_session_id, 'https://example.com/nope'),
    ).rejects.toBeInstanceOf(OfferNotFoundError)
  })

  it('reports a session that has no file', async () => {
    await expect(
      showSession(store, 'ffffffffffff', {
        includeOcrText: true,
        includeMessages: false,
        ocrPreviewChars: 0,
      }),
    ).rejects.toBeInstanceOf(SessionNotFoundError)
    await expect(getReport(store, 'ffffffffffff')).rejects.toBeInstanceOf(SessionNotFoundError)
  })
})

/**
 * Read the first offer's recognised text out of a session view.
 * @param view - the view returned by showSession.
 * @returns the text.
 */
function ocrTextOf(view: { session: unknown }): string {
  const session = view.session as { verified_offers: { parameters: { ocr_text?: string } }[] }
  return session.verified_offers[0]?.parameters.ocr_text ?? ''
}
