/**
 * Timestamps in the shape the Python workbench writes.
 *
 * pydantic renders a UTC datetime with six fractional digits and a `Z` suffix,
 * but drops the fraction entirely when the microsecond field is zero. Matching
 * both forms matters because either implementation may rewrite a file the
 * other wrote, and a spurious `.000000` would change its bytes.
 *
 * JavaScript only has millisecond resolution, so the last three digits of a
 * timestamp written here are always zeros.
 */

/**
 * Render an instant in the on-disk format.
 * @param now - the instant to render; defaults to the current time.
 * @returns a timestamp such as `2026-09-08T05:03:26.980000Z`, or
 *   `2026-09-08T05:03:26Z` on a whole second.
 */
export function nowIso(now: Date = new Date()): string {
  const iso = now.toISOString()
  const milliseconds = iso.slice(-4, -1)
  if (milliseconds === '000') return `${iso.slice(0, -5)}Z`
  return `${iso.slice(0, -1)}000Z`
}
