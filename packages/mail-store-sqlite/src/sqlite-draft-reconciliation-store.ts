import type { CommittedChangeSet, DraftStore, SyncLeaseFence } from '@mailrovers/mail-application'
import {
  conversationId,
  draftId,
  draftRevisionFingerprint,
  mailboxId,
  utcTimestamp,
  workspaceId,
  type MailboxId,
} from '@mailrovers/mail-domain'
import {
  mergeProviderDraft,
  mergeProviderDraftDeletion,
  type DraftMergeOptions,
} from './draft-reconciliation.js'
import type { SqliteDatabase } from './open-database.js'
import { optionalString, parseAddresses, row } from './sqlite-row-helpers.js'
export class SqliteDraftReconciliation {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly draftMergeOptions: DraftMergeOptions,
    private readonly assertSyncFence: (mailbox: MailboxId, fence: SyncLeaseFence) => void,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}
  async beginDraftReconciliation(
    input: Parameters<DraftStore['beginDraftReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      this.db
        .prepare(`INSERT INTO draft_reconciliation_runs
        (mailbox_id,generation,state,created_at) VALUES (?,?,'staging',?)`)
        .run(input.mailboxId, input.generation, input.fence.now)
    })()
  }

  async stageDraftReconciliation(
    input: Parameters<DraftStore['stageDraftReconciliation']>[0],
  ): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO draft_reconciliation
    (mailbox_id,generation,id,workspace_id,conversation_id,provider_draft_id,
    provider_message_id,internet_message_id,provider_fingerprint,to_json,cc_json,bcc_json,
    subject,text_body,html_body,updated_at)
    VALUES (@mailboxId,@generation,@id,@workspaceId,@conversationId,@providerDraftId,
    @providerMessageId,@internetMessageId,@providerFingerprint,@toJson,@ccJson,@bccJson,
    @subject,@textBody,@htmlBody,@updatedAt)
    ON CONFLICT(mailbox_id,generation,provider_draft_id) DO UPDATE SET
    id=excluded.id,workspace_id=excluded.workspace_id,conversation_id=excluded.conversation_id,
    provider_message_id=excluded.provider_message_id,
    internet_message_id=excluded.internet_message_id,
    provider_fingerprint=excluded.provider_fingerprint,to_json=excluded.to_json,
    cc_json=excluded.cc_json,bcc_json=excluded.bcc_json,subject=excluded.subject,
    text_body=excluded.text_body,html_body=excluded.html_body,updated_at=excluded.updated_at`)
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      for (const draft of input.drafts)
        insert.run({
          mailboxId: input.mailboxId,
          generation: input.generation,
          id: draft.id,
          workspaceId: draft.workspaceId,
          conversationId: draft.conversationId ?? null,
          providerDraftId: draft.providerDraftId,
          providerMessageId: draft.providerMessageId,
          internetMessageId: draft.internetMessageId,
          providerFingerprint: draft.providerFingerprint,
          toJson: JSON.stringify(draft.to),
          ccJson: JSON.stringify(draft.cc),
          bccJson: JSON.stringify(draft.bcc),
          subject: draft.subject,
          textBody: draft.textBody,
          htmlBody: draft.htmlBody ?? null,
          updatedAt: draft.updatedAt,
        })
    })()
  }

  async completeDraftReconciliation(
    input: Parameters<DraftStore['completeDraftReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.assertSyncFence(input.mailboxId, input.fence)
      const run = this.db
        .prepare(`SELECT state FROM draft_reconciliation_runs
        WHERE mailbox_id=? AND generation=?`)
        .get(input.mailboxId, input.generation)
      if (run === undefined || row(run).state !== 'staging')
        throw new Error('Draft reconciliation run is not active')
      const staged = this.db
        .prepare(`SELECT * FROM draft_reconciliation
        WHERE mailbox_id=? AND generation=? ORDER BY provider_draft_id`)
        .all(input.mailboxId, input.generation)
        .map(row)
      const providerIds = new Set(staged.map((value) => String(value.provider_draft_id)))
      const existing = this.db
        .prepare(`SELECT provider_draft_id,provider_message_id FROM drafts
        WHERE mailbox_id=? AND provider_draft_id IS NOT NULL`)
        .all(input.mailboxId)
        .map(row)
      for (const draft of existing) {
        if (providerIds.has(String(draft.provider_draft_id))) continue
        mergeProviderDraftDeletion(
          this.db,
          input.mailboxId,
          String(draft.provider_message_id),
          input.completedAt,
        )
      }
      for (const value of staged)
        mergeProviderDraft(
          this.db,
          {
            id: draftId(String(value.id)),
            workspaceId: workspaceId(String(value.workspace_id)),
            mailboxId: mailboxId(String(value.mailbox_id)),
            ...(optionalString(value.conversation_id) === undefined
              ? {}
              : { conversationId: conversationId(String(value.conversation_id)) }),
            providerDraftId: String(value.provider_draft_id),
            providerMessageId: String(value.provider_message_id),
            internetMessageId: String(value.internet_message_id),
            sender: { address: 'unknown@invalid' },
            references: [],
            providerFingerprint: draftRevisionFingerprint(String(value.provider_fingerprint)),
            to: parseAddresses(value.to_json),
            cc: parseAddresses(value.cc_json),
            bcc: parseAddresses(value.bcc_json),
            subject: String(value.subject),
            textBody: String(value.text_body),
            ...(optionalString(value.html_body) === undefined
              ? {}
              : { htmlBody: String(value.html_body) }),
            updatedAt: utcTimestamp(String(value.updated_at)),
          },
          this.draftMergeOptions,
        )
      this.db
        .prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=? AND generation=?')
        .run(input.mailboxId, input.generation)
      this.db
        .prepare(`UPDATE draft_reconciliation_runs SET state='complete'
        WHERE mailbox_id=? AND generation=?`)
        .run(input.mailboxId, input.generation)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, drafts: true, outbox: true })
  }
}
