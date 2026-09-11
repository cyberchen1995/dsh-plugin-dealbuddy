/**
 * The panel's stylesheet, injected once.
 *
 * Chrome, spacing and type come from the harness's own alias tokens so the
 * drawer looks like the rest of dsh and follows its theme switch. Two colours
 * do not: the price and the price-caveat quote stay in DealBuddy's amber, and
 * delete stays in DealBuddy's red, because those are product meanings rather
 * than decoration. Their values are the same ones the capture extension and the
 * Python workbench use, and the dark pair is keyed on the harness's own
 * `body[data-ds-dark-theme]`.
 */

/** The style element's identity, matching the harness's own convention. */
const TAG_ID = 'dsh-plugin-dealbuddy/workbench.css'

const CSS = `
[data-dealbuddy-workbench] {
  --db-price-fg: #8a5c14;
  --db-price-bg: #f7edd8;
  --db-danger-fg: #a84848;
  --db-danger-bg: #f7e5e5;
}
body[data-ds-dark-theme] [data-dealbuddy-workbench] {
  --db-price-fg: #ecc287;
  --db-price-bg: rgba(224, 170, 92, 0.16);
  --db-danger-fg: #e39a9a;
  --db-danger-bg: rgba(217, 128, 128, 0.16);
}
[data-dealbuddy-workbench] {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: min(1100px, 100vw);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dsw-alias-bg-base, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  border-inline-start: .5px solid var(--dsw-alias-border-l3, currentColor);
  box-shadow: var(--dsw-elevation-soft, 0 4px 24px rgba(0, 0, 0, .18));
  font-size: 13px;
}
[data-dealbuddy-workbench] * { box-sizing: border-box; }
.db-wb-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: .5px solid var(--dsw-alias-border-l3, currentColor);
}
.db-wb-title { font-size: 14px; font-weight: 600; margin: 0; }
.db-wb-head-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-caption, currentColor);
}
.db-wb-head-status code {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-wb-spacer { flex: 1 1 auto; }
.db-wb-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1.25fr) minmax(0, 1fr);
}
.db-wb-col {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.db-wb-col + .db-wb-col { border-inline-start: .5px solid var(--dsw-alias-border-l3, currentColor); }
.db-wb-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, currentColor);
  margin: 0;
}
.db-wb-hint { font-size: 12px; color: var(--dsw-alias-label-caption, currentColor); margin: 0; line-height: 1.6; }
.db-wb-form { display: flex; flex-direction: column; gap: 8px; }
.db-wb-input,
.db-wb-textarea {
  width: 100%;
  padding: 7px 9px;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: inherit;
  font: inherit;
}
.db-wb-textarea { min-height: 56px; resize: vertical; }
.db-wb-sessions { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.db-wb-session-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  border: .5px solid transparent;
}
.db-wb-session-row[aria-current='true'] {
  background: var(--dsw-specific-sidebar-nav-item-active, rgba(127, 127, 127, .18));
  border-color: var(--dsw-alias-border-l2, currentColor);
}
.db-wb-session-row .db-wb-session { padding: 0; background: none; cursor: default; }
.db-wb-session-row .db-wb-session:hover { background: none; }
.db-wb-head-note { padding: 0 16px 8px; }
.db-wb-head-status { flex-direction: column; align-items: flex-start; gap: 2px; }
.db-wb-badge {
  padding: 2px 9px;
  border-radius: 999px;
  border: .5px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--db-price-bg);
  color: var(--db-price-fg);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.db-wb-session {
  width: 100%;
  text-align: start;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  border: .5px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.db-wb-session:hover { background: var(--dsw-specific-sidebar-nav-item-hover, rgba(127, 127, 127, .12)); }
.db-wb-session[aria-current='true'] {
  background: var(--dsw-specific-sidebar-nav-item-active, rgba(127, 127, 127, .18));
  border-color: var(--dsw-alias-border-l2, currentColor);
}
.db-wb-session-name { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.db-wb-session-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-caption, currentColor);
}
.db-wb-offer {
  border: .5px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: 10px;
  overflow: hidden;
}
.db-wb-offer-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  cursor: pointer;
  list-style: none;
}
.db-wb-offer-summary::-webkit-details-marker { display: none; }
.db-wb-offer-headline { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.db-wb-offer-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-wb-offer-title a { color: inherit; }
.db-wb-offer-meta { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.db-wb-pill {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .14));
  color: var(--dsw-alias-label-secondary, currentColor);
  white-space: nowrap;
}
.db-wb-pill.is-price { background: var(--db-price-bg); color: var(--db-price-fg); font-weight: 600; }
.db-wb-offer-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 12px 12px;
  border-top: .5px solid var(--dsw-alias-border-l3, currentColor);
}
.db-wb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 14px; }
.db-wb-item { display: flex; gap: 8px; min-width: 0; }
.db-wb-item-label { flex: none; min-width: 72px; color: var(--dsw-alias-label-caption, currentColor); }
.db-wb-item-value { min-width: 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary, currentColor); }
.db-wb-subhead { font-size: 12px; font-weight: 600; margin: 0 0 4px; }
.db-wb-ocr {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, .08));
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.db-wb-insight {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--db-price-bg);
  color: var(--db-price-fg);
  line-height: 1.6;
}
.db-wb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.db-wb-button {
  padding: 5px 12px;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.db-wb-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .14)); }
.db-wb-button:disabled { opacity: .5; cursor: default; }
.db-wb-button.is-danger { color: var(--db-danger-fg); background: var(--db-danger-bg); border-color: transparent; }
.db-wb-button.is-primary {
  /* The primary fill is a light plate in the dark theme and a dark one in the
     light theme, so the label has to come from its paired token rather than
     inheriting: an inherited colour renders white on white here. */
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .18)));
  color: var(--dsw-alias-label-primary-foreground, inherit);
  border-color: transparent;
}
.db-wb-button.is-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .24)));
}
.db-wb-report { line-height: 1.7; overflow-wrap: anywhere; }
.db-wb-report blockquote {
  margin: 4px 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--db-price-bg);
  color: var(--db-price-fg);
  font-size: 12.5px;
  line-height: 1.6;
}
.db-wb-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 24px 12px;
  text-align: center;
  color: var(--dsw-alias-label-caption, currentColor);
}
.db-wb-empty-title { font-weight: 600; color: var(--dsw-alias-label-secondary, currentColor); }
.db-wb-error { color: var(--db-danger-fg); margin: 0; }
.db-wb-notice {
  position: absolute;
  inset-block-end: 16px;
  inset-inline: 16px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 20, .9));
  border: .5px solid var(--dsw-alias-border-l2, currentColor);
  box-shadow: var(--dsw-elevation-soft, 0 4px 16px rgba(0, 0, 0, .2));
  text-align: center;
}
.db-wb-confirm-scrim {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .32);
}
.db-wb-confirm {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: 14px;
  background: var(--dsw-alias-bg-base, Canvas);
  border: .5px solid var(--dsw-alias-border-l2, currentColor);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 32px rgba(0, 0, 0, .28));
}
.db-wb-confirm-title { font-size: 14px; font-weight: 600; margin: 0; }
.db-wb-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.db-wb-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.db-wb-trigger:hover { background: var(--dsw-specific-sidebar-nav-item-hover, rgba(127, 127, 127, .12)); }
.db-wb-trigger[aria-pressed='true'] { background: var(--dsw-specific-sidebar-nav-item-active, rgba(127, 127, 127, .18)); }
.db-wb-trigger-dot { width: 6px; height: 6px; border-radius: 999px; flex: none; background: currentColor; }
@media (max-width: 960px) {
  .db-wb-body { grid-template-columns: minmax(0, 1fr); overflow: auto; }
  .db-wb-col { overflow: visible; }
  .db-wb-col + .db-wb-col {
    border-inline-start: none;
    border-top: .5px solid var(--dsw-alias-border-l3, currentColor);
  }
}
`

