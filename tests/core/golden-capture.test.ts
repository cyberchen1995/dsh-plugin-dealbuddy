import { describe, expect, it } from 'vitest'

import { captureToVerifiedOffer, type CapturePayload } from '../../src/core/capture.js'
import { readStringMap, readVerifiedOffer, writeVerifiedOffer } from '../../src/core/domain.js'
import { inputObject, loadGolden } from '../golden.js'
import { getString, type JsonObject } from '../../src/store/json.js'

/**
 * Build a capture payload from a golden case's raw input node.
 * @param node - the payload object node.
 * @returns the payload.
 */
function toPayload(node: JsonObject): CapturePayload {
  return {
    platform: getString(node, 'platform') ?? '',
    url: getString(node, 'url') ?? '',
    title: getString(node, 'title') ?? '',
    visible_price: getString(node, 'visible_price') ?? null,
    store_name: getString(node, 'store_name') ?? null,
    sku_id: getString(node, 'sku_id') ?? null,
    sku_text: getString(node, 'sku_text') ?? null,
    selected_sku_text: getString(node, 'selected_sku_text') ?? null,
    specs: readStringMap(node, 'specs'),
    ocr_text: getString(node, 'ocr_text') ?? null,
    confidence: getString(node, 'confidence') ?? 'medium',
  }
}

describe('captureToVerifiedOffer matches Python capture_to_verified_offer', () => {
  for (const testCase of loadGolden('capture_to_verified_offer')) {
    it(testCase.name, () => {
      const expected = testCase.expected as JsonObject
      const verifiedAt = getString(expected, 'verified_at') ?? ''
      const actual = captureToVerifiedOffer(toPayload(inputObject(testCase.input, 'payload')), verifiedAt)

      // Compare the serialisable projection so extra fields cannot hide.
      expect(writeVerifiedOffer(actual)).toEqual(writeVerifiedOffer(readVerifiedOffer(expected)))
      // Spec insertion order is observable in the ranking search text.
      expect([...actual.specs.keys()]).toEqual([...readStringMap(expected, 'specs').keys()])
      expect([...actual.parameters.keys()]).toEqual([...readStringMap(expected, 'parameters').keys()])
    })
  }
})
