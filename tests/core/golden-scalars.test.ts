import { describe, expect, it } from 'vitest'

import { priceScore } from '../../src/core/ranking.js'
import { parseVisiblePrice } from '../../src/core/capture.js'
import { compact } from '../../src/core/text.js'
import { emptyRequirements } from '../../src/core/requirements.js'
import { inputString, loadGolden } from '../golden.js'

describe('compact matches Python _compact', () => {
  for (const testCase of loadGolden('compact')) {
    it(testCase.name, () => {
      expect(compact(inputString(testCase.input, 'value'))).toBe(testCase.expected)
    })
  }
})

describe('parseVisiblePrice matches Python parse_visible_price', () => {
  for (const testCase of loadGolden('parse_visible_price')) {
    it(testCase.name, () => {
      expect(parseVisiblePrice(inputString(testCase.input, 'value'))).toBe(testCase.expected)
    })
  }
})

describe('priceScore matches Python _price_score', () => {
  for (const testCase of loadGolden('price_score')) {
    it(testCase.name, () => {
      const requirements = emptyRequirements('电视')
      requirements.budget_max = inputString(testCase.input, 'budget_max')
      expect(priceScore(inputString(testCase.input, 'price'), requirements)).toBe(
        testCase.expected,
      )
    })
  }
})
