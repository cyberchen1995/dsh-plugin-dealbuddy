import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import {
  createSession,
  setCurrentSession,
  showSession,
} from '../services/sessions.js'
import type { BindingStore } from '../store/binding-store.js'
import type { SessionStore } from '../store/session-store.js'
import { resolveSessionId } from './shared.js'

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
      return createSession(store, args.category, args.request ?? '')
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
  bindings: BindingStore,
  ocrPreviewChars: () => number,
): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_show_session',
    description:
      'Show one session with every captured product. Use this rather than the report when explaining the options: the report only has four slots, so a product that meets the requirements without being the best or the cheapest never appears in it. Recognised detail-image text is shortened by default.',
    parameters: {
      session_id: { type: 'string', description: 'The session to show. Omit to use the shopping session bound to the current conversation.' },
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
    presentResult: (args, result) =>
      result.isError
        ? undefined
        : { card: 'generic', title: `DealBuddy 会话 ${sessionIdOf(args)}` },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sessionId = await resolveSessionId(args.session_id, exec, bindings)
      return showSession(store, sessionId, {
        includeOcrText: args.include_ocr_text === true,
        includeMessages: args.include_messages === true,
        ocrPreviewChars: ocrPreviewChars(),
      })
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
      return setCurrentSession(store, args.session_id)
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

/**
 * Read the session id out of a call's arguments for a card title.
 * @param args - the call arguments as recorded.
 * @returns the id, or a placeholder when it is not a string.
 */
export function sessionIdOf(args: unknown): string {
  const record = args as { session_id?: unknown } | null
  const id = record?.session_id
  return typeof id === 'string' ? id : '(未知)'
}
