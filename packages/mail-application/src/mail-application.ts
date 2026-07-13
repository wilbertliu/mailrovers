import type {
  CancelOperationInput,
  ConnectGmailInput,
  ConnectGmailResult,
  ConversationPage,
  DisconnectMailboxInput,
  GetSyncStatusInput,
  ListConversationsInput,
  ListMailboxesInput,
  MailboxSummary,
  StartSyncInput,
  SyncReceipt,
  SyncStatus,
} from '@mailrovers/mail-contracts'
import {
  mailboxId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type OperationId,
} from '@mailrovers/mail-domain'
import type { GmailConnector } from './mail-provider.js'
import type { MailStore } from './mail-store.js'
import type { SecretSealer, SyncEngine } from './sync-engine.js'

export interface MailApplication {
  listMailboxes(input: ListMailboxesInput): Promise<MailboxSummary[]>
  connectGmail(input: ConnectGmailInput): Promise<ConnectGmailResult>
  disconnectMailbox(input: DisconnectMailboxInput): Promise<void>
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  startSync(input: StartSyncInput): Promise<SyncReceipt>
  getSyncStatus(input: GetSyncStatusInput): Promise<SyncStatus>
  cancelOperation(input: CancelOperationInput): Promise<void>
}

export type MailApplicationDependencies = {
  store: MailStore
  gmailConnector?: GmailConnector | undefined
  secretSealer?: SecretSealer | undefined
  syncEngine?: SyncEngine | undefined
  now?: (() => Date) | undefined
}

function required<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`${name} is not configured`)
  return value
}

export function createMailApplication(
  input: MailStore | MailApplicationDependencies,
): MailApplication {
  const dependencies: MailApplicationDependencies = 'store' in input ? input : { store: input }
  const now = dependencies.now ?? (() => new Date())
  const connectionOperations = new Map<OperationId, AbortController>()

  return {
    listMailboxes: () => dependencies.store.listMailboxes(),
    listConversations: (request) => dependencies.store.listConversations(request),
    async connectGmail(request) {
      const connector = required(dependencies.gmailConnector, 'Gmail connector')
      const sealer = required(dependencies.secretSealer, 'Secret sealer')
      const syncEngine = required(dependencies.syncEngine, 'Sync engine')
      if (connectionOperations.has(request.requestId))
        throw new Error('An operation with this request ID already exists')
      const controller = new AbortController()
      connectionOperations.set(request.requestId, controller)
      try {
        const authorization = await connector.authorize({
          ...(request.loginHint === undefined ? {} : { loginHint: request.loginHint }),
          signal: controller.signal,
        })
        const timestamp = utcTimestamp(now().toISOString())
        const id = mailboxId(`gmail:${authorization.providerAccountId}`)
        const mailbox: Mailbox = {
          id,
          workspaceId: workspaceId('workspace-personal'),
          provider: 'gmail',
          providerAccountId: authorization.providerAccountId,
          emailAddress: authorization.emailAddress,
          displayName: authorization.displayName,
          syncState: 'importing',
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const encryptedRefreshToken = await sealer.seal(authorization.refreshToken)
        await dependencies.store.saveConnectedMailbox({
          mailbox,
          encryptedRefreshToken,
          checkpoint: {
            mailboxId: id,
            historyStartCursor: authorization.historyId,
            importState: 'pending',
            importedMessageCount: 0,
            importedDraftCount: 0,
            updatedAt: timestamp,
          },
        })
        const sync = await syncEngine.start({ mailboxId: id, requestId: request.requestId })
        return {
          mailbox: {
            id,
            provider: 'gmail',
            emailAddress: authorization.emailAddress,
            displayName: authorization.displayName,
            syncState: 'importing',
            importedMessageCount: 0,
          },
          sync,
        }
      } finally {
        connectionOperations.delete(request.requestId)
      }
    },
    async disconnectMailbox(request) {
      connectionOperations.get(request.requestId)?.abort()
      await required(dependencies.syncEngine, 'Sync engine').cancelMailbox(request.mailboxId)
      await dependencies.store.removeMailbox({
        mailboxId: request.mailboxId,
        removeLocalData: request.removeLocalData,
      })
    },
    startSync(request) {
      return required(dependencies.syncEngine, 'Sync engine').start(request)
    },
    getSyncStatus(request) {
      return required(dependencies.syncEngine, 'Sync engine').getStatus(request.mailboxId)
    },
    async cancelOperation(request) {
      const connection = connectionOperations.get(request.operationId)
      if (connection) {
        connection.abort()
        return
      }
      await required(dependencies.syncEngine, 'Sync engine').cancel(request.operationId)
    },
  }
}
