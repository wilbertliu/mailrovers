import { describe, expect, it, vi } from 'vitest'
import { SERVICE_CLEANUP_DEADLINE_MS, shutdownBeforeExit } from '../electron/shutdown-lifecycle.js'

function deferred(): {
  promise: Promise<void>
  resolve(): void
  reject(error: Error): void
} {
  let resolvePromise!: () => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

describe('shutdownBeforeExit', () => {
  it('waits for every service to settle before closing the database and exiting', async () => {
    const first = deferred()
    const second = deferred()
    const closeDatabase = vi.fn<() => void>()
    const exit = vi.fn<() => void>()
    const shutdown = shutdownBeforeExit({
      shutdownServices: [() => first.promise, () => second.promise],
      closeDatabase,
      exit,
      serviceCleanupDeadlineMs: 1_000,
    })

    await Promise.resolve()
    first.reject(new Error('cleanup failed'))
    await Promise.resolve()
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()

    second.resolve()
    await shutdown
    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
  })

  it('forces exit without closing the database when the global cleanup deadline wins', async () => {
    const closeDatabase = vi.fn<() => void>()
    const exit = vi.fn<() => void>()

    await shutdownBeforeExit({
      shutdownServices: [() => new Promise<void>(() => undefined)],
      closeDatabase,
      exit,
      serviceCleanupDeadlineMs: 5,
    })

    expect(closeDatabase).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledOnce()
  })

  it('uses the worker-host drain duration as the default cleanup deadline', () => {
    expect(SERVICE_CLEANUP_DEADLINE_MS).toBe(5_000)
  })
})
