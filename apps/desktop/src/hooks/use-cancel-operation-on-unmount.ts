import type { OperationId } from '@mailrovers/mail-domain'
import type { RefObject } from 'react'
import { useEffect } from 'react'
import { desktopBridge } from '../desktop-bridge.js'

export function useCancelOperationOnUnmount({
  operation,
  unsubscribe,
}: {
  operation: RefObject<OperationId | undefined>
  unsubscribe: RefObject<(() => void) | undefined>
}) {
  useEffect(
    () => () => {
      unsubscribe.current?.()
      const active = operation.current
      if (active)
        void desktopBridge.cancelOperation({
          requestId: desktopBridge.createRequestId(),
          operationId: active,
        })
    },
    [operation, unsubscribe],
  )
}
