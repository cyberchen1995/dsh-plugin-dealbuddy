import type { Context } from '@deepseek-ai/cordis'

import type { BindingStore } from '../store/binding-store.js'
import type { SessionStore } from '../store/session-store.js'
import { doctorTool } from './doctor.js'
import { listSessionsTool } from './list-sessions.js'
import { addOfferTool, getReportTool, refineRequirementsTool, removeOfferTool } from './offers.js'
import { createSessionTool, setCurrentSessionTool, showSessionTool } from './sessions.js'

/**
 * Register every DealBuddy tool.
 *
 * `ask_session` from the Python MCP surface has no counterpart: follow-up
 * questions are the conversation the tools already live in.
 * @param ctx - a context whose `tools` service is ready.
 * @param store - the session store.
 * @param store - the session store; it follows a data-directory change in place.
 * @param bindings - the conversation bindings, used when `session_id` is omitted.
 * @param ocrPreviewChars - reads how much recognised text a session view keeps.
 * @param port - reads the configured intake port, reported by the self-check.
 */
export function registerTools(
  ctx: Context,
  store: SessionStore,
  bindings: BindingStore,
  ocrPreviewChars: () => number,
  port: () => number,
): void {
  for (const tool of [
    listSessionsTool(store),
    createSessionTool(store),
    showSessionTool(store, bindings, ocrPreviewChars),
    setCurrentSessionTool(store),
    addOfferTool(store, bindings),
    removeOfferTool(store, bindings),
    refineRequirementsTool(store, bindings),
    getReportTool(store, bindings),
    doctorTool(store, port),
  ]) {
    ctx.tools.register(tool)
  }
}
