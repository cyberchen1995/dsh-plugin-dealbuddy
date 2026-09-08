import { describe, expect, it } from 'vitest'

import {
  DETAIL_ROWS,
  fieldValue,
  formatPrice,
  objectEntries,
  offerToMarkdown,
  safeUrl,
} from '../../src/client/workbench/format.js'
import type { OfferView } from '../../src/client/workbench/types.js'

/**
 * The panel's field formatting against the Python workbench's.
 *
 * Someone moving between the two workbenches should read the same card, so the
 * fallbacks, the separators and the Markdown export are checked literally.
 */

/** One product with every field filled. */
const FULL: OfferView = {
  platform: 'taobao',
  title: '示例牌 65 英寸电视',
  url: 'https://item.taobao.com/item.htm?id=1',
  store_name: '示例官方旗舰店',
  brand: '示例牌',
  model: 'DB-65A',
  specs: { 屏幕尺寸: '65英寸', 分辨率: '4K' },
  sku: '65英寸 / 黑色',
  listed_price: '5299',
  visible_price: '4599.00',
  coupon: '满5000减300',
  estimated_payable: '4599.00',
  conditions: ['前100名', '限新客'],
  stock: '有货',
  parameters: { sku_id: '9001', ocr_text: '详情图文本' },
  verified_at: '2026-01-01T00:00:00.000000Z',
  confidence: 'high',
}

describe('workbench formatting', () => {
  it('formats a price with the yuan sign and says so when there is none', () => {
    expect(formatPrice('4599.00')).toBe('¥4599.00')
    expect(formatPrice(null)).toBe('未提取')
    expect(formatPrice('')).toBe('未提取')
  })

  it('joins list fields with the full-width semicolon', () => {
    expect(fieldValue(['前100名', '限新客'])).toBe('前100名；限新客')
    expect(fieldValue([])).toBe('未明确')
    expect(fieldValue(null)).toBe('未明确')
  })

  it('keeps object entries in stored order and drops empty values', () => {
    expect(objectEntries({ 分辨率: '4K', 面板: '', 尺寸: '65英寸' })).toEqual([
      ['分辨率', '4K'],
      ['尺寸', '65英寸'],
    ])
  })

  it('shows every detail row the Python workbench shows, in the same order', () => {
    expect(DETAIL_ROWS.map((row) => row.label)).toEqual([
      '平台',
      '店铺',
      '品牌',
      '型号',
      'SKU',
      '页面展示价',
      '估算应付',
      '标价',
      '优惠',
      '优惠条件',
      '库存',
      '可信度',
      '复核时间',
      '链接',
    ])
  })

  it('falls back per field the way the workbench does', () => {
    const empty: OfferView = {}
    const rendered = new Map(DETAIL_ROWS.map((row) => [row.label, row.read(empty)]))

    expect(rendered.get('平台')).toBe('未明确')
    // Prices say 未提取 rather than 未明确: a missing price is a failed read,
    // not an unstated fact.
    expect(rendered.get('页面展示价')).toBe('未提取')
    expect(rendered.get('估算应付')).toBe('未提取')
    expect(rendered.get('优惠条件')).toBe('未明确')
  })

  it('exports the same Markdown the Python workbench copies', () => {
    expect(offerToMarkdown(FULL, 0)).toBe(
      [
        '# 商品 1：示例牌 65 英寸电视',
        '',
        '- 平台：taobao',
        '- 链接：https://item.taobao.com/item.htm?id=1',
        '- 店铺：示例官方旗舰店',
        '- 品牌：示例牌',
        '- 型号：DB-65A',
        '- SKU：65英寸 / 黑色',
        '- 标价：5299',
        '- 页面展示价：¥4599.00',
        '- 估算应付：¥4599.00',
        '- 优惠：满5000减300',
        '- 优惠条件：前100名；限新客',
        '- 库存：有货',
        '- 可信度：high',
        '- 复核时间：2026-01-01T00:00:00.000000Z',
        '',
        '## 规格',
        '- 屏幕尺寸：65英寸',
        '- 分辨率：4K',
        '',
        '## 页面参数',
        '- sku_id：9001',
        '',
        '## OCR 文本',
        '',
        '```text',
        '详情图文本',
        '```',
      ].join('\n'),
    )
  })

  it('links only to http and https', () => {
    expect(safeUrl('https://item.jd.com/1.html')).toBe('https://item.jd.com/1.html')
    // A captured page controls this string, so anything that could execute is
    // rendered as plain text instead of a link.
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl('not a url')).toBeUndefined()
    expect(safeUrl('')).toBeUndefined()
  })
})
