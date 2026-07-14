import type {
  MailProvider,
  MailProviderFactory,
  MailStore,
  SyncEngine,
  SyncLease,
  SyncLeaseFence,
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
  ownerId?: string | undefined
  syncLeaseTtlMs?: number | undefined
  postImportMaintenanceDelayMs?: number | undefined
}

type RunningOperation = {
  mailboxId: MailboxId
  requestId: OperationId
  controller: AbortController
  userCancelled: boolean
  leaseLost: boolean
  lease?: SyncLease | undefined
  renewalTimer?: ReturnType<typeof setInterval> | undefined
  reconciliationCounter: number
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
    case 'full_reconciliation':
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
    ...(checkpoint.retryAt === undefined ? {} : { retryAt: checkpoint.retryAt }),
  }
}

export class MailSyncEngine implements SyncEngine {
  private readonly operations = new Map<OperationId, RunningOperation>()
  private readonly mailboxOperations = new Map<MailboxId, OperationId>()
  private readonly ownerId: string
  private readonly syncLeaseTtlMs: number
  private readonly postImportMaintenanceDelayMs: number
  private readonly maintenanceTimers = new Map<MailboxId, ReturnType<typeof setTimeout>>()

  constructor(private readonly options: MailSyncEngineOptions) {
    this.ownerId = options.ownerId ?? `sync-engine:${globalThis.crypto.randomUUID()}`
    this.syncLeaseTtlMs = options.syncLeaseTtlMs ?? 30_000
    this.postImportMaintenanceDelayMs = options.postImportMaintenanceDelayMs ?? 1_000
    if (!Number.isFinite(this.syncLeaseTtlMs) || this.syncLeaseTtlMs <= 0)
      throw new Error('Synchronization lease TTL must be positive')
    if (
      !Number.isFinite(this.postImportMaintenanceDelayMs) ||
      this.postImportMaintenanceDelayMs < 0
    )
      throw new Error('Post-import maintenance delay must not be negative')
  }

  private date(): Date {
    return this.options.now?.() ?? new Date()
  }

  private now(): ReturnType<typeof utcTimestamp> {
    return utcTimestamp(this.date().toISOString())
  }

  private async acquireLease(operation: RunningOperation): Promise<boolean> {
    const now = this.date()
    const lease = await this.options.store.acquireSyncLease({
      mailboxId: operation.mailboxId,
      ownerId: this.ownerId,
      now: utcTimestamp(now.toISOString()),
      expiresAt: utcTimestamp(new Date(now.getTime() + this.syncLeaseTtlMs).toISOString()),
    })
    if (lease === undefined) return false
    operation.lease = lease
    return true
  }

  private startLeaseHeartbeat(operation: RunningOperation): void {
    const intervalMs = Math.max(1, Math.floor(this.syncLeaseTtlMs / 3))
    operation.renewalTimer = setInterval(() => {
      void this.renewLease(operation).catch((error: unknown) => {
        this.isLeaseLoss(error, operation)
      })
    }, intervalMs)
    operation.renewalTimer.unref?.()
  }

  private async renewLease(operation: RunningOperation): Promise<SyncLeaseFence> {
    const lease = operation.lease
    if (lease === undefined || operation.leaseLost) throw new Error('SYNC_LEASE_LOST')
    const now = this.date()
    const fence: SyncLeaseFence = {
      ownerId: lease.ownerId,
      fencingToken: lease.fencingToken,
      now: utcTimestamp(now.toISOString()),
    }
    const expiresAt = utcTimestamp(new Date(now.getTime() + this.syncLeaseTtlMs).toISOString())
    const renewed = await this.options.store.renewSyncLease({
      mailboxId: operation.mailboxId,
      ...fence,
      expiresAt,
    })
    if (!renewed) {
      operation.leaseLost = true
      operation.controller.abort()
      throw new Error('SYNC_LEASE_LOST')
    }
    operation.lease = { ...lease, expiresAt }
    return fence
  }

