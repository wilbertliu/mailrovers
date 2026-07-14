import type { AiStreamEvent } from './ai.js'
import type {
  MailboxId,
  MailboxConnectionState,
  MailboxSyncState,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

export type ListMailboxesInput = { requestId: OperationId }

export const stableErrorCodes = [
  'AI_ARTIFACT_STALE',
  'AI_AUTHENTICATION_FAILED',
  'AI_CONFIGURATION_INVALID',
  'AI_CONTEXT_STALE',
  'AI_OPERATION_EXPIRED',
  'AI_PROVIDER_THROTTLED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_RESPONSE_INVALID',
  'AI_UNSAFE_OUTPUT',
  'APPLICATION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'DRAFT_VERSION_CONFLICT',
  'GMAIL_CONFIGURATION_REQUIRED',
  'INTERNAL_ERROR',
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'OPERATION_CANCELLED',
  'PROVIDER_THROTTLED',
  'SYNC_FAILED',
  'UNAUTHORIZED_REQUEST',
] as const

export type StableErrorCode = (typeof stableErrorCodes)[number]

export type ProviderCapabilities = {
  threadArchive: boolean
  threadRead: boolean
  threadLabels: boolean
  messageStar: boolean
  drafts: boolean
  send: boolean
  search: boolean
  attachmentExport: boolean
}

export const GMAIL_CAPABILITIES: ProviderCapabilities = {
  threadArchive: true,
  threadRead: true,
  threadLabels: true,
  messageStar: true,
  drafts: true,
  send: true,
  search: true,
  attachmentExport: true,
}

export type MailboxSummary = {
  id: MailboxId
  provider: 'gmail'
  emailAddress: string
  displayName: string
  syncState: MailboxSyncState
  connectionState: MailboxConnectionState
  capabilities: ProviderCapabilities
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
  reason?: 'manual' | 'lifecycle' | undefined
}

export type SyncReceipt =
  | { requestId: OperationId; mailboxId: MailboxId; state: 'active' }
  | {
      requestId: OperationId
      mailboxId: MailboxId
      state: 'deferred'
      retryAt: UtcTimestamp
    }

export type GetSyncStatusInput = { requestId: OperationId; mailboxId: MailboxId }

export type SyncPhase =
  | 'idle'
  | 'authenticating'
  | 'importing_labels'
  | 'importing_messages'
  | 'importing_drafts'
  | 'reconciling_history'
  | 'full_reconciliation'
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

export const COMMITTED_CHANGES_REQUEST_ID = 'mailrovers:committed-changes'

export type CommittedChangesEvent = {
  kind: 'mail-changed'
  requestId: OperationId
  mailboxId?: MailboxId | undefined
  changes: {
    mailboxes?: true | undefined
    conversations?: true | undefined
    labels?: true | undefined
    drafts?: true | undefined
    outbox?: true | undefined
  }
}

export type EventRecoveryRequired = {
  kind: 'events-overflowed'
  requestId: OperationId
  mailboxId?: MailboxId | undefined
}

export type DesktopEvent =
  | SyncProgressEvent
  | SyncTerminalEvent
  | AiStreamEvent
  | CommittedChangesEvent
  | EventRecoveryRequired

export type ApplicationError = {
  code: StableErrorCode
  message: string
  retryable: boolean
  requestId: string
  userAction?: 'reauthenticate' | 'checkNetwork' | 'reviewSettings' | 'retry' | undefined
}

export type IpcResult<Value> = { ok: true; value: Value } | { ok: false; error: ApplicationError }
