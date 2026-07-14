import type {
  CommandDispatcher,
  MailProviderFactory,
  MailStore,
} from '@mailrovers/mail-application'
import type { DurableCommand } from '@mailrovers/mail-contracts'
import {
  utcTimestamp,
  type DraftRevisionFingerprint,
  type MailboxId,
} from '@mailrovers/mail-domain'

function draftExpectation(command: DurableCommand): {
  expectedDraftVersion?: number | undefined
  expectedRevisionFingerprint?: DraftRevisionFingerprint | undefined
} {
  return command.kind === 'sync-draft' || command.kind === 'send-draft'
    ? {
        expectedDraftVersion: command.expectedVersion,
        expectedRevisionFingerprint: command.outboundRevisionFingerprint,
      }
    : {}
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

export class MailCommandExecutor implements CommandDispatcher {
  private running = false
  private stopped = false
  private readonly activeCommands = new Map<
    MailboxId,
    { controller: AbortController; done: Promise<void>; resolve: () => void }
  >()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    private readonly options: {
      store: MailStore
      providers: MailProviderFactory
      now?: (() => Date) | undefined
      onChanged?: ((mailboxId: MailboxId) => void) | undefined
    },
  ) {
    this.timer = setInterval(() => this.wake(), 5_000)
  }

  wake(): void {
    if (this.running || this.stopped) return
    this.running = true
    void this.drain().finally(() => {
      this.running = false
    })
  }

  async cancelMailbox(mailboxId: MailboxId): Promise<boolean> {
    const active = this.activeCommands.get(mailboxId)
    if (!active) return false
    active.controller.abort()
    await active.done
    return true
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    for (const active of this.activeCommands.values()) active.controller.abort()
    await Promise.all([...this.activeCommands.values()].map((active) => active.done))
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  private now(): ReturnType<typeof utcTimestamp> {
    return utcTimestamp((this.options.now?.() ?? new Date()).toISOString())
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const now = this.options.now?.() ?? new Date()
      const command = await this.options.store.claimNextCommand({
        now: utcTimestamp(now.toISOString()),
        leaseExpiresAt: utcTimestamp(new Date(now.getTime() + 60_000).toISOString()),
      })
      if (command === undefined) return
      const controller = new AbortController()
      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve
      })
      this.activeCommands.set(command.mailboxId, { controller, done, resolve: resolveDone })
      try {
        let requestMayHaveBeenSent = false
        try {
          const provider = await this.options.providers.create(command.mailboxId)
          const resolved = await this.options.store.resolveProviderCommand(command)
          const unsafe =
            command.command.kind === 'sync-draft' || command.command.kind === 'send-draft'
          if (unsafe && command.attemptCount > 1) {
            const reconciliation = await provider.reconcileCommand({
              ...resolved,
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
            })
            if (reconciliation.kind === 'applied') {
              await this.options.store.completeCommand({
                id: command.id,
                mailboxId: command.mailboxId,
                changes: reconciliation.result.changes,
                ...draftExpectation(command.command),
                ...(reconciliation.result.draftIdentity === undefined
                  ? {}
                  : { draftIdentity: reconciliation.result.draftIdentity }),
                ...(reconciliation.result.sentDraftId === undefined
                  ? {}
                  : { sentDraftId: reconciliation.result.sentDraftId }),
                completedAt: this.now(),
              })
              this.options.onChanged?.(command.mailboxId)
              continue
            }
            if (reconciliation.kind === 'uncertain') {
              await this.options.store.setCommandState({
                id: command.id,
                state: 'needs_review',
                errorCode: 'AMBIGUOUS_PROVIDER_RESULT',
                errorMessage: 'Gmail may have accepted this action. Review it before retrying.',
                updatedAt: this.now(),
              })
              this.options.onChanged?.(command.mailboxId)
              continue
            }
          }
          requestMayHaveBeenSent = true
          const result = await provider.executeCommand({
            ...resolved,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
          })
          await this.options.store.completeCommand({
            id: command.id,
            mailboxId: command.mailboxId,
            changes: result.changes,
            ...draftExpectation(command.command),
            ...(result.draftIdentity === undefined ? {} : { draftIdentity: result.draftIdentity }),
            ...(result.sentDraftId === undefined ? {} : { sentDraftId: result.sentDraftId }),
            completedAt: this.now(),
          })
        } catch (error) {
          const status = providerStatus(error)
          const unsafe =
            command.command.kind === 'sync-draft' || command.command.kind === 'send-draft'
          if (error instanceof Error && error.message === 'DRAFT_SUPERSEDED') {
            await this.options.store.setCommandState({
              id: command.id,
              state: 'cancelled',
              errorCode: 'DRAFT_SUPERSEDED',
              updatedAt: this.now(),
            })
          } else if (
            unsafe &&
            (requestMayHaveBeenSent || command.attemptCount > 1) &&
            (status === undefined || status >= 500 || status === 429)
          ) {
            try {
              const provider = await this.options.providers.create(command.mailboxId)
              const resolved = await this.options.store.resolveProviderCommand(command)
              const reconciliation = await provider.reconcileCommand({
                ...resolved,
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
              })
              if (reconciliation.kind === 'applied')
                await this.options.store.completeCommand({
                  id: command.id,
                  mailboxId: command.mailboxId,
                  changes: reconciliation.result.changes,
                  ...draftExpectation(command.command),
                  ...(reconciliation.result.draftIdentity === undefined
                    ? {}
                    : { draftIdentity: reconciliation.result.draftIdentity }),
                  ...(reconciliation.result.sentDraftId === undefined
                    ? {}
                    : { sentDraftId: reconciliation.result.sentDraftId }),
                  completedAt: this.now(),
                })
              else
                await this.options.store.setCommandState({
                  id: command.id,
                  state: 'needs_review',
                  errorCode: 'AMBIGUOUS_PROVIDER_RESULT',
                  errorMessage: 'Gmail may have accepted this action. Review it before retrying.',
                  updatedAt: this.now(),
                })
            } catch {
              await this.options.store.setCommandState({
                id: command.id,
                state: 'needs_review',
                errorCode: 'AMBIGUOUS_PROVIDER_RESULT',
                errorMessage: 'Gmail may have accepted this action. Review it before retrying.',
                updatedAt: this.now(),
              })
            }
          } else if (status === 401) {
            await this.options.store.setMailboxAuthRequired({
              mailboxId: command.mailboxId,
              updatedAt: this.now(),
            })
            await this.options.store.setCommandState({
              id: command.id,
              state: 'retry_wait',
              nextAttemptAt: utcTimestamp(
                new Date((this.options.now?.() ?? new Date()).getTime() + 5 * 60_000).toISOString(),
              ),
              errorCode: 'AUTHENTICATION_REQUIRED',
              errorMessage: 'Gmail needs to be connected again.',
              updatedAt: this.now(),
            })
          } else if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
            await this.options.store.setCommandState({
              id: command.id,
              state: 'failed',
              errorCode: 'PROVIDER_REJECTED_COMMAND',
              errorMessage: 'Gmail rejected this change.',
              updatedAt: this.now(),
            })
          } else {
            const delay = Math.min(2 ** Math.max(0, command.attemptCount - 1) * 5_000, 15 * 60_000)
            await this.options.store.setCommandState({
              id: command.id,
              state: 'retry_wait',
              nextAttemptAt: utcTimestamp(
                new Date((this.options.now?.() ?? new Date()).getTime() + delay).toISOString(),
              ),
              errorCode: status === 429 ? 'PROVIDER_THROTTLED' : 'COMMAND_RETRY',
              errorMessage: 'The change will retry when Gmail is available.',
              updatedAt: this.now(),
            })
          }
        }
        this.options.onChanged?.(command.mailboxId)
      } finally {
        this.activeCommands.delete(command.mailboxId)
        resolveDone()
      }
    }
  }
}
