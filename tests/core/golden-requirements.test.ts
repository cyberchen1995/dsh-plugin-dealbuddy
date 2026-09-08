import { describe, expect, it } from 'vitest'

import { readRequirements, type Requirements } from '../../src/core/domain.js'
import { initialRequirements, mergeRequirements } from '../../src/core/requirements.js'
import { inputObject, inputString, loadGolden, mapToObject } from '../golden.js'
import type { JsonObject } from '../../src/store/json.js'

/**
 * Compare a ported requirement set against the exported JSON shape.
 * @param actual - the value the port produced.
 * @param expected - the exported expectation.
 */
function expectRequirements(actual: Requirements, expected: JsonObject): void {
  const want = readRequirements(expected)
  expect({
    ...actual,
    must_have: mapToObject(actual.must_have),
    preferences: mapToObject(actual.preferences),
  }).toEqual({
    ...want,
    must_have: mapToObject(want.must_have),
    preferences: mapToObject(want.preferences),
  })
  // Key order is observable downstream, so compare it explicitly.
  expect([...actual.must_have.keys()]).toEqual([...want.must_have.keys()])
  expect([...actual.preferences.keys()]).toEqual([...want.preferences.keys()])
}

describe('initialRequirements matches Python initial_requirements', () => {
  for (const testCase of loadGolden('initial_requirements')) {
    it(testCase.name, () => {
      const category = inputString(testCase.input, 'category') ?? ''
      const request = inputString(testCase.input, 'request') ?? ''
      expectRequirements(
        initialRequirements(category, request),
        testCase.expected as JsonObject,
      )
    })
  }
})

describe('mergeRequirements matches Python merge_requirements', () => {
  for (const testCase of loadGolden('merge_requirements')) {
    it(testCase.name, () => {
      const current = readRequirements(inputObject(testCase.input, 'current'))
      const changes = inputObject(testCase.input, 'changes')
      expectRequirements(
        mergeRequirements(current, changes),
        testCase.expected as JsonObject,
      )
    })
  }
})
