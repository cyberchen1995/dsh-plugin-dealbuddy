import type { OfferView } from './types.js'

/**
 * The workbench's field formatting, kept identical to the Python workbench's
 * (`static/index.html`): the same fallbacks, the same separators, and the same
 * Markdown export, so a person moving between the two reads the same card.
 *
 * The price wording is a product rule, not a style choice: what DealBuddy
 * computes is 「估算应付」, never a settlement price.
 */

/**
 * Read a value as display text.
 * @param value - the raw stored value.
 * @param fallback - what to show when it is empty.
 * @returns the text to display.
 */
export function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  const rendered = String(value)
  return rendered === '' ? fallback : rendered
}

/**
 * Format a price the way the workbench does.
 * @param value - the stored decimal string.
 * @returns the price, or 未提取.
 */
export function formatPrice(value: unknown): string {
  const rendered = text(value)
  return rendered === '' ? '未提取' : `¥${rendered}`
}

/**
 * Read a field that may hold a list.
 * @param value - the raw stored value.
 * @param fallback - what to show when it is empty.
 * @returns the text to display.
 */
export function fieldValue(value: unknown, fallback = '未明确'): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((entry) => text(entry)).join('；') : fallback
  }
  return text(value, fallback)
}

/**
 * Read an object's non-empty entries in stored order.
 * @param value - the raw stored value.
 * @returns the entries, or an empty list.
 */
export function objectEntries(value: unknown): [string, string][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => text(entry) !== '')
    .map(([key, entry]) => [key, text(entry)])
}

/**
 * Read the recognised detail-image text of an offer.
 * @param offer - the offer.
 * @returns the text, or an empty string.
 */
export function ocrTextOf(offer: OfferView): string {
  const parameters = offer.parameters
  if (parameters === null || typeof parameters !== 'object') return ''
  return text((parameters as Record<string, unknown>)['ocr_text'])
}

/**
 * Accept only a URL safe to put in an href.
 * @param value - the stored URL.
 * @returns the URL, or undefined when it is not http(s).
 */
export function safeUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (raw === '') return undefined
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : undefined
  } catch {
    return undefined
  }
}

/** The detail rows, in the Python workbench's order. */
export const DETAIL_ROWS: readonly {
  label: string
  read: (offer: OfferView) => string
}[] = [
  { label: '平台', read: (offer) => fieldValue(offer.platform) },
  { label: '店铺', read: (offer) => fieldValue(offer.store_name) },
  { label: '品牌', read: (offer) => fieldValue(offer.brand) },
  { label: '型号', read: (offer) => fieldValue(offer.model) },
  { label: 'SKU', read: (offer) => fieldValue(offer.sku) },
  { label: '页面展示价', read: (offer) => formatPrice(offer.visible_price) },
  { label: '估算应付', read: (offer) => formatPrice(offer.estimated_payable) },
  { label: '标价', read: (offer) => fieldValue(offer.listed_price) },
  { label: '优惠', read: (offer) => fieldValue(offer.coupon) },
  { label: '优惠条件', read: (offer) => fieldValue(offer.conditions) },
  { label: '库存', read: (offer) => fieldValue(offer.stock) },
  { label: '可信度', read: (offer) => fieldValue(offer.confidence) },
  { label: '复核时间', read: (offer) => fieldValue(offer.verified_at) },
  { label: '链接', read: (offer) => fieldValue(offer.url) },
]

/**
 * Export one product as Markdown, byte-for-byte as the Python workbench does.
 * @param offer - the offer.
 * @param index - its position in the list.
 * @returns the Markdown document.
 */
export function offerToMarkdown(offer: OfferView, index: number): string {
  const lines = [
    `# 商品 ${index + 1}：${text(offer.title, '未命名商品')}`,
    '',
    `- 平台：${text(offer.platform, '未明确')}`,
    `- 链接：${text(offer.url, '未明确')}`,
    `- 店铺：${text(offer.store_name, '未明确')}`,
    `- 品牌：${text(offer.brand, '未明确')}`,
    `- 型号：${text(offer.model, '未明确')}`,
    `- SKU：${text(offer.sku, '未明确')}`,
    `- 标价：${text(offer.listed_price, '未明确')}`,
    `- 页面展示价：${formatPrice(offer.visible_price)}`,
    `- 估算应付：${formatPrice(offer.estimated_payable)}`,
    `- 优惠：${text(offer.coupon, '未明确')}`,
    `- 优惠条件：${fieldValue(offer.conditions)}`,
    `- 库存：${text(offer.stock, '未明确')}`,
    `- 可信度：${text(offer.confidence, '未明确')}`,
    `- 复核时间：${text(offer.verified_at, '未明确')}`,
  ]
  if (text(offer.llm_summary) !== '') {
    lines.push(`- 优劣短评：${text(offer.llm_summary)}`)
  }
  const specs = objectEntries(offer.specs)
  if (specs.length > 0) {
    lines.push('', '## 规格')
    for (const [key, value] of specs) lines.push(`- ${key}：${value}`)
  }
  const parameters = objectEntries(offer.parameters).filter(([key]) => key !== 'ocr_text')
  if (parameters.length > 0) {
    lines.push('', '## 页面参数')
    for (const [key, value] of parameters) lines.push(`- ${key}：${value}`)
  }
  const ocr = ocrTextOf(offer)
  if (ocr !== '') {
    lines.push('', '## OCR 文本', '', '```text', ocr, '```')
  }
  return lines.join('\n')
}
