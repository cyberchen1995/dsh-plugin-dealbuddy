import type { Context } from '@deepseek-ai/cordis'

import { Config } from './config.js'
import { startIntakeServer } from './intake/server.js'
import { registerSkill } from './skill.js'
import { resolveDataDir } from './store/paths.js'
import { SessionStore } from './store/session-store.js'
import { registerTools } from './tools/index.js'

export const name = 'dealbuddy'

/** The tool registry is required; the skill registry is optional (see below). */
export const inject = ['tools'] as const

export { Config }

/**
 * Mount the DealBuddy plugin.
 *
 * The intake listener is an external resource, so it lives inside
 * `ctx.effect()`: its disposer waits for the socket to close, which is what
 * makes an unload or a reload free the port instead of failing the next bind.
 *
 * Skills are registered from a child fiber because cordis has no optional
 * injection: a top-level `inject: ['tools', 'skills']` would hold the tools
 * back in a deployment that mounts no skill registry.
 * @param ctx - the plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const dataDir = resolveDataDir(config.dataDir)
  const store = new SessionStore(dataDir)
  const logger = ctx.logger('dealbuddy')

  registerTools(ctx, store, config.ocrTextPreviewChars, config.port)

  ctx.effect(() => {
    const starting = startIntakeServer(store, {
      port: config.port,
      legacyOffersRoute: config.legacyOffersRoute,
      extraAllowedDomains: config.extraAllowedDomains,
    })
    starting.then(
      ({ port }) => {
        logger.info(
          'capture intake listening on http://127.0.0.1:%d/api/current/offers (data dir: %s)',
          port,
          dataDir,
        )
      },
      (error: unknown) => {
        logger.error('%s', error instanceof Error ? error.message : String(error))
      },
    )
    return async () => {
      try {
        const { close } = await starting
        await close()
      } catch {
        // A listener that never started has nothing to close.
      }
    }
  })

  ctx.plugin({
    name: 'dealbuddy-skill',
    inject: ['skills'],
    apply(skillCtx: Context) {
      void registerSkill(skillCtx).catch((error: unknown) => {
        skillCtx.logger('dealbuddy').warn('skill registration failed: %s', String(error))
      })
    },
  })
}
