import type { Context } from '@deepseek-ai/cordis'

import { Config } from './config.js'
import { registerSkill } from './skill.js'
import { resolveDataDir } from './store/paths.js'
import { SessionStore } from './store/session-store.js'
import { listSessionsTool } from './tools/list-sessions.js'

export const name = 'dealbuddy'

/** The tool registry is required; the skill registry is optional (see below). */
export const inject = ['tools'] as const

export { Config }
export type { Config as ConfigType } from './config.js'

/**
 * Mount the DealBuddy plugin.
 *
 * Skills are registered from a child fiber so a deployment without the `skills`
 * service still gets the tools: cordis 4 has no optional-injection syntax, and
 * a top-level `inject: ['tools', 'skills']` would hold the whole plugin back.
 * @param ctx - the plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const dataDir = resolveDataDir(config.dataDir)
  const store = new SessionStore(dataDir)

  ctx.tools.register(listSessionsTool(store))

  ctx.plugin({
    name: 'dealbuddy-skill',
    inject: ['skills'],
    apply(skillCtx: Context) {
      void registerSkill(skillCtx).catch((error: unknown) => {
        skillCtx.logger('dealbuddy').warn('skill registration failed: %s', String(error))
      })
    },
  })

  ctx.logger('dealbuddy').info('DealBuddy tools ready (data dir: %s)', dataDir)
}
