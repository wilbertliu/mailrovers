import type { MailStore, SyncEngine } from '@mailrovers/mail-application'
import { operationId, type MailboxId } from '@mailrovers/mail-domain'

export type SyncScheduleReason = 'startup' | 'timer' | 'focus' | 'manual'

export type SyncSchedulerOptions = {
  store: Pick<MailStore, 'getMailbox' | 'getSyncCheckpoint' | 'listMailboxes'>
  syncEngine: Pick<SyncEngine, 'start'>
  now?: (() => Date) | undefined
  setTimeout?: typeof globalThis.setTimeout | undefined
  clearTimeout?: typeof globalThis.clearTimeout | undefined
  cadenceMs?: number | undefined
  focusQuietPeriodMs?: number | undefined
}

type ScheduleEntry = {
  dueAt: number
  generation: number
}

const DEFAULT_CADENCE_MS = 60_000
const DEFAULT_FOCUS_QUIET_PERIOD_MS = 5_000

export class SyncScheduler {
  private readonly entries = new Map<MailboxId, ScheduleEntry>()
  private readonly active = new Map<MailboxId, Promise<void>>()
  private readonly now: () => Date
  private readonly scheduleTimeout: typeof globalThis.setTimeout
  private readonly cancelTimeout: typeof globalThis.clearTimeout
  private readonly cadenceMs: number
  private readonly focusQuietPeriodMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly options: SyncSchedulerOptions) {
    this.now = options.now ?? (() => new Date())
    this.scheduleTimeout = options.setTimeout ?? globalThis.setTimeout
    this.cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout
    this.cadenceMs = options.cadenceMs ?? DEFAULT_CADENCE_MS
    this.focusQuietPeriodMs = options.focusQuietPeriodMs ?? DEFAULT_FOCUS_QUIET_PERIOD_MS
    if (this.cadenceMs <= 0 || this.focusQuietPeriodMs < 0)
      throw new Error('Synchronization scheduler intervals must be valid')
  }

  async start(): Promise<void> {
    const mailboxes = await this.options.store.listMailboxes()
    await Promise.all(mailboxes.map((mailbox) => this.refreshMailbox(mailbox.id, 'startup')))
  }

  async notifyMailboxChanged(mailboxId: MailboxId): Promise<void> {
    await this.refreshMailbox(mailboxId)
  }

  async trigger(mailboxId: MailboxId, reason: SyncScheduleReason = 'manual'): Promise<void> {
    if (this.disposed) return
    const entry = this.entries.get(mailboxId)
    if (entry === undefined) {
      await this.refreshMailbox(mailboxId, reason)
      return
    }
    entry.dueAt = await this.dueAt(mailboxId, this.now().getTime())
    entry.generation += 1
    this.reschedule()
    if (reason === 'manual') await this.run(mailboxId, reason)
  }

  focus(): void {
    if (this.disposed) return
    const dueAt = this.now().getTime() + this.focusQuietPeriodMs
    for (const entry of this.entries.values()) {
      entry.dueAt = Math.min(entry.dueAt, dueAt)
      entry.generation += 1
    }
    this.reschedule()
  }

  remove(mailboxId: MailboxId): void {
    this.entries.delete(mailboxId)
    this.reschedule()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) this.cancelTimeout(this.timer)
    this.timer = undefined
    this.entries.clear()
  }

  private async refreshMailbox(
    mailboxId: MailboxId,
    immediateReason?: SyncScheduleReason,
  ): Promise<void> {
    const mailbox = await this.options.store.getMailbox(mailboxId)
    if (
      mailbox === undefined ||
      mailbox.connectionState === 'disconnected' ||
      mailbox.syncState === 'auth_required' ||
      mailbox.syncState === 'paused'
    ) {
      this.remove(mailboxId)
      return
    }
    const now = this.now().getTime()
    const dueAt = await this.dueAt(mailboxId, now)
    const existing = this.entries.get(mailboxId)
    this.entries.set(mailboxId, { dueAt, generation: (existing?.generation ?? 0) + 1 })
    this.reschedule()
    if (immediateReason !== undefined) await this.run(mailboxId, immediateReason)
  }

  private async dueAt(mailboxId: MailboxId, earliest: number): Promise<number> {
    // SyncEngine remains the final authority for backoff. Mirroring the durable
    // checkpoint here avoids waking the process only to be immediately deferred.
    const checkpoint = await this.options.store.getSyncCheckpoint(mailboxId)
    const retryAt = checkpoint?.retryAt === undefined ? undefined : Date.parse(checkpoint.retryAt)
    return retryAt !== undefined && Number.isFinite(retryAt)
      ? Math.max(earliest, retryAt)
      : earliest
  }

  private reschedule(): void {
    if (this.timer !== undefined) this.cancelTimeout(this.timer)
    this.timer = undefined
    if (this.disposed || this.entries.size === 0) return
    let next = Number.POSITIVE_INFINITY
    for (const entry of this.entries.values()) next = Math.min(next, entry.dueAt)
    const delay = Math.max(0, next - this.now().getTime())
    this.timer = this.scheduleTimeout(() => {
      this.timer = undefined
      void this.wake()
    }, delay)
    this.timer.unref?.()
  }

  private async wake(): Promise<void> {
    if (this.disposed) return
    const now = this.now().getTime()
    const due = [...this.entries].filter(([, entry]) => entry.dueAt <= now)
    await Promise.all(due.map(([mailboxId]) => this.run(mailboxId, 'timer')))
    this.reschedule()
  }

  private async run(mailboxId: MailboxId, reason: SyncScheduleReason): Promise<void> {
    if (this.disposed) return
    const existing = this.active.get(mailboxId)
    if (existing !== undefined) return existing
    const work = (async () => {
      const now = this.now().getTime()
      const checkpoint = await this.options.store.getSyncCheckpoint(mailboxId)
      const retryAt = checkpoint?.retryAt === undefined ? undefined : Date.parse(checkpoint.retryAt)
      if (retryAt !== undefined && Number.isFinite(retryAt) && retryAt > now) {
        const entry = this.entries.get(mailboxId)
        if (entry !== undefined) entry.dueAt = retryAt
        return
      }
      await this.options.syncEngine.start({
        mailboxId,
        requestId: operationId(`scheduler:${reason}:${mailboxId}:${now}`),
        reason: reason === 'manual' ? 'manual' : 'lifecycle',
      })
      const entry = this.entries.get(mailboxId)
      if (entry !== undefined) entry.dueAt = this.now().getTime() + this.cadenceMs
    })()
    this.active.set(mailboxId, work)
    try {
      await work
    } finally {
      this.active.delete(mailboxId)
      this.reschedule()
    }
  }
}
