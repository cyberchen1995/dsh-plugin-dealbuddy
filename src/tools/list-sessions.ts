import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { SessionSummary } from '../core/models.js'
import type { SessionStore } from '../store/session-store.js'

/**
 * Build the `dealbuddy_list_sessions` tool.
 *
 * The Python MCP tool of the same name returns whole sessions including every
 * offer and the full report — 17.7 KB for two small sessions in the R0
 * measurement — so this returns a summary instead and leaves the detail to
 * `dealbuddy_show_session`.
 * @param store - the read-only session store.
 * @returns the registrable tool definition.
 */
export function listSessionsTool(store: SessionStore): ToolDefinition {
  return defineTool({
    name: 'dealbuddy_list_sessions',
    description:
      'List local DealBuddy shopping-research sessions as compact summaries, oldest first, and report which one browser-extension captures currently land in. Returns no offer or report bodies.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          current_session_id: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Session that extension captures are delivered into, or null when unset.',
            required: true,
          },
          data_dir: {
            type: 'string',
            description: 'Data directory the summaries were read from.',
            required: true,
          },
          sessions: {
            type: 'array',
            description: 'Session summaries ordered by updated_at ascending.',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                session_id: { type: 'string', required: true },
                category: { type: 'string', required: true },
                raw_request: { type: 'string', required: true },
                version: { type: 'integer', required: true },
                phase: { type: 'string', required: true },
                verified_count: { type: 'integer', required: true },
                report_available: { type: 'boolean', required: true },
                created_at: { type: 'string', required: true },
                updated_at: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSummaries(value) }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const [sessions, currentSessionId] = await Promise.all([
        store.listSummaries(),
        store.currentSessionId(),
      ])
      return {
        current_session_id: currentSessionId ?? null,
        data_dir: store.dataDir,
        sessions,
      }
    },
  })
}

/**
 * Render summaries as a compact table for the model.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
function renderSummaries(value: {
  current_session_id: string | null
  data_dir: string
  sessions: readonly SessionSummary[]
}): string {
  if (value.sessions.length === 0) {
    return `No DealBuddy sessions in ${value.data_dir}.`
  }
  const lines = [
    `${value.sessions.length} session(s) in ${value.data_dir}.`,
    `Current session for extension captures: ${value.current_session_id ?? 'none'}`,
    '',
    '| session_id | category | offers | report | version | phase | updated_at |',
    '| --- | --- | ---: | --- | ---: | --- | --- |',
  ]
  for (const session of value.sessions) {
    const marker = session.session_id === value.current_session_id ? ' (current)' : ''
    lines.push(
      `| ${session.session_id}${marker} | ${session.category} | ${session.verified_count} | ${session.report_available ? 'yes' : 'no'} | v${session.version} | ${session.phase} | ${session.updated_at} |`,
    )
  }
  return lines.join('\n')
}
