/**
 * Whether the capture listener answers the way the browser extension needs.
 *
 * Both the self-check tool and the workbench panel ask this question, and the
 * answer has one subtlety worth keeping in one place: Chrome refuses a shop
 * page's request to a loopback address unless the preflight carries
 * `Access-Control-Allow-Private-Network`, so a 204 alone is not enough.
 */

/** The probe's verdict. */
export interface IntakeProbe {
  /** Whether a capture would be accepted. */
  ok: boolean
  /** The address the extension has to be pointed at. */
  url: string
  /** Why the probe failed; absent when it succeeded. */
  reason?: string
}

/**
 * Send the extension's own preflight to the configured port.
 * @param port - the configured intake port.
 * @param signal - cancellation for the probe request.
 * @returns the verdict.
 */
export async function probeIntakeListener(
  port: number,
  signal: AbortSignal,
): Promise<IntakeProbe> {
  const url = `http://127.0.0.1:${port}/api/current/offers`
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://item.jd.com' },
      signal,
    })
    if (response.status !== 204) {
      return { ok: false, url, reason: `${url} answered ${response.status}` }
    }
    if (response.headers.get('access-control-allow-private-network') !== 'true') {
      return {
        ok: false,
        url,
        reason: 'preflight is missing Access-Control-Allow-Private-Network',
      }
    }
    return { ok: true, url }
  } catch (error) {
    return { ok: false, url, reason: `${url} is unreachable: ${String(error)}` }
  }
}
