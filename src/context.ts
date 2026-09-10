import type { Context } from '@deepseek-ai/cordis'

import { readBoundContext } from './services/bindings.js'
import { CONTEXT_NAME, renderBindingContext } from './services/binding-text.js'
import type { BindingStore } from './store/binding-store.js'
import type { SessionStore } from './store/session-store.js'

/**
 * Tell the model, in a bound conversation, which shopping session it is about.
 *
 * A prompt context is the right shape for this rather than a system-prompt
 * section: the harness re-renders it on every assembly and materialises a fresh
 * durable snapshot only when the text actually changed, so a capture shows up
 * as one visible line in the conversation and an idle session adds nothing.
 *
 * The provider must answer synchronously, which is why the binding table is
 * consulted from memory first: a conversation with no shopping session behind
 * it does no work at all.
 */

/** Where the block sits among the other runtime-context contributions. */
const CONTEXT_ORDER = 500

/**
 * The narrow view this plugin needs of the prompt registry.
 *
 * Declared here rather than imported for the same reason `client/scope.ts`
 * declares the browser services: it keeps one more developer-preview package
 * out of the dependency list, and if the wider contract moves this is the file
 * that follows.
 */
interface SystemPromptLike {
  context(contribution: {
    name: string
    order: number
    text: (assemble: { agent?: { id: string } }) => string
  }): () => void
}

/**
 * Register the context provider.
 * @param ctx - a context whose `systemPrompt` service is ready.
 * @param sessions - the session store.
 * @param bindings - the binding store.
 */
export function registerBindingContext(
  ctx: Context,
  sessions: SessionStore,
  bindings: BindingStore,
): void {
  const systemPrompt = (ctx as unknown as { systemPrompt: SystemPromptLike }).systemPrompt
  systemPrompt.context({
    name: CONTEXT_NAME,
    order: CONTEXT_ORDER,
    text: (assemble) => {
      const agentId = assemble.agent?.id
      if (agentId === undefined) return ''
      try {
        return escapeVariables(renderBindingContext(readBoundContext(sessions, bindings, agentId)))
      } catch {
        // A prompt assembly must not fail because a session file was being
        // rewritten as it was read; the next assembly picks it up.
        return ''
      }
    },
  })
}

/**
 * Neutralise the prompt template's variable syntax.
 *
 * Context text is interpolated for `{{name}}` groups, and this block carries a
 * user's own words — a request that happens to contain braces would otherwise
 * fail the whole assembly.
 * @param text - the rendered block.
 * @returns the same text with no interpolation group left in it.
 */
function escapeVariables(text: string): string {
  return text.replaceAll('{{', '{ {')
}
