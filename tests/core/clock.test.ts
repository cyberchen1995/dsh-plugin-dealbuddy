import { describe, expect, it } from 'vitest'

import { nowIso } from '../../src/core/clock.js'

describe('nowIso matches how pydantic serialises a UTC datetime', () => {
  it('pads milliseconds out to six digits', () => {
    expect(nowIso(new Date(Date.UTC(2026, 8, 8, 5, 3, 26, 980)))).toBe(
      '2026-09-08T05:03:26.980000Z',
    )
  })

  it('drops the fraction on a whole second, as pydantic does', () => {
    // Writing `.000000` here would change the bytes of a file Python rewrites.
    expect(nowIso(new Date(Date.UTC(2026, 8, 8, 5, 3, 26, 0)))).toBe('2026-09-08T05:03:26Z')
  })
})
