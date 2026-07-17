import type { App, BrowserWindow } from 'electron'

type PresentableApp = Pick<App, 'focus'>
type PresentableWindow = Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'focus'>

export async function presentWindow(app: PresentableApp, window: PresentableWindow): Promise<void> {
  if (window.isMinimized()) window.restore()
  window.show()
  await new Promise<void>((resolve) => setImmediate(resolve))
  app.focus({ steal: true })
  window.focus()
}

export function acquireSingleInstance(
  app: Pick<App, 'requestSingleInstanceLock' | 'quit' | 'on' | 'focus'>,
  getMainWindow: () => PresentableWindow | undefined,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    const window = getMainWindow()
    if (window === undefined) return
    void presentWindow(app, window)
  })
  return true
}
