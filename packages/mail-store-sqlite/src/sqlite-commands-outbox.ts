import type { CommittedChangeSet, MailStore } from '@mailrovers/mail-application'
import type { CommandReceipt, MailCommand } from '@mailrovers/mail-contracts'
import { type MailboxId } from '@mailrovers/mail-domain'
import type { DraftMergeOptions } from './draft-reconciliation.js'
import type { SqliteDatabase } from './open-database.js'
import { applyChanges } from './sqlite-provider-changes.js'
import {
  commandEntity,
  mapCommand,
  mapDraft,
  optionalString,
  parseMailCommand,
  row,
} from './sqlite-row-helpers.js'

const commandStateTransitionError = 'COMMAND_STATE_TRANSITION_NOT_FOUND'

function inverseCommand(command: MailCommand): MailCommand {
  switch (command.kind) {
    case 'set-thread-archived':
      return { ...command, archived: !command.archived }
    case 'set-thread-read':
      return { ...command, read: !command.read }
    case 'set-message-starred':
      return { ...command, starred: !command.starred }
    case 'set-thread-label':
      return { ...command, applied: !command.applied }
    default: {
      const exhaustive: never = command
      throw new Error(`Unsupported inverse command: ${String(exhaustive)}`)
    }
  }
}

export class SqliteCommandsOutbox {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly draftMergeOptions: DraftMergeOptions,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}
  async enqueueCommand(input: Parameters<MailStore['enqueueCommand']>[0]): Promise<CommandReceipt> {
    const committed = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.mailboxId, input.idempotencyKey)
      if (existing !== undefined) return { receipt: mapCommand(existing), changed: false }
      this.db
        .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          input.id,
          input.mailboxId,
          input.idempotencyKey,
          input.command.kind,
          commandEntity(input.command),
          JSON.stringify(input.command),
          input.createdAt,
          input.createdAt,
        )
      const stored = this.db.prepare('SELECT * FROM command_outbox WHERE id=?').get(input.id)
      if (stored === undefined) throw new Error('Failed to persist command')
      return { receipt: mapCommand(stored), changed: true }
    })()
    if (committed.changed) this.publishCommitted({ mailboxId: input.mailboxId, outbox: true })
    return committed.receipt
  }

  async enqueueDraftCommand(
    input: Parameters<MailStore['enqueueDraftCommand']>[0],
  ): Promise<CommandReceipt> {
    const committed = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.mailboxId, input.idempotencyKey)
      if (existing !== undefined) return { receipt: mapCommand(existing), changed: false }
      this.db
        .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          input.id,
          input.mailboxId,
          input.idempotencyKey,
          input.command.kind,
          commandEntity(input.command),
          JSON.stringify(input.command),
          input.createdAt,
          input.createdAt,
        )
      const stored = this.db.prepare('SELECT * FROM command_outbox WHERE id=?').get(input.id)
      if (stored === undefined) throw new Error('Failed to persist draft command')
      return { receipt: mapCommand(stored), changed: true }
    })()
    if (committed.changed) this.publishCommitted({ mailboxId: input.mailboxId, outbox: true })
    return committed.receipt
  }

  async enqueueInverseCommand(
    input: Parameters<MailStore['enqueueInverseCommand']>[0],
  ): Promise<CommandReceipt> {
    const committed = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.mailboxId, input.idempotencyKey)
      if (existing !== undefined) return { receipt: mapCommand(existing), changed: false }
      const sourceValue = this.db
        .prepare('SELECT * FROM command_outbox WHERE id=? AND mailbox_id=?')
        .get(input.sourceCommandId, input.mailboxId)
      if (sourceValue === undefined) throw new Error('Undo source command was not found')
      const source = mapCommand(sourceValue)
      if (source.command.kind === 'sync-draft' || source.command.kind === 'send-draft')
        throw new Error('Draft and send commands cannot be undone')
      const command = inverseCommand(source.command)
      const entityKey = commandEntity(command)
      const owned =
        command.kind === 'set-message-starred'
          ? this.db
              .prepare('SELECT 1 FROM messages WHERE id=? AND mailbox_id=?')
              .get(command.messageId, input.mailboxId)
          : this.db
              .prepare('SELECT 1 FROM conversations WHERE id=? AND mailbox_id=?')
              .get(command.conversationId, input.mailboxId)
      if (owned === undefined) throw new Error('Undo target does not belong to this mailbox')
      if (
        command.kind === 'set-thread-label' &&
        this.db
          .prepare('SELECT 1 FROM labels WHERE id=? AND mailbox_id=?')
          .get(command.labelId, input.mailboxId) === undefined
      )
        throw new Error('Undo label does not belong to this mailbox')
      this.db
        .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,
        inverse_of_command_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?,?)`)
        .run(
          input.id,
          input.mailboxId,
          input.idempotencyKey,
          command.kind,
          entityKey,
          JSON.stringify(command),
          input.sourceCommandId,
          input.createdAt,
          input.createdAt,
        )
      const stored = this.db.prepare('SELECT * FROM command_outbox WHERE id=?').get(input.id)
      if (stored === undefined) throw new Error('Failed to persist inverse command')
      return { receipt: mapCommand(stored), changed: true }
    })()
    if (committed.changed) this.publishCommitted({ mailboxId: input.mailboxId, outbox: true })
    return committed.receipt
  }

  async claimNextCommand(
    input: Parameters<MailStore['claimNextCommand']>[0],
  ): Promise<Awaited<ReturnType<MailStore['claimNextCommand']>>> {
    const claimed = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE command_outbox SET state='retry_wait',claimed_at=NULL,lease_expires_at=NULL,
        updated_at=? WHERE state='running' AND lease_expires_at<=?`)
        .run(input.now, input.now)
      this.db
        .prepare(`UPDATE command_outbox AS inverse SET state='cancelled',
        last_error_code='INVERSE_SOURCE_NOT_APPLIED',
        last_error_message='The original change did not complete, so its inverse was not sent.',
        updated_at=?
        WHERE inverse.state IN ('pending','retry_wait')
        AND inverse.inverse_of_command_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM command_outbox source
          WHERE source.id=inverse.inverse_of_command_id
          AND source.state IN ('failed','cancelled'))`)
        .run(input.now)
      const value = this.db
        .prepare(`SELECT * FROM command_outbox c WHERE c.state IN ('pending','retry_wait')
        AND (c.next_attempt_at IS NULL OR c.next_attempt_at<=?)
        AND (c.inverse_of_command_id IS NULL OR EXISTS (
          SELECT 1 FROM command_outbox source
          WHERE source.id=c.inverse_of_command_id AND source.mailbox_id=c.mailbox_id
          AND source.state='succeeded'
        ))
        AND NOT EXISTS (SELECT 1 FROM sync_leases sync
          WHERE sync.mailbox_id=c.mailbox_id AND sync.owner_id IS NOT NULL
          AND sync.expires_at>?)
        AND NOT EXISTS (SELECT 1 FROM command_outbox earlier
          WHERE earlier.mailbox_id=c.mailbox_id AND earlier.entity_key=c.entity_key
          AND earlier.sequence<c.sequence
          AND earlier.state IN ('pending','running','retry_wait','needs_review'))
        AND (c.command_kind<>'send-draft' OR EXISTS (
          SELECT 1 FROM command_outbox synced
          WHERE synced.mailbox_id=c.mailbox_id AND synced.entity_key=c.entity_key
          AND synced.command_kind='sync-draft' AND synced.state='succeeded'
          AND json_extract(synced.payload_json,'$.expectedVersion')=
            json_extract(c.payload_json,'$.expectedVersion')
          AND json_extract(synced.payload_json,'$.outboundRevisionFingerprint')=
            json_extract(c.payload_json,'$.outboundRevisionFingerprint')
        ))
        ORDER BY c.sequence LIMIT 1`)
        .get(input.now, input.now)
      if (value === undefined) return undefined
      const result = row(value)
      this.db
        .prepare(`UPDATE command_outbox SET state='running',attempt_count=attempt_count+1,
        claimed_at=?,lease_expires_at=?,updated_at=? WHERE id=?`)
        .run(input.now, input.leaseExpiresAt, input.now, result.id)
      const receipt = mapCommand({ ...result, state: 'running' })
      return {
        ...receipt,
        idempotencyKey: String(result.idempotency_key),
        entityKey: String(result.entity_key),
        attemptCount: Number(result.attempt_count) + 1,
      }
    })()
    if (claimed !== undefined) this.publishCommitted({ mailboxId: claimed.mailboxId, outbox: true })
    return claimed
  }

  async resolveProviderCommand(
    stored: Parameters<MailStore['resolveProviderCommand']>[0],
  ): Promise<Awaited<ReturnType<MailStore['resolveProviderCommand']>>> {
    switch (stored.command.kind) {
      case 'set-thread-archived':
      case 'set-thread-read': {
        const value = this.db
          .prepare('SELECT provider_thread_id FROM conversations WHERE id=? AND mailbox_id=?')
          .get(stored.command.conversationId, stored.mailboxId)
        if (value === undefined) throw new Error('Command conversation was not found')
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          providerThreadId: String(row(value).provider_thread_id),
        }
      }
      case 'set-thread-label': {
        const value = this.db
          .prepare(`SELECT c.provider_thread_id,l.provider_label_id FROM conversations c,labels l
          WHERE c.id=? AND c.mailbox_id=? AND l.id=? AND l.mailbox_id=c.mailbox_id`)
          .get(stored.command.conversationId, stored.mailboxId, stored.command.labelId)
        if (value === undefined) throw new Error('Command conversation or label was not found')
        const result = row(value)
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          providerThreadId: String(result.provider_thread_id),
          providerLabelId: String(result.provider_label_id),
        }
      }
      case 'set-message-starred': {
        const value = this.db
          .prepare('SELECT provider_message_id FROM messages WHERE id=? AND mailbox_id=?')
          .get(stored.command.messageId, stored.mailboxId)
        if (value === undefined) throw new Error('Command message was not found')
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          providerMessageId: String(row(value).provider_message_id),
        }
      }
      case 'sync-draft':
      case 'send-draft': {
        const value = this.db
          .prepare(`SELECT d.*,c.provider_thread_id,
          reply.internet_message_id AS reply_internet_message_id,
          mailbox.email_address AS mailbox_email_address,
          mailbox.display_name AS mailbox_display_name
          FROM drafts d
          JOIN mailboxes mailbox ON mailbox.id=d.mailbox_id
          LEFT JOIN conversations c ON c.id=d.conversation_id AND c.mailbox_id=d.mailbox_id
          LEFT JOIN messages reply ON reply.id=d.reply_to_message_id AND reply.mailbox_id=d.mailbox_id
          WHERE d.id=? AND d.mailbox_id=?`)
          .get(stored.command.draftId, stored.mailboxId)
        if (value === undefined) throw new Error('Command draft was not found')
        const result = row(value)
        if (
          Number(result.version) !== stored.command.expectedVersion ||
          String(result.revision_fingerprint) !== stored.command.outboundRevisionFingerprint
        )
          throw new Error('DRAFT_SUPERSEDED')
        const providerThreadId = optionalString(result.provider_thread_id)
        const internetMessageId = String(result.internet_message_id)
        const replyInternetMessageId = optionalString(result.reply_internet_message_id)
        const sender = {
          address: String(result.mailbox_email_address),
          name: String(result.mailbox_display_name),
        }
        const draft = mapDraft(value)
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          draft,
          sender,
          internetMessageId,
          ...(providerThreadId === undefined ? {} : { providerThreadId }),
          ...(replyInternetMessageId === undefined ? {} : { replyInternetMessageId }),
          outboundRevision: {
            internetMessageId,
            sender,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            textBody: draft.textBody,
            ...(draft.htmlBody === undefined ? {} : { htmlBody: draft.htmlBody }),
            ...(providerThreadId === undefined ? {} : { providerThreadId }),
            ...(replyInternetMessageId === undefined ? {} : { inReplyTo: replyInternetMessageId }),
            references: replyInternetMessageId === undefined ? [] : [replyInternetMessageId],
          },
        }
      }
    }
  }

  async completeCommand(input: Parameters<MailStore['completeCommand']>[0]): Promise<void> {
    this.db.transaction(() => {
      const activeSync = this.db
        .prepare(`SELECT 1 FROM sync_leases WHERE mailbox_id=? AND owner_id IS NOT NULL
        AND expires_at>?`)
        .get(input.mailboxId, input.completedAt)
      if (activeSync !== undefined) throw new Error('SYNC_LEASE_ACTIVE')
      const storedValue = this.db
        .prepare('SELECT payload_json,state FROM command_outbox WHERE id=? AND mailbox_id=?')
        .get(input.id, input.mailboxId)
      if (storedValue === undefined) throw new Error('Command was not found')
      if (row(storedValue).state !== 'running')
        throw new Error('Command completion state changed unexpectedly')

      const command = parseMailCommand(JSON.parse(String(row(storedValue).payload_json)))
      const isDraftCommand = command.kind === 'sync-draft' || command.kind === 'send-draft'
      const expectationMatches =
        !isDraftCommand ||
        (input.expectedDraftVersion === command.expectedVersion &&
          input.expectedRevisionFingerprint === command.outboundRevisionFingerprint)
      const providerFingerprintMatches =
        input.draftIdentity === undefined ||
        !isDraftCommand ||
        input.draftIdentity.providerFingerprint === command.outboundRevisionFingerprint
      let draftTransitionApplied = true
      if (input.draftIdentity !== undefined && expectationMatches && providerFingerprintMatches) {
        const result = this.db
          .prepare(`UPDATE drafts SET provider_draft_id=?,provider_message_id=?,sync_state='synced',
          provider_fingerprint=?,base_fingerprint=?,updated_at=?
          WHERE id=? AND mailbox_id=? AND version=? AND revision_fingerprint=?`)
          .run(
            input.draftIdentity.providerDraftId,
            input.draftIdentity.providerMessageId,
            input.draftIdentity.providerFingerprint,
            input.draftIdentity.providerFingerprint,
            input.completedAt,
            input.draftIdentity.draftId,
            input.mailboxId,
            input.expectedDraftVersion,
            input.expectedRevisionFingerprint,
          )
        draftTransitionApplied = result.changes === 1
      }
      if (!providerFingerprintMatches) {
        const result = this.db
          .prepare(`UPDATE command_outbox SET state='needs_review',claimed_at=NULL,
          lease_expires_at=NULL,provider_result_json='{"confirmed":true}',
          last_error_code='DRAFT_COMPLETION_STALE',
          last_error_message='A newer local draft revision was preserved.',updated_at=?
          WHERE id=? AND mailbox_id=? AND state='running'`)
          .run(input.completedAt, input.id, input.mailboxId)
        if (result.changes !== 1) throw new Error('Command completion state changed unexpectedly')
        return
      }
      if (!expectationMatches || !draftTransitionApplied) {
        applyChanges(this.db, input.mailboxId, input.changes, this.draftMergeOptions)
        const result = this.db
          .prepare(`UPDATE command_outbox SET state='needs_review',claimed_at=NULL,
          lease_expires_at=NULL,provider_result_json='{"confirmed":true}',
          last_error_code='DRAFT_COMPLETION_STALE',
          last_error_message='A newer local draft revision was preserved.',updated_at=?
          WHERE id=? AND mailbox_id=? AND state='running'`)
          .run(input.completedAt, input.id, input.mailboxId)
        if (result.changes !== 1) throw new Error('Command completion state changed unexpectedly')
        return
      }
      applyChanges(this.db, input.mailboxId, input.changes, this.draftMergeOptions)
      if (input.sentDraftId !== undefined) {
        const result = this.db
          .prepare(`DELETE FROM drafts WHERE id=? AND mailbox_id=? AND version=?
          AND revision_fingerprint=?`)
          .run(
            input.sentDraftId,
            input.mailboxId,
            input.expectedDraftVersion,
            input.expectedRevisionFingerprint,
          )
        if (result.changes !== 1) {
          const transition = this.db
            .prepare(`UPDATE command_outbox SET state='needs_review',claimed_at=NULL,
            lease_expires_at=NULL,provider_result_json='{"confirmed":true}',
            last_error_code='DRAFT_COMPLETION_STALE',
            last_error_message='A newer local draft revision was preserved.',updated_at=?
            WHERE id=? AND mailbox_id=? AND state='running'`)
            .run(input.completedAt, input.id, input.mailboxId)
          if (transition.changes !== 1)
            throw new Error('Command completion state changed unexpectedly')
          return
        }
      }
      const result = this.db
        .prepare(`UPDATE command_outbox SET state='succeeded',claimed_at=NULL,lease_expires_at=NULL,
        provider_result_json='{"confirmed":true}',last_error_code=NULL,last_error_message=NULL,
        updated_at=? WHERE id=? AND mailbox_id=? AND state='running'`)
        .run(input.completedAt, input.id, input.mailboxId)
      if (result.changes !== 1) throw new Error('Command completion state changed unexpectedly')
    })()
    this.publishCommitted({
      mailboxId: input.mailboxId,
      conversations: true,
      labels: true,
      drafts: true,
      outbox: true,
    })
  }

  async setCommandState(input: Parameters<MailStore['setCommandState']>[0]): Promise<void> {
    this.db.transaction(() => {
      if (input.allowedSourceStates?.length === 0) throw new Error(commandStateTransitionError)
      const allowedStates = input.allowedSourceStates ?? []
      const sourceStateClause =
        allowedStates.length === 0
          ? ''
          : ` AND state IN (${allowedStates.map(() => '?').join(',')})`
      const result = this.db
        .prepare(`UPDATE command_outbox SET state=?,next_attempt_at=?,last_error_code=?,
        last_error_message=?,claimed_at=NULL,lease_expires_at=NULL,updated_at=?
        WHERE id=? AND mailbox_id=?${sourceStateClause}`)
        .run(
          input.state,
          input.nextAttemptAt ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null,
          input.updatedAt,
          input.id,
          input.mailboxId,
          ...allowedStates,
        )
      if (result.changes !== 1) throw new Error(commandStateTransitionError)
    })()
    this.publishCommitted({ mailboxId: input.mailboxId, outbox: true })
  }

  async cancelMailboxCommands(
    input: Parameters<MailStore['cancelMailboxCommands']>[0],
  ): Promise<void> {
    const result = this.db.transaction(() => {
      // A running send/draft update can have reached Gmail before its abort was observed.
      // Keep that ambiguity visible rather than silently cancelling it on disconnect.
      const ambiguous = this.db
        .prepare(`UPDATE command_outbox SET state='needs_review',claimed_at=NULL,lease_expires_at=NULL,
        last_error_code='AMBIGUOUS_PROVIDER_RESULT',
        last_error_message='Gmail may have accepted this action. Review it before retrying.',updated_at=?
        WHERE mailbox_id=? AND state='running' AND command_kind IN ('sync-draft','send-draft')`)
        .run(input.updatedAt, input.mailboxId)
      const cancelled = this.db
        .prepare(`UPDATE command_outbox SET state='cancelled',claimed_at=NULL,lease_expires_at=NULL,
        last_error_code='MAILBOX_DISCONNECTED',last_error_message=NULL,updated_at=?
        WHERE mailbox_id=? AND state IN ('pending','running','retry_wait','needs_review')
          AND NOT (state='needs_review' AND command_kind IN ('sync-draft','send-draft'))`)
        .run(input.updatedAt, input.mailboxId)
      return ambiguous.changes + cancelled.changes
    })()
    if (result > 0) this.publishCommitted({ mailboxId: input.mailboxId, outbox: true })
  }

  async listCommandIssues(id: MailboxId): Promise<CommandReceipt[]> {
    return this.db
      .prepare(`SELECT * FROM command_outbox WHERE mailbox_id=?
      AND state IN ('failed','needs_review') ORDER BY updated_at DESC`)
      .all(id)
      .map(mapCommand)
  }
}
