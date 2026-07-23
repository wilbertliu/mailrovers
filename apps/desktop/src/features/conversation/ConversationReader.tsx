import type {
  ConversationDetail,
  LabelSummary,
  MailCommand,
  MessageDetail,
} from '@mailrovers/mail-contracts'
import type { AttachmentId, ConversationId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import {
  AiMagicIcon,
  Archive02Icon,
  MailOpen01Icon,
  MailReply01Icon,
  StarIcon,
  Tag01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { IconTooltipButton } from '@/components/icon-tooltip-button.js'
import { MailRelativeTime } from '@/components/mail-relative-time.js'
import { Button } from '@/components/ui/button.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.js'
import { featureFlags } from '@/feature-flags.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { ConversationSummaryPanel, useConversationSummary } from '../ai/ConversationSummary.js'
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
      className="m-0 border-b"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none flex-col gap-0.5 px-6 py-4 max-[980px]:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-sm font-medium">
            {addressLabel(message.sender)}
          </span>
          <MailRelativeTime className="shrink-0" value={message.receivedAt} />
        </div>
        <small className="min-w-0 truncate text-sm text-muted-foreground">
          to {message.recipients.to.map(addressLabel).join(', ') || 'me'}
        </small>
      </summary>
      <div className="px-6 pt-1 pb-6 text-sm leading-relaxed text-foreground/90 max-[980px]:px-5">
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

function ConversationReaderContent({
  mailboxId,
  conversationId,
  labels,
  onCommand,
  onReply,
  conversation,
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
  conversation: ConversationDetail
}) {
  const latestMessage = conversation.messages.at(-1)
  const summary = useConversationSummary({
    mailboxId,
    conversationId,
    sourceVersion: conversation.version,
  })
  const userLabels = labels.filter((label) => label.kind === 'user')

  return (
    <section className="min-w-0 overflow-auto bg-card" aria-label={conversation.subject}>
      <header className="window-titlebar sticky top-0 z-2 border-b bg-card">
        <div className="h-10 shrink-0" aria-hidden="true" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-6 pb-2.5 max-[980px]:px-5">
          <div className="flex h-7 min-w-0 items-center">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {conversation.subject || '(No subject)'}
            </h1>
          </div>
          <div className="flex h-7 items-center justify-self-end gap-0.5">
            <IconTooltipButton
              label="Summarize conversation"
              icon={AiMagicIcon}
              onClick={summary.generate}
            />
            {latestMessage ? (
              <IconTooltipButton
                label="Reply"
                icon={MailReply01Icon}
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
              />
            ) : null}
            {featureFlags.readerThreadActions ? (
              <>
                <IconTooltipButton
                  label="Mark read"
                  icon={MailOpen01Icon}
                  onClick={() =>
                    void onCommand({ kind: 'set-thread-read', conversationId, read: true })
                  }
                />
                <IconTooltipButton
                  label="Archive"
                  icon={Archive02Icon}
                  onClick={() =>
                    void onCommand({ kind: 'set-thread-archived', conversationId, archived: true })
                  }
                />
                {latestMessage ? (
                  <IconTooltipButton
                    label="Star"
                    icon={StarIcon}
                    onClick={() =>
                      void onCommand({
                        kind: 'set-message-starred',
                        messageId: latestMessage.id,
                        starred: true,
                      })
                    }
                  />
                ) : null}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-md"
                              aria-label="Add label"
                              disabled={userLabels.length === 0}
                            />
                          }
                        />
                      }
                    >
                      <HugeiconsIcon icon={Tag01Icon} aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>Add label</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="min-w-44">
                    {userLabels.map((label) => (
                      <DropdownMenuItem
                        key={label.id}
                        className="text-sm"
                        onClick={() =>
                          void onCommand({
                            kind: 'set-thread-label',
                            conversationId,
                            labelId: label.id,
                            applied: true,
                          })
                        }
                      >
                        {label.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <ConversationSummaryPanel
        status={summary.status}
        content={summary.content}
        error={summary.error}
        cleanupRef={summary.cleanupRef}
        onCancel={summary.cancel}
        onRegenerate={summary.regenerate}
      />
      <div>
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

  return (
    <ConversationReaderContent
      mailboxId={mailboxId}
      conversationId={conversationId}
      labels={labels}
      onCommand={onCommand}
      onReply={onReply}
      conversation={query.data}
    />
  )
}
