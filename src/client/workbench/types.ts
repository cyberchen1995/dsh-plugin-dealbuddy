/**
 * The shapes the panel reads out of a session view.
 *
 * The Host returns the stored document as-is, so every field is optional and
 * loosely typed on purpose: a session written by an older DealBuddy, or by the
 * Python workbench, must still render.
 */

/** One captured product. */
export interface OfferView {
  platform?: unknown
  title?: unknown
  url?: unknown
  store_name?: unknown
  brand?: unknown
  model?: unknown
  specs?: unknown
  sku?: unknown
  listed_price?: unknown
  visible_price?: unknown
  coupon?: unknown
  estimated_payable?: unknown
  conditions?: unknown
  stock?: unknown
  parameters?: unknown
  llm_summary?: unknown
  verified_at?: unknown
  confidence?: unknown
}

/** One session document as the panel reads it. */
export interface SessionView {
  session_id?: unknown
  requirements?: { category?: unknown; raw_request?: unknown; version?: unknown }
  phase?: unknown
  verified_offers?: unknown
  report_markdown?: unknown
  updated_at?: unknown
}

/** One row of the session rail. */
export interface SessionSummaryView {
  session_id: string
  category: string
  raw_request: string
  version: number
  phase: string
  verified_count: number
  report_available: boolean
  created_at: string
  updated_at: string
}

/** What the panel shows about the capture path. */
export interface WorkbenchStatusView {
  data_dir: string
  intake_url: string
  listening: boolean
  reason?: string
}

/**
 * Read a session's offers, skipping anything that is not one.
 *
 * The Host hands the stored document through as it found it, so a hand-edited
 * or older file can carry a null or a scalar where an offer belongs. The Host's
 * own helpers skip those nodes; the panel has to as well, or one bad entry
 * takes the whole workbench down while the list is being rendered.
 * @param session - the session view, or null.
 * @returns the offers, or an empty list.
 */
export function offersOf(session: SessionView | null): OfferView[] {
  const offers = session?.verified_offers
  if (!Array.isArray(offers)) return []
  return offers.filter(
    (offer): offer is OfferView =>
      typeof offer === 'object' && offer !== null && !Array.isArray(offer),
  )
}
