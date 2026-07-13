import type { LabelSummary, MailCommand } from '@mailrovers/mail-contracts'
import type { ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { useQuery } from '@tanstack/react-query'
import { desktopBridge } from '../../desktop-bridge.js'
import { EmailFrame } from './EmailFrame.js'

function addressLabel(address: { name?: string | undefined; address: string }): string {
  return address.name ? `${address.name} <${address.address}>` : address.address
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
      <div className="message-stack">
        {conversation.messages.map((message, index) => {
          const latest = index === conversation.messages.length - 1
          return (
            <details className="message" key={message.id} open={latest}>
              <summary>
                <span>
                  <strong>{addressLabel(message.sender)}</strong>
                  <small>to {message.recipients.to.map(addressLabel).join(', ') || 'me'}</small>
                </span>
                <time>{new Date(message.receivedAt).toLocaleString()}</time>
              </summary>
              <div className="message-body">
                {message.sanitizedHtmlBody ? (
                  <EmailFrame
                    html={message.sanitizedHtmlBody}
                    title={`Message from ${message.sender.address}`}
                  />
                ) : (
                  <pre>{message.textBody || 'This message has no readable body.'}</pre>
                )}
                {message.attachments.length > 0 ? (
                  <ul className="attachment-list" aria-label="Attachments">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <span>{attachment.filename}</span>
                        <small>{attachment.mediaType}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}
