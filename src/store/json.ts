/**
 * Order-preserving JSON for the DealBuddy session format.
 *
 * V8 hoists integer-like keys to the front of an object, so a round trip
 * through `JSON.parse` / `JSON.stringify` silently rewrites
 * `{"2": …, "1": …}` as `{"1": …, "2": …}`. That matters twice: the session
 * files must stay byte-compatible with the Python workbench, and `specs`
 * insertion order reaches the ranking search text (`ranking.py:62-71`). Object
 * nodes are therefore materialised as `Map`s, which preserve insertion order
 * for every key type.
 */

/** An object node with its key order intact. */
export type JsonObject = Map<string, JsonValue>

/** Any JSON value, with objects as ordered maps. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject

/**
 * Parse JSON text, preserving object key order.
 * @param text - the JSON document.
 * @returns the parsed value.
 * @throws when the text is not a single well-formed JSON value.
 */
export function parseJson(text: string): JsonValue {
  const parser = new Parser(text)
  parser.skipWhitespace()
  const value = parser.readValue()
  parser.skipWhitespace()
  if (!parser.atEnd()) parser.fail('unexpected trailing content')
  return value
}

/**
 * Serialise a value the way the Python workbench writes session files:
 * two-space indent, `": "` after each key, non-ASCII left unescaped, and no
 * trailing newline (`session.py:45-53` via `model_dump_json(indent=2)`).
 * @param value - the value to serialise.
 * @returns the JSON text.
 */
export function stringifyJson(value: JsonValue): string {
  return write(value, 0)
}

/**
 * Read a plain string field from an object node.
 * @param object - the object node.
 * @param key - the key to read.
 * @returns the string, or `undefined` when absent or of another type.
 */
export function getString(object: JsonObject, key: string): string | undefined {
  const value = object.get(key)
  return typeof value === 'string' ? value : undefined
}

/**
 * Read a nested object node.
 * @param object - the object node.
 * @param key - the key to read.
 * @returns the nested object, or `undefined` when absent or of another type.
 */
export function getObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object.get(key)
  return value instanceof Map ? value : undefined
}

/**
 * Read an array node.
 * @param object - the object node.
 * @param key - the key to read.
 * @returns the array, or `undefined` when absent or of another type.
 */
export function getArray(object: JsonObject, key: string): JsonValue[] | undefined {
  const value = object.get(key)
  return Array.isArray(value) ? value : undefined
}

/**
 * Render one value at the given indent depth.
 * @param value - the value to render.
 * @param depth - the current nesting depth.
 * @returns the rendered fragment.
 */
function write(value: JsonValue, depth: number): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return writeNumber(value)
  if (typeof value === 'string') return JSON.stringify(value)
  const pad = '  '.repeat(depth + 1)
  const closePad = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((item) => `${pad}${write(item, depth + 1)}`)
    return `[\n${items.join(',\n')}\n${closePad}]`
  }
  if (value.size === 0) return '{}'
  const entries = [...value.entries()].map(
    ([key, item]) => `${pad}${JSON.stringify(key)}: ${write(item, depth + 1)}`,
  )
  return `{\n${entries.join(',\n')}\n${closePad}}`
}

/**
 * Render a number the way Python's json module does for the values that reach
 * a session file: integers stay integral and floats keep their shortest
 * round-trippable form.
 * @param value - the number.
 * @returns the rendered number.
 * @throws when the value cannot be represented in JSON.
 */
function writeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`cannot serialise ${String(value)} as JSON`)
  return String(value)
}

/** A minimal recursive-descent JSON reader. */
class Parser {
  private index = 0

  /**
   * @param text - the document to read.
   */
  constructor(private readonly text: string) {}

  /**
   * @returns whether the whole document has been consumed.
   */
  atEnd(): boolean {
    return this.index >= this.text.length
  }

  /** Advance past insignificant whitespace. */
  skipWhitespace(): void {
    while (this.index < this.text.length) {
      const char = this.text[this.index]
      if (char === ' ' || char === '\n' || char === '\r' || char === '\t') this.index += 1
      else break
    }
  }

  /**
   * Read one JSON value.
   * @returns the value.
   */
  readValue(): JsonValue {
    this.skipWhitespace()
    const char = this.text[this.index]
    if (char === undefined) this.fail('unexpected end of input')
    if (char === '{') return this.readObject()
    if (char === '[') return this.readArray()
    if (char === '"') return this.readString()
    if (char === 't' || char === 'f' || char === 'n') return this.readKeyword()
    return this.readNumber()
  }

  /**
   * Read an object into an insertion-ordered map.
   * @returns the object node.
   */
  private readObject(): JsonObject {
    this.expect('{')
    const result: JsonObject = new Map()
    this.skipWhitespace()
    if (this.peek() === '}') {
      this.index += 1
      return result
    }
    for (;;) {
      this.skipWhitespace()
      const key = this.readString()
      this.skipWhitespace()
      this.expect(':')
      result.set(key, this.readValue())
      this.skipWhitespace()
      const next = this.peek()
      if (next === ',') {
        this.index += 1
        continue
      }
      if (next === '}') {
        this.index += 1
        return result
      }
      this.fail('expected "," or "}"')
    }
  }

  /**
   * Read an array.
   * @returns the array node.
   */
  private readArray(): JsonValue[] {
    this.expect('[')
    const result: JsonValue[] = []
    this.skipWhitespace()
    if (this.peek() === ']') {
      this.index += 1
      return result
    }
    for (;;) {
      result.push(this.readValue())
      this.skipWhitespace()
      const next = this.peek()
      if (next === ',') {
        this.index += 1
        continue
      }
      if (next === ']') {
        this.index += 1
        return result
      }
      this.fail('expected "," or "]"')
    }
  }

  /**
   * Read a string, delegating escape handling to the built-in parser.
   * @returns the decoded string.
   */
  private readString(): string {
    const start = this.index
    this.expect('"')
    while (this.index < this.text.length) {
      const char = this.text[this.index]
      if (char === '\\') {
        this.index += 2
        continue
      }
      this.index += 1
      if (char === '"') {
        return JSON.parse(this.text.slice(start, this.index)) as string
      }
    }
    this.fail('unterminated string')
  }

  /**
   * Read `true`, `false` or `null`.
   * @returns the keyword value.
   */
  private readKeyword(): boolean | null {
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.text.startsWith(word, this.index)) {
        this.index += word.length
        return value
      }
    }
    return this.fail('invalid literal')
  }

  /**
   * Read a number.
   * @returns the numeric value.
   */
  private readNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.index))
    if (match === null) this.fail('invalid number')
    this.index += match[0].length
    return Number(match[0])
  }

  /**
   * @returns the character at the cursor, or `undefined` at the end.
   */
  private peek(): string | undefined {
    return this.text[this.index]
  }

  /**
   * Consume one required character.
   * @param char - the expected character.
   */
  private expect(char: string): void {
    if (this.text[this.index] !== char) this.fail(`expected ${char}`)
    this.index += 1
  }

  /**
   * Abort with the cursor position.
   * @param message - what was expected.
   * @returns never; the call always throws.
   * @throws always.
   */
  fail(message: string): never {
    throw new Error(`invalid JSON at position ${this.index}: ${message}`)
  }
}
