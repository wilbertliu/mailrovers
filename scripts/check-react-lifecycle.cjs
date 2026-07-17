const fs = require('node:fs')
const path = require('node:path')

const repositoryRoot = path.resolve(__dirname, '..')
const sourceRoots = ['apps', 'packages']
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const forbiddenHooks = [
  ['use', 'Effect'].join(''),
  ['use', 'InsertionEffect'].join(''),
  ['use', 'LayoutEffect'].join(''),
]
const ignoredDirectories = new Set([
  '.vite',
  'build',
  'dist',
  'node_modules',
  'out',
  'storybook-static',
])
const violations = []

function inspectDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) inspectDirectory(entryPath)
      continue
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue

    const source = fs.readFileSync(entryPath, 'utf8')
    for (const hook of forbiddenHooks) {
      if (source.includes(hook))
        violations.push(`${path.relative(repositoryRoot, entryPath)}: ${hook}`)
    }
  }
}

for (const sourceRoot of sourceRoots) inspectDirectory(path.join(repositoryRoot, sourceRoot))

if (violations.length > 0) {
  process.stderr.write(`Generic React lifecycle hooks are forbidden:\n${violations.join('\n')}\n`)
  process.exitCode = 1
}
