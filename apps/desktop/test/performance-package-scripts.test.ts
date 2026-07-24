import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function readPackageScripts(file: string): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('scripts' in parsed))
    throw new Error(`Package scripts are missing from ${file}`)
  if (!isStringRecord(parsed.scripts)) throw new Error(`Package scripts are invalid in ${file}`)
  return parsed.scripts
}

function requiredScript(scripts: Record<string, string>, name: string): string {
  const script = scripts[name]
  if (script === undefined) throw new Error(`Missing package script ${name}`)
  return script
}

const desktopRoot = path.resolve(import.meta.dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')

describe('packaged performance scripts', () => {
  it('uses default host selection for the release gate', () => {
    const desktopScripts = readPackageScripts(path.join(desktopRoot, 'package.json'))
    const releaseGate = requiredScript(desktopScripts, 'performance:packaged')

    expect(releaseGate).toContain('--default-host')
    expect(releaseGate).not.toMatch(/--mode=(main|worker)/)
  })

  it('keeps an explicit main-host rollback diagnostic and workspace aliases', () => {
    const desktopScripts = readPackageScripts(path.join(desktopRoot, 'package.json'))
    const workspaceScripts = readPackageScripts(path.join(workspaceRoot, 'package.json'))

    expect(requiredScript(desktopScripts, 'performance:packaged:main')).toContain('--mode=main')
    expect(requiredScript(workspaceScripts, 'performance:packaged')).toBe(
      'pnpm --filter @mailrovers/desktop performance:packaged',
    )
    expect(requiredScript(workspaceScripts, 'performance:packaged')).not.toContain(
      'performance:packaged:main',
    )
    expect(requiredScript(workspaceScripts, 'performance:packaged:main')).toBe(
      'pnpm --filter @mailrovers/desktop performance:packaged:main',
    )
  })
})
