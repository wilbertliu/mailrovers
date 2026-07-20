import type { LabelSummary, MailCommand, MessageDetail } from '@mailrovers/mail-contracts'
import type { AttachmentId, ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { Archive02Icon, MailOpen01Icon, StarIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { ConversationSummary } from '../ai/ConversationSummary.js'
import { EmailFrame } from './EmailFrame.js'
import { NativeSelect } from '@/components/ui/native-select.js'

export function shouldLoadMessageBody(expanded: boolean, bodyAvailable: boolean): boolean {
  return expanded && bodyAvailable
}

function addressLabel(address: { name?: string | undefined; address: string }): string {
  return address.name ? `${address.name} <${address.address}>` : address.address
}

function MessageCard({
  mailboxId,
  conversationId,
  message,
  initiallyExpanded,
}: {
  mailboxId: MailboxId
  conversationId: ConversationId
  message: MessageDetail
  initiallyExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [exporting, setExporting] = useState<AttachmentId>()
  const [exportStatus, setExportStatus] = useState<string>()
  const body = useQuery({
    queryKey: ['message-body', mailboxId, conversationId, message.id],
    queryFn: () =>
      desktopBridge.getMessageBody({ mailboxId, conversationId, messageId: message.id }),
    enabled: shouldLoadMessageBody(expanded, message.bodyAvailable),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return (
    <details
      className="m-0 overflow-hidden border-b"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex min-h-17 cursor-pointer list-none items-center justify-between gap-4 py-4">
        <span className="flex min-w-0 flex-col">
          <strong className="truncate text-xs">{addressLabel(message.sender)}</strong>
          <small className="truncate text-[0.625rem] text-muted-foreground">
            to {message.recipients.to.map(addressLabel).join(', ') || 'me'}
          </small>
        </span>
        <time className="text-[0.625rem] text-muted-foreground">
          {new Date(message.receivedAt).toLocaleString()}
        </time>
      </summary>
      <div className="px-0 pt-1 pb-6 text-xs leading-relaxed text-foreground/90">
        {body.data?.sanitizedHtmlBody ? (
          <EmailFrame
            html={body.data.sanitizedHtmlBody}
            title={`Message from ${message.sender.address}`}
          />
        ) : body.data?.textBody ? (
          <pre className="m-0 max-w-[65ch] wrap-anywhere whitespace-pre-wrap font-sans">
            {body.data.textBody}
          </pre>
        ) : body.isPending && message.bodyAvailable ? (
          <p>Loading message…</p>
        ) : (
          <pre className="m-0 max-w-[65ch] wrap-anywhere whitespace-pre-wrap font-sans">
            This message has no readable body.
          </pre>
        )}
        {message.attachments.length > 0 ? (
          <ul className="mt-4.5 flex list-none flex-wrap gap-2 p-0" aria-label="Attachments">
            {message.attachments.map((attachment) => (
              <li
                className="flex flex-col gap-0.5 rounded-md border bg-background px-2.5 py-2"
                key={attachment.id}
              >
                <span>{attachment.filename}</span>
                <small>{attachment.mediaType}</small>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={attachment.availability === 'unavailable' || exporting !== undefined}
                  onClick={() => {
                    setExporting(attachment.id)
                    setExportStatus(undefined)
                    void desktopBridge
                      .exportAttachment({
                        mailboxId,
                        messageId: message.id,
                        attachmentId: attachment.id,
                      })
                      .then((result) =>
                        setExportStatus(
                          result.status === 'exported'
                            ? `${attachment.filename} exported.`
                            : 'Export cancelled.',
                        ),
                      )
                      .catch((error: unknown) =>
                        setExportStatus(
                          error instanceof Error ? error.message : 'Attachment export failed.',
                        ),
                      )
                      .finally(() => setExporting(undefined))
                  }}
                >
                  {exporting === attachment.id ? 'Exporting…' : 'Export'}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {exportStatus ? <output>{exportStatus}</output> : null}
      </div>
    </details>
  )
}

export function ConversationReader({
  mailboxId,
  conversationId,
  labels,
  onCommand,
  onReply,
}: {
  mailboxId: MailboxId
  conversationId: ConversationId
  labels: LabelSummary[]
  onCommand: (command: MailCommand) => Promise<void>
  onReply: (input: {
    conversationId: ConversationId
    messageId: MessageId
    sourceVersion: number
    to: string
    subject: string
  }) => void
}) {
  const query = useQuery({
    queryKey: ['conversation', mailboxId, conversationId],
    queryFn: () => desktopBridge.getConversation({ mailboxId, conversationId }),
    staleTime: 30_000,
  })
  if (query.isPending)
    return (
      <section className="window-titlebar min-w-0 bg-card px-4.5 py-6" aria-live="polite">
        Loading conversation…
      </section>
    )
  if (query.isError || !query.data)
    return (
      <section className="window-titlebar min-w-0 bg-card px-4.5 py-6" role="alert">
        Unable to open this conversation.
      </section>
    )

  const conversation = query.data
  const latestMessage = conversation.messages.at(-1)
  return (
    <section className="min-w-0 overflow-auto bg-card" aria-label={conversation.subject}>
      <header className="window-titlebar sticky top-0 z-2 flex min-h-30 items-start justify-between border-b bg-card px-8 pt-11 pb-4 max-[980px]:px-5">
        <div className="min-w-0">
          <p className="mb-2.5 text-[0.625rem] text-muted-foreground">Inbox / Conversation</p>
          <h1 className="max-w-2xl truncate text-xl tracking-tight">
            {conversation.subject || '(No subject)'}
          </h1>
          <p className="mt-1 text-[0.625rem] text-muted-foreground">
            {conversation.messages.length} messages
          </p>
        </div>
        <div className="absolute top-2 right-3 flex items-center gap-1.5">
          {latestMessage ? (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                onReply({
                  conversationId,
                  messageId: latestMessage.id,
                  sourceVersion: conversation.version,
                  to: latestMessage.sender.address,
                  subject: conversation.subject.startsWith('Re:')
                    ? conversation.subject
                    : `Re: ${conversation.subject}`,
                })
              }
            >
              Reply
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mark read"
            onClick={() => void onCommand({ kind: 'set-thread-read', conversationId, read: true })}
          >
            <HugeiconsIcon icon={MailOpen01Icon} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Archive"
            onClick={() =>
              void onCommand({ kind: 'set-thread-archived', conversationId, archived: true })
            }
          >
            <HugeiconsIcon icon={Archive02Icon} aria-hidden="true" />
          </Button>
          {latestMessage ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Star"
              onClick={() =>
                void onCommand({
                  kind: 'set-message-starred',
                  messageId: latestMessage.id,
                  starred: true,
                })
              }
            >
              <HugeiconsIcon icon={StarIcon} aria-hidden="true" />
            </Button>
          ) : null}
          <NativeSelect
            className="px-2.5 py-1.5"
            aria-label="Add label"
            defaultValue=""
            onChange={(event) => {
              const label = labels.find((item) => item.id === event.target.value)
              if (label)
                void onCommand({
                  kind: 'set-thread-label',
                  conversationId,
                  labelId: label.id,
                  applied: true,
                })
              event.currentTarget.value = ''
            }}
          >
            <option value="">Add label…</option>
            {labels
              .filter((label) => label.kind === 'user')
              .map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
          </NativeSelect>
        </div>
      </header>
      <ConversationSummary
        mailboxId={mailboxId}
        conversationId={conversationId}
        sourceVersion={conversation.version}
      />
      <div className="max-w-190 px-8 pb-8 max-[980px]:px-5">
        {conversation.messages.map((message, index) => (
          <MessageCard
            key={message.id}
            mailboxId={mailboxId}
            conversationId={conversationId}
            message={message}
            initiallyExpanded={index === conversation.messages.length - 1}
          />
        ))}
      </div>
    </section>
  )
}