/**
 * Add the stylesheet to the document, and take it away again on unload.
 *
 * Two client instances overlap for a moment during a plugin reload, and the
 * second one adopts the first one's tag rather than adding a duplicate. So the
 * tag is only removed once nobody is left using it — and the count lives on the
 * node itself, because each bundle copy has its own module state and the DOM is
 * the only thing the two of them share.
 * @returns the disposer releasing this call's claim on the stylesheet.
 */
export function ensureWorkbenchStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const selector = `style[data-plugin-css=${JSON.stringify(TAG_ID)}]`
  let tag = document.querySelector<HTMLStyleElement>(selector)
  if (tag === null) {
    tag = document.createElement('style')
    tag.dataset['pluginCss'] = TAG_ID
    tag.textContent = CSS
    document.head.append(tag)
  }
  const owned = tag
  owned.dataset['pluginCssUsers'] = String(readUsers(owned) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = readUsers(owned) - 1
    if (left > 0) {
      owned.dataset['pluginCssUsers'] = String(left)
      return
    }
    owned.remove()
  }
}

/**
 * Read how many live instances claim the stylesheet.
 * @param tag - the style element.
 * @returns the recorded count, or 0 when it carries none.
 */
function readUsers(tag: HTMLStyleElement): number {
  const recorded = Number(tag.dataset['pluginCssUsers'])
  return Number.isFinite(recorded) && recorded > 0 ? recorded : 0
}
