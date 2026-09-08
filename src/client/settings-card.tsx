import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import type { DealbuddySettings } from '../settings.js'
import type { SettingsScopeLike, SettingsSnapshot } from './scope.js'

/**
 * The DealBuddy card in Settings → Plugins → Plugin configuration.
 *
 * Edits are staged locally and written only on save, and each write carries the
 * namespace revision the form read, so a card that has drifted from the
 * document is refused rather than overwriting a concurrent change. A field
 * counts as overridden by its PRESENCE in the user layer, not by its value: an
 * override that happens to equal the composed default is still an override.
 */

/** What the card needs from its host. */
export interface DealbuddyCardProps {
  /** The bound `dealbuddy` settings namespace. */
  scope: SettingsScopeLike<DealbuddySettings>
}

/** The fields the card edits, in the order they are shown. */
const FIELDS = [
  {
    field: 'port',
    label: '采集入库端口',
    hint: '浏览器扩展投递商品的端口。与 dealbuddy web 并存时改成别的端口，并把扩展弹窗里的投递地址改成同一个。',
    kind: 'number',
  },
  {
    field: 'dataDir',
    label: '数据目录',
    hint: '留空则取 DEALBUDDY_HOME 环境变量，再退回 ~/.dealbuddy。与 Python 工作台共用同一份数据。',
    kind: 'text',
  },
  {
    field: 'ocrTextPreviewChars',
    label: '详情图文本预览长度',
    hint: '查看会话时保留多少个字的识别文本。设为 0 表示不保留。',
    kind: 'number',
  },
  {
    field: 'extraAllowedDomains',
    label: '额外允许的投递域名',
    hint: '淘宝、天猫、京东之外还允许哪些主机后缀投递，用逗号分隔。留空表示不额外放行。',
    kind: 'list',
  },
  {
    field: 'legacyOffersRoute',
    label: '保留旧投递地址 /offers',
    hint: '老版本扩展设置里用的是 /offers。关掉后只接受 /api/current/offers。',
    kind: 'boolean',
  },
] as const satisfies readonly {
  field: keyof DealbuddySettings
  label: string
  hint: string
  kind: 'number' | 'text' | 'boolean' | 'list'
}[]

/**
 * Render the card.
 * @param props - the bound settings scope.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function DealbuddyCard(props: DealbuddyCardProps): JSX.Element | null {
  const { scope } = props
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => scope.subscribe(listener), [scope]),
    () => scope.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const value = snapshot.value
  const overridden = useMemo(() => overriddenFields(snapshot), [snapshot])

  // A deployment that does not compose the plugin should show no trace of it.
  if (snapshot.status === 'unavailable' || value === undefined) return null

  const dirty = Object.keys(draft).length > 0

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      for (const [field, raw] of Object.entries(draft)) {
        if (raw === undefined) continue
        const spec = FIELDS.find((entry) => entry.field === field)
        if (spec === undefined) continue
        await scope.set(field, parseField(spec.kind, raw))
      }
      setDraft({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const reset = async (field: string): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await scope.unset(field)
      setDraft((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <li style={styles.card}>
      <button
        type="button"
        style={styles.header}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span style={styles.headText}>
          <span style={styles.name}>
            DealBuddy
            {/* The marker reads as its own word so it cannot be mistaken for
                the save control when a reader scans the card. */}
            {dirty ? <span style={styles.dirty}>有改动待保存</span> : null}
          </span>
          <span style={styles.description}>
            采集入库端口、数据目录与投递白名单。
          </span>
        </span>
        <span aria-hidden style={styles.chevron}>
          {open ? '⌃' : '⌄'}
        </span>
      </button>
      {open ? (
        <div style={styles.body}>
          {FIELDS.map((spec) => (
            <label key={spec.field} style={styles.field}>
              <span style={styles.label}>
                {spec.label}
                {overridden.has(spec.field) ? (
                  <button
                    type="button"
                    style={styles.reset}
                    disabled={saving || !snapshot.writable}
                    onClick={() => void reset(spec.field)}
                  >
                    已修改，恢复默认
                  </button>
                ) : null}
              </span>
              {spec.kind === 'boolean' ? (
                <input
                  type="checkbox"
                  disabled={saving || !snapshot.writable}
                  checked={readDraftBoolean(draft, spec.field, value)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [spec.field]: event.target.checked ? 'true' : 'false',
                    }))
                  }
                />
              ) : (
                <input
                  type={spec.kind === 'number' ? 'number' : 'text'}
                  style={styles.input}
                  disabled={saving || !snapshot.writable}
                  value={readDraftText(draft, spec.field, value)}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [spec.field]: event.target.value }))
                  }
                />
              )}
              <span style={styles.hint}>{spec.hint}</span>
            </label>
          ))}
          {snapshot.writable ? null : (
            <p style={styles.notice}>这个连接不保存偏好设置，改动无法写入。</p>
          )}
          {error === undefined ? null : <p style={styles.error}>{error}</p>}
          <div style={styles.actions}>
            <button
              type="button"
              style={styles.save}
              disabled={!dirty || saving || !snapshot.writable}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <span style={styles.hint}>
              端口或数据目录改动保存后立即生效，监听器会重新绑定。
            </span>
          </div>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Read which fields the user layer overrides.
 * @param snapshot - the scope snapshot.
 * @returns the overridden field names.
 */
