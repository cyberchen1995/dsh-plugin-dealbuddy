import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { parseJson, stringifyJson, type JsonObject, type JsonValue } from '../store/json.js'
import type { SessionStore } from '../store/session-store.js'
import { corsHeaders } from './cors.js'
import { ingestCapture, IntakeError, validateCapture } from './handler.js'

/**
 * The loopback listener the Chrome extension delivers captures to.
 *
 * The extension is fixed: one POST with `Content-Type: application/json`, no
 * retry, no timeout, and success only when the response is 2xx *and* its body
 * says `status: "ok"` (`content-script.js:1404-1422`). Everything here exists
 * to keep that contract intact without changing a line of the extension.
 */

/** How the listener is configured. */
export interface IntakeOptions {
  /** Listener port; the extension defaults to 8765. */
  port: number
  /** Whether the legacy `POST /offers` alias stays mounted. */
  legacyOffersRoute: boolean
  /** Extra host suffixes accepted by the CORS allowlist. */
  extraAllowedDomains: readonly string[]
}

/** The primary intake route (`web.py:1035`). */
const INTAKE_PATH = '/api/current/offers'

/** The legacy alias kept for older extension settings (`web.py:1050`). */
const LEGACY_INTAKE_PATH = '/offers'

/** Refuse bodies large enough to be a mistake rather than a capture. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/**
 * Start the intake listener on the loopback interface.
 *
 * The host is deliberately not configurable: binding anywhere else would put a
 * writable endpoint on the network.
 * @param store - the session store to ingest into.
 * @param options - the listener configuration.
 * @returns the listening server and a disposer that waits for it to close.
 * @throws when the port cannot be bound.
 */
export async function startIntakeServer(
  store: SessionStore,
  options: IntakeOptions,
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handleRequest(store, options, request, response).catch(() => {
      if (!response.headersSent) {
        respond(response, 500, new Map([['detail', 'Internal error']]), {})
      } else {
        response.end()
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening)
      reject(describeListenError(error, options.port))
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(options.port, '127.0.0.1')
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

/**
 * Route one request.
 * @param store - the session store.
 * @param options - the listener configuration.
 * @param request - the incoming request.
 * @param response - the response to write.
 */
async function handleRequest(
  store: SessionStore,
  options: IntakeOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const origin = header(request, 'origin')
  const headers = corsHeaders(origin, options.extraAllowedDomains)

  // Preflight is answered for any path, before routing (`web.py:986-988`).
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers)
    response.end()
    return
  }

  const path = (request.url ?? '').split('?')[0] ?? ''
  const isIntake =
    path === INTAKE_PATH || (options.legacyOffersRoute && path === LEGACY_INTAKE_PATH)

  if (!isIntake) {
    respond(response, 404, detail('Not Found'), headers)
    return
  }
  if (request.method !== 'POST') {
    respond(response, 405, detail('Method Not Allowed'), headers)
    return
  }

  let body: JsonValue
  try {
    body = parseJson(await readBody(request))
  } catch (error) {
    respond(response, 422, detail(`Invalid JSON body: ${String(error)}`), headers)
    return
  }

  try {
    const capture = validateCapture(body)
    const sessionId = await store.currentSessionId()
    if (sessionId === undefined) {
      // Same message the workbench returns, so existing guidance still applies.
      respond(response, 404, detail('No current DealBuddy session'), headers)
      return
    }
    const result = await ingestCapture(store, sessionId, capture)
    respond(response, 200, toNode(result), headers)
  } catch (error) {
    if (error instanceof IntakeError) {
      respond(response, error.status, detail(error.detail), headers)
      return
    }
    throw error
  }
}

/**
 * Read the whole request body as text.
 * @param request - the incoming request.
 * @returns the body text.
 * @throws when the body exceeds the size cap.
 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Write one JSON response.
 * @param response - the response to write.
 * @param status - the status code.
 * @param body - the body node.
 * @param headers - the CORS headers to merge in.
 */
function respond(
  response: ServerResponse,
  status: number,
  body: JsonObject,
  headers: Record<string, string>,
): void {
  const text = stringifyJson(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  })
  response.end(text)
}

/**
 * Wrap a value in FastAPI's `detail` envelope.
 * @param value - the detail value.
 * @returns the body node.
 */
function detail(value: JsonValue): JsonObject {
  return new Map([['detail', value]])
}

/**
 * Convert the success result into an ordered node.
 * @param result - the intake result.
 * @returns the body node.
 */
function toNode(result: {
  status: 'ok'
  session_id: string
  verified_count: number
  report_available: boolean
}): JsonObject {
  const node: JsonObject = new Map()
  node.set('status', result.status)
  node.set('session_id', result.session_id)
  node.set('verified_count', result.verified_count)
  node.set('report_available', result.report_available)
  return node
}

/**
 * Read one request header.
 * @param request - the incoming request.
 * @param name - the lowercase header name.
 * @returns the header value, or undefined when absent.
 */
function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Turn a listen failure into an actionable message.
 * @param error - the raised error.
 * @param port - the port that was requested.
 * @returns the error to reject with.
 */
function describeListenError(error: NodeJS.ErrnoException, port: number): Error {
  if (error.code === 'EADDRINUSE') {
    return new Error(
      `DealBuddy intake cannot bind 127.0.0.1:${port} — the port is already in use. ` +
        'Stop the process holding it (a running `dealbuddy web` workbench, most likely), ' +
        `or set the plugin's \`port\` config to a free port and change the capture ` +
        "extension's delivery address to match.",
      { cause: error },
    )
  }
  return new Error(`DealBuddy intake cannot bind 127.0.0.1:${port}: ${error.message}`, {
    cause: error,
  })
}
