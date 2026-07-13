import type { Draft, DurableCommand } from '@mailrovers/mail-contracts'
import type { DraftId, MailAddress, MailboxId, ProviderChangeBatch } from '@mailrovers/mail-domain'

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
}

export type ProviderCommandResult = {
  changes: ProviderChangeBatch
  draftIdentity?:
    | {
        draftId: DraftId
        providerDraftId: string
        providerMessageId: string
      }
    | undefined
  sentDraftId?: DraftId | undefined
}

export type ProviderCommandReconciliation =
  | { kind: 'applied'; result: ProviderCommandResult }
  | { kind: 'not-applied' }
  | { kind: 'uncertain' }

export interface MailProvider {
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
}

export interface MailProviderFactory {
  create(mailboxId: MailboxId): Promise<MailProvider>
}
