import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDirectory = path.join(desktopRoot, 'artifacts', 'test-discovery-regression')

afterEach(() => {
  rmSync(evidenceDirectory, { recursive: true, force: true })
})

describe('generated evidence discovery', () => {
  it('excludes a test-shaped file stored under artifacts', () => {
    const testFile = path.join(evidenceDirectory, 'nested', 'evidence.test.ts')
    mkdirSync(path.dirname(testFile), { recursive: true })
    writeFileSync(testFile, "throw new Error('generated evidence must not execute')\n")

    const vitestEntry = path.join(desktopRoot, '../../node_modules/vitest/vitest.mjs')
    const listed = execFileSync(process.execPath, [vitestEntry, 'list', '--root', desktopRoot], {
      cwd: desktopRoot,
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })

    expect(listed).not.toContain('artifacts/test-discovery-regression/nested/evidence.test.ts')
  }, 30_000)
})
