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

/**
 * Public MailStore facade composed from capability-aligned SQLite modules.
 * Methods are bound explicitly so the composed surface stays visible to TypeScript.
 */
class SqliteMailStoreImpl {
  private readonly committedChangeListeners = new Set<CommittedChangeListener>()

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

    const store = {
      // ConversationQueryStore — conversations + attachments + search
      listConversations: conversations.listConversations.bind(conversations),
      listLabels: conversations.listLabels.bind(conversations),
      getConversation: conversations.getConversation.bind(conversations),
      getMessageBody: conversations.getMessageBody.bind(conversations),
      getMessageBodies: conversations.getMessageBodies.bind(conversations),
      loadAiSourceSnapshot: conversations.loadAiSourceSnapshot.bind(conversations),
      getAttachmentForExport: attachments.getAttachmentForExport.bind(attachments),
      markAttachmentCached: attachments.markAttachmentCached.bind(attachments),
      listAttachmentCachePaths: attachments.listAttachmentCachePaths.bind(attachments),
      searchMail: search.searchMail.bind(search),
      backfillSearchIndex: search.backfillSearchIndex.bind(search),
      // MailboxSyncStore
      listMailboxes: mailboxes.listMailboxes.bind(mailboxes),
      getMailbox: mailboxes.getMailbox.bind(mailboxes),
      saveConnectedMailbox: mailboxes.saveConnectedMailbox.bind(mailboxes),
      removeMailbox: mailboxes.removeMailbox.bind(mailboxes),
      getEncryptedRefreshToken: mailboxes.getEncryptedRefreshToken.bind(mailboxes),
      getSyncCheckpoint: mailboxes.getSyncCheckpoint.bind(mailboxes),
      acquireSyncLease: mailboxes.acquireSyncLease.bind(mailboxes),
      renewSyncLease: mailboxes.renewSyncLease.bind(mailboxes),
      releaseSyncLease: mailboxes.releaseSyncLease.bind(mailboxes),
      setImportState: mailboxes.setImportState.bind(mailboxes),
      setSyncRetry: mailboxes.setSyncRetry.bind(mailboxes),
      setMailboxAuthRequired: mailboxes.setMailboxAuthRequired.bind(mailboxes),
      resetHistoryPagination: mailboxes.resetHistoryPagination.bind(mailboxes),
      beginFullReconciliation: mailboxes.beginFullReconciliation.bind(mailboxes),
      stageFullReconciliation: mailboxes.stageFullReconciliation.bind(mailboxes),
      completeFullReconciliation: mailboxes.completeFullReconciliation.bind(mailboxes),
      setImportStart: mailboxes.setImportStart.bind(mailboxes),
      applyImportBatch: mailboxes.applyImportBatch.bind(mailboxes),
      applyHistoryPage: mailboxes.applyHistoryPage.bind(mailboxes),
      completeHistory: mailboxes.completeHistory.bind(mailboxes),
      resetInitialImport: mailboxes.resetInitialImport.bind(mailboxes),
      runPostImportMaintenance: mailboxes.runPostImportMaintenance.bind(mailboxes),
      // AiArtifactStore
      getAiConfiguration: aiArtifacts.getAiConfiguration.bind(aiArtifacts),
      saveAiConfiguration: aiArtifacts.saveAiConfiguration.bind(aiArtifacts),
      clearAiConfiguration: aiArtifacts.clearAiConfiguration.bind(aiArtifacts),
      setAiConfigurationValidated: aiArtifacts.setAiConfigurationValidated.bind(aiArtifacts),
      findAiArtifact: aiArtifacts.findAiArtifact.bind(aiArtifacts),
      getAiArtifact: aiArtifacts.getAiArtifact.bind(aiArtifacts),
      saveAiArtifactIfCurrent: aiArtifacts.saveAiArtifactIfCurrent.bind(aiArtifacts),
      saveAiArtifact: aiArtifacts.saveAiArtifact.bind(aiArtifacts),
      acceptAiReply: aiArtifacts.acceptAiReply.bind(aiArtifacts),
      reviewAiArtifact: aiArtifacts.reviewAiArtifact.bind(aiArtifacts),
      // OutboxStore
      enqueueCommand: commands.enqueueCommand.bind(commands),
      enqueueInverseCommand: commands.enqueueInverseCommand.bind(commands),
      enqueueDraftCommand: commands.enqueueDraftCommand.bind(commands),
      claimNextCommand: commands.claimNextCommand.bind(commands),
      resolveProviderCommand: commands.resolveProviderCommand.bind(commands),
      completeCommand: commands.completeCommand.bind(commands),
      setCommandState: commands.setCommandState.bind(commands),
      cancelMailboxCommands: commands.cancelMailboxCommands.bind(commands),
      listCommandIssues: commands.listCommandIssues.bind(commands),
      // DraftStore — drafts + draft reconciliation
      saveDraft: drafts.saveDraft.bind(drafts),
      getDraft: drafts.getDraft.bind(drafts),
      listDrafts: drafts.listDrafts.bind(drafts),
      enqueueSendDraft: drafts.enqueueSendDraft.bind(drafts),
      beginDraftReconciliation:
        draftReconciliation.beginDraftReconciliation.bind(draftReconciliation),
      stageDraftReconciliation:
        draftReconciliation.stageDraftReconciliation.bind(draftReconciliation),
      completeDraftReconciliation:
        draftReconciliation.completeDraftReconciliation.bind(draftReconciliation),
    } satisfies MailStore

    Object.assign(this, store)
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

export type SqliteMailStore = SqliteMailStoreImpl & MailStore

export const SqliteMailStore: {
  new (db: SqliteDatabase, draftMergeOptions?: DraftMergeOptions): SqliteMailStore
} = SqliteMailStoreImpl as unknown as {
  new (db: SqliteDatabase, draftMergeOptions?: DraftMergeOptions): SqliteMailStore
}
