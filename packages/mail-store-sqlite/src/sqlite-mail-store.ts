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

/** Bind selected instance methods so they keep `this` when composed onto the facade. */
function bindMethods<T extends object, const Keys extends readonly (keyof T & string)[]>(
  source: T,
  keys: Keys,
): { [K in Keys[number]]: T[K] } {
  const bound = {} as { [K in Keys[number]]: T[K] }
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'function') {
      ;(bound as Record<string, unknown>)[key] = (value as (...args: never[]) => unknown).bind(
        source,
      )
    }
  }
  return bound
}

/**
 * Public MailStore facade composed from capability-aligned SQLite modules.
 * Interface merge supplies the MailStore method types; the constructor assigns
 * bound module methods (no per-method `.bind` wall).
 */
export interface SqliteMailStore extends MailStore {}

export class SqliteMailStore {
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

    const store: MailStore = {
      // ConversationQueryStore — conversations + attachments + search
      ...bindMethods(conversations, [
        'listConversations',
        'listLabels',
        'getConversation',
        'getMessageBody',
        'getMessageBodies',
        'loadAiSourceSnapshot',
      ] as const),
      ...bindMethods(attachments, [
        'getAttachmentForExport',
        'markAttachmentCached',
        'listAttachmentCachePaths',
      ] as const),
      ...bindMethods(search, ['searchMail', 'backfillSearchIndex'] as const),
      // MailboxSyncStore
      ...bindMethods(mailboxes, [
        'listMailboxes',
        'getMailbox',
        'saveConnectedMailbox',
        'removeMailbox',
        'getEncryptedRefreshToken',
        'getSyncCheckpoint',
        'acquireSyncLease',
        'renewSyncLease',
        'releaseSyncLease',
        'setImportState',
        'setSyncRetry',
        'setMailboxAuthRequired',
        'resetHistoryPagination',
        'beginFullReconciliation',
        'stageFullReconciliation',
        'completeFullReconciliation',
        'setImportStart',
        'applyImportBatch',
        'applyHistoryPage',
        'completeHistory',
        'resetInitialImport',
        'runPostImportMaintenance',
      ] as const),
      // AiArtifactStore
      ...bindMethods(aiArtifacts, [
        'getAiConfiguration',
        'saveAiConfiguration',
        'clearAiConfiguration',
        'setAiConfigurationValidated',
        'findAiArtifact',
        'getAiArtifact',
        'saveAiArtifactIfCurrent',
        'saveAiArtifact',
        'acceptAiReply',
        'reviewAiArtifact',
      ] as const),
      // OutboxStore
      ...bindMethods(commands, [
        'enqueueCommand',
        'enqueueInverseCommand',
        'enqueueDraftCommand',
        'claimNextCommand',
        'resolveProviderCommand',
        'completeCommand',
        'setCommandState',
        'cancelMailboxCommands',
        'listCommandIssues',
      ] as const),
      // DraftStore — drafts + draft reconciliation
      ...bindMethods(drafts, ['saveDraft', 'getDraft', 'listDrafts', 'enqueueSendDraft'] as const),
      ...bindMethods(draftReconciliation, [
        'beginDraftReconciliation',
        'stageDraftReconciliation',
        'completeDraftReconciliation',
      ] as const),
    }

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
