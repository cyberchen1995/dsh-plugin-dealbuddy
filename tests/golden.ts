import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseJson, type JsonObject, type JsonValue } from '../src/store/json.js'

/**
 * Load golden samples exported from the Python workbench.
 *
 * The files are parsed with the order-preserving reader, because several cases
 * exist precisely to pin insertion order that `JSON.parse` would destroy.
 */

/** One exported case. */
export interface GoldenCase {
  name: string
  input: JsonObject
  expected: JsonValue
}

/**
 * Read one golden file.
 * @param name - the file's base name, matching the exported function.
 * @returns the cases it holds.
 */
export function loadGolden(name: string): GoldenCase[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'golden', `${name}.json`)
  const parsed = parseJson(readFileSync(path, 'utf8'))
  if (!(parsed instanceof Map)) throw new Error(`${name}.json is not an object`)
  const cases = parsed.get('cases')
  if (!Array.isArray(cases)) throw new Error(`${name}.json has no cases array`)
  return cases.map((entry) => {
    if (!(entry instanceof Map)) throw new Error(`${name}.json case is not an object`)
    const input = entry.get('input')
    if (!(input instanceof Map)) throw new Error(`${name}.json case has no input object`)
    return {
      name: String(entry.get('name')),
      input,
      expected: entry.get('expected') ?? null,
    }
  })
}

/**
 * Read a nullable string argument from a case's input.
 * @param input - the case input.
 * @param key - the argument name.
 * @returns the string, or null.
 */
export function inputString(input: JsonObject, key: string): string | null {
  const value = input.get(key)
  return typeof value === 'string' ? value : null
}

/**
 * Read a required object argument from a case's input.
 * @param input - the case input.
 * @param key - the argument name.
 * @returns the object node.
 * @throws when the argument is missing.
 */
export function inputObject(input: JsonObject, key: string): JsonObject {
  const value = input.get(key)
  if (!(value instanceof Map)) throw new Error(`missing object argument ${key}`)
  return value
}

/**
 * Convert an ordered map into a plain object for comparison.
 *
 * Only safe for assertions where key order does not matter; order-sensitive
 * cases compare `[...map.keys()]` explicitly.
 * @param map - the ordered map.
 * @returns a plain object with the same entries.
 */
export function mapToObject(map: ReadonlyMap<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(map)
}
