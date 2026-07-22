import type {
  CommittedChangeListener,
  CommittedChangeSet,
  MailStore,
} from '@mailrovers/mail-application'
import type { DraftMergeOptions } from './draft-reconciliation.js'
import type { SqliteDatabase } from './open-database.js'
import { SqliteAiArtifacts } from './sqlite-ai-artifacts.js'
import { SqliteAttachments } from './sqlite-attachments.js'
import { SqliteCommandsOutbox } from './sqlite-commands-outbox.js'
import { SqliteConversations } from './sqlite-conversations.js'
import { SqliteDraftReconciliation } from './sqlite-draft-reconciliation-store.js'
import { SqliteDrafts } from './sqlite-drafts.js'
import { SqliteMailboxesSync } from './sqlite-mailboxes-sync.js'
import { SqliteSearch } from './sqlite-search.js'

/** Public MailStore facade; SQLite implementation details remain internal modules. */
export class SqliteMailStore implements MailStore {
  private readonly committedChangeListeners = new Set<CommittedChangeListener>()

  readonly listConversations: MailStore['listConversations']
  readonly listLabels: MailStore['listLabels']
  readonly getConversation: MailStore['getConversation']
  readonly getMessageBody: MailStore['getMessageBody']
  readonly getAttachmentForExport: MailStore['getAttachmentForExport']
  readonly markAttachmentCached: MailStore['markAttachmentCached']
  readonly listAttachmentCachePaths: MailStore['listAttachmentCachePaths']
  readonly getMessageBodies: MailStore['getMessageBodies']
  readonly loadAiSourceSnapshot: MailStore['loadAiSourceSnapshot']
  readonly searchMail: MailStore['searchMail']
  readonly backfillSearchIndex: MailStore['backfillSearchIndex']
  readonly listMailboxes: MailStore['listMailboxes']
  readonly getMailbox: MailStore['getMailbox']
  readonly saveConnectedMailbox: MailStore['saveConnectedMailbox']
  readonly removeMailbox: MailStore['removeMailbox']
  readonly getEncryptedRefreshToken: MailStore['getEncryptedRefreshToken']
  readonly getAiConfiguration: MailStore['getAiConfiguration']
  readonly saveAiConfiguration: MailStore['saveAiConfiguration']
  readonly clearAiConfiguration: MailStore['clearAiConfiguration']
  readonly setAiConfigurationValidated: MailStore['setAiConfigurationValidated']
  readonly findAiArtifact: MailStore['findAiArtifact']
  readonly getAiArtifact: MailStore['getAiArtifact']
  readonly saveAiArtifactIfCurrent: MailStore['saveAiArtifactIfCurrent']
  readonly saveAiArtifact: MailStore['saveAiArtifact']
  readonly acceptAiReply: MailStore['acceptAiReply']
  readonly reviewAiArtifact: MailStore['reviewAiArtifact']
  readonly getSyncCheckpoint: MailStore['getSyncCheckpoint']
  readonly acquireSyncLease: MailStore['acquireSyncLease']
  readonly renewSyncLease: MailStore['renewSyncLease']
  readonly releaseSyncLease: MailStore['releaseSyncLease']
  readonly enqueueCommand: MailStore['enqueueCommand']
  readonly enqueueInverseCommand: MailStore['enqueueInverseCommand']
  readonly enqueueDraftCommand: MailStore['enqueueDraftCommand']
  readonly claimNextCommand: MailStore['claimNextCommand']
  readonly resolveProviderCommand: MailStore['resolveProviderCommand']
  readonly completeCommand: MailStore['completeCommand']
  readonly setCommandState: MailStore['setCommandState']
  readonly cancelMailboxCommands: MailStore['cancelMailboxCommands']
  readonly listCommandIssues: MailStore['listCommandIssues']
  readonly saveDraft: MailStore['saveDraft']
  readonly getDraft: MailStore['getDraft']
  readonly listDrafts: MailStore['listDrafts']
  readonly enqueueSendDraft: MailStore['enqueueSendDraft']
  readonly beginDraftReconciliation: MailStore['beginDraftReconciliation']
  readonly stageDraftReconciliation: MailStore['stageDraftReconciliation']
  readonly completeDraftReconciliation: MailStore['completeDraftReconciliation']
  readonly setImportState: MailStore['setImportState']
  readonly setSyncRetry: MailStore['setSyncRetry']
  readonly setMailboxAuthRequired: MailStore['setMailboxAuthRequired']
  readonly resetHistoryPagination: MailStore['resetHistoryPagination']
  readonly beginFullReconciliation: MailStore['beginFullReconciliation']
  readonly stageFullReconciliation: MailStore['stageFullReconciliation']
  readonly completeFullReconciliation: MailStore['completeFullReconciliation']
  readonly setImportStart: MailStore['setImportStart']
  readonly applyImportBatch: MailStore['applyImportBatch']
  readonly applyHistoryPage: MailStore['applyHistoryPage']
  readonly completeHistory: MailStore['completeHistory']
  readonly resetInitialImport: MailStore['resetInitialImport']
  readonly runPostImportMaintenance: MailStore['runPostImportMaintenance']

