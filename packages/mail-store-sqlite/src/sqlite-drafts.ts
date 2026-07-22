import type { CommittedChangeSet, DraftStore } from '@mailrovers/mail-application'
import type { CommandReceipt, Draft, DraftCommand } from '@mailrovers/mail-contracts'
import {
  draftId,
  draftRevisionFingerprint,
  newCommandId,
  fingerprintDraftRevision,
  normalizeDraftHtmlBody,
  type MailboxId,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'
import { mapCommand, mapDraft, optionalString, row } from './sqlite-row-helpers.js'
export class SqliteDrafts {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}
  async saveDraft(input: Parameters<DraftStore['saveDraft']>[0]): Promise<Draft> {
    const committed = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM drafts WHERE id=?').get(input.id)
      if (
        existing !== undefined &&
        String(row(existing).mailbox_id) !== String(input.request.mailboxId)
      )
        throw new Error('DRAFT_OWNERSHIP')
      const duplicate = this.db
        .prepare(`SELECT command_kind,entity_key FROM command_outbox
        WHERE mailbox_id=? AND idempotency_key=?`)
        .get(input.request.mailboxId, input.request.idempotencyKey)
      if (duplicate !== undefined) {
        const duplicateRow = row(duplicate)
        const entityKey = String(duplicateRow.entity_key)
        if (duplicateRow.command_kind !== 'sync-draft' || !entityKey.startsWith('draft:'))
          throw new Error('IDEMPOTENCY_KEY_OPERATION_MISMATCH')
        const duplicateDraft = this.db
          .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
          .get(draftId(entityKey.slice('draft:'.length)), input.request.mailboxId)
        if (duplicateDraft === undefined) throw new Error('DRAFT_REPLAY_NOT_FOUND')
        return { draft: mapDraft(duplicateDraft), changed: false }
      }
      if (existing !== undefined) {
        const existingDraft = mapDraft(existing)
        if (
          input.request.expectedVersion !== undefined &&
          existingDraft.version !== input.request.expectedVersion
        )
          throw new Error('DRAFT_VERSION_CONFLICT')
      } else if (input.request.expectedVersion !== undefined) {
        throw new Error('DRAFT_VERSION_CONFLICT')
      }
      const mailboxValue = this.db
        .prepare('SELECT workspace_id,email_address,display_name FROM mailboxes WHERE id=?')
        .get(input.request.mailboxId)
      if (mailboxValue === undefined) throw new Error('Mailbox not found')
      const mailboxRow = row(mailboxValue)
      const conversationValue =
        input.request.conversationId === undefined
          ? undefined
          : this.db
              .prepare('SELECT provider_thread_id FROM conversations WHERE id=? AND mailbox_id=?')
              .get(input.request.conversationId, input.request.mailboxId)
      const replyValue =
        input.request.replyToMessageId === undefined
          ? undefined
          : this.db
              .prepare('SELECT internet_message_id FROM messages WHERE id=? AND mailbox_id=?')
              .get(input.request.replyToMessageId, input.request.mailboxId)
      if (input.request.conversationId !== undefined && conversationValue === undefined)
        throw new Error('DRAFT_CONVERSATION_NOT_FOUND')
      if (input.request.replyToMessageId !== undefined && replyValue === undefined)
        throw new Error('DRAFT_REPLY_TO_MESSAGE_NOT_FOUND')
      const providerThreadId =
        conversationValue === undefined
          ? undefined
          : optionalString(row(conversationValue).provider_thread_id)
      const replyInternetMessageId =
        replyValue === undefined ? undefined : optionalString(row(replyValue).internet_message_id)
      const internetMessageId =
        existing === undefined ? input.internetMessageId : String(row(existing).internet_message_id)
      const htmlBody = normalizeDraftHtmlBody(input.request.htmlBody)
      const revisionFingerprint = fingerprintDraftRevision({
        internetMessageId,
        sender: {
          address: String(mailboxRow.email_address),
          ...(String(mailboxRow.display_name).length === 0
            ? {}
            : { name: String(mailboxRow.display_name) }),
        },
        to: input.request.to,
        cc: input.request.cc,
        bcc: input.request.bcc,
        subject: input.request.subject,
        textBody: input.request.textBody,
        ...(htmlBody === undefined ? {} : { htmlBody }),
        ...(providerThreadId === undefined ? {} : { providerThreadId }),
        ...(replyInternetMessageId === undefined ? {} : { inReplyTo: replyInternetMessageId }),
        references: replyInternetMessageId === undefined ? [] : [replyInternetMessageId],
      })
      const draftWrite =
        existing === undefined
          ? this.db
              .prepare(`INSERT INTO drafts
              (id,workspace_id,mailbox_id,conversation_id,reply_to_message_id,provider_draft_id,
              provider_message_id,internet_message_id,to_json,cc_json,bcc_json,subject,text_body,
              html_body,version,sync_state,revision_fingerprint,created_at,updated_at)
              VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,1,'local',?,?,?)`)
              .run(
                input.id,
                mailboxRow.workspace_id,
                input.request.mailboxId,
                input.request.conversationId ?? null,
                input.request.replyToMessageId ?? null,
                internetMessageId,
                JSON.stringify(input.request.to),
                JSON.stringify(input.request.cc),
                JSON.stringify(input.request.bcc),
                input.request.subject,
                input.request.textBody,
                htmlBody ?? null,
                revisionFingerprint,
                input.updatedAt,
                input.updatedAt,
              )
          : this.db
              .prepare(`UPDATE drafts SET conversation_id=?,reply_to_message_id=?,to_json=?,cc_json=?,
              bcc_json=?,subject=?,text_body=?,html_body=?,version=version+1,sync_state='local',
              revision_fingerprint=?,updated_at=? WHERE id=? AND mailbox_id=?`)
              .run(
                input.request.conversationId ?? null,
                input.request.replyToMessageId ?? null,
                JSON.stringify(input.request.to),
                JSON.stringify(input.request.cc),
                JSON.stringify(input.request.bcc),
                input.request.subject,
                input.request.textBody,
                htmlBody ?? null,
                revisionFingerprint,
                input.updatedAt,
                input.id,
                input.request.mailboxId,
              )
      if (draftWrite.changes !== 1) throw new Error('Failed to save draft')
      const value = this.db
        .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
        .get(input.id, input.request.mailboxId)
      if (value === undefined) throw new Error('Failed to save draft')
      const draft = mapDraft(value)
      this.db
        .prepare(`UPDATE command_outbox SET state='cancelled',updated_at=?
        WHERE mailbox_id=? AND entity_key=? AND command_kind='sync-draft' AND state='pending'`)
        .run(input.updatedAt, input.request.mailboxId, `draft:${input.id}`)
      const syncCommand: DraftCommand = {
        kind: 'sync-draft',
        draftId: input.id,
        expectedVersion: draft.version,
        outboundRevisionFingerprint: draft.revisionFingerprint,
      }
      const commandWrite = this.db
        .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          newCommandId(),
          input.request.mailboxId,
          input.request.idempotencyKey,
          syncCommand.kind,
          `draft:${input.id}`,
          JSON.stringify(syncCommand),
          input.updatedAt,
          input.updatedAt,
        )
      if (commandWrite.changes !== 1) throw new Error('Failed to persist draft command')
      return { draft, changed: true }
    })()
    if (committed.changed)
      this.publishCommitted({
        mailboxId: input.request.mailboxId,
        drafts: true,
        outbox: true,
        ...(input.request.conversationId === undefined ? {} : { conversations: true }),
      })
    return committed.draft
  }

  async getDraft(input: {
    mailboxId: MailboxId
    draftId: ReturnType<typeof draftId>
  }): Promise<Draft | undefined> {
    const value = this.db
      .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
      .get(input.draftId, input.mailboxId)
    return value === undefined ? undefined : mapDraft(value)
  }

  async listDrafts(id: MailboxId): Promise<Draft[]> {
    return this.db
      .prepare('SELECT * FROM drafts WHERE mailbox_id=? ORDER BY updated_at DESC,id DESC')
      .all(id)
      .map(mapDraft)
  }

  async enqueueSendDraft(
    input: Parameters<DraftStore['enqueueSendDraft']>[0],
  ): Promise<CommandReceipt> {
    const committed = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.mailboxId, input.idempotencyKey)
      if (existing !== undefined) return { receipt: mapCommand(existing), changed: false }
      const draftValue = this.db
        .prepare('SELECT version,revision_fingerprint FROM drafts WHERE id=? AND mailbox_id=?')
        .get(input.draftId, input.mailboxId)
      if (draftValue === undefined || Number(row(draftValue).version) !== input.expectedVersion)
        throw new Error('DRAFT_VERSION_CONFLICT')
      const command: DraftCommand = {
        kind: 'send-draft',
        draftId: input.draftId,
        expectedVersion: input.expectedVersion,
        outboundRevisionFingerprint: draftRevisionFingerprint(
          String(row(draftValue).revision_fingerprint),
        ),
      }
      const id = newCommandId()
      this.db
        .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          id,
          input.mailboxId,
          input.idempotencyKey,
          command.kind,
          `draft:${input.draftId}`,
          JSON.stringify(command),
          input.createdAt,
          input.createdAt,
        )
      const stored = this.db
        .prepare('SELECT * FROM command_outbox WHERE id=? AND mailbox_id=?')
        .get(id, input.mailboxId)
      if (stored === undefined) throw new Error('Failed to persist send command')
      return { receipt: mapCommand(stored), changed: true }
    })()
    if (committed.changed)
      this.publishCommitted({ mailboxId: input.mailboxId, drafts: true, outbox: true })
    return committed.receipt
  }
}
