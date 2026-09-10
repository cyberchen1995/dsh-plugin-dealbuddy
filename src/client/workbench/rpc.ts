import type { ClientContextLike } from '../scope.js'

/**
 * The panel's half of the `dealbuddy` Remote namespace.
 *
 * Without the Typert generator the Host resolves these endpoints from the
 * method source, so the argument object's keys have to be the Host method's
 * parameter names exactly: an extra key is refused outright.
 */

/** A failure carried back from the Host. */
export class RpcFailure extends Error {
  /**
   * @param code - the stable failure code.
   * @param message - the Host's own message.
   */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RpcFailure'
  }
}

/**
 * Call one workbench endpoint.
 * @param ctx - the browser plugin context.
 * @param method - the method name inside the `dealbuddy` namespace.
 * @param args - arguments keyed by the Host method's parameter names.
 * @param signal - optional cancellation.
 * @returns the endpoint's value.
 * @throws RpcFailure when the Host refused the call.
 */
export async function callWorkbench<T>(
  ctx: ClientContextLike,
  method: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const result = await ctx.connection.rpc.call(
    '/api',
    `dealbuddy/${method}`,
    { args },
    signal,
  )
  if (result.ok) return result.value as T
  throw new RpcFailure(result.error.code, result.error.message)
}

/**
 * Turn a failure into something worth showing a person.
 * @param error - the caught value.
 * @returns the message to display.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof RpcFailure) {
    if (error.code === 'dealbuddy/session-not-found') return '这个会话的文件已经不在了。'
    if (error.code === 'dealbuddy/offer-not-found') return error.message
    if (error.code === 'gateway/invocation-unavailable' || error.code === 'gateway/service-unavailable') {
      return '工作台接口没有加载，重启 dsh 后再试。'
    }
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}
