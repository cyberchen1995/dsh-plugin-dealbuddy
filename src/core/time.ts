/**
 * Timestamp helpers mirroring the Python workbench's on-disk and rendered forms.
 *
 * Python writes pydantic-serialised datetimes as `2026-09-08T05:03:26.980831Z`
 * (six fractional digits, or none when the microsecond field is zero), while
 * `datetime.isoformat()` — used by `reporting.py:47` for 复核时间 — renders the
 * same instant as `...980831+00:00`. `Date.prototype.toISOString()` only carries
 * milliseconds, so comparisons and any future writes must not round-trip
 * through `Date` alone.
 */

/** An instant with microsecond resolution, comparable as a pair. */
export interface Instant {
  /** Whole milliseconds since the epoch. */
  readonly epochMs: number
  /** Sub-millisecond remainder in microseconds, 0-999. */
  readonly microRemainder: number
}

const ISO_UTC =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/

/**
 * Parse an ISO-8601 timestamp written by the Python workbench.
 * @param value - the raw timestamp string.
 * @returns the instant, or `undefined` when the value is unparsable.
 */
export function parseInstant(value: string): Instant | undefined {
  const match = ISO_UTC.exec(value.trim())
  if (match === undefined || match === null) return undefined
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  const micros = (fraction ?? '').padEnd(6, '0').slice(0, 6)
  let offsetMinutes = 0
  if (zone !== undefined && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const digits = zone.slice(1).replace(':', '')
    offsetMinutes =
      sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)))
  }
  const epochMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(micros.slice(0, 3)),
    ) -
    offsetMinutes * 60_000
  if (Number.isNaN(epochMs)) return undefined
  return { epochMs, microRemainder: Number(micros.slice(3, 6)) }
}

/**
 * Order two timestamps ascending, tolerating unparsable values by sorting them
 * last while preserving their relative input order.
 * @param left - first raw timestamp.
 * @param right - second raw timestamp.
 * @returns a negative, zero, or positive comparator result.
 */
export function compareTimestamps(left: string, right: string): number {
  const a = parseInstant(left)
  const b = parseInstant(right)
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  if (a.epochMs !== b.epochMs) return a.epochMs - b.epochMs
  return a.microRemainder - b.microRemainder
}
