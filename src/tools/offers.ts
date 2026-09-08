import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import { nowIso } from '../core/clock.js'
import { writeVerifiedOffer, type StringMap } from '../core/domain.js'
import { captureToVerifiedOffer, CONFIDENCES, PLATFORMS } from '../core/capture.js'
import { offerNodes, rebuildReport, removeOffer, upsertOffer } from '../core/session.js'
import type { JsonObject } from '../store/json.js'
import { refineSession } from '../core/refine.js'
import type { SessionStore } from '../store/session-store.js'
import { toPlain, writeSummary } from './shared.js'

/**
 * Tools that change a session's products or requirements.
 */

/**
 * Build `dealbuddy_add_offer`.
 * @param store - the session store.
 * @returns the tool definition.
 */
export function addOfferTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_add_offer',
    description:
      'Record one product in a session from facts the user already supplied. Prefer the browser extension: it reads the real detail page. Use this only when the user has given you the fields directly. Re-adding the same URL replaces the earlier record.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session to add to.' },
      offer: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: 'The product facts, as read from the page.',
        properties: {
          platform: { type: 'string', required: true, enum: PLATFORMS },
          url: { type: 'string', required: true, description: 'Product URL; it is the identity.' },
          title: { type: 'string', required: true },
          visible_price: {
            type: 'string',
            description: 'Price as shown on the page; the first number in it is parsed.',
          },
          store_name: { type: 'string' },
          sku_id: { type: 'string' },
          sku_text: { type: 'string', description: 'The selected SKU, e.g. 65英寸 / 黑色 / 单机.' },
          specs: {
            type: 'object',
            additionalProperties: true,
            description: 'Specification pairs read from the page.',
          },
          ocr_text: { type: 'string', description: 'Text recognised from detail images.' },
          confidence: { type: 'string', enum: CONFIDENCES },
        },
      },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderWrite(value) }] },
    async execute(args) {
      const raw = args.offer as Record<string, unknown>
      const specs: StringMap = new Map()
      const rawSpecs = raw['specs']
      if (rawSpecs !== null && typeof rawSpecs === 'object') {
        for (const [key, value] of Object.entries(rawSpecs as Record<string, unknown>)) {
          if (typeof value === 'string') specs.set(key, value)
        }
      }
      const url = String(raw['url']).trim()
      const offer = captureToVerifiedOffer(
        {
          platform: String(raw['platform']),
          url,
          title: String(raw['title']),
          visible_price: asOptionalString(raw['visible_price']),
          store_name: asOptionalString(raw['store_name']),
          sku_id: asOptionalString(raw['sku_id']),
          sku_text: asOptionalString(raw['sku_text']),
          selected_sku_text: null,
          specs,
          ocr_text: asOptionalString(raw['ocr_text']),
          confidence: asOptionalString(raw['confidence']) ?? 'medium',
        },
        nowIso(),
      )
      return store.update(args.session_id, (session) => {
        upsertOffer(session, url, writeVerifiedOffer(offer))
        rebuildReport(session)
        return { ...writeSummary(session, args.session_id), added_url: url }
      })
    },
  })
}

/**
 * Build `dealbuddy_remove_offer`.
 * @param store - the session store.
 * @returns the tool definition.
 */
export function removeOfferTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_remove_offer',
    description:
      'Remove one product from a session by its URL, then rebuild the report. The URL is the identity, so a product captured twice has one record.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session to remove from.' },
      url: { type: 'string', required: true, description: 'The product URL to remove.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderWrite(value) }] },
    async execute(args) {
      return store.update(args.session_id, (session) => {
        const removed = removeOffer(session, args.url)
        if (removed.length === 0) throw new Error('该商品已不在当前会话中')
        rebuildReport(session)
        return {
          ...writeSummary(session, args.session_id),
          removed_offer: toPlain(removed[0] as JsonObject),
        }
      })
    },
  })
}

/**
 * Build `dealbuddy_refine_requirements`.
 * @param store - the session store.
 * @returns the tool definition.
 */