  constructor(db: SqliteDatabase, draftMergeOptions: DraftMergeOptions = {}) {
    const conversations = new SqliteConversations(db)
    const attachments = new SqliteAttachments(db, this.publishCommitted.bind(this))
    const search = new SqliteSearch(db, this.publishCommitted.bind(this))
    const mailboxes = new SqliteMailboxesSync(
      db,
      draftMergeOptions,
      this.publishCommitted.bind(this),
    )
    const aiArtifacts = new SqliteAiArtifacts(db, this.publishCommitted.bind(this))
    const commands = new SqliteCommandsOutbox(
      db,
      draftMergeOptions,
      this.publishCommitted.bind(this),
    )
    const drafts = new SqliteDrafts(db, this.publishCommitted.bind(this))
    const draftReconciliation = new SqliteDraftReconciliation(
      db,
      draftMergeOptions,
      mailboxes.assertSyncFence.bind(mailboxes),
      this.publishCommitted.bind(this),
    )

    this.listConversations = conversations.listConversations.bind(conversations)
    this.listLabels = conversations.listLabels.bind(conversations)
    this.getConversation = conversations.getConversation.bind(conversations)
    this.getMessageBody = conversations.getMessageBody.bind(conversations)
    this.getAttachmentForExport = attachments.getAttachmentForExport.bind(attachments)
    this.markAttachmentCached = attachments.markAttachmentCached.bind(attachments)
    this.listAttachmentCachePaths = attachments.listAttachmentCachePaths.bind(attachments)
    this.getMessageBodies = conversations.getMessageBodies.bind(conversations)
    this.loadAiSourceSnapshot = conversations.loadAiSourceSnapshot.bind(conversations)
    this.searchMail = search.searchMail.bind(search)
    this.backfillSearchIndex = search.backfillSearchIndex.bind(search)
    this.listMailboxes = mailboxes.listMailboxes.bind(mailboxes)
    this.getMailbox = mailboxes.getMailbox.bind(mailboxes)
    this.saveConnectedMailbox = mailboxes.saveConnectedMailbox.bind(mailboxes)
    this.removeMailbox = mailboxes.removeMailbox.bind(mailboxes)
    this.getEncryptedRefreshToken = mailboxes.getEncryptedRefreshToken.bind(mailboxes)
    this.getAiConfiguration = aiArtifacts.getAiConfiguration.bind(aiArtifacts)
    this.saveAiConfiguration = aiArtifacts.saveAiConfiguration.bind(aiArtifacts)
    this.clearAiConfiguration = aiArtifacts.clearAiConfiguration.bind(aiArtifacts)
    this.setAiConfigurationValidated = aiArtifacts.setAiConfigurationValidated.bind(aiArtifacts)
    this.findAiArtifact = aiArtifacts.findAiArtifact.bind(aiArtifacts)
    this.getAiArtifact = aiArtifacts.getAiArtifact.bind(aiArtifacts)
    this.saveAiArtifactIfCurrent = aiArtifacts.saveAiArtifactIfCurrent.bind(aiArtifacts)
    this.saveAiArtifact = aiArtifacts.saveAiArtifact.bind(aiArtifacts)
    this.acceptAiReply = aiArtifacts.acceptAiReply.bind(aiArtifacts)
    this.reviewAiArtifact = aiArtifacts.reviewAiArtifact.bind(aiArtifacts)
    this.getSyncCheckpoint = mailboxes.getSyncCheckpoint.bind(mailboxes)
    this.acquireSyncLease = mailboxes.acquireSyncLease.bind(mailboxes)
    this.renewSyncLease = mailboxes.renewSyncLease.bind(mailboxes)
    this.releaseSyncLease = mailboxes.releaseSyncLease.bind(mailboxes)
    this.enqueueCommand = commands.enqueueCommand.bind(commands)
    this.enqueueInverseCommand = commands.enqueueInverseCommand.bind(commands)
    this.enqueueDraftCommand = commands.enqueueDraftCommand.bind(commands)
    this.claimNextCommand = commands.claimNextCommand.bind(commands)
    this.resolveProviderCommand = commands.resolveProviderCommand.bind(commands)
    this.completeCommand = commands.completeCommand.bind(commands)
    this.setCommandState = commands.setCommandState.bind(commands)
    this.cancelMailboxCommands = commands.cancelMailboxCommands.bind(commands)
    this.listCommandIssues = commands.listCommandIssues.bind(commands)
    this.saveDraft = drafts.saveDraft.bind(drafts)
    this.getDraft = drafts.getDraft.bind(drafts)
    this.listDrafts = drafts.listDrafts.bind(drafts)
    this.enqueueSendDraft = drafts.enqueueSendDraft.bind(drafts)
    this.beginDraftReconciliation =
      draftReconciliation.beginDraftReconciliation.bind(draftReconciliation)
    this.stageDraftReconciliation =
      draftReconciliation.stageDraftReconciliation.bind(draftReconciliation)
    this.completeDraftReconciliation =
      draftReconciliation.completeDraftReconciliation.bind(draftReconciliation)
    this.setImportState = mailboxes.setImportState.bind(mailboxes)
    this.setSyncRetry = mailboxes.setSyncRetry.bind(mailboxes)
    this.setMailboxAuthRequired = mailboxes.setMailboxAuthRequired.bind(mailboxes)
    this.resetHistoryPagination = mailboxes.resetHistoryPagination.bind(mailboxes)
    this.beginFullReconciliation = mailboxes.beginFullReconciliation.bind(mailboxes)
    this.stageFullReconciliation = mailboxes.stageFullReconciliation.bind(mailboxes)
    this.completeFullReconciliation = mailboxes.completeFullReconciliation.bind(mailboxes)
    this.setImportStart = mailboxes.setImportStart.bind(mailboxes)
    this.applyImportBatch = mailboxes.applyImportBatch.bind(mailboxes)
    this.applyHistoryPage = mailboxes.applyHistoryPage.bind(mailboxes)
    this.completeHistory = mailboxes.completeHistory.bind(mailboxes)
    this.resetInitialImport = mailboxes.resetInitialImport.bind(mailboxes)
    this.runPostImportMaintenance = mailboxes.runPostImportMaintenance.bind(mailboxes)
  }

  subscribeCommittedChanges(listener: CommittedChangeListener): () => void {
    this.committedChangeListeners.add(listener)
    return () => this.committedChangeListeners.delete(listener)
  }

  private publishCommitted(changes: CommittedChangeSet): void {
    for (const listener of this.committedChangeListeners)
      try {
        listener(changes)
      } catch {
        // A notification consumer cannot roll back or fail an already committed transaction.
      }
  }
}
