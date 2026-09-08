import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
// Type-only import: pulls in the declaration merge that adds `ctx.settings`.
import type {} from '@deepseek-ai/dsh-settings'

import type { Config } from './config.js'

/**
 * The user-editable settings namespace behind the plugin's configuration card.
 *
 * The composition entry in `cordis.patch.yml` stays the base layer, so a
 * deployment that mounts no settings provider keeps working exactly as before.
 * When a provider is present its user layer sits on top, which is what makes
 * the browser card able to write a port without editing YAML by hand.
 */

/** The namespace both halves key on. */
export const DEALBUDDY_SETTINGS_NAMESPACE = 'dealbuddy'

/** The settings section; a subset of the composition entry. */
export interface DealbuddySettings {
  port: number
  dataDir: string
  extraAllowedDomains: string[]
  ocrTextPreviewChars: number
  legacyOffersRoute: boolean
}

export const DEALBUDDY_SETTINGS_SCHEMA: Schema<DealbuddySettings> = Schema.object({
  port: Schema.number()
    .min(1)
    .max(65535)
    .default(8765)
    .description('采集入库监听端口。与 dealbuddy web 并存时改成别的端口，并同步修改扩展弹窗的投递地址。'),
  dataDir: Schema.string()
    .default('')
    .description('数据目录。留空则取 $DEALBUDDY_HOME，再退回 ~/.dealbuddy。'),
  extraAllowedDomains: Schema.array(Schema.string().pattern(/^[a-z0-9.-]+$/))
    .default([])
    .description('在淘宝、天猫、京东之外额外允许投递的主机后缀。'),
  ocrTextPreviewChars: Schema.number()
    .min(0)
    .max(20000)
    .default(400)
    .description('查看会话时保留的详情图识别文本长度。'),
  legacyOffersRoute: Schema.boolean()
    .default(true)
    .description('是否保留 POST /offers 这个旧投递地址。'),
})

/**
 * Register the namespace and keep the plugin following it.
 *
 * A port or data-directory change has to rebind a socket and re-open a store,
 * so `onChange` is what actually applies it; the namespace is declared `live`
 * because the plugin does that work itself rather than asking for a restart.
 * @param ctx - a context whose `settings` service is ready.
 * @param config - the composition entry, used as the base layer.
 * @param onChange - invoked with the resolved settings after each commit.
 * @returns the resolved settings at registration time.
 */
export function registerSettings(
  ctx: Context,
  config: Config,
  onChange: (next: DealbuddySettings, prev: DealbuddySettings) => void | Promise<void>,
): DealbuddySettings {
  const scope = ctx.settings.register(DEALBUDDY_SETTINGS_NAMESPACE, DEALBUDDY_SETTINGS_SCHEMA, {
    base: {
      port: config.port,
      dataDir: config.dataDir,
      extraAllowedDomains: config.extraAllowedDomains,
      ocrTextPreviewChars: config.ocrTextPreviewChars,
      legacyOffersRoute: config.legacyOffersRoute,
    },
    applies: 'live',
  })
  scope.watch(onChange)
  return scope.get()
}
