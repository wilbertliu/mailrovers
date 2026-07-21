import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(import.meta.dirname, '..')

describe('packaged smoke readiness', () => {
  it('waits for inbox buttons through the semantic inbox container', () => {
    const source = readFileSync(path.join(desktopRoot, 'electron/main.ts'), 'utf8')

    expect(source).toContain(`document.querySelector('[aria-label="Inbox"]')`)
    expect(source).toContain("inbox?.querySelectorAll('button').length ?? 0")
    expect(source).not.toContain("querySelectorAll('.conversation-row')")
  })

  it('settles search indexing before recording a successful smoke result', () => {
    const source = readFileSync(path.join(desktopRoot, 'electron/main.ts'), 'utf8')

    expect(source).toContain('const searchIndexing = backfillSearch(host.store)')
    expect(source.slice(source.indexOf('await searchIndexing'))).toContain('writeSmokeSuccess')
    expect(source).toContain("let smokeTerminalState: 'pending' | 'passed' | 'failed' = 'pending'")
  })
})
