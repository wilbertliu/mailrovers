import type {
  ImportPageCommit,
  MailProvider,
  MailStore,
  SyncLeaseFence,
} from '@mailrovers/mail-application'
import type { ImportState, MailboxId, SyncCheckpoint, UtcTimestamp } from '@mailrovers/mail-domain'

export type SyncPhaseOutcome =
  | { kind: 'continue'; state: ImportState }
  | { kind: 'complete' }
  | {
      kind: 'history-restart'
      checkpoint: SyncCheckpoint
      pageTokenRestarts: number
    }

export type PagedImportSpec = {
  phase: 'messages' | 'drafts'
  pageToken(checkpoint: SyncCheckpoint): string | undefined
  commitPage(input: {
    nextPageToken?: string | undefined
    processedCount: number
    totalEstimate?: number | undefined
  }): ImportPageCommit
}

export type PagedImportRunScope = {
  mailboxId: MailboxId
  provider: MailProvider
  signal: AbortSignal
  store: Pick<MailStore, 'applyImportBatch'>
  now(): UtcTimestamp
  renewLease(): Promise<SyncLeaseFence>
  requireCheckpoint(): Promise<SyncCheckpoint>
  publishProgress(): Promise<void>
}

export const MESSAGE_IMPORT: PagedImportSpec = {
  phase: 'messages',
  pageToken: (checkpoint) => checkpoint.importMessagePageToken,
  commitPage: ({ nextPageToken, processedCount, totalEstimate }) => ({
    kind: 'messages',
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
    processedCount,
    ...(totalEstimate === undefined ? {} : { totalEstimate }),
    nextState: nextPageToken === undefined ? 'importing_drafts' : 'importing_messages',
  }),
}

export const DRAFT_IMPORT: PagedImportSpec = {
  phase: 'drafts',
  pageToken: (checkpoint) => checkpoint.importDraftPageToken,
  commitPage: ({ nextPageToken, processedCount }) => ({
    kind: 'drafts',
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
    processedCount,
    nextState: nextPageToken === undefined ? 'reconciling_history' : 'importing_drafts',
  }),
}

export async function runPagedImportPhase(
  scope: PagedImportRunScope,
  spec: PagedImportSpec,
): Promise<SyncPhaseOutcome> {
  let importing = true
  let nextState: ImportState = spec.phase === 'messages' ? 'importing_messages' : 'importing_drafts'
  while (importing) {
    const checkpoint = await scope.requireCheckpoint()
    const pageToken = spec.pageToken(checkpoint)
    let pageCount = 0
    await scope.renewLease()
    for await (const batch of scope.provider.importMailbox({
      mailboxId: scope.mailboxId,
      phase: spec.phase,
      ...(pageToken === undefined ? {} : { pageToken }),
      signal: scope.signal,
    })) {
      pageCount += batch.processedCount
      const page = batch.pageComplete
        ? spec.commitPage({
            nextPageToken: batch.nextPageToken,
            processedCount: pageCount,
            totalEstimate: batch.totalEstimate,
          })
        : undefined
      if (page?.nextState !== undefined) nextState = page.nextState
      await scope.store.applyImportBatch({
        mailboxId: scope.mailboxId,
        batch: batch.changes,
        ...(page === undefined ? {} : { page }),
        updatedAt: scope.now(),
        fence: await scope.renewLease(),
      })
      await scope.publishProgress()
      if (batch.pageComplete && batch.nextPageToken === undefined) importing = false
    }
  }
  return { kind: 'continue', state: nextState }
}
