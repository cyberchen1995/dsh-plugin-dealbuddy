import { getArray, getObject, getString, type JsonObject, type JsonValue } from '../store/json.js'

/**
 * Domain records as they appear on disk.
 *
 * Dictionary fields are `Map`s rather than plain objects: their insertion order
 * is observable, both in the ranking search text (`ranking.py:62-71`) and in
 * the bytes of a rewritten session file.
 */

/** An ordered `dict[str, str]`. */
export type StringMap = Map<string, string>

/** A requirement set (`models.py:58-69`); decimals stay serialised as strings. */
export interface Requirements {
  category: string
  raw_request: string
  version: number
  budget_min: string | null
  budget_max: string | null
  use_cases: string[]
  must_have: StringMap
  preferences: StringMap
  exclusions: string[]
  brands: string[]
  after_sales: string[]
}

/** A verified offer (`models.py:109-127`). */
export interface VerifiedOffer {
  platform: string
  title: string
  url: string
  store_name: string | null
  brand: string | null
  model: string | null
  specs: StringMap
  sku: string | null
  listed_price: string | null
  visible_price: string | null
  coupon: string | null
  estimated_payable: string | null
  conditions: string[]
  stock: string | null
  parameters: StringMap
  llm_summary: string | null
  verified_at: string
  confidence: string
}

/** One scored offer (`models.py:130-136`). */
export interface RankedOffer {
  offer: VerifiedOffer
  score: number
  hard_requirements_met: boolean
  matched_requirements: string[]
  unmet_requirements: string[]
  reasons: string[]
}

/**
 * Read an ordered string map from an object node.
 * @param node - the parent object.
 * @param key - the field name.
 * @returns the map; empty when the field is absent.
 */
export function readStringMap(node: JsonObject, key: string): StringMap {
  const raw = getObject(node, key)
  const result: StringMap = new Map()
  if (raw === undefined) return result
  for (const [name, value] of raw) {
    if (typeof value === 'string') result.set(name, value)
  }
  return result
}

/**
 * Read a string array from an object node.
 * @param node - the parent object.
 * @param key - the field name.
 * @returns the array; empty when the field is absent.
 */
export function readStringArray(node: JsonObject, key: string): string[] {
  const raw = getArray(node, key)
  if (raw === undefined) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

/**
 * Read a nullable scalar stored as a string.
 * @param node - the parent object.
 * @param key - the field name.
 * @returns the string, or null when absent or null.
 */
export function readNullableString(node: JsonObject, key: string): string | null {
  const value = node.get(key)
  return typeof value === 'string' ? value : null
}

/**
 * Parse a requirement set from a parsed session file or golden case.
 * @param node - the object node holding the requirement fields.
 * @returns the requirement set.
 */
export function readRequirements(node: JsonObject): Requirements {
  const version = node.get('version')
  return {
    category: getString(node, 'category') ?? '',
    raw_request: getString(node, 'raw_request') ?? '',
    version: typeof version === 'number' ? version : 1,
    budget_min: readNullableString(node, 'budget_min'),
    budget_max: readNullableString(node, 'budget_max'),
    use_cases: readStringArray(node, 'use_cases'),
    must_have: readStringMap(node, 'must_have'),
    preferences: readStringMap(node, 'preferences'),
    exclusions: readStringArray(node, 'exclusions'),
    brands: readStringArray(node, 'brands'),
    after_sales: readStringArray(node, 'after_sales'),
  }
}

/**
 * Parse a verified offer from a parsed session file or golden case.
 * @param node - the object node holding the offer fields.
 * @returns the offer.
 */
export function readVerifiedOffer(node: JsonObject): VerifiedOffer {
  return {
    platform: getString(node, 'platform') ?? '',
    title: getString(node, 'title') ?? '',
    url: getString(node, 'url') ?? '',
    store_name: readNullableString(node, 'store_name'),
    brand: readNullableString(node, 'brand'),
    model: readNullableString(node, 'model'),
    specs: readStringMap(node, 'specs'),
    sku: readNullableString(node, 'sku'),
    listed_price: readNullableString(node, 'listed_price'),
    visible_price: readNullableString(node, 'visible_price'),
    coupon: readNullableString(node, 'coupon'),
    estimated_payable: readNullableString(node, 'estimated_payable'),
    conditions: readStringArray(node, 'conditions'),
    stock: readNullableString(node, 'stock'),
    parameters: readStringMap(node, 'parameters'),
    llm_summary: readNullableString(node, 'llm_summary'),
    verified_at: getString(node, 'verified_at') ?? '',
    confidence: getString(node, 'confidence') ?? 'medium',
  }
}

/**
 * Serialise an ordered string map back to a JSON object node.
 * @param map - the map to write.
 * @returns the object node.
 */
export function writeStringMap(map: StringMap): JsonObject {
  const node: JsonObject = new Map()
  for (const [key, value] of map) node.set(key, value)
  return node
}

/**
 * Serialise a verified offer in the field order pydantic writes.
 * @param offer - the offer to write.
 * @returns the object node.
 */
export function writeVerifiedOffer(offer: VerifiedOffer): JsonObject {
  const node: JsonObject = new Map()
  const entries: [string, JsonValue][] = [
    ['platform', offer.platform],
    ['title', offer.title],
    ['url', offer.url],
    ['store_name', offer.store_name],
    ['brand', offer.brand],
    ['model', offer.model],
    ['specs', writeStringMap(offer.specs)],
    ['sku', offer.sku],
    ['listed_price', offer.listed_price],
    ['visible_price', offer.visible_price],
    ['coupon', offer.coupon],
    ['estimated_payable', offer.estimated_payable],
    ['conditions', [...offer.conditions]],
    ['stock', offer.stock],
    ['parameters', writeStringMap(offer.parameters)],
    ['llm_summary', offer.llm_summary],
    ['verified_at', offer.verified_at],
    ['confidence', offer.confidence],
  ]
  for (const [key, value] of entries) node.set(key, value)
  return node
}
