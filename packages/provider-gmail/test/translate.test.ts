import { mailboxId, utcTimestamp, workspaceId } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import { parseAddressList, translateMessage, type GmailMessage } from '../src/index.js'

const encode = (value: string) => Buffer.from(value).toString('base64url')

describe('Gmail payload translation', () => {
  it('parses common address list forms', () => {
    expect(parseAddressList('"Person, One" <one@example.test>, two@example.test')).toEqual([
      { name: 'Person, One', address: 'one@example.test' },
      { address: 'two@example.test' },
    ])
  })

  it('normalizes MIME bodies, labels, and attachment metadata', () => {
    const message: GmailMessage = {
      id: 'message-1',
      threadId: 'thread-1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Preview',
      historyId: '20',
      internalDate: '1783900800000',
      sizeEstimate: 512,
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Sender <sender@example.test>' },
          { name: 'To', value: 'Person <person@example.test>' },
          { name: 'Subject', value: 'Subject' },
          { name: 'Message-ID', value: '<message-1@example.test>' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: encode('Plain body') } },
          {
            mimeType: 'text/html',
            body: {
              data: encode(
                '<p>Hello</p><script>alert(1)</script><img src="https://tracker.test/pixel">',
              ),
            },
          },
          {
            partId: '2',
            mimeType: 'application/pdf',
            filename: 'document.pdf',
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            body: { attachmentId: 'attachment-1', size: 123 },
          },
        ],
      },
    }

    const normalized = translateMessage({
      workspaceId: workspaceId('workspace-personal'),
      mailboxId: mailboxId('gmail:account-1'),
      message,
      now: utcTimestamp('2026-07-13T00:00:00.000Z'),
    })

    expect(normalized).toEqual(
      expect.objectContaining({
        providerMessageId: 'message-1',
        providerThreadId: 'thread-1',
        providerHistoryId: '20',
        subject: 'Subject',
        textBody: 'Plain body',
        providerLabelIds: ['INBOX', 'UNREAD'],
      }),
    )
    expect(normalized.sanitizedHtmlBody).toBe(
      '<p>Hello</p><img src="https://tracker.test/pixel" />',
    )
    expect(normalized.attachments).toEqual([
      expect.objectContaining({
        providerAttachmentId: 'attachment-1',
        filename: 'document.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 123,
      }),
    ])
  })
})
