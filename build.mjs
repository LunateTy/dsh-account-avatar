// Assemble client.js from src/.
//
// The browser half has to be one file: `dsh.client` names a single entry and
// `__ModuleLoader__` registers a single factory. The layering therefore lives in
// src/, and this script concatenates it back inside that one factory, in
// filename order. Every slice is a fragment of the same function body, so there
// are no imports and no exports — the order is the only contract.
//
// Run with --check to rebuild in memory and compare against client.js without
// writing; that is what proves a refactor changed no behaviour.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, 'src')
const TARGET = join(here, 'client.js')

// The factory id must equal the package name, and the dev checkout and the
// published copy differ only in that name. Reading it from the manifest keeps
// one build script valid in both.
const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const MODULE_ID = manifest.name

const HEADER = `/**
 * Browser half of the account avatar bundle.
 *
 * Adds a "Profile picture" page to Settings and repaints the sidebar account
 * launcher's avatar with the user's own image. The launcher seat itself stays
 * with the shipped account menu; this module only overrides the avatar paint
 * through one scoped stylesheet, so sign-in, notifications and the account
 * menu keep working untouched.
 */
window.__ModuleLoader__.load({
  id: '${MODULE_ID}',
  factory(require) {
`

// A trailing note rather than a header line: the header has to stay byte-identical
// to the hand-written original for --check to mean anything.
const FOOTER = `
    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
// ═══ built from src/ by build.mjs — edit the slices, not this file
`

if (!existsSync(SOURCE)) throw new Error(`no src directory at ${SOURCE}`)

const files = readdirSync(SOURCE).filter((name) => name.endsWith('.js')).sort()
if (files.length === 0) throw new Error('src has no .js slices')

const pieces = files.map((name) => {
  const text = readFileSync(join(SOURCE, name), 'utf8')
  // Each slice keeps its own trailing newline: the slices tile the original
  // line for line, so blank lines at a boundary belong to the earlier one.
  return text.endsWith('\n') ? text : text + '\n'
})

const assembled = HEADER + pieces.join('') + FOOTER

if (process.argv.includes('--check')) {
  const current = readFileSync(TARGET, 'utf8')
  // The banner lines are documentation the build keeps; compare the code with
  // them removed, which is the claim worth checking. Trailing whitespace is
  // ignored too, so a final newline cannot masquerade as a change.
  const withoutBanners = (text) =>
    text.split('\n').filter((line) => !line.startsWith('// ═══')).join('\n').trimEnd()
  const same = withoutBanners(assembled) === withoutBanners(current)
  console.log(`${files.length} slices, ${assembled.length} bytes assembled`)
  console.log(`matches ${TARGET}: ${same}`)
  if (!same) {
    // Point at the first divergence so the split can be corrected rather than
    // hunted for.
    const a = withoutBanners(assembled).split('\n')
    const b = withoutBanners(current).split('\n')
    const at = a.findIndex((line, index) => line !== b[index])
    console.log(`first difference at line ${at + 1}`)
    console.log(`  built:   ${JSON.stringify(a[at])}`)
    console.log(`  current: ${JSON.stringify(b[at])}`)
    process.exit(1)
  }
} else {
  writeFileSync(TARGET, assembled, 'utf8')
  console.log(`wrote ${TARGET} from ${files.length} slices (${assembled.length} bytes)`)
  for (const name of files) {
    const lines = readFileSync(join(SOURCE, name), 'utf8').split('\n').length
    console.log(`  ${name.padEnd(20)} ${String(lines).padStart(4)} lines`)
  }
}