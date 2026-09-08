import { DEALBUDDY_SETTINGS_NAMESPACE, type DealbuddySettings } from '../settings.js'
import { DealbuddyCard } from './settings-card.js'
import type { ClientContextLike, SettingsScopeLike } from './scope.js'

/**
 * Browser half of the plugin: the DealBuddy card in Settings → Plugins.
 *
 * The card is keyed on the settings namespace the Host half registers, which
 * is what lets a plugin distributed outside the harness repository contribute
 * a card at all: the tab pairs the two without learning what the namespace
 * means.
 */

/** Browser services this half requires before it mounts. */
export const inject = ['slots', 'settingsScope'] as const

/**
 * Register the card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: unknown): void {
  // The slot and scope generics reach across several harness packages; the
  // shape this plugin uses is declared in ./scope.ts and asserted once here.
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
}
