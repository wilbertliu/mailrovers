import { useEffect, useState } from 'react'

const BOOT_SPLASH_ID = 'mailrovers-boot-splash'
/** Avoid a one-frame logo flash when mailbox open resolves quickly (Storybook / retries). */
const REACT_SPLASH_DEFER_MS = 120

/** Keeps the index.html boot splash until opening finishes, then removes it. */
export function useHtmlBootSplash(keepVisible: boolean): boolean {
  const [hasBootSplash] = useState(() => document.getElementById(BOOT_SPLASH_ID) !== null)

  useEffect(() => {
    if (keepVisible) return
    document.getElementById(BOOT_SPLASH_ID)?.remove()
  }, [keepVisible])

  return hasBootSplash
}

/** Show the React splash only after opening has lasted long enough to matter. */
export function useDeferredStartupSplash(loading: boolean): boolean {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!loading) {
      setShow(false)
      return
    }
    const timer = window.setTimeout(() => setShow(true), REACT_SPLASH_DEFER_MS)
    return () => window.clearTimeout(timer)
  }, [loading])

  return loading && show
}
