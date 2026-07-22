import {
  decodeCommandState,
  decodeDraftSyncState,
  decodeImportState,
  decodeMailboxConnectionState,
  decodeMailboxSyncState,
  decodeResumeImportState,
  type AiArtifact,
  type CommandReceipt,
  type Draft,
  type DurableCommand,
} from '@mailrovers/mail-contracts'
import {
  aiArtifactId,
  commandId,
  conversationId,
  draftId,
  draftRevisionFingerprint,
  labelId,
  mailboxId,
  messageId,
  utcTimestamp,
  workspaceId,
  type MailAddress,
  type Mailbox,
  type MailboxId,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'

export type Cursor = { v: 1; t: string; id: string; f?: string | undefined }
export type SearchCursor = { v: 1; r: number; rowid: number; f: string }

export type Row = Record<string, unknown>

export function row(value: unknown): Row {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid database row')
  return value as Row
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function decodeCursor(value: string): Cursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'v' in decoded &&
      't' in decoded &&
      'id' in decoded &&
      decoded.v === 1 &&
      typeof decoded.t === 'string' &&
      typeof decoded.id === 'string' &&
      (!('f' in decoded) || typeof decoded.f === 'string')
    )
      return {
        v: 1,
        t: decoded.t,
        id: decoded.id,
        ...('f' in decoded && typeof decoded.f === 'string' ? { f: decoded.f } : {}),
      }
  } catch {}
  throw new Error('Invalid conversation cursor')
}

export function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeSearchCursor(value: string): SearchCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'v' in decoded &&
      'r' in decoded &&
      'rowid' in decoded &&
      'f' in decoded &&
      decoded.v === 1 &&
      typeof decoded.r === 'number' &&
      typeof decoded.rowid === 'number' &&
      typeof decoded.f === 'string'
    )
      return { v: 1, r: decoded.r, rowid: decoded.rowid, f: decoded.f }
  } catch {}
  throw new Error('Invalid search cursor')
}

export function encodeSearchCursor(value: SearchCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function parseAddresses(value: unknown): MailAddress[] {
  if (typeof value !== 'string') return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry): MailAddress[] => {
    if (typeof entry !== 'object' || entry === null || !('address' in entry)) return []
    if (typeof entry.address !== 'string') return []
    return [
      {
        address: entry.address,
        ...('name' in entry && typeof entry.name === 'string' ? { name: entry.name } : {}),
      },
    ]
  })
}

export function parseAddress(value: unknown): MailAddress {
  if (typeof value !== 'string') return { address: 'unknown@invalid' }
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || !('address' in parsed))
    return { address: 'unknown@invalid' }
  if (typeof parsed.address !== 'string') return { address: 'unknown@invalid' }
  return {
    address: parsed.address,
    ...('name' in parsed && typeof parsed.name === 'string' ? { name: parsed.name } : {}),
  }
}

export function commandEntity(command: DurableCommand): string {
  switch (command.kind) {
    case 'set-thread-archived':
    case 'set-thread-read':
    case 'set-thread-label':
      return `conversation:${command.conversationId}`
    case 'set-message-starred':
      return `message:${command.messageId}`
    case 'sync-draft':
    case 'send-draft':
      return `draft:${command.draftId}`
  }
}

