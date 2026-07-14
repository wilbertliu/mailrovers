import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { channels } from '../electron/ipc/channels.js'
import { mailIpcRegistry } from '../electron/ipc/register-mail-application.js'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '../..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry)
    if (entry === 'node_modules' || entry === '.vite' || entry === 'out' || entry === 'test')
      return []
    return statSync(absolute).isDirectory()
      ? sourceFiles(absolute)
      : /\.[cm]?[jt]sx?$/.test(entry)
        ? [absolute]
        : []
  })
}

describe('Electron process boundaries', () => {
  it('keeps renderer sources free of Node, Electron, and Electron implementation imports', () => {
    for (const file of sourceFiles(path.join(desktopRoot, 'src'))) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/from\s+['"](?:electron|node:)/)
      expect(source).not.toMatch(/import\s*\(\s*['"](?:electron|node:)/)
      expect(source).not.toMatch(/['"]\.\.\/electron\//)
    }
    const rendererConfig = readFileSync(path.join(desktopRoot, 'tsconfig.renderer.json'), 'utf8')
    expect(JSON.parse(rendererConfig).compilerOptions.types).toEqual(['vite/client'])
    expect(JSON.parse(rendererConfig).include).toContain('renderer-node-ambient.canary.ts')
    expect(existsSync(path.join(desktopRoot, 'renderer-node-ambient.canary.ts'))).toBe(true)
    expect(existsSync(path.join(desktopRoot, 'src/renderer-node-ambient.canary.ts'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(desktopRoot, 'tsconfig.json'), 'utf8')).files).toEqual(
      [],
    )
  })

  it('has matching invoke registry and preload coverage', () => {
    const preload = readFileSync(path.join(desktopRoot, 'electron/preload.ts'), 'utf8')
    const invokedNames = [
      ...preload.matchAll(/ipcRenderer\s*\.invoke\(channels\.([A-Za-z0-9]+)/g),
    ].map((match) => match[1])
    const invokeNames = Object.keys(channels).filter((name) => name !== 'event')
    expect(new Set(invokedNames)).toEqual(new Set(invokeNames))
    expect(new Set(mailIpcRegistry.map(({ channel }) => channel))).toEqual(
      new Set(invokeNames.map((name) => channels[name as keyof typeof channels])),
    )
  })

  it('guards production TypeScript and JavaScript from direct console calls', () => {
    const roots = [
      path.join(desktopRoot, 'electron'),
      path.join(desktopRoot, 'src'),
      path.join(desktopRoot, 'perf'),
    ]
    const packageRoot = path.join(repositoryRoot, 'packages')
    for (const packageName of readdirSync(packageRoot)) {
      const packageSource = path.join(packageRoot, packageName, 'src')
      try {
        if (statSync(packageSource).isDirectory()) roots.push(packageSource)
      } catch {
        // A workspace package without source has nothing to scan.
      }
    }
    for (const root of roots)
      for (const file of sourceFiles(root))
        expect(readFileSync(file, 'utf8')).not.toMatch(
          /\bconsole\s*\.(?:log|info|warn|error|debug|trace)\s*\(/,
        )
  })
})
