import { compareDecimals, decimalToNumber, formatFixed2, isTruthyDecimal } from './decimal.js'
import type { RankedOffer, Requirements } from './domain.js'

/**
 * The Markdown report, ported from `reporting.py`.
 *
 * The report is a four-slot digest — most suitable, cheapest, best value, worth
 * stretching for — plus up to five rejects. An eligible offer that fills none
 * of those slots never appears, which is why the tool surface also exposes the
 * full session.
 */

/** The price-boundary line every report carries (`reporting.py:92-95`). */
export const PRICE_DISCLAIMER =
  '> 价格来自页面可见信息。估算应付只计算页面明确展示且可直接解析的优惠，不代表结算价格。'

/** Placeholder when a slot has no candidate (`reporting.py:17`). */
const NO_CANDIDATE = '暂无满足条件的候选。'

/** Placeholder when nothing was rejected (`reporting.py:115`). */
const NO_REJECTS = '暂无明确不推荐项。'

/** At most five rejects are listed (`reporting.py:112`). */
const MAX_REJECTED = 5

/**
 * Choose the price a report line shows (`reporting.py:8-13`).
 * @param item - the ranked offer.
 * @returns the serialised price, or null when unknown.
 */
function displayPrice(item: RankedOffer): string | null {
  return isTruthyDecimal(item.offer.estimated_payable)
    ? item.offer.estimated_payable
    : item.offer.visible_price
}

/**
 * Render one offer block (`reporting.py:15-55`).
 * @param item - the ranked offer, or null for the placeholder.
 * @returns the block's lines.
 */
function offerBlock(item: RankedOffer | null): string[] {
  if (item === null) return [NO_CANDIDATE]
  const offer = item.offer
  // Python's `or` treats an empty string as absent, so these use falsiness
  // rather than a null check; `estimated_payable` deliberately does not, so a
  // zero payable still renders.
  const lines = [
    `- 商品：[${offer.title}](${offer.url})`,
    `- 平台：${offer.platform}`,
    `- 店铺：${offer.store_name !== null && offer.store_name !== '' ? offer.store_name : '页面未明确'}`,
    `- 匹配分：${formatFixed2(item.score)}`,
    `- SKU：${offer.sku !== null && offer.sku !== '' ? offer.sku : '页面未明确'}`,
  ]
  // The visible price is shown verbatim here; only the slot selection uses the
  // estimated-payable fallback (`reporting.py:26-30`).
  lines.push(
    `- 页面展示价：${offer.visible_price === null ? '未可靠提取' : `¥${offer.visible_price}`}`,
  )
  if (offer.estimated_payable !== null) lines.push(`- 估算应付：¥${offer.estimated_payable}`)
  if (offer.coupon !== null && offer.coupon !== '') lines.push(`- 可见优惠：${offer.coupon}`)
  if (offer.conditions.length > 0) lines.push(`- 优惠条件：${offer.conditions.join('；')}`)
  if (offer.llm_summary !== null && offer.llm_summary !== '') {
    lines.push(`- 优劣短评：${offer.llm_summary}`)
  }
  lines.push(`- 复核时间：${renderVerifiedAt(offer.verified_at)}`)
  lines.push(`- 数据可信度：${offer.confidence}`)
  if (item.unmet_requirements.length > 0) {
    lines.push(`- 未满足：${item.unmet_requirements.join('；')}`)
  }
  return lines
}

/**
 * Render a stored timestamp the way `datetime.isoformat()` does.
 *
 * Session files carry `…890123Z`; `isoformat()` renders the same instant as
 * `…890123+00:00`, and drops the fraction entirely when it is zero.
 * @param value - the stored timestamp.
 * @returns the rendered timestamp.
 */
export function renderVerifiedAt(value: string): string {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(value)
  if (match === null) return value
  const [, head, fraction] = match
  const micros = (fraction ?? '').padEnd(6, '0').slice(0, 6)
  const suffix = micros === '000000' ? '' : `.${micros}`
  return `${head ?? ''}${suffix}+00:00`
}

/**
 * Build the Markdown report (`reporting.py:58-116`).
 * @param requirements - the requirement set.
 * @param ranked - offers already ordered by `rankOffers`.
 * @returns the report Markdown, ending in a single newline.
 */
export function buildMarkdownReport(
  requirements: Requirements,
  ranked: readonly RankedOffer[],
): string {
  const eligible = ranked.filter((item) => item.hard_requirements_met)
  const rejected = ranked.filter((item) => !item.hard_requirements_met)

  const best = eligible[0] ?? null
  const lowest = firstBy(eligible, (left, right) => comparePrices(left, right) < 0)
  const value = firstBy(eligible, (left, right) => valueRatio(left) > valueRatio(right))
  const stretch =
    ranked.find(
      (item) =>
        requirements.budget_max !== null &&
        displayPrice(item) !== null &&
        compareDecimals(displayPrice(item) as string, requirements.budget_max) > 0 &&
        item.hard_requirements_met,
    ) ?? null

  const sections: string[] = [
    `# DealBuddy 选品报告：${requirements.category}`,
    '',
    `需求版本：v${requirements.version}`,
    '',
    PRICE_DISCLAIMER,
    '',
    '## 最符合需求',
    ...offerBlock(best),
    '',
    '## 最低预算',
    ...offerBlock(lowest),
    '',
    '## 综合性价比',
    ...offerBlock(value),
    '',
    '## 值得加预算',
    ...offerBlock(stretch),
    '',
    '## 不推荐项',
  ]
  if (rejected.length > 0) {
    for (const item of rejected.slice(0, MAX_REJECTED)) sections.push(...offerBlock(item))
  } else {
    sections.push(NO_REJECTS)
  }
  return `${sections.join('\n').replace(/\s+$/u, '')}\n`
}

/**
 * Pick the first extremum, matching Python's `min`/`max` tie behaviour.
 * @param items - the candidates.
 * @param isBetter - whether the first argument beats the second.
 * @returns the winning item, or null when there are no candidates.
 */
function firstBy(
  items: readonly RankedOffer[],
  isBetter: (left: RankedOffer, right: RankedOffer) => boolean,
): RankedOffer | null {
  let winner: RankedOffer | null = null
  for (const item of items) {
    if (winner === null || isBetter(item, winner)) winner = item
  }
  return winner
}

/**
 * Compare two offers by display price, treating a missing price as infinite.
 * @param left - the left offer.
 * @param right - the right offer.
 * @returns a negative, zero, or positive comparator result.
 */
function comparePrices(left: RankedOffer, right: RankedOffer): number {
  const leftPrice = displayPrice(left)
  const rightPrice = displayPrice(right)
  if (leftPrice === null && rightPrice === null) return 0
  if (leftPrice === null) return 1
  if (rightPrice === null) return -1
  return compareDecimals(leftPrice, rightPrice)
}

/**
 * Score-per-yuan, with Python's `or Decimal("1")` fallback for a falsy price.
 * @param item - the ranked offer.
 * @returns the value ratio.
 */
function valueRatio(item: RankedOffer): number {
  const price = displayPrice(item)
  const divisor = price !== null && isTruthyDecimal(price) ? decimalToNumber(price) : 1
  return item.score / divisor
}
