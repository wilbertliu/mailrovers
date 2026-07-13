import type { ConversationId, MailboxId, OperationId } from '@mailrovers/mail-domain'
import { useEffect, useRef, useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'

export function ConversationSummary({
  mailboxId,
  conversationId,
  sourceVersion,
}: {
  mailboxId: MailboxId
  conversationId: ConversationId
  sourceVersion: number
}) {
  const [status, setStatus] = useState<'idle' | 'streaming' | 'complete' | 'error'>('idle')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string>()
  const operation = useRef<OperationId | undefined>(undefined)
  const unsubscribe = useRef<(() => void) | undefined>(undefined)

  const cancel = async () => {
    const active = operation.current
    unsubscribe.current?.()
    unsubscribe.current = undefined
    operation.current = undefined
    if (active)
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: active,
      })
    setStatus('idle')
  }

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
    [],
  )

  const generate = async (force = false) => {
    unsubscribe.current?.()
    setStatus('streaming')
    setContent('')
    setError(undefined)
    try {
      const receipt = await desktopBridge.startConversationSummary({
        mailboxId,
        conversationId,
        sourceVersion,
        ...(force ? { force: true } : {}),
      })
      operation.current = receipt.requestId
      unsubscribe.current = desktopBridge.subscribeOperation(
        receipt.requestId,
        mailboxId,
        (event) => {
          switch (event.kind) {
            case 'ai-started':
              if (!event.cached) setContent('')
              break
            case 'ai-delta':
              setContent((current) => current + event.text)
              break
            case 'ai-completed':
              setContent(event.artifact.content)
              setStatus('complete')
              operation.current = undefined
              unsubscribe.current?.()
              unsubscribe.current = undefined
              break
            case 'ai-failed':
              setError(event.error.message)
              setStatus('error')
              operation.current = undefined
              unsubscribe.current?.()
              unsubscribe.current = undefined
              break
            case 'ai-cancelled':
              setStatus('idle')
              operation.current = undefined
              unsubscribe.current?.()
              unsubscribe.current = undefined
              break
          }
        },
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not summarize this conversation.')
      setStatus('error')
    }
  }

  if (status === 'idle')
    return (
      <div className="summary-entry">
        <button type="button" className="secondary" onClick={() => void generate()}>
          Summarize conversation
        </button>
      </div>
    )

  return (
    <section className="conversation-summary" aria-label="Conversation summary">
      <header>
        <strong>AI summary</strong>
        <div>
          {status === 'streaming' ? (
            <button type="button" className="text-button" onClick={() => void cancel()}>
              Cancel
            </button>
          ) : (
            <button type="button" className="text-button" onClick={() => void generate(true)}>
              Regenerate
            </button>
          )}
        </div>
      </header>
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : (
        <p aria-live="polite">{content || 'Writing summary…'}</p>
      )}
    </section>
  )
}
