import type { StartSyncInput, SyncReceipt, SyncStatus } from '@mailrovers/mail-contracts'
import type { MailboxId, OperationId } from '@mailrovers/mail-domain'

export interface SyncEngine {
  start(input: StartSyncInput): Promise<SyncReceipt>
  getStatus(mailboxId: MailboxId): Promise<SyncStatus>
  cancel(operationId: OperationId): Promise<boolean>
  cancelMailbox(mailboxId: MailboxId): Promise<boolean>
  resumeInterrupted(): Promise<void>
  startAll(reason: 'startup' | 'focus' | 'timer'): Promise<void>
  shutdown(): Promise<void>
}

export interface CommandDispatcher {
  wake(): void
  /** Aborts active provider work for a mailbox and waits until it is quiescent. */
  cancelMailbox(mailboxId: MailboxId): Promise<boolean>
  shutdown(): Promise<void>
}

export interface SecretSealer {
  seal(plainText: string): Promise<Uint8Array>
  unseal(cipherText: Uint8Array): Promise<string>
}
