import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseJson, stringifyJson, type JsonObject } from '../../src/store/json.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

/**
 * Read a fixture written by the Python workbench.
 * @param name - the fixture file name.
 * @returns the raw text, minus the file's trailing newline if any.
 */
function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8').replace(/\n$/u, '')
}

describe('order-preserving parse', () => {
  it('keeps integer-like keys where the writer put them', () => {
    const source = '{"2": "第二", "1": "第一", "屏幕尺寸": "65英寸"}'
    const parsed = parseJson(source) as JsonObject
    expect([...parsed.keys()]).toEqual(['2', '1', '屏幕尺寸'])
    // The built-in parser hoists them, which is why this module exists.
    expect(Object.keys(JSON.parse(source) as object)).toEqual(['1', '2', '屏幕尺寸'])
  })

  it('handles escapes, unicode, empty containers and nesting', () => {
    const source = '{"a": "line\\nbreak \\"q\\" \\u00e9", "b": [], "c": {}, "d": [1, -2.5, true, false, null]}'
    const parsed = parseJson(source) as JsonObject
    expect(parsed.get('a')).toBe('line\nbreak "q" é')
    expect(parsed.get('b')).toEqual([])
    expect((parsed.get('c') as JsonObject).size).toBe(0)
    expect(parsed.get('d')).toEqual([1, -2.5, true, false, null])
  })

  it('rejects malformed documents instead of guessing', () => {
    for (const bad of ['{', '{"a"}', '{"a": }', '[1,]', '{"a": 1} trailing', '']) {
      expect(() => parseJson(bad), bad).toThrow(/invalid JSON/u)
    }
  })
})

describe('round trip with the Python workbench', () => {
  it('rewrites a session file byte for byte', () => {
    const raw = fixture('python-written-session.json')
    expect(stringifyJson(parseJson(raw))).toBe(raw)
  })

  it('rewrites config.json byte for byte, preserving the untouched llm block', () => {
    const raw = fixture('python-written-config.json')
    expect(stringifyJson(parseJson(raw))).toBe(raw)
    const parsed = parseJson(raw) as JsonObject
    expect([...parsed.keys()]).toContain('llm')
  })
})
