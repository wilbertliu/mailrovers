import { useEffect, useState } from 'react'

/** Avoid a one-frame logo flash when mailbox open resolves quickly (Storybook). */
const REACT_SPLASH_DEFER_MS = 120

function isElectronShell(): boolean {
  return /Electron\//.test(navigator.userAgent)
}

/**
 * Coordinates opening UX:
 * - Marks `data-mailrovers-ui-ready` so Electron can dismiss its BrowserView splash
 * - Returns whether to paint the React splash (Storybook + post-error retries only)
 */
export function useMailboxOpeningSplash(opening: boolean): boolean {
  const [allowReactSplash, setAllowReactSplash] = useState(() => !isElectronShell())
  const [showReactSplash, setShowReactSplash] = useState(false)

  useEffect(() => {
    if (opening) delete document.documentElement.dataset.mailroversUiReady
    else document.documentElement.dataset.mailroversUiReady = '1'
  }, [opening])

  useEffect(() => {
    if (!opening && isElectronShell()) setAllowReactSplash(true)
  }, [opening])

  useEffect(() => {
    if (!opening || !allowReactSplash) {
      setShowReactSplash(false)
      return
    }
    const timer = window.setTimeout(() => setShowReactSplash(true), REACT_SPLASH_DEFER_MS)
    return () => window.clearTimeout(timer)
  }, [opening, allowReactSplash])

  return opening && allowReactSplash && showReactSplash
}