  private isLeaseLoss(error: unknown, operation: RunningOperation): boolean {
    const lost =
      operation.leaseLost ||
      (error instanceof Error &&
        (error.message === 'SYNC_LEASE_LOST' || error.message === 'SYNC_LEASE_ACTIVE'))
    if (lost) {
      operation.leaseLost = true
      operation.controller.abort()
    }
    return lost
  }

  async start(input: Parameters<SyncEngine['start']>[0]): Promise<SyncReceipt> {
    const mailbox = await this.options.store.getMailbox(input.mailboxId)
    if (mailbox === undefined) throw new Error('Mailbox was not found')
    if (mailbox.connectionState === 'disconnected')
      throw new Error('Mailbox is disconnected and cannot contact Gmail')
    const active = this.mailboxOperations.get(input.mailboxId)
    if (active !== undefined)
      return { requestId: active, mailboxId: input.mailboxId, state: 'active' }
    const checkpoint = await this.options.store.getSyncCheckpoint(input.mailboxId)
    if (checkpoint?.retryAt !== undefined && Date.parse(checkpoint.retryAt) > this.date().getTime())
      return {
        requestId: input.requestId,
        mailboxId: input.mailboxId,
        state: 'deferred',
        retryAt: checkpoint.retryAt,
      }
    if (this.operations.has(input.requestId))
      throw new Error('An operation with this request ID already exists')
    const controller = new AbortController()
    const operation: RunningOperation = {
      mailboxId: input.mailboxId,
      requestId: input.requestId,
      controller,
      userCancelled: false,
      leaseLost: false,
      reconciliationCounter: 0,
      promise: Promise.resolve(),
    }
    this.operations.set(input.requestId, operation)
    this.mailboxOperations.set(input.mailboxId, input.requestId)
    operation.promise = this.run(operation).finally(() => {
      this.operations.delete(input.requestId)
      this.mailboxOperations.delete(input.mailboxId)
    })
    void operation.promise.catch(() => undefined)
    return { requestId: input.requestId, mailboxId: input.mailboxId, state: 'active' }
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
    await this.startAll('startup')
  }

  async startAll(reason: 'startup' | 'focus' | 'timer'): Promise<void> {
    const mailboxes = await this.options.store.listMailboxes()
    for (const mailbox of mailboxes) {
      if (
        mailbox.connectionState === 'disconnected' ||
        mailbox.syncState === 'auth_required' ||
        mailbox.syncState === 'paused'
      )
        continue
      await this.start({
        mailboxId: mailbox.id,
        requestId: operationId(`${reason}:${mailbox.id}:${Date.now()}`),
        reason: 'lifecycle',
      })
    }
  }

  async shutdown(): Promise<void> {
    for (const timer of this.maintenanceTimers.values()) clearTimeout(timer)
    this.maintenanceTimers.clear()
    const operations = [...this.operations.values()]
    for (const operation of operations) operation.controller.abort()
    await Promise.all(operations.map((operation) => operation.promise.catch(() => undefined)))
  }

  private async publishProgress(operation: RunningOperation): Promise<void> {
    const checkpoint = await this.requireCheckpoint(operation)
    if (operation.leaseLost) return
    this.options.publish({
      kind: 'sync-progress',
      requestId: operation.requestId,
      mailboxId: operation.mailboxId,
      status: statusFromCheckpoint(checkpoint),
    })
  }

