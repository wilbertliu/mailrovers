import type { App, BrowserWindow } from 'electron'

export function acquireSingleInstance(
  app: Pick<App, 'requestSingleInstanceLock' | 'quit' | 'on'>,
  getMainWindow: () =>
    | Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'focus'>
    | undefined,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    const window = getMainWindow()
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  return true
}
