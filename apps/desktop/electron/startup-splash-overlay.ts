import { BrowserView, type BrowserWindow } from 'electron'
import { createStartupScreenDocument } from '../src/startup-screen-document.js'

export type StartupSplashOverlay = {
  dismiss: () => void
  dismissWhenUiReady: () => void
}

/**
 * Keep a single script-free splash BrowserView above the renderer until the gate is ready.
 * Avoids navigating the splash document away (which reflows the logo).
 */
export async function attachStartupSplashOverlay(
  window: BrowserWindow,
  logoSrc: string,
): Promise<StartupSplashOverlay> {
  const view = new BrowserView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const { width, height } = window.getContentBounds()
  window.setBrowserView(view)
  view.setBounds({ x: 0, y: 0, width, height })
  view.setAutoResize({ width: true, height: true })
  await view.webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(createStartupScreenDocument(logoSrc))}`,
  )

  let dismissed = false
  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    if (!window.isDestroyed() && window.getBrowserView() === view) window.setBrowserView(null)
  }

  window.once('closed', dismiss)

  const dismissWhenUiReady = () => {
    const deadline = Date.now() + 60_000
    const tick = async () => {
      if (window.isDestroyed()) {
        dismiss()
        return
      }
      try {
        const ready = (await window.webContents.executeJavaScript(
          `document.documentElement.dataset.mailroversUiReady === '1'`,
        )) as boolean
        if (ready) {
          dismiss()
          return
        }
      } catch {
        dismiss()
        return
      }
      if (Date.now() > deadline) {
        dismiss()
        return
      }
      setTimeout(() => {
        void tick()
      }, 32)
    }
    void tick()
  }

  return { dismiss, dismissWhenUiReady }
}
