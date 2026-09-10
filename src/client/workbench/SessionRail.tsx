import { text } from './format.js'
import type { BindingView, SessionSummaryView } from './types.js'

/** What the session rail needs. */
export interface SessionRailProps {
  sessions: readonly SessionSummaryView[]
  /** Where browser captures land. */
  currentId: string | null
  /** The shopping session this conversation is about. */
  boundSessionId: string | null
  bindings: readonly BindingView[]
  /** Conversation titles by id, for the rows that name one. */
  conversations: Readonly<Record<string, string>>
  /** Whether a conversation is on screen at all. */
  hasConversation: boolean
  busy: boolean
  draftCategory: string
  draftRequest: string
  onDraft: (field: 'draftCategory' | 'draftRequest', value: string) => void
  onCreate: () => void
  onBind: (sessionId: string) => void
  onBindToNew: (sessionId: string) => void
  onOpenConversation: (dshSessionId: string) => void
  onSetTarget: (sessionId: string) => void
}

/**
 * The shopping sessions, newest first, plus the form that starts one.
 *
 * A shopping session belongs to one conversation, so each row leads to that
 * conversation rather than switching something inside this panel. Where
 * captures land is a separate decision with its own control: the two are
 * allowed to differ, and saying so is more honest than hiding it.
 * @param props - the sessions and their controls.
 * @returns the rail.
 */
export function SessionRail(props: SessionRailProps): JSX.Element {
  return (
    <>
      <h3 className="db-wb-section-title">购物会话</h3>
      <p className="db-wb-hint">一个购物会话对应一段对话。扩展采集投递到投递目标。</p>
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
          {props.sessions.map((session) => {
            const binding = props.bindings.find((entry) => entry.session_id === session.session_id)
            const isBound = session.session_id === props.boundSessionId
            const isTarget = session.session_id === props.currentId
            return (
              <li key={session.session_id} className="db-wb-session-row" aria-current={isBound}>
                <div className="db-wb-session">
                  <span className="db-wb-session-name">
                    {text(session.category, '未命名')}
                    {isTarget ? <span className="db-wb-pill">投递目标</span> : null}
                  </span>
                  <span className="db-wb-session-meta">
                    <span>{session.session_id}</span>
                    <span>v{session.version}</span>
                    <span>{session.verified_count} 件</span>
                  </span>
                  <span className="db-wb-session-meta">
                    {binding === undefined
                      ? '未绑定'
                      : `对话：${props.conversations[binding.dsh_session_id] ?? binding.dsh_session_id}`}
                  </span>
                </div>
                <div className="db-wb-actions">
                  {binding === undefined || !isBound ? (
                    <button
                      className="db-wb-button"
                      type="button"
                      disabled={props.busy || !props.hasConversation}
                      onClick={() => {
                        props.onBind(session.session_id)
                      }}
                    >
                      绑定到本对话
                    </button>
                  ) : null}
                  {binding === undefined ? (
                    <button
                      className="db-wb-button"
                      type="button"
                      disabled={props.busy}
                      onClick={() => {
                        props.onBindToNew(session.session_id)
                      }}
                    >
                      新建对话并绑定
                    </button>
                  ) : (
                    <button
                      className="db-wb-button"
                      type="button"
                      disabled={props.busy}
                      onClick={() => {
                        props.onOpenConversation(binding.dsh_session_id)
                      }}
                    >
                      打开对话
                    </button>
                  )}
                  {isTarget ? null : (
                    <button
                      className="db-wb-button"
                      type="button"
                      disabled={props.busy}
                      onClick={() => {
                        props.onSetTarget(session.session_id)
                      }}
                    >
                      设为投递目标
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
