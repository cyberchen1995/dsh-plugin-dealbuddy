import { describe, expect, it } from 'vitest'

import { DEALBUDDY_SETTINGS_NAMESPACE, DEALBUDDY_SETTINGS_SCHEMA } from '../../src/settings.js'

/**
 * The card's contract with the harness.
 *
 * The rendering itself is verified in a running browser; what a unit test can
 * pin is the pairing the settings tab depends on — the card key must be the
 * namespace the Host half registers, and the schema must resolve the same
 * defaults the composition entry does.
 */

describe('settings namespace', () => {
  it('uses a namespace the harness accepts', () => {
    // The provider rejects anything but a lowercase hyphenated identifier.
    expect(DEALBUDDY_SETTINGS_NAMESPACE).toMatch(/^[a-z][a-z0-9-]*$/u)
  })

  it('resolves the same defaults as the composition entry', () => {
    expect(DEALBUDDY_SETTINGS_SCHEMA({})).toEqual({
      port: 8765,
      dataDir: '',
      extraAllowedDomains: [],
      ocrTextPreviewChars: 400,
      legacyOffersRoute: true,
    })
  })

  it('refuses a port outside the range, so a bad card write cannot land', () => {
    expect(() => DEALBUDDY_SETTINGS_SCHEMA({ port: 99999 })).toThrow()
    expect(() => DEALBUDDY_SETTINGS_SCHEMA({ port: 0 })).toThrow()
  })

  it('refuses a domain that is not a host suffix', () => {
    expect(() => DEALBUDDY_SETTINGS_SCHEMA({ extraAllowedDomains: ['https://x.com'] })).toThrow()
    expect(
      DEALBUDDY_SETTINGS_SCHEMA({ extraAllowedDomains: ['shop.example.com'] }).extraAllowedDomains,
    ).toEqual(['shop.example.com'])
  })
})
