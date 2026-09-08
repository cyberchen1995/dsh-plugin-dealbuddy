import { Decimal } from 'decimal.js'

/**
 * Decimal helpers matching CPython's default arithmetic context.
 *
 * Prices travel as strings end to end, because the scale is user-visible:
 * `reporting.py:27` interpolates the `Decimal` straight into the report, so
 * `4599.00` must not become `4599`. Arithmetic still has to be exact before the
 * conversion to float — `ranking.py:49-53` subtracts and divides `Decimal`s and
 * only then calls `float()` — so a plain JavaScript number would drift.
 *
 * CPython's default context is 28 significant digits with ROUND_HALF_EVEN.
 */
const Ctx = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN })

/**
 * Parse a stored decimal string.
 * @param value - the serialised decimal, or null/undefined.
 * @returns the decimal, or `undefined` when there is no value.
 * @throws when a present value is not a decimal.
 */
export function toDecimal(value: string | null | undefined): Decimal | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = new Ctx(value)
  if (!parsed.isFinite()) throw new Error(`not a decimal: ${value}`)
  return parsed
}

/**
 * Test Python truthiness for an optional price.
 *
 * `Decimal("0")` is falsy, which is what makes `price or offer.visible_price`
 * fall through to the visible price (`ranking.py:115-120`).
 * @param value - the serialised decimal.
 * @returns whether Python would treat the value as truthy.
 */
export function isTruthyDecimal(value: string | null | undefined): boolean {
  const parsed = toDecimal(value)
  return parsed !== undefined && !parsed.isZero()
}

/**
 * Compare two serialised decimals.
 * @param left - the left value.
 * @param right - the right value.
 * @returns a negative, zero, or positive comparator result.
 */
export function compareDecimals(left: string, right: string): number {
  return new Ctx(left).comparedTo(new Ctx(right))
}

/**
 * Compute `float((left - right) / right)` exactly as Python does.
 * @param left - the dividend's left operand.
 * @param right - the subtrahend and divisor.
 * @returns the ratio as a double.
 */
export function excessRatio(left: string, right: string): number {
  return new Ctx(left).minus(new Ctx(right)).dividedBy(new Ctx(right)).toNumber()
}

/**
 * Compute `float(left / right)` exactly as Python does.
 * @param left - the dividend.
 * @param right - the divisor.
 * @returns the ratio as a double.
 */
export function ratio(left: string, right: string): number {
  return new Ctx(left).dividedBy(new Ctx(right)).toNumber()
}

/**
 * Convert a serialised decimal to a double.
 * @param value - the serialised decimal.
 * @returns the double value.
 */
export function decimalToNumber(value: string): number {
  return new Ctx(value).toNumber()
}

/**
 * Round half to even at two decimal places, matching Python's `round(x, 2)`.
 *
 * `toFixed` rounds an exact binary tie away from zero, and `Math.round(x * 100)`
 * misreports common values such as `1.115`, so neither works on its own.
 * @param value - the value to round.
 * @returns the rounded value.
 */
export function roundHalfEven2(value: number): number {
  if (!Number.isFinite(value)) return value
  const scaled = value * 8
  if (Number.isInteger(scaled) && !Number.isInteger(value * 4)) {
    // An exact binary tie at the hundredths place: resolve it toward even.
    const floor = Math.floor(value * 100)
    const chosen = floor % 2 === 0 ? floor : floor + 1
    return chosen / 100
  }
  return Number(value.toFixed(2))
}

/**
 * Format a float the way Python's `f"{x:.2f}"` does.
 * @param value - the value to format.
 * @returns the formatted string.
 */
export function formatFixed2(value: number): string {
  const rounded = roundHalfEven2(value)
  return rounded.toFixed(2)
}
