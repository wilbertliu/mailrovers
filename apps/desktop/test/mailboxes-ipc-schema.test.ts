import { describe, expect, it } from 'vitest'
import {
  connectGmailInputSchema,
  desktopEventSchema,
  listMailboxesResultSchema,
} from '../electron/ipc/mailboxes.schema.js'

describe('mailbox IPC contracts', () => {
  it('accepts task inputs and rejects credential fields', () => {
    expect(
      connectGmailInputSchema.parse({ requestId: 'request-1', loginHint: 'person@example.test' }),
    ).toEqual({ requestId: 'request-1', loginHint: 'person@example.test' })
    expect(() =>
      connectGmailInputSchema.parse({
        requestId: 'request-1',
        refreshToken: 'must-not-cross-ipc',
      }),
    ).toThrow('Unrecognized key')
  })

  it('requires safe result envelopes', () => {
    expect(
      listMailboxesResultSchema.parse({
        ok: false,
        error: {
          code: 'APPLICATION_ERROR',
          message: 'Safe message',
          retryable: true,
          requestId: 'request-1',
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'APPLICATION_ERROR',
        message: 'Safe message',
        retryable: true,
        requestId: 'request-1',
      },
    })
  })

  it('rejects malformed progress events', () => {
    expect(() =>
      desktopEventSchema.parse({
        kind: 'sync-progress',
        requestId: 'request-1',
        mailboxId: 'mailbox-1',
        status: { phase: 'importing_messages' },
      }),
    ).toThrow('Required')
  })
})
