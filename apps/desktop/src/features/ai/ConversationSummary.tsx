import type { ConversationId, MailboxId, OperationId } from '@mailrovers/mail-domain'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { useCancelOperationOnUnmount } from '@/hooks/use-cancel-operation-on-unmount.js'
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

  useCancelOperationOnUnmount({ operation, unsubscribe })

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
      <div className="px-3.5 pt-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void generate()}>
          Summarize conversation
        </Button>
      </div>
    )

  return (
    <section className="mx-3.5 mt-3.5" aria-label="Conversation summary">
      <header className="flex min-h-10.5 items-center justify-between px-3 py-2">
        <strong>AI summary</strong>
        <div>
          {status === 'streaming' ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => void cancel()}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="xs" onClick={() => void generate(true)}>
              Regenerate
            </Button>
          )}
        </div>
      </header>
      {error ? (
        <p role="alert" className="whitespace-pre-wrap p-3">
          {error}
        </p>
      ) : (
        <p className="whitespace-pre-wrap p-3" aria-live="polite">
          {content || 'Writing summary…'}
        </p>
      )}
    </section>
  )
}
