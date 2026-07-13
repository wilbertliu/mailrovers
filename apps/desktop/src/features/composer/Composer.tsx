import type { Draft } from '@mailrovers/mail-contracts'
import type { ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'

type ComposerSeed = {
  draft?: Draft | undefined
  conversationId?: ConversationId | undefined
  replyToMessageId?: MessageId | undefined
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
  const queue = useRef(Promise.resolve<Draft | undefined>(undefined))
  const draftRef = useRef<Draft | undefined>(seed?.draft)

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
    if (!to && !subject && !body) return
    const timer = setTimeout(() => void save({ to, subject, body }), 750)
    return () => clearTimeout(timer)
  }, [to, subject, body, save])

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

  return (
    <section className="composer" aria-label={seed?.replyToMessageId ? 'Reply' : 'New message'}>
      <header>
        <strong>{seed?.replyToMessageId ? 'Reply' : 'New message'}</strong>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close composer">
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
      <footer>
        <button type="button" onClick={() => void send()} disabled={status === 'sending' || !to}>
          {status === 'sending' ? 'Queueing…' : 'Send'}
        </button>
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
