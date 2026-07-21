import type { ConversationId, MailboxId, OperationId } from '@mailrovers/mail-domain'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { useOperationCleanup } from '@/hooks/use-operation-cleanup.js'
import { desktopBridge } from '../../desktop-bridge.js'

export type ConversationSummaryStatus = 'idle' | 'streaming' | 'complete' | 'error'

export function useConversationSummary({
  mailboxId,
  conversationId,
  sourceVersion,
}: {
  mailboxId: MailboxId
  conversationId: ConversationId
  sourceVersion: number
}) {
  const [status, setStatus] = useState<ConversationSummaryStatus>('idle')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string>()
  const operation = useRef<OperationId | undefined>(undefined)
  const unsubscribe = useRef<(() => void) | undefined>(undefined)

  const clearOperation = () => {
    operation.current = undefined
    unsubscribe.current?.()
    unsubscribe.current = undefined
  }

  const cancel = async () => {
    const active = operation.current
    clearOperation()
    if (active)
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: active,
      })
    setStatus('idle')
  }

  const cleanupOperation = useOperationCleanup({ operation, unsubscribe })
  const cleanupRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return
      return cleanupOperation
    },
    [cleanupOperation],
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
              clearOperation()
              break
            case 'ai-failed':
              setError(event.error.message)
              setStatus('error')
              clearOperation()
              break
            case 'ai-cancelled':
              setStatus('idle')
              clearOperation()
              break
          }
        },
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not summarize this conversation.')
      setStatus('error')
    }
  }

  return {
    status,
    content,
    error,
    cleanupRef,
    generate: () => void generate(),
    regenerate: () => void generate(true),
    cancel: () => void cancel(),
  }
}

export function ConversationSummaryPanel({
  status,
  content,
  error,
  cleanupRef,
  onCancel,
  onRegenerate,
}: {
  status: ConversationSummaryStatus
  content: string
  error?: string | undefined
  cleanupRef: (node: HTMLDivElement | null) => (() => void) | undefined
  onCancel: () => void
  onRegenerate: () => void
}) {
  if (status === 'idle') return <div ref={cleanupRef} className="hidden" />

  return (
    <section
      ref={cleanupRef}
      className="border-b px-6 py-3 max-[980px]:px-5"
      aria-label="Conversation summary"
    >
      <header className="flex min-h-8 items-center justify-between gap-2">
        <strong className="text-sm">AI summary</strong>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={status === 'streaming' ? onCancel : onRegenerate}
        >
          {status === 'streaming' ? 'Cancel' : 'Regenerate'}
        </Button>
      </header>
      {error ? (
        <p role="alert" className="mt-2 whitespace-pre-wrap text-sm">
          {error}
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm" aria-live="polite">
          {content || 'Writing summary…'}
        </p>
      )}
    </section>
  )
}
