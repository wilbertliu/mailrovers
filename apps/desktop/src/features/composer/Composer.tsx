import type { AiArtifact, Draft } from '@mailrovers/mail-contracts'
import type { ConversationId, MailboxId, MessageId, OperationId } from '@mailrovers/mail-domain'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { useCancelOperationOnUnmount } from '@/hooks/use-cancel-operation-on-unmount.js'
import { useComposerAutosave } from '@/hooks/use-composer-autosave.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { Input } from '@/components/ui/input.js'
import { Textarea } from '@/components/ui/textarea.js'

type ComposerSeed = {
  draft?: Draft | undefined
  conversationId?: ConversationId | undefined
  replyToMessageId?: MessageId | undefined
  sourceVersion?: number | undefined
  to?: string | undefined
  subject?: string | undefined
}

function addresses(value: string): Array<{ address: string }> {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((address) => ({ address }))
}

export function Composer({
  mailboxId,
  seed,
  onClose,
}: {
  mailboxId: MailboxId
  seed?: ComposerSeed | undefined
  onClose: () => void
}) {
  const [to, setTo] = useState(
    seed?.draft?.to.map((address) => address.address).join(', ') ?? seed?.to ?? '',
  )
  const [subject, setSubject] = useState(seed?.draft?.subject ?? seed?.subject ?? '')
  const [body, setBody] = useState(seed?.draft?.textBody ?? '')
  const [draft, setDraft] = useState<Draft | undefined>(seed?.draft)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'sending' | 'error'>('idle')
  const [aiStatus, setAiStatus] = useState<'idle' | 'streaming' | 'ready' | 'error'>('idle')
  const [suggestion, setSuggestion] = useState('')
  const [artifact, setArtifact] = useState<AiArtifact>()
  const [aiError, setAiError] = useState<string>()
  const queue = useRef(Promise.resolve<Draft | undefined>(undefined))
  const draftRef = useRef<Draft | undefined>(seed?.draft)
  const aiOperation = useRef<OperationId | undefined>(undefined)
  const aiUnsubscribe = useRef<(() => void) | undefined>(undefined)
  const suppressAutosave = useRef(false)

  const save = useCallback(
    (snapshot: { to: string; subject: string; body: string }) => {
      setStatus('saving')
      queue.current = queue.current.then(async () => {
        const current = draftRef.current
        const saved = await desktopBridge.saveDraft({
          mailboxId,
          ...(current === undefined
            ? {}
            : { draftId: current.id, expectedVersion: current.version }),
          ...(seed?.draft?.conversationId === undefined && seed?.conversationId === undefined
            ? {}
            : { conversationId: seed?.draft?.conversationId ?? seed?.conversationId }),
          ...(seed?.draft?.replyToMessageId === undefined && seed?.replyToMessageId === undefined
            ? {}
            : { replyToMessageId: seed?.draft?.replyToMessageId ?? seed?.replyToMessageId }),
          idempotencyKey: crypto.randomUUID(),
          to: addresses(snapshot.to),
          cc: [],
          bcc: [],
          subject: snapshot.subject,
          textBody: snapshot.body,
        })
        draftRef.current = saved
        setDraft(saved)
        setStatus('saved')
        return saved
      })
      queue.current.catch(() => setStatus('error'))
      return queue.current
    },
    [mailboxId, seed],
  )

  useComposerAutosave({
    snapshot: { to, subject, body },
    save,
    suppressNextSave: suppressAutosave,
  })

  const cancelAi = useCallback(async () => {
    const active = aiOperation.current
    aiUnsubscribe.current?.()
    aiUnsubscribe.current = undefined
    aiOperation.current = undefined
    if (active)
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: active,
      })
    setAiStatus('idle')
  }, [])

  useCancelOperationOnUnmount({ operation: aiOperation, unsubscribe: aiUnsubscribe })

  const generateReply = async () => {
    const conversationId = seed?.draft?.conversationId ?? seed?.conversationId
    const sourceVersion = seed?.sourceVersion
    if (!conversationId || sourceVersion === undefined) return
    setAiStatus('streaming')
    setSuggestion('')
    setArtifact(undefined)
    setAiError(undefined)
    try {
      const saved = await save({ to, subject, body })
      if (!saved) throw new Error('Draft could not be saved')
      const receipt = await desktopBridge.startReplyDraft({
        mailboxId,
        conversationId,
        sourceVersion,
        draftId: saved.id,
        draftVersion: saved.version,
      })
      aiOperation.current = receipt.requestId
      aiUnsubscribe.current = desktopBridge.subscribeOperation(
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
              setAiStatus('ready')
              aiOperation.current = undefined
              aiUnsubscribe.current?.()
              aiUnsubscribe.current = undefined
              break
            case 'ai-failed':
              setAiError(event.error.message)
              setAiStatus('error')
              aiOperation.current = undefined
              aiUnsubscribe.current?.()
              aiUnsubscribe.current = undefined
              break
            case 'ai-cancelled':
              setAiStatus('idle')
              aiOperation.current = undefined
              aiUnsubscribe.current?.()
              aiUnsubscribe.current = undefined
              break
          }
        },
      )
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : 'Could not draft a reply.')
      setAiStatus('error')
    }
  }

  const acceptSuggestion = async () => {
    if (!artifact?.draftVersion) return
    try {
      const accepted = await desktopBridge.acceptAiReply({
        mailboxId,
        artifactId: artifact.id,
        expectedDraftVersion: artifact.draftVersion,
        idempotencyKey: crypto.randomUUID(),
      })
      suppressAutosave.current = true
      draftRef.current = accepted
      setDraft(accepted)
      setBody(accepted.textBody)
      setStatus('saved')
      setAiStatus('idle')
      setSuggestion('')
      setArtifact(undefined)
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : 'The draft changed. Generate again.')
      setAiStatus('error')
    }
  }

  const rejectSuggestion = async () => {
    if (artifact) await desktopBridge.rejectAiArtifact({ mailboxId, artifactId: artifact.id })
    setAiStatus('idle')
    setSuggestion('')
    setArtifact(undefined)
  }

  const send = async () => {
    if (addresses(to).length === 0) return
    setStatus('sending')
    try {
      const saved = await save({ to, subject, body })
      if (!saved) throw new Error('Draft could not be saved')
      await desktopBridge.sendDraft({
        mailboxId,
        draftId: saved.id,
        expectedVersion: saved.version,
        idempotencyKey: crypto.randomUUID(),
      })
      onClose()
    } catch {
      setStatus('error')
    }
  }

  const close = async () => {
    if (aiOperation.current) await cancelAi()
    onClose()
  }

  const canGenerateReply =
    (seed?.draft?.conversationId !== undefined || seed?.conversationId !== undefined) &&
    seed?.sourceVersion !== undefined

  return (
    <section
      className="fixed right-4.5 bottom-4.5 z-40 flex h-[min(560px,calc(100vh-92px))] w-[min(520px,calc(100vw-36px))] flex-col overflow-hidden"
      aria-label={seed?.replyToMessageId ? 'Reply' : 'New message'}
    >
      <header className="flex h-12 items-center justify-between py-2 pr-3 pl-4">
        <strong>{seed?.replyToMessageId ? 'Reply' : 'New message'}</strong>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void close()}
          aria-label="Close composer"
        >
          Close
        </Button>
      </header>
      <label htmlFor="composer-to" className="flex min-h-11.5 items-center gap-2.5 px-3.5">
        <span className="w-13.5">To</span>
        <Input
          id="composer-to"
          className="min-w-0 flex-1"
          type="email"
          multiple
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="name@example.com"
        />
      </label>
      <label htmlFor="composer-subject" className="flex min-h-11.5 items-center gap-2.5 px-3.5">
        <span className="w-13.5">Subject</span>
        <Input
          id="composer-subject"
          className="min-w-0 flex-1"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </label>
      <Textarea
        className="min-h-45 flex-1 resize-none p-4"
        aria-label="Message"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a message…"
      />
      {aiStatus !== 'idle' ? (
        <section className="max-h-57.5 overflow-y-auto" aria-label="AI reply suggestion">
          <header className="flex min-h-10.5 items-center justify-between px-3 py-2">
            <strong>AI suggestion</strong>
            {aiStatus === 'streaming' ? <span>Drafting…</span> : null}
          </header>
          {aiError ? (
            <p role="alert" className="px-3.5 py-2.5">
              {aiError}
            </p>
          ) : (
            <p className="whitespace-pre-wrap px-3.5 py-2.5" aria-live="polite">
              {suggestion || 'Starting…'}
            </p>
          )}
          <div className="flex items-center gap-2 px-3.5 pb-3">
            {aiStatus === 'ready' ? (
              <>
                <Button type="button" size="sm" onClick={() => void acceptSuggestion()}>
                  Use suggestion
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void rejectSuggestion()}
                >
                  Discard
                </Button>
              </>
            ) : aiStatus === 'streaming' ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void cancelAi()}>
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void generateReply()}
              >
                Try again
              </Button>
            )}
          </div>
        </section>
      ) : null}
      <footer className="flex min-h-14.5 items-center gap-3 px-3.5 py-2.5">
        <Button
          type="button"
          onClick={() => void send()}
          disabled={status === 'sending' || aiStatus === 'streaming' || !to}
        >
          {status === 'sending' ? 'Queueing…' : 'Send'}
        </Button>
        {canGenerateReply && aiStatus === 'idle' ? (
          <Button type="button" variant="secondary" onClick={() => void generateReply()}>
            Draft with AI
          </Button>
        ) : null}
        <output>
          {status === 'saving'
            ? 'Saving locally…'
            : status === 'saved'
              ? 'Saved locally'
              : status === 'error'
                ? 'Could not save. Keep this window open.'
                : draft
                  ? `Draft ${draft.version}`
                  : ''}
        </output>
      </footer>
    </section>
  )
}
