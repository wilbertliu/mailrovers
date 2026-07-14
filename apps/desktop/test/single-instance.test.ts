import type { App, BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstance } from '../electron/single-instance.js'

type SecondInstanceListener = () => void

function fakeApp(acquired: boolean) {
  let secondInstance: SecondInstanceListener | undefined
  const quit = vi.fn<() => void>()
  const app = {
    requestSingleInstanceLock: vi.fn<() => boolean>(() => acquired),
    quit,
    on: vi.fn<(event: string, listener: SecondInstanceListener) => unknown>(
      (event: string, listener: SecondInstanceListener) => {
        if (event === 'second-instance') secondInstance = listener
        return app
      },
    ),
  } as unknown as Pick<App, 'requestSingleInstanceLock' | 'quit' | 'on'>
  return { app, quit, emitSecondInstance: () => secondInstance?.() }
}

describe('Electron single-instance fencing', () => {
  it('quits a losing instance without invoking startup work', () => {
    const fake = fakeApp(false)
    const getWindow = vi.fn<() => BrowserWindow | undefined>()

    expect(acquireSingleInstance(fake.app, getWindow)).toBe(false)
    expect(fake.quit).toHaveBeenCalledOnce()
    expect(getWindow).not.toHaveBeenCalled()
  })

  it('restores and focuses the winner when a second instance starts', () => {
    const fake = fakeApp(true)
    const window = {
      isMinimized: vi.fn<() => boolean>(() => true),
      restore: vi.fn<() => void>(),
      show: vi.fn<() => void>(),
      focus: vi.fn<() => void>(),
    } as unknown as Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'focus'>

    expect(acquireSingleInstance(fake.app, () => window)).toBe(true)
    fake.emitSecondInstance()

    expect(fake.quit).not.toHaveBeenCalled()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
