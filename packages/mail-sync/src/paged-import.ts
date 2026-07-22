import type {
  ImportPageCommit,
  MailboxSyncStore,
  MailProvider,
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
  store: Pick<MailboxSyncStore, 'applyImportBatch'>
  now(): UtcTimestamp
  withFence<T>(write: (fence: SyncLeaseFence) => Promise<T>): Promise<T>
  requireCheckpoint(): Promise<SyncCheckpoint>
  publishProgress(): Promise<void>
}

export type LabelImportRunScope = {
  mailboxId: MailboxId
  provider: MailProvider
  signal: AbortSignal
  store: Pick<MailboxSyncStore, 'applyImportBatch' | 'setImportState'>
  now(): UtcTimestamp
  withFence<T>(write: (fence: SyncLeaseFence) => Promise<T>): Promise<T>
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

export async function runLabelImportPhase(scope: LabelImportRunScope): Promise<SyncPhaseOutcome> {
  await scope.withFence((fence) =>
    scope.store.setImportState({
      mailboxId: scope.mailboxId,
      state: 'importing_labels',
      updatedAt: scope.now(),
      fence,
    }),
  )
  for await (const batch of scope.provider.importMailbox({
    mailboxId: scope.mailboxId,
    phase: 'labels',
    signal: scope.signal,
  }))
    await scope.withFence((fence) =>
      scope.store.applyImportBatch({
        mailboxId: scope.mailboxId,
        batch: batch.changes,
        updatedAt: scope.now(),
        fence,
      }),
    )
  await scope.withFence((fence) =>
    scope.store.setImportState({
      mailboxId: scope.mailboxId,
      state: 'importing_messages',
      updatedAt: scope.now(),
      fence,
    }),
  )
  await scope.publishProgress()
  return { kind: 'continue', state: 'importing_messages' }
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
      await scope.withFence((fence) =>
        scope.store.applyImportBatch({
          mailboxId: scope.mailboxId,
          batch: batch.changes,
          ...(page === undefined ? {} : { page }),
          updatedAt: scope.now(),
          fence,
        }),
      )
      await scope.publishProgress()
      if (batch.pageComplete && batch.nextPageToken === undefined) importing = false
    }
  }
  return { kind: 'continue', state: nextState }
}