  private async run(operation: RunningOperation): Promise<void> {
    try {
      if (!(await this.acquireLease(operation))) return
      this.startLeaseHeartbeat(operation)
      await this.renewLease(operation)
      const initialCheckpoint = await this.options.store.getSyncCheckpoint(operation.mailboxId)
      if (initialCheckpoint === undefined) return
      if (
        initialCheckpoint.importState === 'complete' &&
        initialCheckpoint.postImportAnalyzedAt === undefined
      )
        this.schedulePostImportMaintenance(operation.mailboxId)
      if (
        initialCheckpoint.retryAt !== undefined &&
        Date.parse(initialCheckpoint.retryAt) > (this.options.now?.() ?? new Date()).getTime()
      ) {
        this.options.publish({
          kind: 'sync-completed',
          requestId: operation.requestId,
          mailboxId: operation.mailboxId,
          status: statusFromCheckpoint(initialCheckpoint),
        })
        return
      }
      await this.renewLease(operation)
      const provider = await this.options.providers.create(operation.mailboxId)
      for (let restart = 0; restart < 3; restart += 1) {
        const completed = await this.runFromCheckpoint(operation, provider)
        if (completed) {
          const checkpoint = await this.requireCheckpoint(operation)
          if (
            checkpoint.importState === 'complete' &&
            checkpoint.postImportAnalyzedAt === undefined
          )
            this.schedulePostImportMaintenance(operation.mailboxId)
          if (!operation.leaseLost)
            this.options.publish({
              kind: 'sync-completed',
              requestId: operation.requestId,
              mailboxId: operation.mailboxId,
              status: statusFromCheckpoint(checkpoint),
            })
          return
        }
      }
      throw new Error('Gmail history expired repeatedly during initial import')
    } catch (error) {
      if (this.isLeaseLoss(error, operation)) return
      if (operation.controller.signal.aborted) {
        if (operation.userCancelled) {
          await this.options.store.setImportState({
            mailboxId: operation.mailboxId,
            state: 'paused',
            updatedAt: this.now(),
            fence: await this.renewLease(operation),
          })
          const checkpoint = await this.requireCheckpoint(operation)
          this.options.publish({
            kind: 'sync-cancelled',
            requestId: operation.requestId,
            mailboxId: operation.mailboxId,
            status: statusFromCheckpoint(checkpoint),
          })
        }
        return
      }
      const timestamp = this.now()
      const status = providerStatus(error)
      await this.renewLease(operation)
      const checkpoint = await this.options.store.getSyncCheckpoint(operation.mailboxId)
      if (status === 401) {
        await this.options.store.setMailboxAuthRequired({
          mailboxId: operation.mailboxId,
          updatedAt: timestamp,
          fence: await this.renewLease(operation),
        })
      } else if (
        checkpoint?.importState === 'complete' ||
        checkpoint?.importState === 'reconciling_history' ||
        checkpoint?.importState === 'full_reconciliation'
      ) {
        const failures = checkpoint.syncFailureCount ?? 0
        const delayMilliseconds = Math.min(30_000 * 2 ** failures, 30 * 60_000)
        await this.options.store.setSyncRetry({
          mailboxId: operation.mailboxId,
          retryAt: utcTimestamp(
            new Date(
              (this.options.now?.() ?? new Date()).getTime() + delayMilliseconds,
            ).toISOString(),
          ),
          errorCode: applicationError(error, operation.requestId).code,
          updatedAt: timestamp,
          fence: await this.renewLease(operation),
        })
      } else {
        await this.options.store.setImportState({
          mailboxId: operation.mailboxId,
          state: 'failed',
          updatedAt: timestamp,
          fence: await this.renewLease(operation),
        })
      }
      if (!operation.leaseLost)
        this.options.publish({
          kind: 'sync-failed',
          requestId: operation.requestId,
          mailboxId: operation.mailboxId,
          error: applicationError(error, operation.requestId),
        })
    } finally {
      if (operation.renewalTimer !== undefined) clearInterval(operation.renewalTimer)
      const lease = operation.lease
      if (lease !== undefined)
        await this.options.store.releaseSyncLease({
          mailboxId: operation.mailboxId,
          ownerId: lease.ownerId,
          fencingToken: lease.fencingToken,
        })
    }
  }

