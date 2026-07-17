import type { OperationId } from '@mailrovers/mail-domain'
import type { RefObject } from 'react'
import { useCallback } from 'react'
import { desktopBridge } from '../desktop-bridge.js'

export function useOperationCleanup({
  operation,
  unsubscribe,
}: {
  operation: RefObject<OperationId | undefined>
  unsubscribe: RefObject<(() => void) | undefined>
}): () => void {
  return useCallback(() => {
    unsubscribe.current?.()
    unsubscribe.current = undefined
    const active = operation.current
    operation.current = undefined
    if (active)
      void desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: active,
      })
  }, [operation, unsubscribe])
}
