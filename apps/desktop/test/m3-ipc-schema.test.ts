import { describe, expect, it } from 'vitest'
import { saveDraftInputSchema, sendDraftInputSchema } from '../electron/ipc/drafts.schema.js'
import {
  getConversationInputSchema,
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

  it('rejects unknown fields and oversized search input', () => {
    expect(listLabelsInputSchema.safeParse({ ...base, sql: 'select *' }).success).toBe(false)
    expect(searchMailInputSchema.safeParse({ ...base, query: 'x'.repeat(513) }).success).toBe(false)
  })
})
