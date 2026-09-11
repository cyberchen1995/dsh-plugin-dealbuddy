import type { BoundContext, MissingBinding } from './bindings.js'

/**
 * The two pieces of prose this feature puts in front of the model.
 *
 * Both are pure functions of the facts so they can be asserted literally: the
 * context block is re-rendered on every model request, where a wrong word would
 * repeat forever, and the price wording is a product rule rather than a style
 * choice.
 */

/** The name the harness shows on the injected context row. */
export const CONTEXT_NAME = 'dealbuddy'

/**
 * Render the context block for a bound conversation.
 *
 * Returns an empty string when there is nothing to say — the harness drops a
 * context contribution that renders empty, so a conversation with no shopping
 * session behind it carries no trace of this plugin at all.
 * @param bound - the facts, a missing marker, or undefined when unbound.
 * @returns the model-facing text.
 */
export function renderBindingContext(
  bound: BoundContext | MissingBinding | undefined,
): string {
  if (bound === undefined) return ''
  if ('missing' in bound) {
    return [
      `DealBuddy 购物会话 ${bound.session_id} 读不到了，文件可能已被删除或移动。`,
      '告诉用户，让他在 DealBuddy 抽屉里重新绑定一个会话。',
    ].join('\n')
  }
  const lines = [
    `DealBuddy 购物会话 ${bound.session_id} · ${bound.category === '' ? '未填品类' : bound.category}`,
    `需求 v${bound.version}：${bound.raw_request === '' ? '未填写' : bound.raw_request}`,
  ]
  const budget = renderBudget(bound.budget_min, bound.budget_max)
  if (budget !== '') lines.push(`预算：${budget}`)
  if (bound.must_have.length > 0) {
    lines.push(`硬性要求：${bound.must_have.map(([key, value]) => `${key}=${value}`).join(', ')}`)
  }
  lines.push(
    `已采集 ${bound.verified_count} 件 · 报告${bound.report_available ? '可用' : '不可用'}`,
    bound.is_capture_target
      ? '投递目标是本会话'
      : `投递目标不是本会话（当前投递到 ${bound.capture_target ?? '未设置'}），扩展采集不会投到这里`,
    '工具 dealbuddy_show_session / dealbuddy_get_report，session_id 省略即本会话。',
    'estimated_payable 是估算应付，不是结算价，以结算页为准。',
  )
  return lines.join('\n')
}

/** The message the panel's evaluate button sends into the conversation. */
export interface EvaluationMessage {
  /** The model-facing text. */
  text: string
  /** The one-line account shown while the row is collapsed. */
  summary: string
}

/**
 * Build the request that asks the model to go through a report.
 * @param report - the stored Markdown report.
 * @param bound - the facts about the session it belongs to.
 * @returns the message text and its collapsed summary.
 */
export function buildEvaluationMessage(report: string, bound: BoundContext): EvaluationMessage {
  const category = bound.category === '' ? '未填品类' : bound.category
  const text = [
    `以下是购物会话 ${bound.session_id}（${category}）的选品报告。`,
    '',
    report,
    '',
    '---',
    '请逐项评估：',
    '- 最符合需求、最低预算、综合性价比、值得加预算四个槽位及不推荐项，核对与商品事实是否一致。',
    '- 指出数据缺口：缺规格、缺库存信息、可信度为 low 的商品。',
    '- 按用户需求给出取舍建议。',
    '- 价格只说「估算应付」，以结算页实际金额为准。',
  ].join('\n')
  return { text, summary: `${category}选品报告 · 评估请求` }
}

/**
 * Render the budget range.
 *
 * One-sided ranges keep the dash and leave the other end blank, so a reader can
 * see which end was stated.
 * @param min - the lower bound, or null.
 * @param max - the upper bound, or null.
 * @returns the range, or an empty string when neither end is set.
 */
function renderBudget(min: string | null, max: string | null): string {
  const low = min ?? ''
  const high = max ?? ''
  if (low === '' && high === '') return ''
  return `${low}–${high}`
}
