import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const sourceRoot = join(root, 'apps/desktop/src')
const uiRoot = join(sourceRoot, 'components/ui')
const featureRoot = join(sourceRoot, 'features')
const sourceExtensions = new Set(['.ts', '.tsx', '.css'])
const rawPalette =
  /\b(?:bg|border|decoration|divide|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\S+/g
const arbitraryVisual =
  /\b(?:bg|border|decoration|fill|font|leading|outline|ring|rounded|shadow|stroke|text)-\[[^\]]+\]/g
const arbitrarySpacing = /\b(?:m[trblexy]?|p[trblexy]?|gap|space-[xy])-\[[^\]]+\]/g
const directPrimitive = /from\s+['"](?:@radix-ui|@base-ui)(?:\/[^'"]*)?['"]/g
const rawControl = /<(?:button|input|select|textarea)(?:\s|>)/g

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory()
        ? filesBelow(path)
        : sourceExtensions.has(extname(path))
          ? [path]
          : []
    }),
  )
  return nested.flat()
}

const failures = []
function inspect(path, source, expression, message) {
  for (const match of source.matchAll(expression)) {
    const line = source.slice(0, match.index).split('\n').length
    failures.push(`${relative(root, path)}:${line} ${message}: ${match[0]}`)
  }
}

for (const path of await filesBelow(sourceRoot)) {
  const source = await readFile(path, 'utf8')
  if (!path.startsWith(uiRoot))
    inspect(path, source, directPrimitive, 'UI libraries are private to components/ui')
  if (!path.startsWith(featureRoot)) continue
  inspect(path, source, rawPalette, 'use a semantic theme token')
  inspect(path, source, arbitraryVisual, 'arbitrary visual values are forbidden')
  inspect(path, source, arbitrarySpacing, 'arbitrary spacing is forbidden')
  inspect(path, source, rawControl, 'use the shared UI control')
}

if (failures.length) {
  console.error(
    ['Style boundary check failed:', ...failures.map((failure) => `  ${failure}`)].join('\n'),
  )
  process.exitCode = 1
}
