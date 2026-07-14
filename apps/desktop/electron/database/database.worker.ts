import type { MailStore } from '@mailrovers/mail-application'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { parentPort, workerData } from 'node:worker_threads'

if (
  !parentPort ||
  typeof workerData !== 'object' ||
  workerData === null ||
  !('dbPath' in workerData) ||
  typeof workerData.dbPath !== 'string'
)
  throw new Error('Invalid database worker startup')

const port = parentPort
const db = openDatabase(workerData.dbPath)
migrate(db)
const store = new SqliteMailStore(db)
store.subscribeCommittedChanges((changes) =>
  port.postMessage({ kind: 'committed-changes', changes }),
)

type Request = { id: number; method: keyof MailStore; input?: unknown }

async function execute(message: Request): Promise<unknown> {
  switch (message.method) {
    case 'listMailboxes':
      return store.listMailboxes()
    case 'listConversations':
      return store.listConversations(message.input as Parameters<MailStore['listConversations']>[0])
    case 'listLabels':
      return store.listLabels(message.input as Parameters<MailStore['listLabels']>[0])
    case 'getConversation':
      return store.getConversation(message.input as Parameters<MailStore['getConversation']>[0])
    case 'getMessageBody':
      return store.getMessageBody(message.input as Parameters<MailStore['getMessageBody']>[0])
    case 'getAttachmentForExport':
      return store.getAttachmentForExport(
        message.input as Parameters<MailStore['getAttachmentForExport']>[0],
      )
    case 'markAttachmentCached':
      return store.markAttachmentCached(
        message.input as Parameters<MailStore['markAttachmentCached']>[0],
      )
    case 'getMessageBodies':
      return store.getMessageBodies(message.input as Parameters<MailStore['getMessageBodies']>[0])
    case 'loadAiSourceSnapshot':
      return store.loadAiSourceSnapshot(
        message.input as Parameters<MailStore['loadAiSourceSnapshot']>[0],
      )
    case 'searchMail':
      return store.searchMail(message.input as Parameters<MailStore['searchMail']>[0])
    case 'backfillSearchIndex':
      return store.backfillSearchIndex(
        message.input as Parameters<MailStore['backfillSearchIndex']>[0],
      )
    case 'getMailbox':
      return store.getMailbox(message.input as Parameters<MailStore['getMailbox']>[0])
    case 'saveConnectedMailbox':
      return store.saveConnectedMailbox(
        message.input as Parameters<MailStore['saveConnectedMailbox']>[0],
      )
    case 'removeMailbox':
      return store.removeMailbox(message.input as Parameters<MailStore['removeMailbox']>[0])
    case 'getEncryptedRefreshToken':
      return store.getEncryptedRefreshToken(
        message.input as Parameters<MailStore['getEncryptedRefreshToken']>[0],
      )
    case 'getAiConfiguration':
      return store.getAiConfiguration(
        message.input as Parameters<MailStore['getAiConfiguration']>[0],
      )
    case 'saveAiConfiguration':
      return store.saveAiConfiguration(
        message.input as Parameters<MailStore['saveAiConfiguration']>[0],
      )
    case 'clearAiConfiguration':
      return store.clearAiConfiguration(
        message.input as Parameters<MailStore['clearAiConfiguration']>[0],
      )
    case 'setAiConfigurationValidated':
      return store.setAiConfigurationValidated(
        message.input as Parameters<MailStore['setAiConfigurationValidated']>[0],
      )
    case 'findAiArtifact':
      return store.findAiArtifact(message.input as Parameters<MailStore['findAiArtifact']>[0])
    case 'getAiArtifact':
      return store.getAiArtifact(message.input as Parameters<MailStore['getAiArtifact']>[0])
    case 'saveAiArtifactIfCurrent':
      return store.saveAiArtifactIfCurrent(
        message.input as Parameters<MailStore['saveAiArtifactIfCurrent']>[0],
      )
    case 'saveAiArtifact':
      return store.saveAiArtifact(message.input as Parameters<MailStore['saveAiArtifact']>[0])
    case 'acceptAiReply':
      return store.acceptAiReply(message.input as Parameters<MailStore['acceptAiReply']>[0])
    case 'reviewAiArtifact':
      return store.reviewAiArtifact(message.input as Parameters<MailStore['reviewAiArtifact']>[0])
    case 'getSyncCheckpoint':
      return store.getSyncCheckpoint(message.input as Parameters<MailStore['getSyncCheckpoint']>[0])
    case 'acquireSyncLease':
      return store.acquireSyncLease(message.input as Parameters<MailStore['acquireSyncLease']>[0])
    case 'renewSyncLease':
      return store.renewSyncLease(message.input as Parameters<MailStore['renewSyncLease']>[0])
    case 'releaseSyncLease':
      return store.releaseSyncLease(message.input as Parameters<MailStore['releaseSyncLease']>[0])
    case 'enqueueCommand':
      return store.enqueueCommand(message.input as Parameters<MailStore['enqueueCommand']>[0])
    case 'enqueueInverseCommand':
      return store.enqueueInverseCommand(
        message.input as Parameters<MailStore['enqueueInverseCommand']>[0],
      )
    case 'enqueueDraftCommand':
      return store.enqueueDraftCommand(
        message.input as Parameters<MailStore['enqueueDraftCommand']>[0],
      )
    case 'claimNextCommand':
      return store.claimNextCommand(message.input as Parameters<MailStore['claimNextCommand']>[0])
    case 'resolveProviderCommand':
      return store.resolveProviderCommand(
        message.input as Parameters<MailStore['resolveProviderCommand']>[0],
      )
    case 'completeCommand':
      return store.completeCommand(message.input as Parameters<MailStore['completeCommand']>[0])
    case 'setCommandState':
      return store.setCommandState(message.input as Parameters<MailStore['setCommandState']>[0])
    case 'cancelMailboxCommands':
      return store.cancelMailboxCommands(
        message.input as Parameters<MailStore['cancelMailboxCommands']>[0],
      )
    case 'listCommandIssues':
      return store.listCommandIssues(message.input as Parameters<MailStore['listCommandIssues']>[0])
    case 'saveDraft':
      return store.saveDraft(message.input as Parameters<MailStore['saveDraft']>[0])
    case 'getDraft':
      return store.getDraft(message.input as Parameters<MailStore['getDraft']>[0])
    case 'listDrafts':
      return store.listDrafts(message.input as Parameters<MailStore['listDrafts']>[0])
    case 'enqueueSendDraft':
      return store.enqueueSendDraft(message.input as Parameters<MailStore['enqueueSendDraft']>[0])
    case 'beginDraftReconciliation':
      return store.beginDraftReconciliation(
        message.input as Parameters<MailStore['beginDraftReconciliation']>[0],
      )
    case 'stageDraftReconciliation':
      return store.stageDraftReconciliation(
        message.input as Parameters<MailStore['stageDraftReconciliation']>[0],
      )
    case 'completeDraftReconciliation':
      return store.completeDraftReconciliation(
        message.input as Parameters<MailStore['completeDraftReconciliation']>[0],
      )
    case 'setImportState':
      return store.setImportState(message.input as Parameters<MailStore['setImportState']>[0])
    case 'setSyncRetry':
      return store.setSyncRetry(message.input as Parameters<MailStore['setSyncRetry']>[0])
    case 'setMailboxAuthRequired':
      return store.setMailboxAuthRequired(
        message.input as Parameters<MailStore['setMailboxAuthRequired']>[0],
      )
    case 'resetHistoryPagination':
      return store.resetHistoryPagination(
        message.input as Parameters<MailStore['resetHistoryPagination']>[0],
      )
    case 'beginFullReconciliation':
      return store.beginFullReconciliation(
        message.input as Parameters<MailStore['beginFullReconciliation']>[0],
      )
    case 'stageFullReconciliation':
      return store.stageFullReconciliation(
        message.input as Parameters<MailStore['stageFullReconciliation']>[0],
      )
    case 'completeFullReconciliation':
      return store.completeFullReconciliation(
        message.input as Parameters<MailStore['completeFullReconciliation']>[0],
      )
    case 'setImportStart':
      return store.setImportStart(message.input as Parameters<MailStore['setImportStart']>[0])
    case 'applyImportBatch':
      return store.applyImportBatch(message.input as Parameters<MailStore['applyImportBatch']>[0])
    case 'applyHistoryPage':
      return store.applyHistoryPage(message.input as Parameters<MailStore['applyHistoryPage']>[0])
    case 'completeHistory':
      return store.completeHistory(message.input as Parameters<MailStore['completeHistory']>[0])
    case 'resetInitialImport':
      return store.resetInitialImport(
        message.input as Parameters<MailStore['resetInitialImport']>[0],
      )
    case 'runPostImportMaintenance':
      return store.runPostImportMaintenance(
        message.input as Parameters<MailStore['runPostImportMaintenance']>[0],
      )
  }
}

port.postMessage({ kind: 'ready' })
port.on('message', async (message: Request) => {
  try {
    const result = await execute(message)
    port.postMessage({ kind: 'result', id: message.id, result })
  } catch (error) {
    port.postMessage({
      kind: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'Database worker failed',
    })
  }
})
port.on('close', () => db.close())
