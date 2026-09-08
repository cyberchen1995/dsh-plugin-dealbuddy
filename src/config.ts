import Schema from '@deepseek-ai/schemastery'

/**
 * Plugin configuration.
 *
 * dsh's rule is that any value a deployment might change must be a config
 * field, and invalid configuration must fail loudly at load. `host` is
 * deliberately absent: the intake listener binds `127.0.0.1` only, matching the
 * Python workbench's security boundary.
 */
export interface Config {
  /** Intake listener port; the Chrome extension defaults to 8765. */
  port: number
  /** DealBuddy data directory; empty means `$DEALBUDDY_HOME` or `~/.dealbuddy`. */
  dataDir: string
  /** Extra host suffixes accepted by the intake CORS allowlist. */
  extraAllowedDomains: string[]
  /** Characters of OCR text kept when a session is shown to the model. */
  ocrTextPreviewChars: number
  /** Whether the legacy `POST /offers` alias stays mounted. */
  legacyOffersRoute: boolean
}

export const Config: Schema<Config> = Schema.object({
  port: Schema.number().min(1).max(65535).default(8765),
  dataDir: Schema.string().default(''),
  extraAllowedDomains: Schema.array(Schema.string().pattern(/^[a-z0-9.-]+$/)).default([]),
  ocrTextPreviewChars: Schema.number().min(0).max(20000).default(400),
  legacyOffersRoute: Schema.boolean().default(true),
})
