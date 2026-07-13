import type {
  CommandId,
  ConversationId,
  DraftId,
  LabelId,
  MailboxId,
  MessageId,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

export type MailCommand =
  | { kind: 'set-thread-archived'; conversationId: ConversationId; archived: boolean }
  | { kind: 'set-thread-read'; conversationId: ConversationId; read: boolean }
  | { kind: 'set-message-starred'; messageId: MessageId; starred: boolean }
  | {
      kind: 'set-thread-label'
      conversationId: ConversationId
      labelId: LabelId
      applied: boolean
    }

export type DraftCommand =
  | { kind: 'sync-draft'; draftId: DraftId; version: number }
  | { kind: 'send-draft'; draftId: DraftId; version: number }

export type DurableCommand = MailCommand | DraftCommand

export type ExecuteMailCommandInput = {
  requestId: OperationId
  mailboxId: MailboxId
  idempotencyKey: string
  command: MailCommand
}

export type CommandState =
  | 'pending'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'needs_review'
  | 'cancelled'

export type CommandReceipt = {
  id: CommandId
  mailboxId: MailboxId
  state: CommandState
  command: DurableCommand
  createdAt: UtcTimestamp
  nextAttemptAt?: UtcTimestamp | undefined
}

export type ListCommandIssuesInput = { requestId: OperationId; mailboxId: MailboxId }
export type ResolveCommandInput = {
  requestId: OperationId
  mailboxId: MailboxId
  commandId: CommandId
  resolution: 'recheck' | 'retry' | 'cancel'
}
