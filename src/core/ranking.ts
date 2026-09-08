import { compareDecimals, excessRatio, isTruthyDecimal, ratio, roundHalfEven2 } from './decimal.js'
import type { RankedOffer, Requirements, VerifiedOffer } from './domain.js'
import { valueMatches } from './text.js'

/**
 * Offer scoring, ported from `ranking.py`.
 *
 * Only the verified-offer path exists here: `CandidateOffer` is produced by the
 * retired search pipeline and never reaches the workbench at runtime, so its
 * review-count bonus (`ranking.py:127`) has no port.
 */

/** Synonyms expanding a `must_have` key (`ranking.py:11-16`). */
const REQUIREMENT_ALIASES = new Map<string, readonly string[]>([
  ['heating_type', ['即热式', '即热', '速热']],
  ['sterilization', ['UV杀菌', 'UV紫外', 'UV抑菌', '紫外杀菌', '紫外抑菌']],
  ['temperature_control', ['调温', '多档调温', '温控', '控温', '多档水温']],
  ['keep_warm', ['保温', '恒温']],
])

/** Store labels earning the trust bonus (`ranking.py:124-125`). */
const STORE_BONUS_LABELS = ['自营', '官方旗舰店', '旗舰店'] as const

/**
 * Score the price against the budget (`ranking.py:44-55`).
 *
 * The arithmetic is exact-decimal before the conversion to double, matching
 * Python; doing it in binary floating point drifts on cent-valued prices.
 * @param price - the serialised price, or null when unknown.
 * @param requirements - the requirement set supplying `budget_max`.
 * @returns the price component of the score.
 */
export function priceScore(price: string | null, requirements: Requirements): number {
  if (price === null) return 0
  const budgetMax = requirements.budget_max
  if (budgetMax === null) return 5.0
  if (compareDecimals(price, budgetMax) > 0) {
    return Math.max(-30.0, -100.0 * excessRatio(price, budgetMax))
  }
  const utilization = ratio(price, budgetMax)
  return 15.0 * (1.0 - Math.max(0.0, utilization - 0.6))
}

/**
 * Score one offer (`ranking.py:58-143`).
 * @param offer - the verified offer.
 * @param requirements - the requirement set.
 * @returns the scored offer.
 */
export function scoreOffer(offer: VerifiedOffer, requirements: Requirements): RankedOffer {
  let score = 0.0
  const matched: string[] = []
  const unmet: string[] = []

  const searchParts = [
    offer.title,
    offer.brand ?? '',
    offer.model ?? '',
    offer.store_name ?? '',
    ...offer.specs.values(),
    ...offer.conditions,
  ]
  const searchText = searchParts.join(' ')

  for (const [key, expected] of requirements.must_have) {
    const actual = offer.specs.get(key)
    if (requirementMatches(key, actual, searchText, expected)) {
      matched.push(`${key}=${expected}`)
      score += 25
    } else {
      unmet.push(`${key}=${expected}`)
      score -= 60
    }
  }

  for (const [key, expected] of requirements.preferences) {
    const actual = offer.specs.get(key)
    if (valueMatches(actual, expected) || valueMatches(searchText, expected)) {
      matched.push(`${key}=${expected}`)
      score += 8
    }
  }

  for (const excluded of requirements.exclusions) {
    if (valueMatches(searchText, excluded)) {
      unmet.push(`排除项:${excluded}`)
      score -= 80
    }
  }

  if (requirements.brands.length > 0) {
    const allowedBrands = requirements.brands.join('/')
    if (requirements.brands.some((brand) => valueMatches(searchText, brand))) {
      matched.push(`品牌限制:${allowedBrands}`)
      score += 10
    } else {
      unmet.push(`品牌限制:${allowedBrands}`)
      score -= 60
    }
  }

  for (const afterSale of requirements.after_sales) {
    if (valueMatches(searchText, afterSale)) {
      matched.push(`售后要求:${afterSale}`)
      score += 10
    } else {
      unmet.push(`售后要求:${afterSale}`)
      score -= 60
    }
  }

  // `price or offer.visible_price` in Python: a zero payable is falsy and falls
  // through to the visible price.
  const price = isTruthyDecimal(offer.estimated_payable)
    ? offer.estimated_payable
    : offer.visible_price
  score += priceScore(price ?? null, requirements)

  const storeName = offer.store_name ?? ''
  if (STORE_BONUS_LABELS.some((label) => storeName.includes(label))) score += 8

  const reasons = [...matched]
  if (price !== null && price !== undefined) reasons.push(`页面价格 ${price}`)
  if (storeName !== '') reasons.push(`店铺 ${storeName}`)

  return {
    offer,
    score: roundHalfEven2(score),
    hard_requirements_met: unmet.length === 0,
    matched_requirements: matched,
    unmet_requirements: unmet,
    reasons,
  }
}

/**
 * Rank offers, best first (`ranking.py:145-154`).
 *
 * Python's `sorted(..., reverse=True)` keeps equal elements in input order, so
 * this uses a stable descending comparator rather than sorting and reversing.
 * @param offers - the offers to rank.
 * @param requirements - the requirement set.
 * @returns the ranked offers, highest first.
 */
export function rankOffers(
  offers: readonly VerifiedOffer[],
  requirements: Requirements,
): RankedOffer[] {
  const scored = offers.map((offer) => scoreOffer(offer, requirements))
  return scored.sort((left, right) => {
    if (left.hard_requirements_met !== right.hard_requirements_met) {
      return left.hard_requirements_met ? -1 : 1
    }
    if (left.score !== right.score) return right.score - left.score
    return 0
  })
}

/**
 * Expand a requirement key through its alias table (`ranking.py:30-41`).
 * @param key - the requirement key.
 * @param actual - the value found in `specs`.
 * @param searchText - the offer's concatenated searchable text.
 * @param expected - the requirement value.
 * @returns whether any alias matches.
 */
function requirementMatches(
  key: string,
  actual: string | undefined,
  searchText: string,
  expected: string,
): boolean {
  const aliases = REQUIREMENT_ALIASES.get(key) ?? [expected]
  return aliases.some((alias) => valueMatches(actual, alias) || valueMatches(searchText, alias))
}
