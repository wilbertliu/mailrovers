import type {
  CommandDispatcher,
  MailProviderFactory,
  MailStore,
  ProviderCommandResult,
  StoredCommand,
} from '@mailrovers/mail-application'
import { utcTimestamp, type MailboxId } from '@mailrovers/mail-domain'
import { commandCompletionFor, needsReviewTransitionFor, policyFor } from './command-policy.js'

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
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

  private async completeApplied(
    command: Pick<StoredCommand, 'id' | 'mailboxId' | 'command'>,
    result: ProviderCommandResult,
  ): Promise<void> {
    await this.options.store.completeCommand(
      commandCompletionFor({
        command: command.command,
        commandId: command.id,
        mailboxId: command.mailboxId,
        result,
        completedAt: this.now(),
      }),
    )
  }

  private async pauseForReview(command: Pick<StoredCommand, 'id' | 'mailboxId'>): Promise<void> {
    await this.options.store.setCommandState(
      needsReviewTransitionFor({
        commandId: command.id,
        mailboxId: command.mailboxId,
        updatedAt: this.now(),
      }),
    )
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
      const policy = policyFor(command.command)
      try {
        let requestMayHaveBeenSent = false
        try {
          const provider = await this.options.providers.create(command.mailboxId)
          const resolved = await this.options.store.resolveProviderCommand(command)
          if (policy.kind === 'reconcile-before-retry' && command.attemptCount > 1) {
            const reconciliation = await provider.reconcileCommand({
              ...resolved,
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
            })
            if (reconciliation.kind === 'applied') {
              await this.completeApplied(command, reconciliation.result)
              this.options.onChanged?.(command.mailboxId)
              continue
            }
            if (reconciliation.kind === 'uncertain') {
              await this.pauseForReview(command)
              this.options.onChanged?.(command.mailboxId)
              continue
            }
          }
          requestMayHaveBeenSent = true
          const result = await provider.executeCommand({
            ...resolved,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
          })
          await this.completeApplied(command, result)
        } catch (error) {
          const status = providerStatus(error)
          const code = errorCode(error)
          if (error instanceof Error && error.message === 'DRAFT_SUPERSEDED') {
            await this.options.store.setCommandState({
              id: command.id,
              mailboxId: command.mailboxId,
              state: 'cancelled',
              errorCode: 'DRAFT_SUPERSEDED',
              updatedAt: this.now(),
            })
          } else if (code === 'COMMAND_TARGET_NOT_FOUND') {
            await this.options.store.setCommandState({
              id: command.id,
              mailboxId: command.mailboxId,
              state: 'failed',
              errorCode: code,
              errorMessage: 'The command target no longer exists in this mailbox.',
              updatedAt: this.now(),
            })
          } else if (
            policy.kind === 'reconcile-before-retry' &&
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
                await this.completeApplied(command, reconciliation.result)
              else await this.pauseForReview(command)
            } catch {
              await this.pauseForReview(command)
            }
          } else if (status === 401) {
            await this.options.store.setMailboxAuthRequired({
              mailboxId: command.mailboxId,
              updatedAt: this.now(),
            })
            await this.options.store.setCommandState({
              id: command.id,
              mailboxId: command.mailboxId,
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
              mailboxId: command.mailboxId,
              state: 'failed',
              errorCode: 'PROVIDER_REJECTED_COMMAND',
              errorMessage: 'Gmail rejected this change.',
              updatedAt: this.now(),
            })
          } else {
            const delay = Math.min(2 ** Math.max(0, command.attemptCount - 1) * 5_000, 15 * 60_000)
            await this.options.store.setCommandState({
              id: command.id,
              mailboxId: command.mailboxId,
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
