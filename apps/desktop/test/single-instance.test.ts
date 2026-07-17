import type { App } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstance, presentWindow } from '../electron/single-instance.js'

type SecondInstanceListener = () => void

function fakeApp(acquired: boolean) {
  let secondInstance: SecondInstanceListener | undefined
  const quit = vi.fn<() => void>()
  const focus = vi.fn<App['focus']>()
  const app = {
    requestSingleInstanceLock: vi.fn<() => boolean>(() => acquired),
    quit,
    focus,
    on: vi.fn<(event: string, listener: SecondInstanceListener) => unknown>(
      (event: string, listener: SecondInstanceListener) => {
        if (event === 'second-instance') secondInstance = listener
        return app
      },
    ),
  } as unknown as Pick<App, 'requestSingleInstanceLock' | 'quit' | 'on' | 'focus'>
  return { app, quit, focus, emitSecondInstance: () => secondInstance?.() }
}

function fakeWindow(minimized: boolean) {
  return {
    isMinimized: vi.fn<() => boolean>(() => minimized),
    restore: vi.fn<() => void>(),
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
  }
}

describe('Electron window presentation', () => {
  it('reveals the window before activating and focusing it', async () => {
    const fake = fakeApp(true)
    const window = fakeWindow(false)

    const presented = presentWindow(fake.app, window)

    expect(window.show).toHaveBeenCalledOnce()
    expect(fake.focus).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()
    await presented

    expect(fake.focus).toHaveBeenCalledOnce()
    expect(fake.focus).toHaveBeenCalledWith({ steal: true })
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})

describe('Electron single-instance fencing', () => {
  it('quits a losing instance without invoking startup work', () => {
    const fake = fakeApp(false)
    const getWindow = vi.fn<() => undefined>()

    expect(acquireSingleInstance(fake.app, getWindow)).toBe(false)
    expect(fake.quit).toHaveBeenCalledOnce()
    expect(getWindow).not.toHaveBeenCalled()
  })

  it('restores and focuses the winner when a second instance starts', async () => {
    const fake = fakeApp(true)
    const window = fakeWindow(true)

    expect(acquireSingleInstance(fake.app, () => window)).toBe(true)
    fake.emitSecondInstance()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(fake.quit).not.toHaveBeenCalled()
    expect(fake.focus).toHaveBeenCalledWith({ steal: true })
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
