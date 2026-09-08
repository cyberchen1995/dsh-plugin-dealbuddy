import type { StringMap, VerifiedOffer } from './domain.js'

/**
 * Capture ingestion, ported from `intake.py`.
 *
 * Intake never computes a discount: `estimated_payable` is set to the parsed
 * visible price (`intake.py:68-69`). The coupon arithmetic in `price.py` has no
 * runtime caller and is deliberately not ported.
 */

/** The eleven payload keys the workbench accepts (`intake.py:18-29`). */
export interface CapturePayload {
  platform: string
  url: string
  title: string
  visible_price?: string | null
  store_name?: string | null
  sku_id?: string | null
  sku_text?: string | null
  selected_sku_text?: string | null
  specs?: StringMap
  ocr_text?: string | null
  confidence?: string
}

/** Platforms the workbench accepts; anything else is a validation error. */
export const PLATFORMS = ['taobao', 'tmall', 'jd'] as const

/** Confidence levels (`models.py:21-24`). */
export const CONFIDENCES = ['high', 'medium', 'low'] as const

/**
 * Parse the first numeric run out of a price string (`intake.py:40-51`).
 *
 * Python's `\d` matches every Unicode decimal digit, so `￥４５９９.００` parses;
 * JavaScript's `\d` is ASCII-only, hence `\p{Nd}`. The matched run is then
 * NFKC-folded because `Decimal("４５９９")` normalises the digits, and only the
 * run is folded so a value Python's `\d` would reject — a circled digit, say —
 * is not smuggled in.
 * @param value - the raw price text.
 * @returns the serialised decimal, or null when no number is present.
 */
export function parseVisiblePrice(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const match = /\p{Nd}+(?:\.\p{Nd}+)?/u.exec(value.replaceAll(',', ''))
  if (match === null) return null
  const normalised = match[0].normalize('NFKC')
  if (!/^\d+(?:\.\d+)?$/.test(normalised)) return null
  return normaliseDecimalString(normalised)
}

/**
 * Convert a capture payload into a verified offer (`intake.py:54-72`).
 * @param capture - the validated payload.
 * @param verifiedAt - the capture time to stamp.
 * @returns the offer record.
 */
export function captureToVerifiedOffer(
  capture: CapturePayload,
  verifiedAt: string,
): VerifiedOffer {
  const visiblePrice = parseVisiblePrice(capture.visible_price)
  const parameters: StringMap = new Map()
  if (isNonEmpty(capture.sku_id)) parameters.set('sku_id', capture.sku_id)
  if (isNonEmpty(capture.ocr_text)) parameters.set('ocr_text', capture.ocr_text)
  const sku = isNonEmpty(capture.sku_text)
    ? capture.sku_text
    : isNonEmpty(capture.selected_sku_text)
      ? capture.selected_sku_text
      : null
  return {
    platform: capture.platform,
    title: capture.title.trim(),
    url: capture.url.trim(),
    store_name: capture.store_name ?? null,
    brand: null,
    model: null,
    specs: new Map(capture.specs ?? []),
    sku,
    listed_price: null,
    visible_price: visiblePrice,
    coupon: null,
    estimated_payable: visiblePrice,
    conditions: [],
    stock: null,
    parameters,
    llm_summary: null,
    verified_at: verifiedAt,
    confidence: capture.confidence ?? 'medium',
  }
}

/**
 * Normalise a decimal string the way `Decimal(...)` round-trips it.
 *
 * `Decimal("4599.00")` keeps its scale, so the string is already canonical
 * once the digits are ASCII; only a leading-zero form needs trimming.
 * @param value - the ASCII digit run.
 * @returns the canonical serialised decimal.
 */
function normaliseDecimalString(value: string): string {
  if (!value.includes('.')) {
    const trimmed = value.replace(/^0+(?=\d)/u, '')
    return trimmed === '' ? '0' : trimmed
  }
  const [whole = '', fraction = ''] = value.split('.')
  const trimmedWhole = whole.replace(/^0+(?=\d)/u, '')
  return `${trimmedWhole === '' ? '0' : trimmedWhole}.${fraction}`
}

/**
 * Test Python truthiness for an optional string field.
 * @param value - the value to test.
 * @returns whether Python would treat it as truthy.
 */
function isNonEmpty(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== ''
}
