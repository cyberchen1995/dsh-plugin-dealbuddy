import { describe, expect, it } from 'vitest'

import { readRequirements, readVerifiedOffer } from '../../src/core/domain.js'
import { rankOffers, scoreOffer } from '../../src/core/ranking.js'
import { buildMarkdownReport } from '../../src/core/reporting.js'
import { inputObject, loadGolden } from '../golden.js'
import { getArray, getString, type JsonObject } from '../../src/store/json.js'

describe('scoreOffer matches Python score_offer', () => {
  for (const testCase of loadGolden('score_offer')) {
    it(testCase.name, () => {
      const offer = readVerifiedOffer(inputObject(testCase.input, 'offer'))
      const requirements = readRequirements(inputObject(testCase.input, 'requirements'))
      const expected = testCase.expected as JsonObject
      const actual = scoreOffer(offer, requirements)
      expect(actual.score).toBe(expected.get('score'))
      expect(actual.hard_requirements_met).toBe(expected.get('hard_requirements_met'))
      expect(actual.matched_requirements).toEqual(expected.get('matched_requirements'))
      expect(actual.unmet_requirements).toEqual(expected.get('unmet_requirements'))
      expect(actual.reasons).toEqual(expected.get('reasons'))
    })
  }
})

describe('rankOffers and buildMarkdownReport match Python', () => {
  for (const testCase of loadGolden('rank_and_report') ) {
    it(testCase.name, () => {
      const requirements = readRequirements(inputObject(testCase.input, 'requirements'))
      const offers = (getArray(testCase.input, 'offers') ?? []).map((node) =>
        readVerifiedOffer(node as JsonObject),
      )
      const expected = testCase.expected as JsonObject
      const ranked = rankOffers(offers, requirements)

      expect(ranked.map((item) => item.offer.url)).toEqual(getArray(expected, 'order'))

      const expectedRanked = getArray(expected, 'ranked') ?? []
      expect(ranked).toHaveLength(expectedRanked.length)
      ranked.forEach((item, index) => {
        const want = expectedRanked[index] as JsonObject
        expect(item.offer.url).toBe(want.get('url'))
        expect(item.score).toBe(want.get('score'))
        expect(item.hard_requirements_met).toBe(want.get('hard_requirements_met'))
        expect(item.matched_requirements).toEqual(want.get('matched_requirements'))
        expect(item.unmet_requirements).toEqual(want.get('unmet_requirements'))
        expect(item.reasons).toEqual(want.get('reasons'))
      })

      expect(buildMarkdownReport(requirements, ranked)).toBe(getString(expected, 'report_markdown'))
    })
  }
})
