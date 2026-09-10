import { useSyncExternalStore } from 'react'

import { text } from './format.js'
import type { WorkbenchStore } from './store.js'

/**
 * The shopping session a conversation is about, next to its title.
 *
 * Session-scoped, so it renders for the conversation it is attached to rather
 * than for whatever the drawer happens to be showing — which is what makes it
 * usable as a label while you move between conversations.
 * @param props - the panel's store and the conversation this entry belongs to.
 * @returns the badge, or nothing when this conversation has no session.
 */
export function WorkbenchBadge(props: {
  store: WorkbenchStore
  sessionId?: string
}): JSX.Element | null {
  const { store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const conversationId = props.sessionId
  if (conversationId === undefined) return null
  const binding = state.bindings.find((entry) => entry.dsh_session_id === conversationId)
  if (binding === undefined) return null
  const summary = state.sessions.find((entry) => entry.session_id === binding.session_id)
  const category = text(summary?.category, '未命名')

  return (
    <button
      className="db-wb-badge"
      type="button"
      title={`DealBuddy · ${category} · ${binding.session_id}`}
      onClick={() => {
        store.toggle()
      }}
    >
      {category}
    </button>
  )
}
