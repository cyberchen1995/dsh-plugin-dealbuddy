import { describe, expect, it } from 'vitest'

import { compareTimestamps, parseInstant } from '../../src/core/time.js'

describe('parseInstant', () => {
  it('parses the six-digit UTC form Python writes to disk', () => {
    expect(parseInstant('2026-09-08T05:03:26.980831Z')).toEqual({
      epochMs: Date.UTC(2026, 8, 8, 5, 3, 26, 980),
      microRemainder: 831,
    })
  })

  it('parses the offset form isoformat() renders into reports', () => {
    expect(parseInstant('2026-09-08T05:03:26.980831+00:00')).toEqual({
      epochMs: Date.UTC(2026, 8, 8, 5, 3, 26, 980),
      microRemainder: 831,
    })
  })

  it('parses a whole second, which Python writes without a fraction', () => {
    expect(parseInstant('2026-09-08T05:03:26Z')).toEqual({
      epochMs: Date.UTC(2026, 8, 8, 5, 3, 26, 0),
      microRemainder: 0,
    })
  })

  it('returns undefined for unparsable input', () => {
    expect(parseInstant('not a timestamp')).toBeUndefined()
  })
})

describe('compareTimestamps', () => {
  it('orders below the millisecond, where a Date round-trip loses information', () => {
    expect(
      compareTimestamps('2026-09-08T05:03:26.980831Z', '2026-09-08T05:03:26.980002Z'),
    ).toBeGreaterThan(0)
  })

  it('treats the Z and +00:00 spellings of one instant as equal', () => {
    expect(
      compareTimestamps('2026-09-08T05:03:26.980831Z', '2026-09-08T05:03:26.980831+00:00'),
    ).toBe(0)
  })

  it('does not fall for a lexicographic compare of differing fraction widths', () => {
    // "…789Z" > "…789000Z" as strings, but they are the same instant.
    expect(compareTimestamps('2026-09-08T05:03:26.789Z', '2026-09-08T05:03:26.789000Z')).toBe(0)
  })

  it('sorts unparsable values last', () => {
    expect(compareTimestamps('nope', '2026-09-08T05:03:26.980831Z')).toBeGreaterThan(0)
  })
})
