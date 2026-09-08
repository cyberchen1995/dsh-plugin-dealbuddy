import type { Requirements, StringMap } from './domain.js'

/**
 * Requirement extraction and merging, ported from `requirements.py`.
 *
 * Both regexes here use Python's Unicode-aware `\d` and `\D`. The size match is
 * interpolated verbatim, so `55吋` yields `55英寸` while `５５吋` keeps its
 * full-width digits; the budget match goes through `Decimal`, which folds them.
 */

/** Use-case keywords; the result follows this table's order, not the input's. */
const USE_CASE_MARKERS: readonly (readonly [string, readonly string[]])[] = [
  ['电影', ['电影', '观影', '追剧', '看剧']],
  ['游戏', ['游戏', '主机', '电竞']],
  ['办公', ['办公', '生产力', '会议']],
  ['学习', ['学习', '网课']],
  ['老人', ['老人', '长辈', '父母']],
  ['儿童', ['儿童', '孩子', '宝宝']],
]

const BUDGET_PATTERN = /(?:预算|不超过|以内)[^\p{Nd}]{0,8}(\p{Nd}+(?:\.\p{Nd}+)?)/u
const SIZE_PATTERN = /(\p{Nd}+(?:\.\p{Nd}+)?)\s*(英寸|吋|寸)/u

/**
 * Build an empty requirement set for a category.
 * @param category - the product category.
 * @returns the requirement set with pydantic's defaults.
 */
export function emptyRequirements(category: string): Requirements {
  return {
    category,
    raw_request: '',
    version: 1,
    budget_min: null,
    budget_max: null,
    use_cases: [],
    must_have: new Map(),
    preferences: new Map(),
    exclusions: [],
    brands: [],
    after_sales: [],
  }
}

/**
 * Extract a first requirement set from free text (`requirements.py:53-75`).
 * @param category - the product category.
 * @param request - the user's free-text request.
 * @returns the requirement set.
 */
export function initialRequirements(category: string, request: string): Requirements {
  const result = emptyRequirements(category)
  result.raw_request = request

  const budget = BUDGET_PATTERN.exec(request)
  if (budget !== null && budget[1] !== undefined) {
    result.budget_max = decimalFromDigits(budget[1])
  }

  const size = SIZE_PATTERN.exec(request)
  if (size !== null && size[1] !== undefined) {
    // Interpolated verbatim by Python, so the raw digits survive.
    result.must_have.set('screen_size', `${size[1]}英寸`)
  }

  for (const [label, markers] of USE_CASE_MARKERS) {
    if (markers.some((marker) => request.includes(marker))) result.use_cases.push(label)
  }
  return result
}

/**
 * Merge requirement changes (`requirements.py:139-178`).
 *
 * A category change resets everything to version 1 and keeps only the fields
 * the change names. Otherwise the version increments, dictionaries merge
 * shallowly, lists union while preserving order, and scalars overwrite.
 * @param current - the stored requirement set.
 * @param changes - the requested changes.
 * @returns the merged requirement set.
 */
export function mergeRequirements(
  current: Requirements,
  changes: ReadonlyMap<string, unknown>,
): Requirements {
  const rawCategory = changes.has('category') ? String(changes.get('category')) : current.category
  const newCategory = rawCategory.trim()

  if (newCategory !== current.category) {
    const reset = emptyRequirements(newCategory)
    reset.raw_request = changes.has('raw_request') ? String(changes.get('raw_request')) : ''
    if (changes.has('budget_min')) reset.budget_min = asDecimalOrNull(changes.get('budget_min'))
    if (changes.has('budget_max')) reset.budget_max = asDecimalOrNull(changes.get('budget_max'))
    if (changes.has('use_cases')) reset.use_cases = asStringList(changes.get('use_cases'))
    if (changes.has('must_have')) reset.must_have = asStringMap(changes.get('must_have'))
    if (changes.has('preferences')) reset.preferences = asStringMap(changes.get('preferences'))
    if (changes.has('exclusions')) reset.exclusions = asStringList(changes.get('exclusions'))
    if (changes.has('brands')) reset.brands = asStringList(changes.get('brands'))
    if (changes.has('after_sales')) reset.after_sales = asStringList(changes.get('after_sales'))
    return reset
  }

  const merged: Requirements = {
    ...current,
    version: current.version + 1,
    use_cases: [...current.use_cases],
    must_have: new Map(current.must_have),
    preferences: new Map(current.preferences),
    exclusions: [...current.exclusions],
    brands: [...current.brands],
    after_sales: [...current.after_sales],
  }

  for (const field of ['must_have', 'preferences'] as const) {
    if (!changes.has(field)) continue
    for (const [key, value] of asStringMap(changes.get(field))) merged[field].set(key, value)
  }
  for (const field of ['use_cases', 'exclusions', 'brands', 'after_sales'] as const) {
    if (!changes.has(field)) continue
    merged[field] = mergeUnique(merged[field], changes.get(field))
  }
  if (changes.has('raw_request')) merged.raw_request = String(changes.get('raw_request'))
  if (changes.has('budget_min')) merged.budget_min = asDecimalOrNull(changes.get('budget_min'))
  if (changes.has('budget_max')) merged.budget_max = asDecimalOrNull(changes.get('budget_max'))
  return merged
}

/**
 * Append incoming values, dropping falsy entries and duplicates
 * (`requirements.py:132-137`).
 * @param existing - the current list.
 * @param incoming - the incoming value, list or scalar.
 * @returns the merged list.
 */
function mergeUnique(existing: readonly string[], incoming: unknown): string[] {
  if (incoming === null || incoming === undefined) return [...existing]
  const values = Array.isArray(incoming) ? incoming : [incoming]
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of [...existing, ...values.filter((item) => isTruthy(item)).map(String)]) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/**
 * Coerce a change value into a serialised decimal.
 * @param value - the raw change value.
 * @returns the serialised decimal, or null.
 */
function asDecimalOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return decimalFromDigits(String(value))
}

/**
 * Normalise digits the way `Decimal(...)` does, folding full-width forms.
 * @param value - the raw digit text.
 * @returns the serialised decimal.
 */
function decimalFromDigits(value: string): string {
  const normalised = value.normalize('NFKC').trim()
  if (!normalised.includes('.')) {
    const trimmed = normalised.replace(/^(-?)0+(?=\d)/u, '$1')
    return trimmed === '' ? '0' : trimmed
  }
  const [whole = '', fraction = ''] = normalised.split('.')
  const trimmedWhole = whole.replace(/^(-?)0+(?=\d)/u, '$1')
  return `${trimmedWhole === '' ? '0' : trimmedWhole}.${fraction}`
}

/**
 * Coerce a change value into a string list.
 * @param value - the raw change value.
 * @returns the string list.
 */
function asStringList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const values = Array.isArray(value) ? value : [value]
  return values.filter((item) => isTruthy(item)).map(String)
}

/**
 * Coerce a change value into an ordered string map.
 * @param value - the raw change value.
 * @returns the string map.
 */
function asStringMap(value: unknown): StringMap {
  if (value instanceof Map) {
    const result: StringMap = new Map()
    for (const [key, item] of value) result.set(String(key), String(item))
    return result
  }
  return new Map()
}

/**
 * Test Python truthiness for a scalar change entry.
 * @param value - the value to test.
 * @returns whether Python would keep it.
 */
function isTruthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && value !== false && value !== 0
}
