/**
 * Text normalisation shared by the matchers.
 *
 * `matching.py:11-16` folds with NFKC and strips whitespace and separators.
 * NFKC behaves identically in JavaScript, and `\s` covers U+3000, so this one
 * ports cleanly — unlike the digit classes elsewhere, where Python's `\d`
 * matches every Unicode decimal and JavaScript's matches ASCII only.
 */

/**
 * Fold a value for comparison: NFKC, lowercase, separators removed.
 * @param value - the raw text.
 * @returns the compacted form; an empty string for a missing value.
 */
export function compact(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value.normalize('NFKC').toLowerCase().replace(/[\s_\-/]+/gu, '')
}

/**
 * Test whether two values match, in either containment direction.
 *
 * Mirrors `ranking.py:19-28`, including its falsy guard: an empty `actual`
 * never matches, even against an empty expectation.
 * @param actual - the observed value.
 * @param expected - the requirement value.
 * @returns whether the pair counts as a match.
 */
export function valueMatches(actual: string | null | undefined, expected: string): boolean {
  if (actual === null || actual === undefined || actual === '') return false
  const normalisedActual = compact(actual)
  const normalisedExpected = compact(expected)
  return (
    normalisedActual.includes(normalisedExpected) || normalisedExpected.includes(normalisedActual)
  )
}
