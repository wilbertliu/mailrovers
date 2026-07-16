import type { LabelSummary, MailCommand, MessageDetail } from '@mailrovers/mail-contracts'
import type { AttachmentId, ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
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
      className="mb-2 overflow-hidden"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex min-h-14.5 cursor-pointer list-inside items-center justify-between gap-4 px-3.5 py-3">
        <span className="flex min-w-0 flex-col">
          <strong className="truncate">{addressLabel(message.sender)}</strong>
          <small className="truncate">
            to {message.recipients.to.map(addressLabel).join(', ') || 'me'}
          </small>
        </span>
        <time>{new Date(message.receivedAt).toLocaleString()}</time>
      </summary>
      <div className="px-4 pt-2 pb-4.5">
        {body.data?.sanitizedHtmlBody ? (
          <EmailFrame
            html={body.data.sanitizedHtmlBody}
            title={`Message from ${message.sender.address}`}
          />
        ) : body.data?.textBody ? (
          <pre className="m-0 wrap-anywhere whitespace-pre-wrap">{body.data.textBody}</pre>
        ) : body.isPending && message.bodyAvailable ? (
          <p>Loading message…</p>
        ) : (
          <pre className="m-0 wrap-anywhere whitespace-pre-wrap">
            This message has no readable body.
          </pre>
        )}
        {message.attachments.length > 0 ? (
          <ul className="mt-4.5 flex list-none flex-wrap gap-2 p-0" aria-label="Attachments">
            {message.attachments.map((attachment) => (
              <li className="flex flex-col gap-0.5 px-2.5 py-2" key={attachment.id}>
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
      <section className="px-4.5 py-6" aria-live="polite">
        Loading conversation…
      </section>
    )
  if (query.isError || !query.data)
    return (
      <section className="px-4.5 py-6" role="alert">
        Unable to open this conversation.
      </section>
    )

  const conversation = query.data
  const latestMessage = conversation.messages.at(-1)
  return (
    <section className="min-w-0 overflow-auto" aria-label={conversation.subject}>
      <header className="sticky top-0 z-2 flex min-h-19 items-center justify-between px-4.5 py-4">
        <div className="min-w-0">
          <h1 className="truncate">{conversation.subject || '(No subject)'}</h1>
          <p className="mt-1">{conversation.messages.length} messages</p>
        </div>
        <div className="flex items-center gap-1.5">
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
            variant="secondary"
            size="sm"
            onClick={() => void onCommand({ kind: 'set-thread-read', conversationId, read: true })}
          >
            Mark read
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              void onCommand({ kind: 'set-thread-archived', conversationId, archived: true })
            }
          >
            Archive
          </Button>
          {latestMessage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                void onCommand({
                  kind: 'set-message-starred',
                  messageId: latestMessage.id,
                  starred: true,
                })
              }
            >
              Star
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
      <div className="p-3.5">
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
