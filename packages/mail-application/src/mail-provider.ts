import type { Draft, DurableCommand, ProviderCapabilities } from '@mailrovers/mail-contracts'
import type {
  CanonicalDraftRevision,
  DraftId,
  DraftRevisionFingerprint,
  MailAddress,
  MailboxId,
  ProviderChangeBatch,
} from '@mailrovers/mail-domain'

export type GmailAuthorization = {
  providerAccountId: string
  emailAddress: string
  displayName: string
  refreshToken: string
  historyId: string
}

export interface GmailConnector {
  authorize(input: {
    loginHint?: string | undefined
    signal: AbortSignal
  }): Promise<GmailAuthorization>
}

export type ProviderImportBatch = {
  changes: ProviderChangeBatch
  processedCount: number
  pageComplete: boolean
  nextPageToken?: string | undefined
  totalEstimate?: number | undefined
}

export type PullChangesResult = {
  changes: ProviderChangeBatch
  historyId: string
  nextPageToken?: string | undefined
}

export type ResolvedProviderCommand = {
  mailboxId: MailboxId
  command: DurableCommand
  providerThreadId?: string | undefined
  providerMessageId?: string | undefined
  providerLabelId?: string | undefined
  draft?: Draft | undefined
  sender?: MailAddress | undefined
  internetMessageId?: string | undefined
  replyInternetMessageId?: string | undefined
  outboundRevision?: CanonicalDraftRevision | undefined
}

export type ProviderCommandResult = {
  changes: ProviderChangeBatch
  draftIdentity?:
    | {
        draftId: DraftId
        providerDraftId: string
        providerMessageId: string
        providerFingerprint: DraftRevisionFingerprint
      }
    | undefined
  sentDraftId?: DraftId | undefined
}

export type ProviderCommandReconciliation =
  | { kind: 'applied'; result: ProviderCommandResult }
  | { kind: 'not-applied' }
  | { kind: 'uncertain' }

export type GetProviderAttachmentInput = {
  mailboxId: MailboxId
  providerMessageId: string
  providerAttachmentId: string
  expectedSizeBytes: number
  signal: AbortSignal
}

export interface MailProvider {
  getCapabilities(): ProviderCapabilities
  getCurrentCursor(signal: AbortSignal): Promise<string>
  importMailbox(input: {
    mailboxId: MailboxId
    phase: 'labels' | 'messages' | 'drafts'
    pageToken?: string | undefined
    signal: AbortSignal
  }): AsyncIterable<ProviderImportBatch>
  pullChanges(input: {
    mailboxId: MailboxId
    startCursor: string
    pageToken?: string | undefined
    signal: AbortSignal
  }): Promise<PullChangesResult>
  executeCommand(
    input: ResolvedProviderCommand & { signal: AbortSignal },
  ): Promise<ProviderCommandResult>
  reconcileCommand(
    input: ResolvedProviderCommand & { signal: AbortSignal },
  ): Promise<ProviderCommandReconciliation>
  getAttachment(input: GetProviderAttachmentInput): Promise<ReadableStream<Uint8Array>>
}

export interface MailProviderFactory {
  create(mailboxId: MailboxId): Promise<MailProvider>
}

export type AttachmentCacheReceipt = {
  relativePath: string
  sizeBytes: number
}

export interface AttachmentStorage {
  exists(relativePath: string): Promise<boolean>
  remove(relativePaths: readonly string[]): Promise<void>
  cache(input: {
    stream: ReadableStream<Uint8Array>
    expectedSizeBytes: number
    signal: AbortSignal
  }): Promise<AttachmentCacheReceipt>
  export(input: {
    relativePath: string
    suggestedName: string
    signal: AbortSignal
  }): Promise<'exported' | 'cancelled'>
}
