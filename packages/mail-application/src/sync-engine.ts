import type { SyncReceipt, SyncStatus } from '@mailrovers/mail-contracts'
import type { MailboxId, OperationId } from '@mailrovers/mail-domain'

export interface SyncEngine {
  start(input: { mailboxId: MailboxId; requestId: OperationId }): Promise<SyncReceipt>
  getStatus(mailboxId: MailboxId): Promise<SyncStatus>
  cancel(operationId: OperationId): Promise<boolean>
  cancelMailbox(mailboxId: MailboxId): Promise<boolean>
  resumeInterrupted(): Promise<void>
  shutdown(): Promise<void>
}

export interface SecretSealer {
  seal(plainText: string): Promise<Uint8Array>
  unseal(cipherText: Uint8Array): Promise<string>
}
