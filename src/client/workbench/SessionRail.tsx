import { text } from './format.js'
import type { SessionSummaryView } from './types.js'

/** What the session rail needs. */
export interface SessionRailProps {
  sessions: readonly SessionSummaryView[]
  currentId: string | null
  busy: boolean
  draftCategory: string
  draftRequest: string
  onDraft: (field: 'draftCategory' | 'draftRequest', value: string) => void
  onCreate: () => void
  onSelect: (sessionId: string) => void
}

/**
 * The shopping sessions, newest first, plus the form that starts one.
 *
 * Selecting a session is the same act as pointing captures at it: the browser
 * extension always delivers into the current session and never names one, so a
 * separate "just look at it" mode would only mislead.
 * @param props - the sessions and their controls.
 * @returns the rail.
 */
export function SessionRail(props: SessionRailProps): JSX.Element {
  return (
    <>
      <h3 className="db-wb-section-title">购物会话</h3>
      <p className="db-wb-hint">扩展会把商品投递到当前会话。</p>
      <form
        className="db-wb-form"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCreate()
        }}
      >
        <label className="db-wb-form">
          <span className="db-wb-hint">品类</span>
          <input
            className="db-wb-input"
            value={props.draftCategory}
            placeholder="电视 / 扫地机器人 / 手机"
            onChange={(event) => {
              props.onDraft('draftCategory', event.target.value)
            }}
          />
        </label>
        <label className="db-wb-form">
          <span className="db-wb-hint">原始需求</span>
          <textarea
            className="db-wb-textarea"
            value={props.draftRequest}
            placeholder="预算5000以内，65英寸，主要看电影"
            onChange={(event) => {
              props.onDraft('draftRequest', event.target.value)
            }}
          />
        </label>
        <div className="db-wb-actions">
          <button
            className="db-wb-button is-primary"
            type="submit"
            disabled={props.busy || props.draftCategory.trim() === ''}
          >
            新建会话
          </button>
        </div>
      </form>
      {props.sessions.length === 0 ? (
        <div className="db-wb-empty">
          <div className="db-wb-empty-title">还没有会话</div>
          <div>先输入品类和需求，再用浏览器扩展采集商品。</div>
        </div>
      ) : (
        <ul className="db-wb-sessions">
          {props.sessions.map((session) => (
            <li key={session.session_id}>
              <button
                className="db-wb-session"
                type="button"
                aria-current={session.session_id === props.currentId}
                disabled={props.busy}
                onClick={() => {
                  props.onSelect(session.session_id)
                }}
              >
                <span className="db-wb-session-name">{text(session.category, '未命名')}</span>
                <span className="db-wb-session-meta">
                  <span>{session.session_id}</span>
                  <span>v{session.version}</span>
                  <span>{session.verified_count} 件</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
