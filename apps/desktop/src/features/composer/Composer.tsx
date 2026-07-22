import type { Draft } from '@mailrovers/mail-contracts'
import type { ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { createDebouncedAction } from '@/lib/debounced-action.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { Input } from '@/components/ui/input.js'
import { Textarea } from '@/components/ui/textarea.js'
import { useAiReplyDraft } from './useAiReplyDraft.js'

export type ComposerReplyContext = {
  conversationId: ConversationId
  replyToMessageId: MessageId
  sourceVersion?: number | undefined
}

export type ComposerMode =
  | { kind: 'new' }
  | {
      kind: 'reply'
      context: ComposerReplyContext
      to: string
      subject: string
    }
  | {
      kind: 'edit'
      draft: Draft
      replyContext?: ComposerReplyContext | undefined
    }

type ComposerSnapshot = {
  to: string
  subject: string
  body: string
}

function initialSnapshot(mode: ComposerMode): ComposerSnapshot {
  if (mode.kind === 'new') return { to: '', subject: '', body: '' }
  if (mode.kind === 'reply') return { to: mode.to, subject: mode.subject, body: '' }
  return {
    to: mode.draft.to.map((address) => address.address).join(', '),
    subject: mode.draft.subject,
    body: mode.draft.textBody,
  }
}

function addresses(value: string): Array<{ address: string }> {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((address) => ({ address }))
}

export function draftAnchors(
  mode: ComposerMode,
  replyContext: ComposerReplyContext | undefined,
): { conversationId?: ConversationId; replyToMessageId?: MessageId } {
  if (replyContext !== undefined) {
    return {
      conversationId: replyContext.conversationId,
      replyToMessageId: replyContext.replyToMessageId,
    }
  }
  if (mode.kind !== 'edit') return {}
  return {
    ...(mode.draft.conversationId === undefined
      ? {}
      : { conversationId: mode.draft.conversationId }),
    ...(mode.draft.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: mode.draft.replyToMessageId }),
  }
}

export function Composer({
  mailboxId,
  mode,
  onClose,
}: {
  mailboxId: MailboxId
  mode: ComposerMode
  onClose: () => void
}) {
  const initial = initialSnapshot(mode)
  const [to, setTo] = useState(initial.to)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [draft, setDraft] = useState<Draft | undefined>(
    mode.kind === 'edit' ? mode.draft : undefined,
  )
  const replyContext =
    mode.kind === 'reply' ? mode.context : mode.kind === 'edit' ? mode.replyContext : undefined
  const isReply = replyContext !== undefined
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'sending' | 'error'>('idle')
  const queue = useRef(Promise.resolve<Draft | undefined>(undefined))
  const draftRef = useRef<Draft | undefined>(mode.kind === 'edit' ? mode.draft : undefined)
  const [autosave] = useState(() => createDebouncedAction(750))

  const save = useCallback(
    (snapshot: ComposerSnapshot) => {
      setStatus('saving')
      queue.current = queue.current.then(async () => {
        const current = draftRef.current
        const saved = await desktopBridge.saveDraft({
          mailboxId,
          ...(current === undefined
            ? {}
            : { draftId: current.id, expectedVersion: current.version }),
          ...draftAnchors(mode, replyContext),
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
    [mailboxId, mode, replyContext],
  )

  const scheduleAutosave = (snapshot: ComposerSnapshot) => {
    if (!snapshot.to && !snapshot.subject && !snapshot.body) {
      autosave.cancel()
      return
    }
    autosave.schedule(() => void save(snapshot))
  }

  const ai = useAiReplyDraft({
    mailboxId,
    replyContext,
    save,
    cancelAutosave: () => autosave.cancel(),
    onAccepted: (accepted) => {
      draftRef.current = accepted
      setDraft(accepted)
      setBody(accepted.textBody)
      setStatus('saved')
    },
  })

  const composerRef = useCallback(
    (node: HTMLElement | null) => {
      if (node === null) return
      return () => {
        autosave.cancel()
        ai.cleanupOperation()
      }
    },
    [autosave, ai],
  )

  const send = async () => {
    if (addresses(to).length === 0) return
    setStatus('sending')
    try {
      autosave.cancel()
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
    if (ai.hasActiveOperation()) await ai.cancel()
    onClose()
  }

  return (
    <section
      ref={composerRef}
      className="fixed right-4.5 bottom-4.5 z-40 flex h-[min(560px,calc(100vh-92px))] w-[min(520px,calc(100vw-36px))] flex-col overflow-hidden"
      aria-label={isReply ? 'Reply' : 'New message'}
    >
      <header className="flex h-12 items-center justify-between py-2 pr-3 pl-4">
        <strong>{isReply ? 'Reply' : 'New message'}</strong>
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
          onChange={(event) => {
            const value = event.target.value
            setTo(value)
            scheduleAutosave({ to: value, subject, body })
          }}
          placeholder="name@example.com"
        />
      </label>
      <label htmlFor="composer-subject" className="flex min-h-11.5 items-center gap-2.5 px-3.5">
        <span className="w-13.5">Subject</span>
        <Input
          id="composer-subject"
          className="min-w-0 flex-1"
          value={subject}
          onChange={(event) => {
            const value = event.target.value
            setSubject(value)
            scheduleAutosave({ to, subject: value, body })
          }}
        />
      </label>
      <Textarea
        className="min-h-45 flex-1 resize-none p-4"
        aria-label="Message"
        value={body}
        onChange={(event) => {
          const value = event.target.value
          setBody(value)
          scheduleAutosave({ to, subject, body: value })
        }}
        placeholder="Write a message…"
      />
      {ai.status !== 'idle' ? (
        <section className="max-h-57.5 overflow-y-auto" aria-label="AI reply suggestion">
          <header className="flex min-h-10.5 items-center justify-between px-3 py-2">
            <strong>AI suggestion</strong>
            {ai.status === 'streaming' ? <span>Drafting…</span> : null}
          </header>
          {ai.error ? (
            <p role="alert" className="px-3.5 py-2.5">
              {ai.error}
            </p>
          ) : (
            <p className="whitespace-pre-wrap px-3.5 py-2.5" aria-live="polite">
              {ai.suggestion || 'Starting…'}
            </p>
          )}
          <div className="flex items-center gap-2 px-3.5 pb-3">
            {ai.status === 'ready' ? (
              <>
                <Button type="button" size="sm" onClick={() => void ai.accept()}>
                  Use suggestion
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void ai.reject()}
                >
                  Discard
                </Button>
              </>
            ) : ai.status === 'streaming' ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void ai.cancel()}>
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void ai.generate({ to, subject, body })}
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
          disabled={status === 'sending' || ai.status === 'streaming' || !to}
        >
          {status === 'sending' ? 'Queueing…' : 'Send'}
        </Button>
        {ai.canGenerate && ai.status === 'idle' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void ai.generate({ to, subject, body })}
          >
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
