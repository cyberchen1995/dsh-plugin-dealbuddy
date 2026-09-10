import { useRef, useSyncExternalStore } from 'react'

import type { WorkbenchStore } from './store.js'

/**
 * The sidebar's DealBuddy button.
 *
 * The sidebar tells its footer entries whether it is wide; collapsed, the
 * button keeps only its dot and its accessible name.
 * @param props - the store and the sidebar's own width state.
 * @returns the trigger.
 */
export function WorkbenchTrigger(props: { store: WorkbenchStore; wide?: boolean }): JSX.Element {
  const { store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const ref = useRef<HTMLButtonElement | null>(null)

  return (
    <button
      className="db-wb-trigger"
      type="button"
      title="DealBuddy 工作台"
      aria-label="DealBuddy 工作台"
      aria-pressed={state.open}
      ref={(element) => {
        ref.current = element
        store.setTrigger(element)
      }}
      onClick={() => {
        store.toggle()
      }}
    >
      <span className="db-wb-trigger-dot" aria-hidden />
      {props.wide === false ? null : <span>DealBuddy</span>}
    </button>
  )
}
