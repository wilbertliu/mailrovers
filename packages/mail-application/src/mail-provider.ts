import type { MailboxId, ProviderChangeBatch } from '@mailrovers/mail-domain'

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
}

export interface MailProviderFactory {
  create(mailboxId: MailboxId): Promise<MailProvider>
}
