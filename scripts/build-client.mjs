/**
 * Build the browser bundle in the envelope dsh's module loader expects.
 *
 * The harness serves each plugin's client bundle as a script that calls
 * `window.__ModuleLoader__.load({ id, factory })`; the factory receives a
 * `require` resolving the ids listed as externals from the browser module
 * table. esbuild's CommonJS output already speaks that shape, so the build is
 * that output wrapped in the envelope.
 */
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/** Ids resolved by the browser module table rather than bundled. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-api-remotes',
]

const result = await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: EXTERNALS,
  logLevel: 'warning',
})

const [output] = result.outputFiles
if (output === undefined) throw new Error('esbuild produced no output')

const envelope = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${output.text}
    return module.exports;
  }
});
`

await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib/client.js'), envelope, 'utf8')
console.log(`lib/client.js  ${envelope.length} bytes`)
