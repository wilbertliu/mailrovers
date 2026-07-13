import type { AiArtifact, Draft } from '@mailrovers/mail-contracts'
import type { ConversationId, MailboxId, MessageId, OperationId } from '@mailrovers/mail-domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'

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

  useEffect(() => {
    if (suppressAutosave.current) {
      suppressAutosave.current = false
      return
    }
    if (!to && !subject && !body) return
    const timer = setTimeout(() => void save({ to, subject, body }), 750)
    return () => clearTimeout(timer)
  }, [to, subject, body, save])

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

  useEffect(
    () => () => {
      aiUnsubscribe.current?.()
      const active = aiOperation.current
      if (active)
        void desktopBridge.cancelOperation({
          requestId: desktopBridge.createRequestId(),
          operationId: active,
        })
    },
    [],
  )

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
    <section className="composer" aria-label={seed?.replyToMessageId ? 'Reply' : 'New message'}>
      <header>
        <strong>{seed?.replyToMessageId ? 'Reply' : 'New message'}</strong>
        <button
          type="button"
          className="text-button"
          onClick={() => void close()}
          aria-label="Close composer"
        >
          Close
        </button>
      </header>
      <label>
        <span>To</span>
        <input
          type="email"
          multiple
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="name@example.com"
        />
      </label>
      <label>
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      <textarea
        aria-label="Message"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a message…"
      />
      {aiStatus !== 'idle' ? (
        <section className="ai-reply-suggestion" aria-label="AI reply suggestion">
          <header>
            <strong>AI suggestion</strong>
            {aiStatus === 'streaming' ? <span>Drafting…</span> : null}
          </header>
          {aiError ? (
            <p role="alert" className="error-message">
              {aiError}
            </p>
          ) : (
            <p aria-live="polite">{suggestion || 'Starting…'}</p>
          )}
          <div className="button-row">
            {aiStatus === 'ready' ? (
              <>
                <button type="button" onClick={() => void acceptSuggestion()}>
                  Use suggestion
                </button>
                <button type="button" className="secondary" onClick={() => void rejectSuggestion()}>
                  Discard
                </button>
              </>
            ) : aiStatus === 'streaming' ? (
              <button type="button" className="secondary" onClick={() => void cancelAi()}>
                Cancel
              </button>
            ) : (
              <button type="button" className="secondary" onClick={() => void generateReply()}>
                Try again
              </button>
            )}
          </div>
        </section>
      ) : null}
      <footer>
        <button
          type="button"
          onClick={() => void send()}
          disabled={status === 'sending' || aiStatus === 'streaming' || !to}
        >
          {status === 'sending' ? 'Queueing…' : 'Send'}
        </button>
        {canGenerateReply && aiStatus === 'idle' ? (
          <button type="button" className="secondary" onClick={() => void generateReply()}>
            Draft with AI
          </button>
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
