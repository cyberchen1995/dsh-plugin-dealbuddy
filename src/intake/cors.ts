/**
 * The CORS and Private Network Access policy the Chrome extension depends on.
 *
 * Ported line by line from `web.py:932-993`. Two details are load-bearing:
 * `Access-Control-Allow-Private-Network` is what lets an https shop page reach
 * a loopback address at all, and the whole `chrome-extension:` scheme is
 * trusted — the workbench keeps no allowlist of extension ids.
 */

/** Hosts always treated as the local machine (`web.py:39`). */
const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Shop domains allowed to deliver captures (`web.py:44`). */
export const ALLOWED_ECOMMERCE_DOMAINS = ['taobao.com', 'tmall.com', 'jd.com'] as const

/**
 * Decide whether an Origin may be echoed back.
 * @param origin - the request's Origin header, if any.
 * @param extraDomains - additional host suffixes from configuration.
 * @returns the origin to echo, or undefined when it is not allowed.
 */
export function allowedCorsOrigin(
  origin: string | undefined,
  extraDomains: readonly string[] = [],
): string | undefined {
  // Python's `if not origin` also rejects the empty string.
  if (origin === undefined || origin === '') return undefined
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return undefined
  }
  if (parsed.protocol === 'chrome-extension:') return origin
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const host = parsed.hostname.toLowerCase()
  if (LOCALHOST_HOSTS.has(host)) return origin
  const domains = [...ALLOWED_ECOMMERCE_DOMAINS, ...extraDomains]
  if (domains.some((domain) => hostMatchesDomain(host, domain))) return origin
  return undefined
}

/**
 * Build the response headers for an allowed origin.
 * @param origin - the request's Origin header, if any.
 * @param extraDomains - additional host suffixes from configuration.
 * @returns the headers; empty when the origin is not allowed.
 */
export function corsHeaders(
  origin: string | undefined,
  extraDomains: readonly string[] = [],
): Record<string, string> {
  const allowed = allowedCorsOrigin(origin, extraDomains)
  if (allowed === undefined) return {}
  return {
    'Access-Control-Allow-Origin': allowed,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
  }
}

/**
 * Match a host against a domain, anchored at a dot (`web.py:935-936`).
 *
 * The anchor is why `eviltaobao.com` is refused while `item.taobao.com` is not.
 * @param host - the lowercased request host.
 * @param domain - the allowed domain.
 * @returns whether the host belongs to the domain.
 */
function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}