export function parseMailCommand(value: unknown): DurableCommand {
  if (typeof value !== 'object' || value === null || !('kind' in value))
    throw new Error('Invalid stored command')
  const kind = value.kind
  if (kind === 'set-thread-archived' && 'conversationId' in value && 'archived' in value)
    return {
      kind,
      conversationId: conversationId(String(value.conversationId)),
      archived: Boolean(value.archived),
    }
  if (kind === 'set-thread-read' && 'conversationId' in value && 'read' in value)
    return {
      kind,
      conversationId: conversationId(String(value.conversationId)),
      read: Boolean(value.read),
    }
  if (kind === 'set-message-starred' && 'messageId' in value && 'starred' in value)
    return { kind, messageId: messageId(String(value.messageId)), starred: Boolean(value.starred) }
  if (
    (kind === 'sync-draft' || kind === 'send-draft') &&
    'draftId' in value &&
    'expectedVersion' in value &&
    'outboundRevisionFingerprint' in value
  )
    return {
      kind,
      draftId: draftId(String(value.draftId)),
      expectedVersion: Number(value.expectedVersion),
      outboundRevisionFingerprint: draftRevisionFingerprint(
        String(value.outboundRevisionFingerprint),
      ),
    }
  if (
    kind === 'set-thread-label' &&
    'conversationId' in value &&
    'labelId' in value &&
    'applied' in value
  )
    return {
      kind,
      conversationId: conversationId(String(value.conversationId)),
      labelId: labelId(String(value.labelId)),
      applied: Boolean(value.applied),
    }
  throw new Error('Invalid stored command')
}

export function mapAiArtifact(value: unknown): AiArtifact {
  const result = row(value)
  const draft = optionalString(result.draft_id)
  const recipientFingerprint = optionalString(result.recipient_fingerprint)
  const acceptedAt = optionalString(result.accepted_at)
  const rejectedAt = optionalString(result.rejected_at)
  return {
    id: aiArtifactId(String(result.id)),
    mailboxId: mailboxId(String(result.mailbox_id)),
    conversationId: conversationId(String(result.conversation_id)),
    artifactType:
      String(result.artifact_type) === 'reply_draft' ? 'reply_draft' : 'conversation_summary',
    sourceVersion: Number(result.source_version),
    model: String(result.model),
    policyVersion: String(result.policy_version),
    content: String(result.content),
    ...(draft === undefined ? {} : { draftId: draftId(draft) }),
    ...(result.draft_version === null || result.draft_version === undefined
      ? {}
      : { draftVersion: Number(result.draft_version) }),
    ...(recipientFingerprint === undefined ? {} : { recipientFingerprint }),
    ...(acceptedAt === undefined ? {} : { acceptedAt: utcTimestamp(acceptedAt) }),
    ...(rejectedAt === undefined ? {} : { rejectedAt: utcTimestamp(rejectedAt) }),
    createdAt: utcTimestamp(String(result.created_at)),
  }
}

export function aiConfigurationKey(mailbox: MailboxId): string {
  return `ai.configuration.${mailbox}`
}

export function mapDraft(value: unknown): Draft {
  const result = row(value)
  const providerDraftId = optionalString(result.provider_draft_id)
  const conversation = optionalString(result.conversation_id)
  const replyTo = optionalString(result.reply_to_message_id)
  const htmlBody = optionalString(result.html_body)
  return {
    id: draftId(String(result.id)),
    mailboxId: mailboxId(String(result.mailbox_id)),
    ...(conversation === undefined ? {} : { conversationId: conversationId(conversation) }),
    ...(replyTo === undefined ? {} : { replyToMessageId: messageId(replyTo) }),
    ...(providerDraftId === undefined ? {} : { providerDraftId }),
    to: parseAddresses(result.to_json),
    cc: parseAddresses(result.cc_json),
    bcc: parseAddresses(result.bcc_json),
    subject: String(result.subject),
    textBody: String(result.text_body),
    ...(htmlBody === undefined ? {} : { htmlBody }),
    version: Number(result.version),
    revisionFingerprint: draftRevisionFingerprint(String(result.revision_fingerprint)),
    syncState: decodeDraftSyncState(result.sync_state),
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

export function ftsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(' AND ')
}

export function mapCommand(value: unknown): CommandReceipt {
  const result = row(value)
  const command: unknown = JSON.parse(String(result.payload_json))
  const nextAttemptAt = optionalString(result.next_attempt_at)
  return {
    id: commandId(String(result.id)),
    mailboxId: mailboxId(String(result.mailbox_id)),
    state: decodeCommandState(result.state),
    command: parseMailCommand(command),
    createdAt: utcTimestamp(String(result.created_at)),
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt: utcTimestamp(nextAttemptAt) }),
  }
}

