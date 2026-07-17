import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedAction } from '../src/lib/debounced-action.js'

describe('debounced action', () => {
  afterEach(() => vi.useRealTimers())

  it('runs only the latest scheduled action after the delay', () => {
    vi.useFakeTimers()
    const debounced = createDebouncedAction(750)
    const first = vi.fn<() => void>()
    const latest = vi.fn<() => void>()

    debounced.schedule(first)
    vi.advanceTimersByTime(500)
    debounced.schedule(latest)
    vi.advanceTimersByTime(749)

    expect(first).not.toHaveBeenCalled()
    expect(latest).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(latest).toHaveBeenCalledOnce()
  })

  it('cancels pending work', () => {
    vi.useFakeTimers()
    const debounced = createDebouncedAction(750)
    const action = vi.fn<() => void>()

    debounced.schedule(action)
    debounced.cancel()
    vi.runAllTimers()

    expect(action).not.toHaveBeenCalled()
  })

  it('rejects a negative delay', () => {
    expect(() => createDebouncedAction(-1)).toThrow('Debounce delay must not be negative')
  })
})
