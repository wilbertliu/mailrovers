import type { LabelSummary, MailCommand, MessageDetail } from '@mailrovers/mail-contracts'
import type { AttachmentId, ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'
import { ConversationSummary } from '../ai/ConversationSummary.js'
import { EmailFrame } from './EmailFrame.js'

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
      className="message"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{addressLabel(message.sender)}</strong>
          <small>to {message.recipients.to.map(addressLabel).join(', ') || 'me'}</small>
        </span>
        <time>{new Date(message.receivedAt).toLocaleString()}</time>
      </summary>
      <div className="message-body">
        {body.data?.sanitizedHtmlBody ? (
          <EmailFrame
            html={body.data.sanitizedHtmlBody}
            title={`Message from ${message.sender.address}`}
          />
        ) : body.data?.textBody ? (
          <pre>{body.data.textBody}</pre>
        ) : body.isPending && message.bodyAvailable ? (
          <p>Loading message…</p>
        ) : (
          <pre>This message has no readable body.</pre>
        )}
        {message.attachments.length > 0 ? (
          <ul className="attachment-list" aria-label="Attachments">
            {message.attachments.map((attachment) => (
              <li key={attachment.id}>
                <span>{attachment.filename}</span>
                <small>{attachment.mediaType}</small>
                <button
                  type="button"
                  className="secondary"
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
                </button>
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
      <section className="reader-state" aria-live="polite">
        Loading conversation…
      </section>
    )
  if (query.isError || !query.data)
    return (
      <section className="reader-state" role="alert">
        Unable to open this conversation.
      </section>
    )

  const conversation = query.data
  const latestMessage = conversation.messages.at(-1)
  return (
    <section className="conversation-reader" aria-label={conversation.subject}>
      <header className="reader-header">
        <div>
          <h1>{conversation.subject || '(No subject)'}</h1>
          <p>{conversation.messages.length} messages</p>
        </div>
        <div className="reader-actions">
          {latestMessage ? (
            <button
              type="button"
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
            </button>
          ) : null}
          <button
            type="button"
            className="secondary"
            onClick={() => void onCommand({ kind: 'set-thread-read', conversationId, read: true })}
          >
            Mark read
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void onCommand({ kind: 'set-thread-archived', conversationId, archived: true })
            }
          >
            Archive
          </button>
          {latestMessage ? (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void onCommand({
                  kind: 'set-message-starred',
                  messageId: latestMessage.id,
                  starred: true,
                })
              }
            >
              Star
            </button>
          ) : null}
          <select
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
          </select>
        </div>
      </header>
      <ConversationSummary
        mailboxId={mailboxId}
        conversationId={conversationId}
        sourceVersion={conversation.version}
      />
      <div className="message-stack">
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
