import type { CommittedChangeSet, MailStore } from '@mailrovers/mail-application'
import { attachmentId, mailboxId, messageId } from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'
import { optionalString, row } from './sqlite-row-helpers.js'

export class SqliteAttachments {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}

  async getAttachmentForExport(
    input: Parameters<MailStore['getAttachmentForExport']>[0],
  ): Promise<Awaited<ReturnType<MailStore['getAttachmentForExport']>>> {
    const value = this.db
      .prepare(`SELECT a.*,m.mailbox_id,m.provider_message_id
      FROM attachments a JOIN messages m ON m.id=a.message_id
      WHERE a.id=? AND a.message_id=? AND m.mailbox_id=?`)
      .get(input.attachmentId, input.messageId, input.mailboxId)
    if (value === undefined) return undefined
    const result = row(value)
    const providerAttachmentId = optionalString(result.provider_attachment_id)
    if (providerAttachmentId === undefined || result.download_state === 'unavailable')
      return undefined
    const cachedRelativePath =
      result.download_state === 'cached' ? optionalString(result.local_path) : undefined
    return {
      mailboxId: mailboxId(String(result.mailbox_id)),
      messageId: messageId(String(result.message_id)),
      attachmentId: attachmentId(String(result.id)),
      providerMessageId: String(result.provider_message_id),
      providerAttachmentId,
      filename: String(result.filename),
      sizeBytes: Number(result.size_bytes),
      ...(cachedRelativePath === undefined ? {} : { cachedRelativePath }),
    }
  }

  async markAttachmentCached(
    input: Parameters<MailStore['markAttachmentCached']>[0],
  ): Promise<void> {
    if (
      input.relativePath.startsWith('/') ||
      input.relativePath.includes('..') ||
      input.relativePath.includes('\\')
    )
      throw new Error('Attachment cache path must be generated and relative')
    const result = this.db
      .prepare(`UPDATE attachments SET local_path=?,download_state='cached'
      WHERE id=? AND message_id=? AND EXISTS (
        SELECT 1 FROM messages m WHERE m.id=attachments.message_id AND m.mailbox_id=?
      )`)
      .run(input.relativePath, input.attachmentId, input.messageId, input.mailboxId)
    if (result.changes !== 1) throw new Error('Attachment was not found for this mailbox')
    this.publishCommitted({ mailboxId: input.mailboxId, conversations: true })
  }

  async listAttachmentCachePaths(
    mailbox: Parameters<MailStore['listAttachmentCachePaths']>[0],
  ): Promise<Awaited<ReturnType<MailStore['listAttachmentCachePaths']>>> {
    return this.db
      .prepare(
        `SELECT DISTINCT a.local_path
        FROM attachments a JOIN messages m ON m.id=a.message_id
        WHERE m.mailbox_id=? AND a.local_path IS NOT NULL`,
      )
      .all(mailbox)
      .map((value) => String(row(value).local_path))
  }
}
