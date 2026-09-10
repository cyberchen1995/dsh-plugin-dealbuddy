import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** This package renders Markdown without cordis, so its chrome arrives by prop. */
const LABELS: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/**
 * The session's report.
 *
 * There is no regenerate control: the report is rebuilt from the captured
 * products on every capture and every delete, and an LLM rewrite is a request
 * to make in the conversation, where the model can say what it changed.
 * @param props - the stored Markdown, or null when there is none.
 * @returns the report column's body.
 */
export function ReportView(props: { report: string | null }): JSX.Element {
  if (props.report === null || props.report === '') {
    return (
      <div className="db-wb-empty">
        <div className="db-wb-empty-title">暂无报告</div>
        <div>采集商品后自动生成。</div>
      </div>
    )
  }
  return (
    <div className="db-wb-report">
      <MarkdownText text={props.report} labels={LABELS} />
    </div>
  )
}
