import type { CommittedChangeSet, MailStore } from '@mailrovers/mail-application'
import type { AiArtifact, Draft, DraftCommand } from '@mailrovers/mail-contracts'
import {
  fingerprintDraftRevision,
  newCommandId,
  normalizeDraftHtmlBody,
  utcTimestamp,
  type MailboxId,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'
import { aiConfigurationKey, mapAiArtifact, mapDraft, row } from './sqlite-row-helpers.js'
export class SqliteAiArtifacts {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}
  async getAiConfiguration(
    id: MailboxId,
  ): Promise<Awaited<ReturnType<MailStore['getAiConfiguration']>>> {
    const setting = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key=?')
      .get(aiConfigurationKey(id))
    if (setting === undefined) return undefined
    const parsed: unknown = JSON.parse(String(row(setting).value_json))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('baseUrl' in parsed) ||
      typeof parsed.baseUrl !== 'string' ||
      !('model' in parsed) ||
      typeof parsed.model !== 'string'
    )
      throw new Error('Invalid stored AI configuration')
    const secret = this.db
      .prepare("SELECT ciphertext FROM encrypted_secrets WHERE mailbox_id=? AND kind='ai_api_key'")
      .get(id)
    const cipher = secret === undefined ? undefined : row(secret).ciphertext
    if (cipher !== undefined && !(cipher instanceof Uint8Array))
      throw new Error('Invalid encrypted AI key')
    const lastValidatedAt =
      'lastValidatedAt' in parsed && typeof parsed.lastValidatedAt === 'string'
        ? utcTimestamp(parsed.lastValidatedAt)
        : undefined
    return {
      mailboxId: id,
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      ...(cipher === undefined ? {} : { encryptedApiKey: new Uint8Array(cipher) }),
      ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
    }
  }

  async saveAiConfiguration(input: Parameters<MailStore['saveAiConfiguration']>[0]): Promise<void> {
    this.db.transaction(() => {
      const mailboxExists = this.db
        .prepare('SELECT 1 FROM mailboxes WHERE id=?')
        .get(input.mailboxId)
      if (mailboxExists === undefined) throw new Error('Mailbox not found')
      this.db
        .prepare(`INSERT INTO app_settings(key,value_json,updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
        .run(
          aiConfigurationKey(input.mailboxId),
          JSON.stringify({ baseUrl: input.baseUrl, model: input.model }),
          input.updatedAt,
        )
      if (input.encryptedApiKey !== undefined)
        this.db
          .prepare(`INSERT INTO encrypted_secrets(mailbox_id,kind,ciphertext,created_at,updated_at)
          VALUES (?,'ai_api_key',?,?,?) ON CONFLICT(mailbox_id,kind) DO UPDATE SET
          ciphertext=excluded.ciphertext,updated_at=excluded.updated_at`)
          .run(
            input.mailboxId,
            Buffer.from(input.encryptedApiKey),
            input.updatedAt,
            input.updatedAt,
          )
    })()
  }

  async clearAiConfiguration(input: { mailboxId: MailboxId }): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM app_settings WHERE key=?')
        .run(aiConfigurationKey(input.mailboxId))
      this.db
        .prepare("DELETE FROM encrypted_secrets WHERE mailbox_id=? AND kind='ai_api_key'")
        .run(input.mailboxId)
    })()
  }

  async setAiConfigurationValidated(
    input: Parameters<MailStore['setAiConfigurationValidated']>[0],
  ): Promise<void> {
    const result = this.db
      .prepare(`UPDATE app_settings SET
      value_json=json_set(value_json,'$.lastValidatedAt',?),updated_at=? WHERE key=?`)
      .run(input.validatedAt, input.validatedAt, aiConfigurationKey(input.mailboxId))
    if (result.changes !== 1) throw new Error('AI configuration not found')
  }

  async findAiArtifact(
    input: Parameters<MailStore['findAiArtifact']>[0],
  ): Promise<AiArtifact | undefined> {
    const value = this.db
      .prepare(`SELECT * FROM ai_artifacts WHERE mailbox_id=? AND conversation_id=?
      AND artifact_type=? AND source_version=? AND model=? AND policy_version=?
      ORDER BY created_at DESC,id DESC LIMIT 1`)
      .get(
        input.mailboxId,
        input.conversationId,
        input.artifactType,
        input.sourceVersion,
        input.model,
        input.policyVersion,
      )
    return value === undefined ? undefined : mapAiArtifact(value)
  }

  async getAiArtifact(
    input: Parameters<MailStore['getAiArtifact']>[0],
  ): Promise<AiArtifact | undefined> {
    const value = this.db
      .prepare('SELECT * FROM ai_artifacts WHERE id=? AND mailbox_id=?')
      .get(input.artifactId, input.mailboxId)
    return value === undefined ? undefined : mapAiArtifact(value)
  }

  async saveAiArtifact(artifact: AiArtifact): Promise<void> {
    const mailboxValue = this.db
      .prepare('SELECT workspace_id FROM mailboxes WHERE id=?')
      .get(artifact.mailboxId)
    if (mailboxValue === undefined) throw new Error('Mailbox not found')
    this.db
      .prepare(`INSERT INTO ai_artifacts
      (id,workspace_id,mailbox_id,conversation_id,artifact_type,source_version,model,
      policy_version,content,draft_id,draft_version,recipient_fingerprint,accepted_at,
      rejected_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        artifact.id,
        row(mailboxValue).workspace_id,
        artifact.mailboxId,
        artifact.conversationId,
        artifact.artifactType,
        artifact.sourceVersion,
        artifact.model,
        artifact.policyVersion,
        artifact.content,
        artifact.draftId ?? null,
        artifact.draftVersion ?? null,
        artifact.recipientFingerprint ?? null,
        artifact.acceptedAt ?? null,
        artifact.rejectedAt ?? null,
        artifact.createdAt,
      )
  }

  async saveAiArtifactIfCurrent(artifact: AiArtifact): Promise<boolean> {
    return this.db.transaction(() => {
      const conversation = this.db
        .prepare('SELECT version FROM conversations WHERE id=? AND mailbox_id=?')
        .get(artifact.conversationId, artifact.mailboxId)
      if (
        conversation === undefined ||
        Number(row(conversation).version) !== artifact.sourceVersion
      )
        return false
      this.saveAiArtifactSync(artifact)
      return true
    })()
  }

  async acceptAiReply(
    input: Parameters<MailStore['acceptAiReply']>[0],
  ): Promise<Draft | undefined> {
    const accepted = this.db.transaction(() => {
      const duplicate = this.db
        .prepare('SELECT 1 FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.mailboxId, input.idempotencyKey)
      const artifactValue = this.db
        .prepare('SELECT * FROM ai_artifacts WHERE id=? AND mailbox_id=?')
        .get(input.artifactId, input.mailboxId)
      if (artifactValue === undefined) return undefined
      const artifact = mapAiArtifact(artifactValue)
      if (!artifact.draftId || artifact.artifactType !== 'reply_draft') return undefined
      if (duplicate !== undefined) {
        const acceptedDraft = this.db
          .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
          .get(artifact.draftId, input.mailboxId)
        return acceptedDraft === undefined ? undefined : mapDraft(acceptedDraft)
      }
      if (artifact.draftVersion !== input.expectedDraftVersion) return undefined
      const conversation = this.db
        .prepare('SELECT version,provider_thread_id FROM conversations WHERE id=? AND mailbox_id=?')
        .get(artifact.conversationId, input.mailboxId)
      if (
        conversation === undefined ||
        Number(row(conversation).version) !== artifact.sourceVersion
      )
        return undefined
      const draftValue = this.db
        .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
        .get(artifact.draftId, input.mailboxId)
      if (draftValue === undefined) return undefined
      const draft = mapDraft(draftValue)
      if (
        draft.version !== input.expectedDraftVersion ||
        draft.conversationId !== artifact.conversationId ||
        recipientFingerprint(draft) !== artifact.recipientFingerprint
      )
        return undefined
      const mailbox = this.db
        .prepare('SELECT email_address,display_name FROM mailboxes WHERE id=?')
        .get(input.mailboxId)
      if (mailbox === undefined) return undefined
      const reply = draft.replyToMessageId
        ? this.db
            .prepare('SELECT internet_message_id FROM messages WHERE id=? AND mailbox_id=?')
            .get(draft.replyToMessageId, input.mailboxId)
        : undefined
      const replyInternetMessageId =
        reply === undefined || row(reply).internet_message_id === null
          ? undefined
          : String(row(reply).internet_message_id)
      const mailboxRow = row(mailbox)
      const revisionFingerprint = fingerprintDraftRevision({
        internetMessageId: String(row(draftValue).internet_message_id),
        sender: {
          address: String(mailboxRow.email_address),
          ...(String(mailboxRow.display_name).length === 0
            ? {}
            : { name: String(mailboxRow.display_name) }),
        },
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        textBody: artifact.content,
        ...(normalizeDraftHtmlBody(draft.htmlBody) === undefined
          ? {}
          : { htmlBody: normalizeDraftHtmlBody(draft.htmlBody) }),
        providerThreadId: String(row(conversation).provider_thread_id),
        ...(replyInternetMessageId === undefined ? {} : { inReplyTo: replyInternetMessageId }),
        references: replyInternetMessageId === undefined ? [] : [replyInternetMessageId],
      })
      const updated = this.db
        .prepare(`UPDATE drafts SET text_body=?,version=version+1,sync_state='local',
          revision_fingerprint=?,updated_at=? WHERE id=? AND mailbox_id=? AND version=?`)
        .run(
          artifact.content,
          revisionFingerprint,
          input.updatedAt,
          draft.id,
          input.mailboxId,
          input.expectedDraftVersion,
        )
      if (updated.changes !== 1) return undefined
      const savedValue = this.db
        .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
        .get(draft.id, input.mailboxId)
      if (savedValue === undefined) throw new Error('Failed to save accepted AI reply')
      const saved = mapDraft(savedValue)
      const syncCommand: DraftCommand = {
        kind: 'sync-draft',
        draftId: saved.id,
        expectedVersion: saved.version,
        outboundRevisionFingerprint: saved.revisionFingerprint,
      }
      this.db
        .prepare(`INSERT INTO command_outbox
          (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          newCommandId(),
          input.mailboxId,
          input.idempotencyKey,
          syncCommand.kind,
          `draft:${saved.id}`,
          JSON.stringify(syncCommand),
          input.updatedAt,
          input.updatedAt,
        )
      const reviewed = this.db
        .prepare(`UPDATE ai_artifacts SET accepted_at=?,rejected_at=NULL
          WHERE id=? AND mailbox_id=? AND accepted_at IS NULL AND rejected_at IS NULL`)
        .run(input.updatedAt, input.artifactId, input.mailboxId)
      if (reviewed.changes !== 1) throw new Error('AI_ARTIFACT_STALE')
      return saved
    })()
    if (accepted !== undefined)
      this.publishCommitted({
        mailboxId: input.mailboxId,
        conversations: true,
        drafts: true,
        outbox: true,
      })
    return accepted
  }

  async reviewAiArtifact(input: Parameters<MailStore['reviewAiArtifact']>[0]): Promise<void> {
    this.db.transaction(() => {
      const artifactValue = this.db
        .prepare('SELECT draft_id,draft_version FROM ai_artifacts WHERE id=? AND mailbox_id=?')
        .get(input.artifactId, input.mailboxId)
      if (artifactValue === undefined) throw new Error('AI artifact not found')
      const artifact = row(artifactValue)
      if (input.expectedDraftVersion !== undefined) {
        if (Number(artifact.draft_version) !== input.expectedDraftVersion)
          throw new Error('AI_ARTIFACT_STALE')
        const draftValue = this.db
          .prepare('SELECT version FROM drafts WHERE id=? AND mailbox_id=?')
          .get(artifact.draft_id, input.mailboxId)
        if (
          draftValue === undefined ||
          Number(row(draftValue).version) !== input.expectedDraftVersion
        )
          throw new Error('AI_ARTIFACT_STALE')
      }
      this.db
        .prepare(`UPDATE ai_artifacts SET accepted_at=?,rejected_at=? WHERE id=? AND mailbox_id=?`)
        .run(
          input.decision === 'accepted' ? input.reviewedAt : null,
          input.decision === 'rejected' ? input.reviewedAt : null,
          input.artifactId,
          input.mailboxId,
        )
    })()
  }

  private saveAiArtifactSync(artifact: AiArtifact): void {
    const mailboxValue = this.db
      .prepare('SELECT workspace_id FROM mailboxes WHERE id=?')
      .get(artifact.mailboxId)
    if (mailboxValue === undefined) throw new Error('Mailbox not found')
    this.db
      .prepare(`INSERT INTO ai_artifacts
      (id,workspace_id,mailbox_id,conversation_id,artifact_type,source_version,model,
      policy_version,content,draft_id,draft_version,recipient_fingerprint,accepted_at,
      rejected_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        artifact.id,
        row(mailboxValue).workspace_id,
        artifact.mailboxId,
        artifact.conversationId,
        artifact.artifactType,
        artifact.sourceVersion,
        artifact.model,
        artifact.policyVersion,
        artifact.content,
        artifact.draftId ?? null,
        artifact.draftVersion ?? null,
        artifact.recipientFingerprint ?? null,
        artifact.acceptedAt ?? null,
        artifact.rejectedAt ?? null,
        artifact.createdAt,
      )
  }
}

function recipientFingerprint(draft: Draft): string {
  const normalize = (addresses: Draft['to']) =>
    addresses.map((entry) => entry.address.trim().toLowerCase()).sort()
  return JSON.stringify({
    to: normalize(draft.to),
    cc: normalize(draft.cc),
    bcc: normalize(draft.bcc),
  })
}
