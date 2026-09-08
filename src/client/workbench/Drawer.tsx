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
  const dialogOpen = state.pendingDelete !== null

  // Escape closes the confirmation first, then the drawer: the innermost layer
  // is the one a person means to dismiss.
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (dialogOpen) store.askDelete(null)
      else store.close()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, dialogOpen, store])

  useEffect(() => {
    if (open) rootRef.current?.focus()
  }, [open])

  // The tab coming back to the front re-reads immediately rather than waiting
  // out the poll interval.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') store.resume()
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

  return (
    <div
      className="db-wb-root"
      data-dealbuddy-workbench
      role="dialog"
      aria-modal={false}
      aria-label="DealBuddy 工作台"
      tabIndex={-1}
      ref={rootRef}
    >
      <div className="db-wb-head">
        <h2 className="db-wb-title">DealBuddy 工作台</h2>
        {state.status === null ? null : (
          <span className="db-wb-head-status">
            <span>{state.status.listening ? '投递地址' : '未监听'}</span>
            <code>{state.status.intake_url}</code>
          </span>
        )}
        <span className="db-wb-spacer" />
        {state.loading ? <span className="db-wb-hint">同步中…</span> : null}
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

      <div className="db-wb-body">
        <div className="db-wb-col">
          <SessionRail
            sessions={state.sessions}
            currentId={state.currentId}
            busy={state.busy}
            draftCategory={state.draftCategory}
            draftRequest={state.draftRequest}
            onDraft={(field, value) => {
              store.setDraft(field, value)
            }}
            onCreate={() => {
              void store.createSession()
            }}
            onSelect={(sessionId) => {
              void store.selectSession(sessionId)
            }}
          />
          {state.error === null ? null : <p className="db-wb-error">{state.error}</p>}
        </div>

        <div className="db-wb-col">
          <h3 className="db-wb-section-title">
            商品{session === null ? '' : ` · ${category} · ${offers.length} 件`}
          </h3>
          {session === null ? (
            <div className="db-wb-empty">
              <div className="db-wb-empty-title">还没有当前会话</div>
              <div>选择左边的会话，或者新建一个。</div>
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
                  key={url === '' ? String(index) : url}
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
  const { onDone } = props
  useEffect(() => {
    const timer = setTimeout(onDone, 2600)
    return () => {
      clearTimeout(timer)
    }
  }, [onDone])
  return (
    <div className="db-wb-notice" role="status">
      {props.text}
    </div>
  )
}
