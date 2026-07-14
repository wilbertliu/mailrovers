import { describe, expect, it } from 'vitest'
import { undoCommandInputSchema } from '../electron/ipc/commands.schema.js'
import { saveDraftInputSchema, sendDraftInputSchema } from '../electron/ipc/drafts.schema.js'
import {
  exportAttachmentInputSchema,
  exportAttachmentResultSchema,
  getConversationInputSchema,
  getMessageBodyInputSchema,
  getMessageBodyResultSchema,
  listLabelsInputSchema,
  searchMailInputSchema,
} from '../electron/ipc/mail.schema.js'

const base = { requestId: 'request-1', mailboxId: 'gmail:account' }

describe('M3 IPC schemas', () => {
  it('accepts bounded task-shaped inputs', () => {
    expect(listLabelsInputSchema.parse(base)).toEqual(base)
    expect(getConversationInputSchema.parse({ ...base, conversationId: 'conversation-1' })).toEqual(
      { ...base, conversationId: 'conversation-1' },
    )
    expect(
      getMessageBodyInputSchema.parse({
        ...base,
        conversationId: 'conversation-1',
        messageId: 'message-1',
      }),
    ).toEqual({
      ...base,
      conversationId: 'conversation-1',
      messageId: 'message-1',
    })
    expect(searchMailInputSchema.parse({ ...base, query: 'invoice', limit: 25 })).toEqual({
      ...base,
      query: 'invoice',
      limit: 25,
    })
  })

  it('validates versioned draft and send requests', () => {
    const saved = saveDraftInputSchema.parse({
      ...base,
      idempotencyKey: 'save-one',
      to: [{ address: 'reader@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Hello',
      textBody: 'Body',
    })
    expect(saved.to[0]?.address).toBe('reader@example.test')
    expect(
      sendDraftInputSchema.safeParse({
        ...base,
        draftId: 'draft-one',
        expectedVersion: 0,
        idempotencyKey: 'send-one',
      }).success,
    ).toBe(false)
  })

  it('allows only sanitized message HTML across IPC', () => {
    expect(
      getMessageBodyResultSchema.parse({
        ok: true,
        value: { messageId: 'message-1', sanitizedHtmlBody: '<p>safe</p>' },
      }),
    ).toEqual({ ok: true, value: { messageId: 'message-1', sanitizedHtmlBody: '<p>safe</p>' } })
    expect(
      getMessageBodyResultSchema.safeParse({
        ok: true,
        value: { messageId: 'message-1', rawHtmlBody: '<script>unsafe()</script>' },
      }).success,
    ).toBe(false)
  })

  it('rejects unknown fields and oversized search input', () => {
    expect(listLabelsInputSchema.safeParse({ ...base, sql: 'select *' }).success).toBe(false)
    expect(searchMailInputSchema.safeParse({ ...base, query: 'x'.repeat(513) }).success).toBe(false)
  })

  it('keeps attachment export and undo payloads path-free and bounded', () => {
    const attachment = {
      ...base,
      messageId: 'message-1',
      attachmentId: 'attachment-1',
    }
    expect(exportAttachmentInputSchema.parse(attachment)).toEqual(attachment)
    expect(
      exportAttachmentInputSchema.safeParse({ ...attachment, destinationPath: '/tmp/secret' })
        .success,
    ).toBe(false)
    expect(
      exportAttachmentResultSchema.parse({
        ok: true,
        value: { status: 'cancelled', attachmentId: 'attachment-1' },
      }),
    ).toEqual({
      ok: true,
      value: { status: 'cancelled', attachmentId: 'attachment-1' },
    })
    expect(
      exportAttachmentResultSchema.safeParse({
        ok: true,
        value: {
          status: 'exported',
          attachmentId: 'attachment-1',
          localPath: '/tmp/secret',
        },
      }).success,
    ).toBe(false)
    expect(
      undoCommandInputSchema.parse({
        ...base,
        sourceCommandId: 'command-1',
        idempotencyKey: 'undo-command-1',
      }),
    ).toEqual({
      ...base,
      sourceCommandId: 'command-1',
      idempotencyKey: 'undo-command-1',
    })
  })
})
