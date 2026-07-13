import type {
  MailProvider,
  MailProviderFactory,
  MailStore,
  SyncEngine,
} from '@mailrovers/mail-application'
import type {
  ApplicationError,
  DesktopEvent,
  SyncReceipt,
  SyncStatus,
} from '@mailrovers/mail-contracts'
import {
  operationId,
  utcTimestamp,
  type ImportState,
  type MailboxId,
  type OperationId,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'

export type MailSyncEngineOptions = {
  store: MailStore
  providers: MailProviderFactory
  publish(event: DesktopEvent): void
  now?: (() => Date) | undefined
}

type RunningOperation = {
  mailboxId: MailboxId
  requestId: OperationId
  controller: AbortController
  userCancelled: boolean
  promise: Promise<void>
}

function applicationError(error: unknown, requestId: OperationId): ApplicationError {
  if (error instanceof Error && error.name === 'AbortError')
    return {
      code: 'OPERATION_CANCELLED',
      message: 'The operation was cancelled.',
      retryable: true,
      requestId,
      userAction: 'retry',
    }
  const status = providerStatus(error)
  if (status === 401)
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Gmail needs to be connected again.',
      retryable: false,
      requestId,
      userAction: 'reauthenticate',
    }
  if (status === 429 || status === 403)
    return {
      code: 'PROVIDER_THROTTLED',
      message: 'Gmail is temporarily limiting requests.',
      retryable: true,
      requestId,
      userAction: 'retry',
    }
  return {
    code: 'SYNC_FAILED',
    message: 'Mail import could not be completed.',
    retryable: true,
    requestId,
    userAction: 'retry',
  }
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function phaseFor(checkpoint: SyncCheckpoint): SyncStatus['phase'] {
  switch (checkpoint.importState) {
    case 'pending':
      return 'idle'
    case 'importing_labels':
    case 'importing_messages':
    case 'importing_drafts':
    case 'reconciling_history':
      return checkpoint.importState
    case 'paused':
      return 'paused'
    case 'complete':
      return 'complete'
    case 'failed':
      return 'failed'
  }
}

function statusFromCheckpoint(checkpoint: SyncCheckpoint): SyncStatus {
  return {
    mailboxId: checkpoint.mailboxId,
    phase: phaseFor(checkpoint),
    importedMessageCount: checkpoint.importedMessageCount,
    importedDraftCount: checkpoint.importedDraftCount,
    ...(checkpoint.importTotalEstimate === undefined
      ? {}
      : { totalEstimate: checkpoint.importTotalEstimate }),
  }
}

export class MailSyncEngine implements SyncEngine {
  private readonly operations = new Map<OperationId, RunningOperation>()
  private readonly mailboxOperations = new Map<MailboxId, OperationId>()

  constructor(private readonly options: MailSyncEngineOptions) {}

  private now(): ReturnType<typeof utcTimestamp> {
    return utcTimestamp((this.options.now?.() ?? new Date()).toISOString())
  }

  async start(input: { mailboxId: MailboxId; requestId: OperationId }): Promise<SyncReceipt> {
    const active = this.mailboxOperations.get(input.mailboxId)
    if (active !== undefined) return { requestId: active, mailboxId: input.mailboxId }
    if (this.operations.has(input.requestId))
      throw new Error('An operation with this request ID already exists')
    const controller = new AbortController()
    const operation: RunningOperation = {
      mailboxId: input.mailboxId,
      requestId: input.requestId,
      controller,
      userCancelled: false,
      promise: Promise.resolve(),
    }
    this.operations.set(input.requestId, operation)
    this.mailboxOperations.set(input.mailboxId, input.requestId)
    operation.promise = this.run(operation).finally(() => {
      this.operations.delete(input.requestId)
      this.mailboxOperations.delete(input.mailboxId)
    })
    void operation.promise.catch(() => undefined)
    return { requestId: input.requestId, mailboxId: input.mailboxId }
  }

  async getStatus(mailboxId: MailboxId): Promise<SyncStatus> {
    const checkpoint = await this.options.store.getSyncCheckpoint(mailboxId)
    if (!checkpoint)
      return {
        mailboxId,
        phase: 'idle',
        importedMessageCount: 0,
        importedDraftCount: 0,
      }
    return statusFromCheckpoint(checkpoint)
  }

  async cancel(id: OperationId): Promise<boolean> {
    const operation = this.operations.get(id)
    if (!operation) return false
    operation.userCancelled = true
    operation.controller.abort()
    await operation.promise.catch(() => undefined)
    return true
  }

  async cancelMailbox(mailboxId: MailboxId): Promise<boolean> {
    const active = this.mailboxOperations.get(mailboxId)
    return active === undefined ? false : this.cancel(active)
  }

  async resumeInterrupted(): Promise<void> {
    const mailboxes = await this.options.store.listMailboxes()
    for (const mailbox of mailboxes) {
      if (mailbox.syncState !== 'importing' && mailbox.syncState !== 'reconciling') continue
      await this.start({
        mailboxId: mailbox.id,
        requestId: operationId(`resume:${mailbox.id}:${Date.now()}`),
      })
    }
  }

  async shutdown(): Promise<void> {
    const operations = [...this.operations.values()]
    for (const operation of operations) operation.controller.abort()
    await Promise.all(operations.map((operation) => operation.promise.catch(() => undefined)))
  }

  private async publishProgress(operation: RunningOperation): Promise<void> {
    const status = await this.getStatus(operation.mailboxId)
    this.options.publish({
      kind: 'sync-progress',
      requestId: operation.requestId,
      mailboxId: operation.mailboxId,
      status,
    })
  }

  private async run(operation: RunningOperation): Promise<void> {
    try {
      const provider = await this.options.providers.create(operation.mailboxId)
      for (let restart = 0; restart < 3; restart += 1) {
        const completed = await this.runFromCheckpoint(operation, provider)
        if (completed) {
          const status = await this.getStatus(operation.mailboxId)
          this.options.publish({
            kind: 'sync-completed',
            requestId: operation.requestId,
            mailboxId: operation.mailboxId,
            status,
          })
          return
        }
      }
      throw new Error('Gmail history expired repeatedly during initial import')
    } catch (error) {
      if (operation.controller.signal.aborted) {
        if (operation.userCancelled) {
          await this.options.store.setImportState({
            mailboxId: operation.mailboxId,
            state: 'paused',
            updatedAt: this.now(),
          })
          const status = await this.getStatus(operation.mailboxId)
          this.options.publish({
            kind: 'sync-cancelled',
            requestId: operation.requestId,
            mailboxId: operation.mailboxId,
            status,
          })
        }
        return
      }
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state: 'failed',
        updatedAt: this.now(),
      })
      this.options.publish({
        kind: 'sync-failed',
        requestId: operation.requestId,
        mailboxId: operation.mailboxId,
        error: applicationError(error, operation.requestId),
      })
    }
  }

  private async runFromCheckpoint(
    operation: RunningOperation,
    provider: MailProvider,
  ): Promise<boolean> {
    let checkpoint = await this.requireCheckpoint(operation.mailboxId)
    let state: ImportState =
      checkpoint.importState === 'paused' || checkpoint.importState === 'failed'
        ? (checkpoint.resumeImportState ?? 'pending')
        : checkpoint.importState
    if (checkpoint.importState === 'paused' || checkpoint.importState === 'failed') {
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state,
        updatedAt: this.now(),
      })
      checkpoint = await this.requireCheckpoint(operation.mailboxId)
    }

    if (state === 'complete') return this.reconcile(operation, provider, checkpoint)

    if (state === 'pending' || state === 'importing_labels') {
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state: 'importing_labels',
        updatedAt: this.now(),
      })
      for await (const batch of provider.importMailbox({
        mailboxId: operation.mailboxId,
        phase: 'labels',
        signal: operation.controller.signal,
      }))
        await this.options.store.applyImportBatch({
          mailboxId: operation.mailboxId,
          batch: batch.changes,
          updatedAt: this.now(),
        })
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state: 'importing_messages',
        updatedAt: this.now(),
      })
      await this.publishProgress(operation)
      state = 'importing_messages'
    }

    if (state === 'importing_messages') {
      let importing = true
      while (importing) {
        checkpoint = await this.requireCheckpoint(operation.mailboxId)
        let pageCount = 0
        for await (const batch of provider.importMailbox({
          mailboxId: operation.mailboxId,
          phase: 'messages',
          ...(checkpoint.importMessagePageToken === undefined
            ? {}
            : { pageToken: checkpoint.importMessagePageToken }),
          signal: operation.controller.signal,
        })) {
          pageCount += batch.processedCount
          await this.options.store.applyImportBatch({
            mailboxId: operation.mailboxId,
            batch: batch.changes,
            ...(batch.pageComplete
              ? {
                  page: {
                    kind: 'messages' as const,
                    ...(batch.nextPageToken === undefined
                      ? {}
                      : { nextPageToken: batch.nextPageToken }),
                    processedCount: pageCount,
                    ...(batch.totalEstimate === undefined
                      ? {}
                      : { totalEstimate: batch.totalEstimate }),
                    nextState:
                      batch.nextPageToken === undefined
                        ? ('importing_drafts' as const)
                        : ('importing_messages' as const),
                  },
                }
              : {}),
            updatedAt: this.now(),
          })
          await this.publishProgress(operation)
          if (batch.pageComplete && batch.nextPageToken === undefined) importing = false
        }
      }
      state = 'importing_drafts'
    }

    if (state === 'importing_drafts') {
      let importing = true
      while (importing) {
        checkpoint = await this.requireCheckpoint(operation.mailboxId)
        let pageCount = 0
        for await (const batch of provider.importMailbox({
          mailboxId: operation.mailboxId,
          phase: 'drafts',
          ...(checkpoint.importDraftPageToken === undefined
            ? {}
            : { pageToken: checkpoint.importDraftPageToken }),
          signal: operation.controller.signal,
        })) {
          pageCount += batch.processedCount
          await this.options.store.applyImportBatch({
            mailboxId: operation.mailboxId,
            batch: batch.changes,
            ...(batch.pageComplete
              ? {
                  page: {
                    kind: 'drafts' as const,
                    ...(batch.nextPageToken === undefined
                      ? {}
                      : { nextPageToken: batch.nextPageToken }),
                    processedCount: pageCount,
                    nextState:
                      batch.nextPageToken === undefined
                        ? ('reconciling_history' as const)
                        : ('importing_drafts' as const),
                  },
                }
              : {}),
            updatedAt: this.now(),
          })
          await this.publishProgress(operation)
          if (batch.pageComplete && batch.nextPageToken === undefined) importing = false
        }
      }
    }

    checkpoint = await this.requireCheckpoint(operation.mailboxId)
    return this.reconcile(operation, provider, checkpoint)
  }

  private async reconcile(
    operation: RunningOperation,
    provider: MailProvider,
    initialCheckpoint: SyncCheckpoint,
  ): Promise<boolean> {
    let checkpoint = initialCheckpoint
    const startCursor = checkpoint.historyStartCursor ?? checkpoint.providerCursor
    if (!startCursor) {
      const current = await provider.getCurrentCursor(operation.controller.signal)
      await this.options.store.setImportStart({
        mailboxId: operation.mailboxId,
        historyStartCursor: current,
        updatedAt: this.now(),
      })
      checkpoint = await this.requireCheckpoint(operation.mailboxId)
    }
    const fixedCursor = checkpoint.historyStartCursor ?? checkpoint.providerCursor
    if (!fixedCursor) throw new Error('Sync checkpoint has no Gmail history cursor')

    try {
      while (true) {
        const result = await provider.pullChanges({
          mailboxId: operation.mailboxId,
          startCursor: fixedCursor,
          ...(checkpoint.historyPageToken === undefined
            ? {}
            : { pageToken: checkpoint.historyPageToken }),
          signal: operation.controller.signal,
        })
        if (result.nextPageToken !== undefined) {
          await this.options.store.applyHistoryPage({
            mailboxId: operation.mailboxId,
            batch: result.changes,
            nextPageToken: result.nextPageToken,
            targetCursor: result.historyId,
            updatedAt: this.now(),
          })
          checkpoint = await this.requireCheckpoint(operation.mailboxId)
          await this.publishProgress(operation)
          continue
        }
        await this.refreshFinalMetadata(operation, provider)
        await this.options.store.completeHistory({
          mailboxId: operation.mailboxId,
          batch: result.changes,
          providerCursor: result.historyId,
          completedAt: this.now(),
        })
        return true
      }
    } catch (error) {
      if (providerStatus(error) !== 404) throw error
      const current = await provider.getCurrentCursor(operation.controller.signal)
      await this.options.store.resetInitialImport({
        mailboxId: operation.mailboxId,
        updatedAt: this.now(),
      })
      await this.options.store.setImportStart({
        mailboxId: operation.mailboxId,
        historyStartCursor: current,
        updatedAt: this.now(),
      })
      return false
    }
  }

  private async refreshFinalMetadata(
    operation: RunningOperation,
    provider: MailProvider,
  ): Promise<void> {
    for await (const batch of provider.importMailbox({
      mailboxId: operation.mailboxId,
      phase: 'labels',
      signal: operation.controller.signal,
    }))
      await this.options.store.applyImportBatch({
        mailboxId: operation.mailboxId,
        batch: batch.changes,
        updatedAt: this.now(),
      })

    const generation = operation.requestId
    await this.options.store.beginDraftReconciliation({
      mailboxId: operation.mailboxId,
      generation,
    })
    let pageToken: string | undefined
    do {
      let nextPageToken: string | undefined
      for await (const batch of provider.importMailbox({
        mailboxId: operation.mailboxId,
        phase: 'drafts',
        ...(pageToken === undefined ? {} : { pageToken }),
        signal: operation.controller.signal,
      })) {
        await this.options.store.stageDraftReconciliation({
          mailboxId: operation.mailboxId,
          generation,
          drafts: batch.changes.drafts ?? [],
        })
        if (batch.pageComplete) nextPageToken = batch.nextPageToken
      }
      pageToken = nextPageToken
    } while (pageToken !== undefined)
    await this.options.store.completeDraftReconciliation({
      mailboxId: operation.mailboxId,
      generation,
      completedAt: this.now(),
    })
  }

  private async requireCheckpoint(mailboxId: MailboxId): Promise<SyncCheckpoint> {
    const checkpoint = await this.options.store.getSyncCheckpoint(mailboxId)
    if (!checkpoint) throw new Error('Mailbox has no synchronization checkpoint')
    return checkpoint
  }
}
