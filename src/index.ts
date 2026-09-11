import type { Context } from '@deepseek-ai/cordis'

import { Config } from './config.js'
import { startIntakeServer } from './intake/server.js'
import { registerSettings, type DealbuddySettings } from './settings.js'
import { registerSkill } from './skill.js'
import { BindingStore } from './store/binding-store.js'
import { resolveDataDir } from './store/paths.js'
import { SessionStore } from './store/session-store.js'
import { registerTools } from './tools/index.js'

export const name = 'dealbuddy'

/** The tool registry is required; skills and settings are optional (see below). */
export const inject = ['tools'] as const

export { Config }

/**
 * Mount the DealBuddy plugin.
 *
 * The intake listener is an external resource, so it lives inside
 * `ctx.effect()`: its disposer waits for the socket to close, which is what
 * makes an unload or a reload free the port instead of failing the next bind.
 *
 * Skills and settings are each mounted from a child fiber. cordis has no
 * optional-injection syntax, so a top-level `inject` naming them would hold the
 * tools back in a deployment that mounts neither.
 * @param ctx - the plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = new PluginRuntime(ctx, config)

  registerTools(
    ctx,
    runtime.store,
    runtime.bindings,
    () => runtime.settings.ocrTextPreviewChars,
    () => runtime.settings.port,
  )

  ctx.effect(() => {
    void runtime.start()
    return () => runtime.stop()
  })

  ctx.plugin({
    name: 'dealbuddy-settings',
    inject: ['settings'],
    apply(settingsCtx: Context) {
      const resolved = registerSettings(settingsCtx, config, (next, prev) =>
        runtime.reconfigure(next, prev),
      )
      void runtime.reconfigure(resolved, runtime.settings)
    },
  })

  // The workbench panel's Host endpoints. The Typert protocol package is an
  // optional peer, so it is imported only inside this fiber: a deployment
  // without it keeps the tools and the capture listener.
  ctx.plugin({
    name: 'dealbuddy-remote',
    apply(remoteCtx: Context) {
      void import('./remote.js')
        .then((module) => {
          module.registerRemote(
            remoteCtx,
            runtime.store,
            runtime.bindings,
            () => runtime.settings.port,
          )
        })
        .catch((error: unknown) => {
          remoteCtx
            .logger('dealbuddy')
            .warn('workbench panel endpoints unavailable: %s', String(error))
        })
    },
  })

  // Telling the model which shopping session a conversation is about needs the
  // prompt registry, which a headless composition may not mount.
  ctx.plugin({
    name: 'dealbuddy-context',
    inject: ['systemPrompt'],
    apply(promptCtx: Context) {
      void import('./context.js')
        .then((module) => {
          module.registerBindingContext(promptCtx, runtime.store, runtime.bindings)
        })
        .catch((error: unknown) => {
          promptCtx
            .logger('dealbuddy')
            .warn('shopping-session context unavailable: %s', String(error))
        })
    },
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

/**
 * The mutable half of the plugin: the listener and the store both have to
 * follow a settings change, and both are cheap to rebuild.
 */
class PluginRuntime {
  /** Current effective settings; starts as the composition entry. */
  settings: DealbuddySettings

  /** The store the tools hold; it follows a data-directory change in place. */
  readonly store: SessionStore

  /** Which conversation each shopping session belongs to. */
  readonly bindings: BindingStore

  private closeServer: (() => Promise<void>) | undefined
  private starting: Promise<void> = Promise.resolve()

  /**
   * @param ctx - the plugin context, used for logging.
   * @param config - the composition entry.
   */
  constructor(
    private readonly ctx: Context,
    config: Config,
  ) {
    this.settings = {
      port: config.port,
      dataDir: config.dataDir,
      extraAllowedDomains: config.extraAllowedDomains,
      ocrTextPreviewChars: config.ocrTextPreviewChars,
      legacyOffersRoute: config.legacyOffersRoute,
    }
    this.store = new SessionStore(resolveDataDir(this.settings.dataDir))
    // The store fills its table synchronously on construction: the prompt
    // provider answers synchronously and the first model request can arrive
    // before an awaited read would have settled.
    this.bindings = new BindingStore(resolveDataDir(this.settings.dataDir))
  }

  /**
   * Start the intake listener for the current settings.
   * @returns fulfillment once the listener is up or its failure is logged.
   */
  async start(): Promise<void> {
    const logger = this.ctx.logger('dealbuddy')
    const settings = this.settings
    this.starting = (async () => {
      try {
        const started = await startIntakeServer(this.store, {
          port: settings.port,
          legacyOffersRoute: settings.legacyOffersRoute,
          extraAllowedDomains: settings.extraAllowedDomains,
        })
        this.closeServer = started.close
        logger.info(
          'capture intake listening on http://127.0.0.1:%d/api/current/offers (data dir: %s)',
          started.port,
          this.store.dataDir,
        )
      } catch (error) {
        this.closeServer = undefined
        logger.error('%s', error instanceof Error ? error.message : String(error))
      }
    })()
    return this.starting
  }

  /**
   * Stop the listener, waiting for the socket to close.
   * @returns fulfillment once the port is free.
   */
  async stop(): Promise<void> {
    await this.starting.catch(() => undefined)
    const close = this.closeServer
    this.closeServer = undefined
    if (close === undefined) return
    try {
      await close()
    } catch {
      // A listener that already failed has nothing to close.
    }
  }

  /**
   * Apply a settings change, rebinding only what actually moved.
   * @param next - the new resolved settings.
   * @param prev - the settings in force until now.
   */
  async reconfigure(next: DealbuddySettings, prev: DealbuddySettings): Promise<void> {
    const dataDirMoved = resolveDataDir(next.dataDir) !== resolveDataDir(prev.dataDir)
    const listenerMoved =
      next.port !== prev.port ||
      next.legacyOffersRoute !== prev.legacyOffersRoute ||
      next.extraAllowedDomains.join(',') !== prev.extraAllowedDomains.join(',') ||
      dataDirMoved
    this.settings = next
    if (dataDirMoved) {
      this.store.useDataDir(resolveDataDir(next.dataDir))
      this.bindings.useDataDir(resolveDataDir(next.dataDir))
    }
    if (!listenerMoved) return
    await this.stop()
    await this.start()
  }
}
