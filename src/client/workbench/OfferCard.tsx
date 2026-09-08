import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

import {
  DETAIL_ROWS,
  objectEntries,
  ocrTextOf,
  offerToMarkdown,
  formatPrice,
  safeUrl,
  text,
} from './format.js'
import type { OfferView } from './types.js'

/** What one product card needs. */
export interface OfferCardProps {
  offer: OfferView
  index: number
  open: boolean
  busy: boolean
  onToggle: () => void
  onDelete: () => void
  onCopied: (copied: boolean) => void
}

/**
 * One captured product: a collapsed line, and every stored field when opened.
 *
 * The card is keyed on the product URL by its caller, which is also the
 * identity the delete uses, so a re-capture that moves a product to the end of
 * the list keeps this card's expanded state and its scroll position.
 * @param props - the product and its controls.
 * @returns the card.
 */
export function OfferCard(props: OfferCardProps): JSX.Element {
  const { offer, index, open } = props
  const specs = objectEntries(offer.specs)
  const parameters = objectEntries(offer.parameters).filter(([key]) => key !== 'ocr_text')
  const ocr = ocrTextOf(offer)
  const href = safeUrl(offer.url)
  const title = text(offer.title, '未命名商品')
  const summary = text(offer.llm_summary)

  return (
    <div className="db-wb-offer">
      <div
        className="db-wb-offer-summary"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${title} 的详情`}
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onToggle()
          }
        }}
      >
        <span className="db-wb-offer-headline">
          <span className="db-wb-offer-title">
            {href === undefined ? (
              title
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.stopPropagation()
                }}
              >
                {title}
              </a>
            )}
          </span>
          <span className="db-wb-session-meta">{text(offer.store_name, '店铺未明确')}</span>
        </span>
        <span className="db-wb-offer-meta">
          <span className="db-wb-pill">{text(offer.platform, '平台未明确')}</span>
          <span className="db-wb-pill is-price">{formatPrice(offer.visible_price)}</span>
          <span className="db-wb-pill">SKU {text(offer.sku, '未明确')}</span>
        </span>
      </div>
      {open ? (
        <div className="db-wb-offer-body">
          {summary === '' ? null : <div className="db-wb-insight">优劣短评：{summary}</div>}
          <div className="db-wb-grid">
            {DETAIL_ROWS.map((row) => (
              <div className="db-wb-item" key={row.label}>
                <span className="db-wb-item-label">{row.label}</span>
                <span className="db-wb-item-value">{row.read(offer)}</span>
              </div>
            ))}
          </div>
          <KeyValueSection title="规格" entries={specs} />
          <KeyValueSection title="页面参数" entries={parameters} />
          {ocr === '' ? null : (
            <div>
              <h4 className="db-wb-subhead">OCR 文本</h4>
              <pre className="db-wb-ocr">{ocr}</pre>
            </div>
          )}
          <div className="db-wb-actions">
            <button
              className="db-wb-button"
              type="button"
              onClick={() => {
                void writeClipboard(offerToMarkdown(offer, index)).then((copied) => {
                  props.onCopied(copied)
                })
              }}
            >
              复制 Markdown
            </button>
            <button
              className="db-wb-button is-danger"
              type="button"
              disabled={props.busy}
              onClick={props.onDelete}
            >
              删除
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Render one titled block of key/value pairs, or nothing when it is empty.
 * @param props - the title and the entries.
 * @returns the block, or null.
 */
function KeyValueSection(props: { title: string; entries: [string, string][] }): JSX.Element | null {
  if (props.entries.length === 0) return null
  return (
    <div>
      <h4 className="db-wb-subhead">{props.title}</h4>
      <div className="db-wb-grid">
        {props.entries.map(([key, value]) => (
          <div className="db-wb-item" key={key}>
            <span className="db-wb-item-label">{key}</span>
            <span className="db-wb-item-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