  private async runFromCheckpoint(
    operation: RunningOperation,
    provider: MailProvider,
  ): Promise<boolean> {
    let checkpoint = await this.requireCheckpoint(operation)
    let state: ImportState =
      checkpoint.importState === 'paused' || checkpoint.importState === 'failed'
        ? (checkpoint.resumeImportState ?? 'pending')
        : checkpoint.importState
    if (checkpoint.importState === 'paused' || checkpoint.importState === 'failed') {
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state,
        updatedAt: this.now(),
        fence: await this.renewLease(operation),
      })
      checkpoint = await this.requireCheckpoint(operation)
    }

    if (state === 'complete') return this.reconcile(operation, provider, checkpoint)
    if (state === 'full_reconciliation') return this.fullReconcile(operation, provider, checkpoint)

    if (state === 'pending' || state === 'importing_labels') {
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state: 'importing_labels',
        updatedAt: this.now(),
        fence: await this.renewLease(operation),
      })
      await this.renewLease(operation)
      for await (const batch of provider.importMailbox({
        mailboxId: operation.mailboxId,
        phase: 'labels',
        signal: operation.controller.signal,
      }))
        await this.options.store.applyImportBatch({
          mailboxId: operation.mailboxId,
          batch: batch.changes,
          updatedAt: this.now(),
          fence: await this.renewLease(operation),
        })
      await this.options.store.setImportState({
        mailboxId: operation.mailboxId,
        state: 'importing_messages',
        updatedAt: this.now(),
        fence: await this.renewLease(operation),
      })
      await this.publishProgress(operation)
      state = 'importing_messages'
    }

    if (state === 'importing_messages') {
      let importing = true
      while (importing) {
        checkpoint = await this.requireCheckpoint(operation)
        let pageCount = 0
        await this.renewLease(operation)
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
            fence: await this.renewLease(operation),
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
        checkpoint = await this.requireCheckpoint(operation)
        let pageCount = 0
        await this.renewLease(operation)
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
            fence: await this.renewLease(operation),
          })
          await this.publishProgress(operation)
          if (batch.pageComplete && batch.nextPageToken === undefined) importing = false
        }
      }
    }

    checkpoint = await this.requireCheckpoint(operation)
    return this.reconcile(operation, provider, checkpoint)
  }

  private async reconcile(
    operation: RunningOperation,
    provider: MailProvider,
    initialCheckpoint: SyncCheckpoint,
    pageTokenRestarts = 0,
  ): Promise<boolean> {
    let checkpoint = initialCheckpoint
    const startCursor = checkpoint.historyStartCursor ?? checkpoint.providerCursor
    if (!startCursor) {
      await this.renewLease(operation)
      const current = await provider.getCurrentCursor(operation.controller.signal)
      await this.options.store.setImportStart({
        mailboxId: operation.mailboxId,
        historyStartCursor: current,
        updatedAt: this.now(),
        fence: await this.renewLease(operation),
      })
      checkpoint = await this.requireCheckpoint(operation)
    }
    const fixedCursor = checkpoint.historyStartCursor ?? checkpoint.providerCursor
    if (!fixedCursor) throw new Error('Sync checkpoint has no Gmail history cursor')

    try {
      while (true) {
        await this.renewLease(operation)
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
            fence: await this.renewLease(operation),
          })
          checkpoint = await this.requireCheckpoint(operation)
          await this.publishProgress(operation)
          continue
        }
        await this.refreshFinalMetadata(operation, provider)
        await this.options.store.completeHistory({
          mailboxId: operation.mailboxId,
          batch: result.changes,
          providerCursor: result.historyId,
          completedAt: this.now(),
          fence: await this.renewLease(operation),
        })
        this.schedulePostImportMaintenance(operation.mailboxId)
        return true
      }
    } catch (error) {
      const status = providerStatus(error)
      if (status === 400 && checkpoint.historyPageToken !== undefined && pageTokenRestarts < 1) {
        await this.options.store.resetHistoryPagination({
          mailboxId: operation.mailboxId,
          updatedAt: this.now(),
          fence: await this.renewLease(operation),
        })
        return this.reconcile(
          operation,
          provider,
          await this.requireCheckpoint(operation),
          pageTokenRestarts + 1,
        )
      }
      if (status !== 404) throw error
      await this.renewLease(operation)
      const current = await provider.getCurrentCursor(operation.controller.signal)
      const generation = `reconcile:${operation.requestId}`
      await this.options.store.beginFullReconciliation({
        mailboxId: operation.mailboxId,
        generation,
        historyStartCursor: current,
        updatedAt: this.now(),
        fence: await this.renewLease(operation),
      })
      return this.fullReconcile(operation, provider, await this.requireCheckpoint(operation))
    }
  }

  private async fullReconcile(
    operation: RunningOperation,
    provider: MailProvider,
    initialCheckpoint: SyncCheckpoint,
  ): Promise<boolean> {
    const generation = initialCheckpoint.fullReconciliationGeneration
    if (generation === undefined) throw new Error('Full reconciliation has no generation')
    let pageToken = initialCheckpoint.fullReconciliationPageToken
    do {
      let nextPageToken: string | undefined
      await this.renewLease(operation)
      for await (const batch of provider.importMailbox({
        mailboxId: operation.mailboxId,
        phase: 'messages',
        ...(pageToken === undefined ? {} : { pageToken }),
        signal: operation.controller.signal,
      })) {
        await this.options.store.stageFullReconciliation({
          mailboxId: operation.mailboxId,
          generation,
          batch: batch.changes,
          pageComplete: batch.pageComplete,
          ...(batch.nextPageToken === undefined ? {} : { nextPageToken: batch.nextPageToken }),
          updatedAt: this.now(),
          fence: await this.renewLease(operation),
        })
        if (batch.pageComplete) nextPageToken = batch.nextPageToken
      }
      pageToken = nextPageToken
      await this.publishProgress(operation)
    } while (pageToken !== undefined)
    await this.refreshFinalMetadata(operation, provider)
    await this.options.store.completeFullReconciliation({
      mailboxId: operation.mailboxId,
      generation,
      updatedAt: this.now(),
      fence: await this.renewLease(operation),
    })
    return this.reconcile(operation, provider, await this.requireCheckpoint(operation))
  }

  private async refreshFinalMetadata(
    operation: RunningOperation,
    provider: MailProvider,
  ): Promise<void> {
    await this.renewLease(operation)
    for await (const batch of provider.importMailbox({
      mailboxId: operation.mailboxId,
      phase: 'labels',
      signal: operation.controller.signal,
    }))
      await this.options.store.applyImportBatch({
        mailboxId: operation.mailboxId,
        batch: batch.changes,
        updatedAt: this.now(),
        fence: await this.renewLease(operation),
      })

    operation.reconciliationCounter += 1
    const generation = `${operation.requestId}:drafts:${operation.reconciliationCounter}`
    await this.options.store.beginDraftReconciliation({
      mailboxId: operation.mailboxId,
      generation,
      fence: await this.renewLease(operation),
    })
    let pageToken: string | undefined
    do {
      let nextPageToken: string | undefined
      await this.renewLease(operation)
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
          fence: await this.renewLease(operation),
        })
        if (batch.pageComplete) nextPageToken = batch.nextPageToken
      }
      pageToken = nextPageToken
    } while (pageToken !== undefined)
    await this.options.store.completeDraftReconciliation({
      mailboxId: operation.mailboxId,
      generation,
      completedAt: this.now(),
      fence: await this.renewLease(operation),
    })
  }

  private async requireCheckpoint(operation: RunningOperation): Promise<SyncCheckpoint> {
    await this.renewLease(operation)
    const checkpoint = await this.options.store.getSyncCheckpoint(operation.mailboxId)
    if (!checkpoint) throw new Error('Mailbox has no synchronization checkpoint')
    return checkpoint
  }

  private schedulePostImportMaintenance(mailboxId: MailboxId): void {
    if (this.maintenanceTimers.has(mailboxId)) return
    const timer = setTimeout(() => {
      this.maintenanceTimers.delete(mailboxId)
      void this.options.store
        .runPostImportMaintenance({ mailboxId, analyzedAt: this.now() })
        .catch(() => undefined)
    }, this.postImportMaintenanceDelayMs)
    timer.unref?.()
    this.maintenanceTimers.set(mailboxId, timer)
  }
}
