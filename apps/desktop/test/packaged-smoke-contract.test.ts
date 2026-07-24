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

    expect(source).toContain('const searchIndexing = backfillSearch(host.store, {')
    expect(source.slice(source.indexOf('await searchIndexing'))).toContain('writeSmokeSuccess')
    expect(source).toContain("let smokeTerminalState: 'pending' | 'passed' | 'failed' = 'pending'")
  })

  it('settles service shutdown before closing the database host', () => {
    const source = readFileSync(path.join(desktopRoot, 'electron/main.ts'), 'utf8')
    const serviceShutdown = source.indexOf('shutdownServices: [')
    const databaseClose = source.indexOf('closeDatabase: () => host?.close()', serviceShutdown)
    const exit = source.indexOf('exit: () => app.exit()', databaseClose)

    expect(serviceShutdown).toBeGreaterThan(-1)
    expect(databaseClose).toBeGreaterThan(serviceShutdown)
    expect(exit).toBeGreaterThan(databaseClose)
    expect(source.slice(serviceShutdown, databaseClose)).toContain('syncEngine?.shutdown()')
    expect(source.slice(serviceShutdown, databaseClose)).toContain('commandDispatcher?.shutdown()')
    expect(source.slice(serviceShutdown, databaseClose)).toContain('shutdownNormalization?.()')
    expect(source.slice(serviceShutdown, databaseClose)).not.toContain('host?.close()')
    expect(source).toContain("logger.error('desktop-shutdown-failed'")
  })

  it('instruments pending-fts-backfill overlap measurements in the packaged main process', () => {
    const source = readFileSync(path.join(desktopRoot, 'electron/main.ts'), 'utf8')

    expect(source).toContain("performanceScenario === 'pending-fts-backfill'")
    expect(source).toContain("checkpoint('searchIndexingStart')")
    expect(source).toContain("checkpoint('searchIndexingComplete'")
    expect(source).toContain('runCoordinatedContentionProbe')
    expect(source).toContain('window.mailrovers.v1.listConversations')
    expect(source).toContain('evaluateContentionProbe')
    expect(source).toContain('attributeIndexingStallMs')
    expect(source).toContain('peakDuringIndexingMb')
    expect(source).toContain('sampleEventLoopStallMs')
    expect(source).toContain("databaseHost === 'main'")
    expect(source).toContain(
      'performanceRequested ? { probe: createSearchBackfillProbe(window) } : {}',
    )
  })

  it('awaits process-group termination before the next packaged host can start', () => {
    const source = readFileSync(path.join(desktopRoot, 'perf/smoke-packaged.ts'), 'utf8')
    expect(source).toContain("from './process-group-terminate.js'")
    expect(source).toContain('terminateProcessGroup')
    expect(source).toContain('await terminateProcessGroup(')
    expect(source).toContain('ProcessGroupTerminationError')
    expect(source).toContain('cleanup-failure.json')
    expect(source).not.toMatch(/function terminate\(/)
    expect(source).not.toContain('.unref()')
  })
})