export function refineRequirementsTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_refine_requirements',
    description:
      'DESTRUCTIVE: updating the requirements clears every captured product and the report in that session, because the products were gathered under the old requirements. Tell the user exactly what will be lost and get their agreement before calling this. Changing the category also resets the requirement version to 1.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session to refine.' },
      changes: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: 'Only the fields being changed. Omitted fields keep their stored values.',
        properties: {
          category: { type: 'string', description: 'A new category resets everything else.' },
          raw_request: { type: 'string' },
          budget_min: { type: 'string' },
          budget_max: { type: 'string' },
          use_cases: { type: 'array', items: { type: 'string' } },
          must_have: {
            type: 'object',
            additionalProperties: true,
            description: 'Hard requirements; an offer missing one is rejected outright.',
          },
          preferences: { type: 'object', additionalProperties: true },
          exclusions: { type: 'array', items: { type: 'string' } },
          brands: { type: 'array', items: { type: 'string' } },
          after_sales: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderRefine(value) }] },
    async execute(args) {
      const changes = toChangeMap(args.changes as Record<string, unknown>)
      return store.update(args.session_id, (session) => {
        const before = offerNodes(session).length
        const outcome = refineSession(session, changes)
        return {
          session: toPlain(session),
          cleared_offers: before,
          cleared_report: outcome.clearedReport,
          category_changed: outcome.categoryChanged,
          phase: outcome.phase,
        }
      })
    },
  })
}

/**
 * Build `dealbuddy_get_report`.
 * @param store - the session store.
 * @returns the tool definition.
 */
export function getReportTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_get_report',
    description:
      'Read a session\'s Markdown report. It is a digest with four slots plus rejects, not the full candidate list, so use dealbuddy_show_session when the user asks about their options.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The session to read.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session_id: { type: 'string', required: true },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            value.report === ''
              ? `Session ${value.session_id} has no report yet; capture some products first.`
              : value.report,
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const session = await store.load(args.session_id)
      if (session === undefined) throw new Error(`Unknown session: ${args.session_id}`)
      const report = session.get('report_markdown')
      return { session_id: args.session_id, report: typeof report === 'string' ? report : '' }
    },
  })
}

/**
 * Convert a tool's change object into the map the merger expects.
 * @param changes - the raw change object.
 * @returns an ordered map of changes.
 */
function toChangeMap(changes: Record<string, unknown>): Map<string, unknown> {
  const result = new Map<string, unknown>()
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue
    if (
      (key === 'must_have' || key === 'preferences') &&
      value !== null &&
      typeof value === 'object'
    ) {
      result.set(key, new Map(Object.entries(value as Record<string, unknown>)))
      continue
    }
    result.set(key, value)
  }
  return result
}

/**
 * Read an optional string field.
 * @param value - the raw value.
 * @returns the string, or null.
 */
function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Render a write result.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
function renderWrite(value: unknown): string {
  const record = value as {
    session_id: string
    verified_count: number
    report_available: boolean
    added_url?: string
    removed_offer?: Record<string, unknown>
  }
  const lines: string[] = []
  if (record.added_url !== undefined) lines.push(`Recorded ${record.added_url}.`)
  if (record.removed_offer !== undefined) {
    lines.push(`Removed 「${String(record.removed_offer['title'])}」.`)
  }
  lines.push(
    `Session ${record.session_id} now holds ${record.verified_count} product(s); report ${record.report_available ? 'rebuilt' : 'cleared'}.`,
  )
  return lines.join('\n')
}

/**
 * Render a refinement result, leading with what was destroyed.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
function renderRefine(value: unknown): string {
  const record = value as {
    session: Record<string, unknown>
    cleared_offers: number
    cleared_report: boolean
    category_changed: boolean
    phase: string
  }
  const requirements = record.session['requirements'] as Record<string, unknown>
  const lines = [
    `Requirements updated to v${String(requirements['version'])} for 「${String(requirements['category'])}」.`,
  ]
  if (record.cleared_offers > 0 || record.cleared_report) {
    lines.push(
      `Cleared ${record.cleared_offers} captured product(s)${record.cleared_report ? ' and the report' : ''}. They have to be captured again.`,
    )
  }
  if (record.category_changed) lines.push('The category changed, so the requirement version reset to 1.')
  return lines.join('\n')
}