function overriddenFields(snapshot: SettingsSnapshot<DealbuddySettings>): Set<string> {
  const user = snapshot.user
  if (user === null || typeof user !== 'object') return new Set()
  return new Set(Object.keys(user as Record<string, unknown>))
}

/**
 * Read a text input's current value, preferring the staged edit.
 * @param draft - staged edits.
 * @param field - the field name.
 * @param value - the resolved section.
 * @returns the string to display.
 */
function readDraftText(
  draft: Partial<Record<string, string>>,
  field: string,
  value: DealbuddySettings,
): string {
  const staged = draft[field]
  if (staged !== undefined) return staged
  const current = (value as unknown as Record<string, unknown>)[field]
  if (Array.isArray(current)) return current.join(', ')
  return current === undefined || current === null ? '' : String(current)
}

/**
 * Read a checkbox's current value, preferring the staged edit.
 * @param draft - staged edits.
 * @param field - the field name.
 * @param value - the resolved section.
 * @returns whether the box is checked.
 */
function readDraftBoolean(
  draft: Partial<Record<string, string>>,
  field: string,
  value: DealbuddySettings,
): boolean {
  const staged = draft[field]
  if (staged !== undefined) return staged === 'true'
  return Boolean((value as unknown as Record<string, unknown>)[field])
}

/**
 * Turn one staged string into the JSON shape the namespace stores.
 * @param kind - the field's editor kind.
 * @param raw - the staged text.
 * @returns the value to write.
 * @throws when a number field does not hold a number.
 */
function parseField(kind: 'number' | 'text' | 'boolean' | 'list', raw: string): unknown {
  if (kind === 'boolean') return raw === 'true'
  if (kind === 'list') {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  }
  if (kind !== 'number') return raw
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`${raw} 不是一个数字`)
  return parsed
}

/** Inline styles; the section's own class names are build-hashed and private. */
const styles = {
  card: {
    listStyle: 'none',
    border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    padding: '18px 20px',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  },
  headText: { display: 'flex', flexDirection: 'column', gap: 6 },
  name: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600 },
  dirty: {
    padding: '1px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 400,
    background: 'color-mix(in srgb, currentColor 14%, transparent)',
  },
  description: { fontSize: 13, opacity: 0.7 },
  chevron: { opacity: 0.6 },
  body: { display: 'flex', flexDirection: 'column', gap: 18, padding: '0 20px 20px' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600 },
  input: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
  },
  hint: { fontSize: 12, opacity: 0.6, lineHeight: 1.5 },
  reset: {
    padding: '2px 8px',
    borderRadius: 6,
    border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
  actions: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  save: {
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    background: 'color-mix(in srgb, currentColor 16%, transparent)',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  },
  notice: { fontSize: 12, opacity: 0.7, margin: 0 },
  error: { fontSize: 12, margin: 0, color: '#e5484d' },
} as const satisfies Record<string, React.CSSProperties>
