import type { CommittedChangeSet, MailStore, SyncLeaseFence } from '@mailrovers/mail-application'
import { GMAIL_CAPABILITIES, type MailboxSummary } from '@mailrovers/mail-contracts'
import {
  mailboxId,
  utcTimestamp,
  type Mailbox,
  type MailboxId,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import type { DraftMergeOptions } from './draft-reconciliation.js'
import type { SqliteDatabase } from './open-database.js'
import { applyChanges } from './sqlite-provider-changes.js'
import {
  aiConfigurationKey,
  mapCheckpoint,
  mapMailbox,
  optionalString,
  row,
} from './sqlite-row-helpers.js'
export class SqliteMailboxesSync {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly draftMergeOptions: DraftMergeOptions,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}

  assertSyncFence(mailbox: MailboxId, fence: SyncLeaseFence): void {
    const result = this.db
      .prepare(`UPDATE sync_leases SET expires_at=expires_at
        WHERE mailbox_id=? AND owner_id=? AND fencing_token=? AND expires_at>?`)
      .run(mailbox, fence.ownerId, fence.fencingToken, fence.now)
    if (result.changes !== 1) throw new Error('SYNC_LEASE_LOST')
  }
  async listMailboxes(): Promise<MailboxSummary[]> {
    return this.db
      .prepare(`SELECT m.*,c.imported_message_count,c.import_total_estimate
      FROM mailboxes m LEFT JOIN sync_checkpoints c ON c.mailbox_id=m.id
      WHERE m.provider='gmail' ORDER BY m.created_at,m.id`)
      .all()
      .map((value): MailboxSummary => {
        const result = row(value)
        const lastSuccessfulSyncAt = optionalString(result.last_successful_sync_at)
        return {
          id: mailboxId(String(result.id)),
          provider: 'gmail',
          emailAddress: String(result.email_address),
          displayName: String(result.display_name),
          syncState: String(result.sync_state) as Mailbox['syncState'],
          connectionState:
            result.connection_state === 'disconnected' ? 'disconnected' : 'connected',
          capabilities: GMAIL_CAPABILITIES,
          importedMessageCount: Number(result.imported_message_count ?? 0),
          ...(result.import_total_estimate === null || result.import_total_estimate === undefined
            ? {}
            : { importTotalEstimate: Number(result.import_total_estimate) }),
          ...(lastSuccessfulSyncAt === undefined
            ? {}
            : { lastSuccessfulSyncAt: utcTimestamp(lastSuccessfulSyncAt) }),
        }
      })
  }

  async getMailbox(id: MailboxId): Promise<Mailbox | undefined> {
    const value = this.db.prepare('SELECT * FROM mailboxes WHERE id=?').get(id)
    return value === undefined ? undefined : mapMailbox(value)
  }

  async saveConnectedMailbox(input: {
    mailbox: Mailbox
    checkpoint: SyncCheckpoint
    encryptedRefreshToken: Uint8Array
  }): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(`INSERT OR IGNORE INTO workspaces(id,name,created_at,updated_at) VALUES (?,?,?,?)`)
        .run(
          input.mailbox.workspaceId,
          'Personal',
          input.mailbox.createdAt,
          input.mailbox.updatedAt,
        )
      this.db
        .prepare(`INSERT INTO mailboxes
        (id,workspace_id,provider,provider_account_id,email_address,display_name,sync_state,connection_state,last_successful_sync_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?, 'connected',NULL,?,?)
        ON CONFLICT(provider,provider_account_id) DO UPDATE SET
          email_address=excluded.email_address,display_name=excluded.display_name,
          sync_state='importing',connection_state='connected',updated_at=excluded.updated_at`)
        .run(
          input.mailbox.id,
          input.mailbox.workspaceId,
          input.mailbox.provider,
          input.mailbox.providerAccountId,
          input.mailbox.emailAddress,
          input.mailbox.displayName,
          input.mailbox.syncState,
          input.mailbox.createdAt,
          input.mailbox.updatedAt,
        )
      this.db
        .prepare(`INSERT INTO sync_checkpoints
        (mailbox_id,provider_cursor,history_start_cursor,history_page_token,history_target_cursor,
        import_message_page_token,import_draft_page_token,import_state,imported_message_count,
        imported_draft_count,import_total_estimate,last_reconciled_at,updated_at)
        VALUES (?,NULL,?,NULL,NULL,NULL,NULL,?,0,0,NULL,NULL,?)
        ON CONFLICT(mailbox_id) DO UPDATE SET
          history_start_cursor=COALESCE(sync_checkpoints.history_start_cursor,excluded.history_start_cursor),
          import_state=CASE WHEN sync_checkpoints.import_state='complete' THEN 'complete' ELSE 'pending' END,
          updated_at=excluded.updated_at`)
        .run(
          input.mailbox.id,
          input.checkpoint.historyStartCursor ?? null,
          input.checkpoint.importState,
          input.checkpoint.updatedAt,
        )
      this.db
        .prepare(`INSERT OR IGNORE INTO search_index_state(mailbox_id,last_message_rowid,state,updated_at)
        VALUES (?,0,'pending',?)`)
        .run(input.mailbox.id, input.mailbox.updatedAt)
      this.db
        .prepare(`INSERT INTO encrypted_secrets(mailbox_id,kind,ciphertext,created_at,updated_at)
        VALUES (?,'gmail_refresh_token',?,?,?)
        ON CONFLICT(mailbox_id,kind) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at`)
        .run(
          input.mailbox.id,
          Buffer.from(input.encryptedRefreshToken),
          input.mailbox.updatedAt,
          input.mailbox.updatedAt,
        )
    })()
    this.publishCommitted({ mailboxId: input.mailbox.id, mailboxes: true })
  }

  async removeMailbox(input: { mailboxId: MailboxId; removeLocalData: boolean }): Promise<void> {
    this.db.transaction(() => {
      if (!input.removeLocalData) {
        this.db
          .prepare(
            "DELETE FROM encrypted_secrets WHERE mailbox_id=? AND kind='gmail_refresh_token'",
          )
          .run(input.mailboxId)
        this.db
          .prepare(
            "UPDATE mailboxes SET connection_state='disconnected',sync_state='paused' WHERE id=?",
          )
          .run(input.mailboxId)
        return
      }
      this.db.prepare('DELETE FROM encrypted_secrets WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare('DELETE FROM app_settings WHERE key=?')
        .run(aiConfigurationKey(input.mailboxId))
      this.db.prepare('DELETE FROM ai_artifacts WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare(
          'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db
        .prepare(
          'DELETE FROM message_labels WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM drafts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM mail_fts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM conversations WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM labels WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM command_outbox WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare('DELETE FROM full_reconciliation_seen WHERE mailbox_id=?')
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM search_index_state WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM sync_checkpoints WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM mailboxes WHERE id=?').run(input.mailboxId)
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      mailboxes: true,
      ...(input.removeLocalData
        ? { conversations: true, labels: true, drafts: true, outbox: true }
        : {}),
    })
  }

  async getEncryptedRefreshToken(id: MailboxId): Promise<Uint8Array | undefined> {
    const value = this.db
      .prepare(
        "SELECT ciphertext FROM encrypted_secrets WHERE mailbox_id=? AND kind='gmail_refresh_token'",
      )
      .get(id)
    if (value === undefined) return undefined
    const cipher = row(value).ciphertext
    if (!(cipher instanceof Uint8Array)) throw new Error('Invalid encrypted secret')
    return new Uint8Array(cipher)
  }

  async getSyncCheckpoint(id: MailboxId): Promise<SyncCheckpoint | undefined> {
    const value = this.db.prepare('SELECT * FROM sync_checkpoints WHERE mailbox_id=?').get(id)
    return value === undefined ? undefined : mapCheckpoint(value)
  }

  async acquireSyncLease(
    input: Parameters<MailStore['acquireSyncLease']>[0],
  ): Promise<Awaited<ReturnType<MailStore['acquireSyncLease']>>> {
    return this.db.transaction(() => {
      this.db
        .prepare(`INSERT OR IGNORE INTO sync_leases
        (mailbox_id,owner_id,fencing_token,expires_at) VALUES (?,NULL,0,NULL)`)
        .run(input.mailboxId)
      const acquired = this.db
        .prepare(`UPDATE sync_leases SET owner_id=?,fencing_token=fencing_token+1,expires_at=?
        WHERE mailbox_id=? AND (owner_id IS NULL OR expires_at<=?)
        AND NOT EXISTS (SELECT 1 FROM command_outbox
          WHERE mailbox_id=? AND state='running' AND lease_expires_at>?)`)
        .run(input.ownerId, input.expiresAt, input.mailboxId, input.now, input.mailboxId, input.now)
      if (acquired.changes !== 1) return undefined
      const value = this.db
        .prepare(`SELECT fencing_token,expires_at FROM sync_leases
        WHERE mailbox_id=? AND owner_id=?`)
        .get(input.mailboxId, input.ownerId)
      if (value === undefined) throw new Error('Failed to read acquired synchronization lease')
      return {
        mailboxId: input.mailboxId,
        ownerId: input.ownerId,
        fencingToken: Number(row(value).fencing_token),
        expiresAt: utcTimestamp(String(row(value).expires_at)),
      }
    })()
  }

  async renewSyncLease(input: Parameters<MailStore['renewSyncLease']>[0]): Promise<boolean> {
    const result = this.db
      .prepare(`UPDATE sync_leases SET expires_at=? WHERE mailbox_id=? AND owner_id=?
      AND fencing_token=? AND expires_at>?`)
      .run(input.expiresAt, input.mailboxId, input.ownerId, input.fencingToken, input.now)
    return result.changes === 1
  }

  async releaseSyncLease(input: Parameters<MailStore['releaseSyncLease']>[0]): Promise<boolean> {
    const result = this.db
      .prepare(`UPDATE sync_leases SET owner_id=NULL,expires_at=NULL
      WHERE mailbox_id=? AND owner_id=? AND fencing_token=?`)
      .run(input.mailboxId, input.ownerId, input.fencingToken)
    return result.changes === 1
  }

  async setImportState(input: Parameters<MailStore['setImportState']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare(`UPDATE sync_checkpoints SET
        resume_import_state=CASE
          WHEN ? NOT IN ('paused','failed') THEN NULL
          WHEN import_state IN ('paused','failed') THEN resume_import_state
          ELSE import_state
        END,
        import_state=?,updated_at=? WHERE mailbox_id=?`)
        .run(input.state, input.state, input.updatedAt, input.mailboxId)
      const mailboxState =
        input.state === 'paused' ? 'paused' : input.state === 'failed' ? 'failed' : 'importing'
      this.db
        .prepare('UPDATE mailboxes SET sync_state=?,updated_at=? WHERE id=?')
        .run(mailboxState, input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
  }

  async setSyncRetry(input: Parameters<MailStore['setSyncRetry']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare(`UPDATE sync_checkpoints SET retry_at=?,last_error_code=?,
        sync_failure_count=CASE WHEN ? IS NULL THEN 0 ELSE sync_failure_count+1 END,
        updated_at=? WHERE mailbox_id=?`)
        .run(
          input.retryAt ?? null,
          input.errorCode ?? null,
          input.retryAt ?? null,
          input.updatedAt,
          input.mailboxId,
        )
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
  }

  async setMailboxAuthRequired(
    input: Parameters<MailStore['setMailboxAuthRequired']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      if (input.fence !== undefined) this.assertSyncFence(input.mailboxId, input.fence)
      else {
        const activeSync = this.db
          .prepare(`SELECT 1 FROM sync_leases WHERE mailbox_id=? AND owner_id IS NOT NULL
          AND expires_at>?`)
          .get(input.mailboxId, input.updatedAt)
        if (activeSync !== undefined) throw new Error('SYNC_LEASE_ACTIVE')
      }
      this.db
        .prepare(
          `UPDATE sync_checkpoints SET retry_at=NULL,last_error_code='AUTHENTICATION_REQUIRED',updated_at=? WHERE mailbox_id=?`,
        )
        .run(input.updatedAt, input.mailboxId)
      this.db
        .prepare("UPDATE mailboxes SET sync_state='auth_required',updated_at=? WHERE id=?")
        .run(input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
  }

  async resetHistoryPagination(
    input: Parameters<MailStore['resetHistoryPagination']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare(`UPDATE sync_checkpoints SET history_page_token=NULL,history_target_cursor=NULL,
        updated_at=? WHERE mailbox_id=?`)
        .run(input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
  }

  async beginFullReconciliation(
    input: Parameters<MailStore['beginFullReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare('DELETE FROM full_reconciliation_seen WHERE mailbox_id=?')
        .run(input.mailboxId)
      this.db
        .prepare(`UPDATE sync_checkpoints SET import_state='full_reconciliation',
        history_start_cursor=?,full_reconciliation_generation=?,
        full_reconciliation_page_token=NULL,updated_at=? WHERE mailbox_id=?`)
        .run(input.historyStartCursor, input.generation, input.updatedAt, input.mailboxId)
      this.db
        .prepare("UPDATE mailboxes SET sync_state='reconciling',updated_at=? WHERE id=?")
        .run(input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
  }

  async stageFullReconciliation(
    input: Parameters<MailStore['stageFullReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      applyChanges(this.db, input.mailboxId, input.batch, this.draftMergeOptions)
      const insert = this.db.prepare(`INSERT OR IGNORE INTO full_reconciliation_seen
      (mailbox_id,generation,provider_message_id) VALUES (?,?,?)`)
      for (const message of input.batch.messages ?? [])
        insert.run(input.mailboxId, input.generation, message.providerMessageId)
      if (input.pageComplete)
        this.db
          .prepare(`UPDATE sync_checkpoints SET full_reconciliation_page_token=?,updated_at=?
          WHERE mailbox_id=?`)
          .run(input.nextPageToken ?? null, input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      conversations: true,
      labels: true,
      drafts: true,
    })
  }

  async completeFullReconciliation(
    input: Parameters<MailStore['completeFullReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      const stale = this.db
        .prepare(`SELECT provider_message_id FROM messages WHERE mailbox_id=?
        AND provider_message_id NOT IN (SELECT provider_message_id FROM full_reconciliation_seen
          WHERE mailbox_id=? AND generation=?)`)
        .all(input.mailboxId, input.mailboxId, input.generation)
        .map((value) => String(row(value).provider_message_id))
      applyChanges(
        this.db,
        input.mailboxId,
        { deletedProviderMessageIds: stale },
        this.draftMergeOptions,
      )
      this.db
        .prepare('DELETE FROM full_reconciliation_seen WHERE mailbox_id=?')
        .run(input.mailboxId)
      this.db
        .prepare(`UPDATE sync_checkpoints SET import_state='reconciling_history',
        full_reconciliation_generation=NULL,full_reconciliation_page_token=NULL,updated_at=?
        WHERE mailbox_id=?`)
        .run(input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      conversations: true,
      labels: true,
      drafts: true,
    })
  }

  async setImportStart(input: Parameters<MailStore['setImportStart']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare(
          `UPDATE sync_checkpoints SET history_start_cursor=?,updated_at=? WHERE mailbox_id=?`,
        )
        .run(input.historyStartCursor, input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
  }

  async applyImportBatch(input: Parameters<MailStore['applyImportBatch']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      applyChanges(this.db, input.mailboxId, input.batch, this.draftMergeOptions)
      if (input.page?.kind === 'messages')
        this.db
          .prepare(`UPDATE sync_checkpoints SET import_message_page_token=?,
          imported_message_count=imported_message_count+?,
          import_total_estimate=COALESCE(?,import_total_estimate),
          import_state=COALESCE(?,import_state),resume_import_state=NULL,updated_at=? WHERE mailbox_id=?`)
          .run(
            input.page.nextPageToken ?? null,
            input.page.processedCount,
            input.page.totalEstimate ?? null,
            input.page.nextState ?? null,
            input.updatedAt,
            input.mailboxId,
          )
      else if (input.page?.kind === 'drafts')
        this.db
          .prepare(`UPDATE sync_checkpoints SET import_draft_page_token=?,
          imported_draft_count=imported_draft_count+?,
          import_state=COALESCE(?,import_state),resume_import_state=NULL,updated_at=? WHERE mailbox_id=?`)
          .run(
            input.page.nextPageToken ?? null,
            input.page.processedCount,
            input.page.nextState ?? null,
            input.updatedAt,
            input.mailboxId,
          )
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      mailboxes: true,
      conversations: true,
      labels: true,
      drafts: true,
    })
  }

  async applyHistoryPage(input: Parameters<MailStore['applyHistoryPage']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      applyChanges(this.db, input.mailboxId, input.batch, this.draftMergeOptions)
      this.db
        .prepare(`UPDATE sync_checkpoints SET history_page_token=?,history_target_cursor=?,
        import_state='reconciling_history',resume_import_state=NULL,updated_at=? WHERE mailbox_id=?`)
        .run(input.nextPageToken ?? null, input.targetCursor, input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      mailboxes: true,
      conversations: true,
      labels: true,
      drafts: true,
    })
  }

  async completeHistory(input: Parameters<MailStore['completeHistory']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      applyChanges(this.db, input.mailboxId, input.batch, this.draftMergeOptions)
      this.db
        .prepare(`UPDATE sync_checkpoints SET provider_cursor=?,history_start_cursor=NULL,
        history_page_token=NULL,history_target_cursor=NULL,import_state='complete',
        resume_import_state=NULL,last_reconciled_at=?,retry_at=NULL,last_error_code=NULL,
        sync_failure_count=0,updated_at=? WHERE mailbox_id=?`)
        .run(input.providerCursor, input.completedAt, input.completedAt, input.mailboxId)
      this.db
        .prepare(
          `UPDATE mailboxes SET sync_state='ready',last_successful_sync_at=?,updated_at=? WHERE id=?`,
        )
        .run(input.completedAt, input.completedAt, input.mailboxId)
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      mailboxes: true,
      conversations: true,
      labels: true,
      drafts: true,
    })
  }

  async resetInitialImport(input: Parameters<MailStore['resetInitialImport']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare(
          'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db
        .prepare(
          'DELETE FROM message_labels WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM ai_artifacts WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare("DELETE FROM drafts WHERE mailbox_id=? AND sync_state='synced'")
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM mail_fts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM conversations WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM labels WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare(
          "UPDATE search_index_state SET last_message_rowid=0,state='pending',updated_at=? WHERE mailbox_id=?",
        )
        .run(input.updatedAt, input.mailboxId)
      this.db
        .prepare(`UPDATE sync_checkpoints SET provider_cursor=NULL,history_start_cursor=NULL,
        history_page_token=NULL,history_target_cursor=NULL,import_message_page_token=NULL,
        import_draft_page_token=NULL,import_state='pending',resume_import_state=NULL,imported_message_count=0,
        imported_draft_count=0,import_total_estimate=NULL,last_reconciled_at=NULL,
        post_import_analyzed_at=NULL,updated_at=?
        WHERE mailbox_id=?`)
        .run(input.updatedAt, input.mailboxId)
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      mailboxes: true,
      conversations: true,
      labels: true,
      drafts: true,
    })
  }

  async runPostImportMaintenance(
    input: Parameters<MailStore['runPostImportMaintenance']>[0],
  ): Promise<boolean> {
    const checkpoint = await this.getSyncCheckpoint(input.mailboxId)
    if (checkpoint === undefined || checkpoint.importState !== 'complete') return false
    if (checkpoint.postImportAnalyzedAt !== undefined) return false

    // ANALYZE is intentionally outside the marker transaction: an interruption
    // before recording the timestamp only repeats a safe SQLite operation.
    this.db.exec('ANALYZE')
    const marked = this.db
      .prepare(`UPDATE sync_checkpoints SET post_import_analyzed_at=?,updated_at=?
        WHERE mailbox_id=? AND import_state='complete' AND post_import_analyzed_at IS NULL`)
      .run(input.analyzedAt, input.analyzedAt, input.mailboxId)
    if (marked.changes !== 1) return false
    this.publishCommitted({ mailboxId: input.mailboxId, mailboxes: true })
    return true
  }
}