export function mapMailbox(value: unknown): Mailbox {
  const result = row(value)
  const lastSuccessfulSyncAt = optionalString(result.last_successful_sync_at)
  return {
    id: mailboxId(String(result.id)),
    workspaceId: workspaceId(String(result.workspace_id)),
    provider: 'gmail',
    providerAccountId: String(result.provider_account_id),
    emailAddress: String(result.email_address),
    displayName: String(result.display_name),
    syncState: decodeMailboxSyncState(result.sync_state),
    connectionState: decodeMailboxConnectionState(result.connection_state ?? 'connected'),
    ...(lastSuccessfulSyncAt === undefined
      ? {}
      : { lastSuccessfulSyncAt: utcTimestamp(lastSuccessfulSyncAt) }),
    createdAt: utcTimestamp(String(result.created_at)),
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

export function mapCheckpoint(value: unknown): SyncCheckpoint {
  const result = row(value)
  const optionalTimestamp = (name: string) => {
    const value = optionalString(result[name])
    return value === undefined ? undefined : utcTimestamp(value)
  }
  return {
    mailboxId: mailboxId(String(result.mailbox_id)),
    ...(optionalString(result.provider_cursor) === undefined
      ? {}
      : { providerCursor: String(result.provider_cursor) }),
    ...(optionalString(result.history_start_cursor) === undefined
      ? {}
      : { historyStartCursor: String(result.history_start_cursor) }),
    ...(optionalString(result.history_page_token) === undefined
      ? {}
      : { historyPageToken: String(result.history_page_token) }),
    ...(optionalString(result.history_target_cursor) === undefined
      ? {}
      : { historyTargetCursor: String(result.history_target_cursor) }),
    ...(optionalString(result.import_message_page_token) === undefined
      ? {}
      : { importMessagePageToken: String(result.import_message_page_token) }),
    ...(optionalString(result.import_draft_page_token) === undefined
      ? {}
      : { importDraftPageToken: String(result.import_draft_page_token) }),
    importState: decodeImportState(result.import_state),
    ...(optionalString(result.resume_import_state) === undefined
      ? {}
      : {
          resumeImportState: decodeResumeImportState(result.resume_import_state),
        }),
    importedMessageCount: Number(result.imported_message_count),
    importedDraftCount: Number(result.imported_draft_count),
    ...(result.import_total_estimate === null || result.import_total_estimate === undefined
      ? {}
      : { importTotalEstimate: Number(result.import_total_estimate) }),
    ...(optionalTimestamp('last_reconciled_at') === undefined
      ? {}
      : { lastReconciledAt: optionalTimestamp('last_reconciled_at') }),
    ...(optionalTimestamp('retry_at') === undefined
      ? {}
      : { retryAt: optionalTimestamp('retry_at') }),
    ...(optionalString(result.last_error_code) === undefined
      ? {}
      : { lastErrorCode: String(result.last_error_code) }),
    ...(optionalString(result.full_reconciliation_generation) === undefined
      ? {}
      : { fullReconciliationGeneration: String(result.full_reconciliation_generation) }),
    ...(optionalString(result.full_reconciliation_page_token) === undefined
      ? {}
      : { fullReconciliationPageToken: String(result.full_reconciliation_page_token) }),
    syncFailureCount: Number(result.sync_failure_count ?? 0),
    ...(optionalTimestamp('post_import_analyzed_at') === undefined
      ? {}
      : { postImportAnalyzedAt: optionalTimestamp('post_import_analyzed_at') }),
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

export function placeholderLabelId(mailbox: MailboxId, providerLabelId: string): string {
  return `gmail:${mailbox}:label:${providerLabelId}`
}
