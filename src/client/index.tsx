import { DEALBUDDY_SETTINGS_NAMESPACE, type DealbuddySettings } from '../settings.js'
import { DealbuddyCard } from './settings-card.js'
import type { ClientContextLike, SessionsServiceLike, SettingsScopeLike } from './scope.js'
import { WorkbenchDrawer } from './workbench/Drawer.js'
import { WorkbenchTrigger } from './workbench/FooterAction.js'
import { WorkbenchBadge } from './workbench/HeaderBadge.js'
import { WorkbenchStore } from './workbench/store.js'
import { ensureWorkbenchStyles } from './workbench/styles.js'

/**
 * Browser half of the plugin: the settings card, and the workbench panel.
 *
 * The panel is two slot entries over one store — a sidebar button that opens
 * it and a drawer in the shell's overlay layer that shows it. Both slots are
 * root-scoped, so switching dsh conversations leaves the panel as it was.
 */

/** Browser services this half requires before it mounts. */
export const inject = ['slots', 'settingsScope', 'connection', 'sessions'] as const

/**
 * Register the card and the panel.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: unknown): void {
  // The slot, scope and connection generics reach across several harness
  // packages; the shape this plugin uses is declared in ./scope.ts and
  // asserted once here.
  const client = ctx as ClientContextLike
  const scope: SettingsScopeLike<DealbuddySettings> = client.settingsScope.bind({
    namespace: DEALBUDDY_SETTINGS_NAMESPACE,
  })

  client.slots.inject('settings.plugin.item', () =>
    client.slots.register(
      { name: 'settings.plugin.item', key: DEALBUDDY_SETTINGS_NAMESPACE },
      () => DealbuddyCard({ scope }),
    ),
  )

  const sessions = client.get('sessions') as SessionsServiceLike | undefined
  const store = new WorkbenchStore(client, sessions)

  client.slots.inject('sidebar.footer.action', () =>
    client.slots.register(
      { name: 'sidebar.footer.action', id: 'dealbuddy-workbench', order: 40 },
      (props: { wide?: boolean }) => WorkbenchTrigger({ store, ...props }),
    ),
  )

  client.slots.inject('shell.overlay', () =>
    client.slots.register({ name: 'shell.overlay', id: 'dealbuddy-workbench' }, () =>
      WorkbenchDrawer({ store }),
    ),
  )

  // Session-scoped, so the badge names the conversation it is rendered in.
  client.slots.inject('conversation.session.header.actions', () =>
    client.slots.register(
      { name: 'conversation.session.header.actions', id: 'dealbuddy-workbench', order: 60 },
      (props: { sessionId?: string }) => WorkbenchBadge({ store, ...props }),
    ),
  )

  // A reconnect means the Host may have restarted under us; re-read rather
  // than keep showing a session list from before.
  client.effect(() => {
    const removeStyles = ensureWorkbenchStyles()
    const off = client.on('connection/reset', () => {
      store.resume()
    })
    // The harness publishes no "conversation changed" event, so the selection
    // is read from its own list snapshot; the callback fires for every list
    // mutation, and the store ignores the ones that do not move the selection.
    const publish = (): void => {
      const snapshot = sessions?.list.getSnapshot()
      if (snapshot === undefined) return
      const titles: Record<string, string> = {}
      for (const id of snapshot.ids) {
        const row = snapshot.byId[id]
        titles[id] = row?.displayTitle ?? row?.title ?? id
      }
      const current = snapshot.current
      store.setConversation(
        current === undefined ? null : { id: current, title: titles[current] ?? current },
        titles,
      )
    }
    publish()
    const offSessions = sessions?.list.subscribe(publish)
    return () => {
      offSessions?.()
      off()
      store.dispose()
      removeStyles()
    }
  })
}
