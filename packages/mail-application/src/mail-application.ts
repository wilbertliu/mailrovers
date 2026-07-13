import type {
  CancelOperationInput,
  CommandReceipt,
  ConnectGmailInput,
  ConnectGmailResult,
  ConversationDetail,
  ConversationPage,
  DisconnectMailboxInput,
  Draft,
  ExecuteMailCommandInput,
  GetConversationInput,
  GetDraftInput,
  GetSyncStatusInput,
  ListCommandIssuesInput,
  ListConversationsInput,
  ListDraftsInput,
  ListLabelsInput,
  ListMailboxesInput,
  LabelSummary,
  MailboxSummary,
  ResolveCommandInput,
  SaveDraftInput,
  SearchMailInput,
  SearchPage,
  SendDraftInput,
  SendDraftReceipt,
  StartSyncInput,
  SyncReceipt,
  SyncStatus,
} from '@mailrovers/mail-contracts'
import {
  commandId,
  draftId,
  mailboxId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type OperationId,
} from '@mailrovers/mail-domain'
import type { GmailConnector } from './mail-provider.js'
import type { MailStore } from './mail-store.js'
import type { CommandDispatcher, SecretSealer, SyncEngine } from './sync-engine.js'

export interface MailApplication {
  listMailboxes(input: ListMailboxesInput): Promise<MailboxSummary[]>
  connectGmail(input: ConnectGmailInput): Promise<ConnectGmailResult>
  disconnectMailbox(input: DisconnectMailboxInput): Promise<void>
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  listLabels(input: ListLabelsInput): Promise<LabelSummary[]>
  getConversation(input: GetConversationInput): Promise<ConversationDetail | undefined>
  searchMail(input: SearchMailInput): Promise<SearchPage>
  executeCommand(input: ExecuteMailCommandInput): Promise<CommandReceipt>
  listCommandIssues(input: ListCommandIssuesInput): Promise<CommandReceipt[]>
  resolveCommand(input: ResolveCommandInput): Promise<void>
  saveDraft(input: SaveDraftInput): Promise<Draft>
  getDraft(input: GetDraftInput): Promise<Draft | undefined>
  listDrafts(input: ListDraftsInput): Promise<Draft[]>
  sendDraft(input: SendDraftInput): Promise<SendDraftReceipt>
  startSync(input: StartSyncInput): Promise<SyncReceipt>
  getSyncStatus(input: GetSyncStatusInput): Promise<SyncStatus>
  cancelOperation(input: CancelOperationInput): Promise<void>
}

export type MailApplicationDependencies = {
  store: MailStore
  gmailConnector?: GmailConnector | undefined
  secretSealer?: SecretSealer | undefined
  syncEngine?: SyncEngine | undefined
  commandDispatcher?: CommandDispatcher | undefined
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
    listLabels: (request) => dependencies.store.listLabels(request.mailboxId),
    getConversation: (request) => dependencies.store.getConversation(request),
    searchMail: (request) => dependencies.store.searchMail(request),
    async executeCommand(request) {
      const receipt = await dependencies.store.enqueueCommand({
        id: commandId(request.idempotencyKey),
        mailboxId: request.mailboxId,
        idempotencyKey: request.idempotencyKey,
        command: request.command,
        createdAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return receipt
    },
    listCommandIssues: (request) => dependencies.store.listCommandIssues(request.mailboxId),
    async resolveCommand(request) {
      await dependencies.store.setCommandState({
        id: request.commandId,
        state: request.resolution === 'cancel' ? 'cancelled' : 'pending',
        updatedAt: utcTimestamp(now().toISOString()),
      })
      if (request.resolution !== 'cancel') dependencies.commandDispatcher?.wake()
    },
    async saveDraft(request) {
      const draft = await dependencies.store.saveDraft({
        request,
        id: request.draftId ?? draftId(`draft:${request.idempotencyKey}`),
        internetMessageId: `<${request.draftId ?? request.idempotencyKey}@mailrovers.local>`,
        updatedAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return draft
    },
    getDraft: (request) =>
      dependencies.store.getDraft({ mailboxId: request.mailboxId, draftId: request.draftId }),
    listDrafts: (request) => dependencies.store.listDrafts(request.mailboxId),
    async sendDraft(request) {
      const receipt = await dependencies.store.enqueueSendDraft({
        mailboxId: request.mailboxId,
        draftId: request.draftId,
        expectedVersion: request.expectedVersion,
        idempotencyKey: request.idempotencyKey,
        createdAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return { commandId: receipt.id, draftId: request.draftId, version: request.expectedVersion }
    },
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
