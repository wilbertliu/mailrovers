import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeCleanupFailureDiagnostic } from '../perf/cleanup-diagnostic.js'

let temporaryDirectory: string | undefined

afterEach(() => {
  if (temporaryDirectory !== undefined) rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = undefined
})

describe('cleanup failure diagnostics', () => {
  it('redacts process-command secrets while retaining cleanup state', () => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mailrovers-cleanup-diagnostic-'))
    const outputPath = path.join(temporaryDirectory, 'cleanup-failure.json')
    writeCleanupFailureDiagnostic(outputPath, {
      childPid: 123,
      processGroupId: 456,
      leader: { exited: true, timedOut: false, observedAt: 789, exitCode: 0, signalCode: null },
      probe: { phase: 'after-natural-shutdown', at: 790, errno: 'EPERM' },
      processSnapshot: [
        '123 1 456 user MailRovers --access_token=super-secret user@example.com password=other-secret',
      ],
    })

    const serialized = readFileSync(outputPath, 'utf8')
    expect(serialized).not.toContain('super-secret')
    expect(serialized).not.toContain('user@example.com')
    expect(serialized).not.toContain('other-secret')

    const diagnostic = JSON.parse(serialized) as {
      childPid: number
      processGroupId: number
      leader: { exited: boolean; exitCode: number }
      probe: { phase: string; at: number; errno: string }
      processSnapshot: string[]
    }
    expect(diagnostic.childPid).toBe(123)
    expect(diagnostic.processGroupId).toBe(456)
    expect(diagnostic.leader).toMatchObject({ exited: true, exitCode: 0 })
    expect(diagnostic.probe).toEqual({ phase: 'after-natural-shutdown', at: 790, errno: 'EPERM' })
    expect(diagnostic.processSnapshot).toEqual([
      '123 1 456 user MailRovers --[REDACTED] [REDACTED] [REDACTED]',
    ])
  })
})
