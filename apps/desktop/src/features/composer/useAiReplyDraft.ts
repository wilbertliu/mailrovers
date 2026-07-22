import type { AiArtifact, Draft } from '@mailrovers/mail-contracts'
import type { ConversationId, MailboxId, OperationId } from '@mailrovers/mail-domain'
import { useCallback, useRef, useState } from 'react'
import { useOperationCleanup } from '@/hooks/use-operation-cleanup.js'
import { desktopBridge } from '../../desktop-bridge.js'

export type AiReplyDraftStatus = 'idle' | 'streaming' | 'ready' | 'error'

export type AiReplyDraftSnapshot = {
  to: string
  subject: string
  body: string
}

export type AiReplyDraftContext = {
  conversationId: ConversationId
  sourceVersion?: number | undefined
}

export function useAiReplyDraft({
  mailboxId,
  replyContext,
  save,
  cancelAutosave,
  onAccepted,
}: {
  mailboxId: MailboxId
  replyContext: AiReplyDraftContext | undefined
  save: (snapshot: AiReplyDraftSnapshot) => Promise<Draft | undefined>
  cancelAutosave: () => void
  onAccepted: (draft: Draft) => void
}) {
  const [status, setStatus] = useState<AiReplyDraftStatus>('idle')
  const [suggestion, setSuggestion] = useState('')
  const [artifact, setArtifact] = useState<AiArtifact>()
  const [error, setError] = useState<string>()
  const operation = useRef<OperationId | undefined>(undefined)
  const unsubscribe = useRef<(() => void) | undefined>(undefined)

  const clearOperation = () => {
    operation.current = undefined
    unsubscribe.current?.()
    unsubscribe.current = undefined
  }

  const cancel = useCallback(async () => {
    const active = operation.current
    clearOperation()
    if (active)
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: active,
      })
    setStatus('idle')
  }, [])

  const cleanupOperation = useOperationCleanup({ operation, unsubscribe })

  const generate = async (snapshot: AiReplyDraftSnapshot) => {
    if (replyContext?.sourceVersion === undefined) return
    const { conversationId, sourceVersion } = replyContext
    setStatus('streaming')
    setSuggestion('')
    setArtifact(undefined)
    setError(undefined)
    try {
      cancelAutosave()
      const saved = await save(snapshot)
      if (!saved) throw new Error('Draft could not be saved')
      const receipt = await desktopBridge.startReplyDraft({
        mailboxId,
        conversationId,
        sourceVersion,
        draftId: saved.id,
        draftVersion: saved.version,
      })
      operation.current = receipt.requestId
      unsubscribe.current = desktopBridge.subscribeOperation(
        receipt.requestId,
        mailboxId,
        (event) => {
          switch (event.kind) {
            case 'ai-started':
              setSuggestion('')
              break
            case 'ai-delta':
              setSuggestion((current) => current + event.text)
              break
            case 'ai-completed':
              setSuggestion(event.artifact.content)
              setArtifact(event.artifact)
              setStatus('ready')
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
            default: {
              const _exhaustive: never = event
              return _exhaustive
            }
          }
        },
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not draft a reply.')
      setStatus('error')
    }
  }

  const accept = async () => {
    if (!artifact?.draftVersion) return
    try {
      const accepted = await desktopBridge.acceptAiReply({
        mailboxId,
        artifactId: artifact.id,
        expectedDraftVersion: artifact.draftVersion,
        idempotencyKey: crypto.randomUUID(),
      })
      cancelAutosave()
      onAccepted(accepted)
      setStatus('idle')
      setSuggestion('')
      setArtifact(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The draft changed. Generate again.')
      setStatus('error')
    }
  }

  const reject = async () => {
    if (artifact) await desktopBridge.rejectAiArtifact({ mailboxId, artifactId: artifact.id })
    setStatus('idle')
    setSuggestion('')
    setArtifact(undefined)
  }

  return {
    status,
    suggestion,
    error,
    canGenerate: replyContext?.sourceVersion !== undefined,
    hasActiveOperation: () => operation.current !== undefined,
    cleanupOperation,
    generate,
    cancel,
    accept,
    reject,
  }
}
