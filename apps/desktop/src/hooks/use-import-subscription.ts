import type { MailboxSummary } from '@mailrovers/mail-contracts'
import type { OperationId } from '@mailrovers/mail-domain'
import { useEffect } from 'react'

export function useImportSubscription({
  syncState,
  start,
  subscribe,
  onError,
}: {
  syncState: MailboxSummary['syncState']
  start: () => Promise<OperationId>
  subscribe: (operationId: OperationId) => () => void
  onError: (message: string) => void
}) {
  useEffect(() => {
    if (syncState !== 'importing' && syncState !== 'reconciling') return

    let unsubscribe: (() => void) | undefined
    let active = true
    void start()
      .then((operationId) => {
        if (active) unsubscribe = subscribe(operationId)
      })
      .catch((caught) => {
        if (active) onError(caught instanceof Error ? caught.message : 'Unable to resume import.')
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [onError, start, subscribe, syncState])
}
