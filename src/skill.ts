import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
// Type-only import: pulls in the declaration merge that adds `ctx.skills`.
import type {} from '@deepseek-ai/dsh-skill'

/**
 * Register the packaged DealBuddy skill.
 *
 * The skill ships inside the package rather than being copied into
 * `$DSH_HOME/skills`, so `resourceBase` must be an absolute runtime path:
 * built output lives in `lib/`, one level below the package root.
 * @param ctx - a context whose `skills` service is ready.
 * @returns nothing; the registration unwinds with the context.
 */
export async function registerSkill(ctx: Context): Promise<void> {
  const skillDir = join(packageRoot(), 'skills', 'dealbuddy')
  const raw = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  const { description, body } = splitFrontmatter(raw)
  ctx.skills.register({
    name: 'dealbuddy',
    description,
    content: body,
    source: 'runtime',
    resourceBase: { kind: 'directory', path: skillDir },
    path: join(skillDir, 'SKILL.md'),
  })
}

/**
 * Resolve the installed package root from the built module location.
 * @returns the absolute package root.
 */
function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/**
 * Split YAML frontmatter from a SKILL.md body.
 *
 * Only `description` is needed for the catalog; the rest of the frontmatter is
 * metadata the registry does not consume for runtime skills.
 * @param raw - the file contents.
 * @returns the description and the markdown body.
 */
export function splitFrontmatter(raw: string): { description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) return { description: '', body: raw.trim() }
  const [, frontmatter] = match
  const body = raw.slice(match[0].length).trim()
  const description = readScalar(frontmatter ?? '', 'description')
  return { description, body }
}

/**
 * Read one single-line scalar from simple YAML frontmatter.
 * @param frontmatter - the raw frontmatter block.
 * @param key - the key to read.
 * @returns the trimmed value, or an empty string when absent.
 */
function readScalar(frontmatter: string, key: string): string {
  for (const line of frontmatter.split(/\r?\n/)) {
    if (!line.startsWith(`${key}:`)) continue
    const value = line.slice(key.length + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }
  return ''
}
