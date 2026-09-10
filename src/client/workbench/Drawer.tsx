import { useEffect, useRef, useSyncExternalStore } from 'react'

import { text } from './format.js'
import { OfferCard } from './OfferCard.js'
import { ReportView } from './ReportView.js'
import { SessionRail } from './SessionRail.js'
import type { WorkbenchStore } from './store.js'
import { offersOf, type SessionView } from './types.js'

/**
 * The workbench drawer.
 *
 * It sits in the shell's overlay layer, which is click-through except for its
 * own children, so the drawer covers only the right-hand strip and the
 * conversation behind it stays usable. That is also why a pointer landing
 * outside it does NOT dismiss it: the panel is meant to be read while you type
 * in the conversation, and it holds a form whose draft a stray click would
 * hide. It closes from its own button, the sidebar button, or Escape.
 * @param props - the panel's store.
 * @returns the drawer, or nothing while it is closed.
 */
export function WorkbenchDrawer(props: { store: WorkbenchStore }): JSX.Element | null {
  const { store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const open = state.open
  const dialogOpen = state.pendingDelete !== null || state.pendingRebind !== null

  useEffect(() => {
    if (open) rootRef.current?.focus()
  }, [open])

  // Both directions matter: coming back to the front re-reads immediately
  // instead of waiting out the interval, and going to the back has to stop the
  // interval that is already armed.
  useEffect(() => {
    const onVisibility = (): void => {
      store.syncVisibility()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [store])

  if (!open) return null

  const session: SessionView | null = state.session
  const offers = offersOf(session)
  const report = typeof session?.report_markdown === 'string' ? session.report_markdown : null
  const category = text(session?.requirements?.category, '未命名')
  const boundLine =
    state.boundSessionId === null
      ? '本对话 · 未绑定'
      : `本对话 · ${category} · ${state.boundSessionId}`
  const target = state.sessions.find((entry) => entry.session_id === state.currentId)
  const targetLine =
    state.currentId === null
      ? '投递目标 · 未设置'
      : `投递目标 · ${text(target?.category, '未命名')} · ${state.currentId}`
  const mismatched = state.boundSessionId !== null && state.boundSessionId !== state.currentId
  const evaluateBlocked =
    state.boundSessionId === null
      ? '本对话未绑定购物会话'
      : report === null || report === ''
        ? '该会话暂无报告'
        : undefined

  return (
    <div
      className="db-wb-root"
      data-dealbuddy-workbench
      role="dialog"
      aria-modal={false}
      aria-label="DealBuddy 工作台"
      tabIndex={-1}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        // Scoped to the drawer's own subtree on purpose: a capture-phase
        // listener on document would swallow the Escape the harness's own
        // editors and popovers need while the panel sits open beside them.
        event.stopPropagation()
        if (state.pendingRebind !== null) void store.resolveRebind(false)
        else if (state.pendingDelete !== null) store.askDelete(null)
        else store.close()
      }}
    >
      <div className="db-wb-head">
        <h2 className="db-wb-title">DealBuddy 工作台</h2>
        <span className="db-wb-head-status">
          <span>{boundLine}</span>
          <span>{targetLine}</span>
        </span>
        <span className="db-wb-spacer" />
        {state.loading ? <span className="db-wb-hint">同步中…</span> : null}
        <button
          className="db-wb-button"
          type="button"
          disabled={state.busy || evaluateBlocked !== undefined}
          title={evaluateBlocked}
          onClick={() => {
            void store.evaluateReport()
          }}
        >
          评估报告
        </button>
        <button
          className="db-wb-button"
          type="button"
          onClick={() => {
            store.close()
          }}
        >
          关闭
        </button>
      </div>
      {mismatched ? (
        <p className="db-wb-hint db-wb-head-note">采集投递到投递目标，不是本对话绑定的会话</p>
      ) : null}

      <div className="db-wb-body">
        <div className="db-wb-col">
          <SessionRail
            sessions={state.sessions}
            currentId={state.currentId}
            boundSessionId={state.boundSessionId}
            bindings={state.bindings}
            conversations={state.conversations}
            hasConversation={state.conversation !== null}
            busy={state.busy}
            draftCategory={state.draftCategory}
            draftRequest={state.draftRequest}
            onDraft={(field, value) => {
              store.setDraft(field, value)
            }}
            onCreate={() => {
              void store.createSession()
            }}
            onBind={(sessionId) => {
              void store.bind(sessionId)
            }}
            onBindToNew={(sessionId) => {
              void store.bindToNewConversation(sessionId)
            }}
            onOpenConversation={(dshSessionId) => {
              store.openConversation(dshSessionId)
            }}
            onSetTarget={(sessionId) => {
              void store.selectSession(sessionId)
            }}
          />
          {state.error === null ? null : <p className="db-wb-error">{state.error}</p>}
        </div>

        <div className="db-wb-col">
          <h3 className="db-wb-section-title">
            商品{session === null ? '' : ` · ${category} · ${offers.length} 件`}
          </h3>
          {state.boundSessionId === null ? (
            <div className="db-wb-empty">
              <div className="db-wb-empty-title">本对话未绑定购物会话</div>
              <div>绑定后，模型可在对话里读取该会话的商品和报告。</div>
            </div>
          ) : session === null ? (
            <div className="db-wb-empty">
              <div className="db-wb-empty-title">读不到这个购物会话</div>
              <div>它的文件可能已被删除或移动。</div>
            </div>
          ) : offers.length === 0 ? (
            <div className="db-wb-empty">
              <div className="db-wb-empty-title">等待商品投递</div>
              <div>在商品详情页使用扩展采集价格、SKU 和规格。</div>
            </div>
          ) : (
            offers.map((offer, index) => {
              const url = text(offer.url)
              return (
                <OfferCard
                  key={url === '' ? `index:${index}` : `url:${url}`}
                  offer={offer}
                  index={index}
                  open={state.openUrls.includes(url)}
                  busy={state.busy}
                  onToggle={() => {
                    store.toggleOffer(url)
                  }}
                  onDelete={() => {
                    store.askDelete({ url, title: text(offer.title, '这个商品') })
                  }}
                  onCopied={(copied) => {
                    store.announce(copied ? '已复制 Markdown' : '复制失败，浏览器拒绝了剪贴板写入')
                  }}
                />
              )
            })
          )}
        </div>

        <div className="db-wb-col">
          <h3 className="db-wb-section-title">报告</h3>
          <ReportView report={report} />
        </div>
      </div>

      {state.notice === null ? null : (
        <Notice key={state.notice.seq} text={state.notice.text} onDone={() => { store.dismissNotice() }} />
      )}

      {state.pendingRebind === null ? null : (
        <div className="db-wb-confirm-scrim">
          <div className="db-wb-confirm" role="alertdialog" aria-label="换绑购物会话？">
            <h3 className="db-wb-confirm-title">换绑购物会话？</h3>
            <p className="db-wb-hint">
              「{text(state.pendingRebind.category, '未命名')} · {state.pendingRebind.session_id}
              」已绑定在对话「{state.pendingRebind.fromTitle}」上。绑定到本对话后，原对话解除绑定。
            </p>
            <div className="db-wb-confirm-actions">
              <button
                className="db-wb-button"
                type="button"
                onClick={() => {
                  void store.resolveRebind(false)
                }}
              >
                取消
              </button>
              <button
                className="db-wb-button is-primary"
                type="button"
                autoFocus
                onClick={() => {
                  void store.resolveRebind(true)
                }}
              >
                换绑
              </button>
            </div>
          </div>
        </div>
      )}

      {state.pendingDelete === null ? null : (
        <div className="db-wb-confirm-scrim">
          <div className="db-wb-confirm" role="alertdialog" aria-label="删除这个商品？">
            <h3 className="db-wb-confirm-title">删除这个商品？</h3>
            <p className="db-wb-hint">
              「{state.pendingDelete.title}」将从当前会话移除，报告会重新生成。
            </p>
            <div className="db-wb-confirm-actions">
              <button
                className="db-wb-button"
                type="button"
                onClick={() => {
                  store.askDelete(null)
                }}
              >
                取消
              </button>
              <button
                className="db-wb-button is-danger"
                type="button"
                autoFocus
                onClick={() => {
                  void store.confirmDelete()
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A transient message that clears itself.
 * @param props - the message and its dismissal.
 * @returns the notice.
 */
function Notice(props: { text: string; onDone: () => void }): JSX.Element {
  // The caller passes a fresh closure every render, so the timer is armed once
  // per notice (the element is keyed by sequence) and read through a ref.
  const onDone = useRef(props.onDone)
  onDone.current = props.onDone
  useEffect(() => {
    const timer = setTimeout(() => {
      onDone.current()
    }, 2600)
    return () => {
      clearTimeout(timer)
    }
  }, [])
  return (
    <div className="db-wb-notice" role="status">
      {props.text}
    </div>
  )
}
