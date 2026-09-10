/**
 * The narrow view this plugin needs of the browser settings scope.
 *
 * `@deepseek-ai/dsh-client-ui-settings` exports its scope types, but binding
 * one goes through a service whose generics reach across several packages.
 * Declaring only what the card actually calls keeps the plugin's contact
 * surface with a developer-preview harness small: if the wider contract moves,
 * this is the one file that has to follow.
 */

/** One namespace's snapshot as the card reads it. */
export interface SettingsSnapshot<T> {
  /** `unavailable` when the namespace is not exposed to this client. */
  status: 'loading' | 'ready' | 'unavailable'
  /** The resolved section: schema defaults, then composition, then user layer. */
  value: T | undefined
  /** The composition layer a cleared field reverts to. */
  base: unknown
  /** The raw user layer; a field's presence here is what marks it overridden. */
  user: unknown
  /** Whether the Host document accepts writes. */
  writable: boolean
}

/** The scope operations the card uses. */
export interface SettingsScopeLike<T> {
  /**
   * @returns the current snapshot; a stable reference until the next change.
   */
  getSnapshot(): SettingsSnapshot<T>
  /**
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing the listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Queue one field write, fenced by the revision the form read.
   * @param field - the field inside the namespace section.
   * @param value - the JSON-shaped value.
   * @returns settlement after the write.
   */
  set(field: string, value: unknown): Promise<void>
  /**
   * Clear one field so it re-inherits the composition layer.
   * @param field - the field inside the namespace section.
   * @returns settlement after the clear.
   */
  unset(field: string): Promise<void>
}

/** One endpoint's answer, as Connection hands it back. */
export type RpcResultLike =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One slot registration's options, across the kinds this plugin uses. */
export interface SlotRegisterOptions {
  name: string
  /** Keyed slots dispatch on this. */
  key?: string
  /** List slots identify their entry by this. */
  id?: string
  /** List position. */
  order?: number
}

/** The browser services this plugin's registrations reach for. */
export interface ClientContextLike {
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: SlotRegisterOptions, component: unknown): () => void
  }
  settingsScope: {
    bind<T>(spec: { namespace: string }): SettingsScopeLike<T>
  }
  connection: {
    rpc: {
      call(
        channel: string,
        endpoint: string,
        payload: unknown,
        signal?: AbortSignal,
      ): Promise<RpcResultLike>
    }
  }
  /**
   * @param event - the cordis event name.
   * @param listener - invoked on each occurrence.
   * @returns the disposer removing the listener.
   */
  on(event: string, listener: () => void): () => void
  /**
   * @param body - run now; its returned disposer runs when the fiber unloads.
   */
  effect(body: () => () => void): void
}
