import type {
  MailboxId,
  MailboxSyncState,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

export type ListMailboxesInput = { requestId: OperationId }

export type MailboxSummary = {
  id: MailboxId
  provider: 'gmail'
  emailAddress: string
  displayName: string
  syncState: MailboxSyncState
  importedMessageCount: number
  importTotalEstimate?: number | undefined
  lastSuccessfulSyncAt?: UtcTimestamp | undefined
}

export type ConnectGmailInput = {
  requestId: OperationId
  loginHint?: string | undefined
}

export type ConnectGmailResult = {
  mailbox: MailboxSummary
  sync: SyncReceipt
}

export type DisconnectMailboxInput = {
  requestId: OperationId
  mailboxId: MailboxId
  removeLocalData: boolean
}

export type StartSyncInput = {
  requestId: OperationId
  mailboxId: MailboxId
}

export type SyncReceipt = { requestId: OperationId; mailboxId: MailboxId }

export type GetSyncStatusInput = { requestId: OperationId; mailboxId: MailboxId }

export type SyncPhase =
  | 'idle'
  | 'authenticating'
  | 'importing_labels'
  | 'importing_messages'
  | 'importing_drafts'
  | 'reconciling_history'
  | 'paused'
  | 'complete'
  | 'failed'
  | 'auth_required'

export type SyncStatus = {
  mailboxId: MailboxId
  phase: SyncPhase
  importedMessageCount: number
  importedDraftCount: number
  totalEstimate?: number | undefined
  retryAt?: UtcTimestamp | undefined
  error?: ApplicationError | undefined
}

export type CancelOperationInput = { requestId: OperationId; operationId: OperationId }

export type SyncProgressEvent = {
  kind: 'sync-progress'
  requestId: OperationId
  mailboxId: MailboxId
  status: SyncStatus
}

export type SyncTerminalEvent =
  | {
      kind: 'sync-completed'
      requestId: OperationId
      mailboxId: MailboxId
      status: SyncStatus
    }
  | {
      kind: 'sync-failed'
      requestId: OperationId
      mailboxId: MailboxId
      error: ApplicationError
    }
  | {
      kind: 'sync-cancelled'
      requestId: OperationId
      mailboxId: MailboxId
      status: SyncStatus
    }

export type DesktopEvent = SyncProgressEvent | SyncTerminalEvent

export type ApplicationError = {
  code: string
  message: string
  retryable: boolean
  requestId: string
  userAction?: 'reauthenticate' | 'checkNetwork' | 'reviewSettings' | 'retry' | undefined
}

export type IpcResult<Value> = { ok: true; value: Value } | { ok: false; error: ApplicationError }
