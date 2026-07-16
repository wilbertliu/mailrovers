import type { RefObject } from 'react'
import { useEffect } from 'react'

type ComposerSnapshot = {
  to: string
  subject: string
  body: string
}

export function useComposerAutosave({
  snapshot,
  save,
  suppressNextSave,
}: {
  snapshot: ComposerSnapshot
  save: (snapshot: ComposerSnapshot) => Promise<unknown>
  suppressNextSave: RefObject<boolean>
}) {
  const { to, subject, body } = snapshot

  useEffect(() => {
    if (suppressNextSave.current) {
      suppressNextSave.current = false
      return
    }
    if (!to && !subject && !body) return
    const timer = setTimeout(() => void save({ to, subject, body }), 750)
    return () => clearTimeout(timer)
  }, [body, save, subject, suppressNextSave, to])
}
