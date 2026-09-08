import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import { initialRequirements } from '../core/requirements.js'
import { newSession } from '../core/session.js'
import { writeRequirements } from '../core/refine.js'
import { nowIso } from '../core/clock.js'
import { parseJson, stringifyJson, type JsonObject } from '../store/json.js'
import { SessionStore } from '../store/session-store.js'
import { dropMessages, toPlain, truncateOcrText } from './shared.js'

/**
 * Session lifecycle tools: create, show, and point captures at a session.
 */

/**
 * Build `dealbuddy_create_session`.
 * @param store - the session store.
 * @returns the tool definition.
 */
export function createSessionTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_create_session',
    description:
      'Start a DealBuddy shopping-research session and make it the target for browser-extension captures. The free-text request is mined for a budget, a screen size and use cases; everything else is refined later.',
    parameters: {
      category: {
        type: 'string',
        required: true,
        description: 'Product category, e.g. 电视 or 电饭煲.',
      },
      request: {
        type: 'string',
        description: "The user's request in their own words; budget and size are extracted from it.",
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: renderCreated(value) }],
    },
    async execute(args) {
      const sessionId = SessionStore.newSessionId()
      const requirements = initialRequirements(args.category, args.request ?? '')
      const now = nowIso()
      const session = newSession(sessionId, writeRequirements(requirements), now)
      await store.create(sessionId, session)
      await store.setCurrentSessionId(sessionId)
      return {
        session: toPlain(session),
        current_session_id: sessionId,
      }
    },
  })
}

/**
 * Build `dealbuddy_show_session`.
 * @param store - the session store.
 * @param ocrPreviewChars - reads the default OCR preview length.
 * @returns the tool definition.
 */
export function showSessionTool(
  store: SessionStore,
  ocrPreviewChars: () => number,
): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_show_session',
    description:
      'Show one session with every captured product. Use this rather than the report when explaining the options: the report only has four slots, so a product that meets the requirements without being the best or the cheapest never appears in it. Recognised detail-image text is shortened by default.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session to show.' },
      include_ocr_text: {
        type: 'boolean',
        description: 'Keep the full recognised detail-image text instead of a preview.',
      },
      include_messages: {
        type: 'boolean',
        description: 'Include the stored follow-up message log, which is usually not needed.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: renderSession(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const session = await store.load(args.session_id)
      if (session === undefined) throw new Error(`Unknown session: ${args.session_id}`)
      // Work on a copy so the view's truncation never reaches the file.
      const view = parseJson(stringifyJson(session)) as JsonObject
      const includeOcr = args.include_ocr_text === true
      const truncated = truncateOcrText(view, ocrPreviewChars(), includeOcr)
      const droppedMessages = args.include_messages === true ? 0 : dropMessages(view)
      return {
        session: toPlain(view),
        ocr_text_shortened_offers: truncated,
        omitted_messages: droppedMessages,
      }
    },
  })
}

/**
 * Build `dealbuddy_set_current_session`.
 * @param store - the session store.
 * @returns the tool definition.
 */
export function setCurrentSessionTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_set_current_session',
    description:
      'Point browser-extension captures at an existing session. Captures always land in the current session; the extension never names one.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session to make current.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          current_session_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Captures now land in session ${value.current_session_id}.` },
      ],
    },
    async execute(args) {
      const session = await store.load(args.session_id)
      if (session === undefined) throw new Error(`Unknown session: ${args.session_id}`)
      await store.setCurrentSessionId(args.session_id)
      return { current_session_id: args.session_id }
    },
  })
}

/**
 * Render the result of creating a session.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
function renderCreated(value: unknown): string {
  const record = value as { current_session_id: string; session: Record<string, unknown> }
  const requirements = record.session['requirements'] as Record<string, unknown>
  const lines = [
    `Created session ${record.current_session_id} for 「${String(requirements['category'])}」; captures now land here.`,
  ]
  if (requirements['budget_max'] !== null) lines.push(`Budget ceiling: ${String(requirements['budget_max'])}`)
  const mustHave = requirements['must_have'] as Record<string, string>
  const entries = Object.entries(mustHave)
  if (entries.length > 0) {
    lines.push(`Hard requirements: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }
  const useCases = requirements['use_cases'] as string[]
  if (useCases.length > 0) lines.push(`Use cases: ${useCases.join('、')}`)
  lines.push('Next: have the user capture products from real detail pages in the browser.')
  return lines.join('\n')
}

/**
 * Render a session view as a compact product table.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
function renderSession(value: unknown): string {
  const record = value as {
    session: Record<string, unknown>
    ocr_text_shortened_offers: number
    omitted_messages: number
  }
  const session = record.session
  const requirements = session['requirements'] as Record<string, unknown>
  const offers = (session['verified_offers'] ?? []) as Record<string, unknown>[]
  const lines = [
    `Session ${String(session['session_id'])} · 「${String(requirements['category'])}」 · requirements v${String(requirements['version'])} · phase ${String(session['phase'])}`,
    `Request: ${String(requirements['raw_request']) || '(none recorded)'}`,
    `Products: ${offers.length} · report available: ${session['report_markdown'] === null ? 'no' : 'yes'}`,
  ]
  if (offers.length > 0) {
    lines.push('', '| # | title | platform | store | visible price | estimated payable | SKU | confidence |')
    lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- |')
    offers.forEach((offer, index) => {
      lines.push(
        `| ${index + 1} | [${String(offer['title'])}](${String(offer['url'])}) | ${String(offer['platform'])} | ${String(offer['store_name'] ?? '')} | ${String(offer['visible_price'] ?? '')} | ${String(offer['estimated_payable'] ?? '')} | ${String(offer['sku'] ?? '')} | ${String(offer['confidence'])} |`,
      )
    })
  }
  if (record.ocr_text_shortened_offers > 0) {
    lines.push(
      '',
      `Recognised detail-image text was shortened for ${record.ocr_text_shortened_offers} product(s); pass include_ocr_text to read it in full.`,
    )
  }
  if (record.omitted_messages > 0) {
    lines.push(`${record.omitted_messages} stored message(s) omitted; pass include_messages to see them.`)
  }
  lines.push(
    '',
    '「估算应付」is an estimate from what the page showed. It is not a settlement price.',
  )
  return lines.join('\n')
}
