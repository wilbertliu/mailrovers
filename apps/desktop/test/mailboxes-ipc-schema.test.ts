import { GMAIL_CAPABILITIES } from '@mailrovers/mail-contracts'
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

  it('requires safe result envelopes and explicit mailbox connection state', () => {
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
    const mailbox = {
      id: 'mailbox-1',
      provider: 'gmail',
      emailAddress: 'person@example.test',
      displayName: 'Person',
      syncState: 'paused',
      capabilities: GMAIL_CAPABILITIES,
      importedMessageCount: 10,
    }
    expect(
      listMailboxesResultSchema.parse({
        ok: true,
        value: [{ ...mailbox, connectionState: 'disconnected' }],
      }),
    ).toMatchObject({ ok: true, value: [{ connectionState: 'disconnected' }] })
    expect(() => listMailboxesResultSchema.parse({ ok: true, value: [mailbox] })).toThrow(
      'Required',
    )
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

  it('accepts only compact, content-free committed change sets', () => {
    expect(
      desktopEventSchema.parse({
        kind: 'mail-changed',
        requestId: 'mailrovers:committed-changes',
        mailboxId: 'mailbox-1',
        changes: { conversations: true, drafts: true, outbox: true },
      }),
    ).toMatchObject({ changes: { conversations: true, drafts: true, outbox: true } })
    for (const leaked of ['subject', 'body', 'address', 'providerMessageId'])
      expect(() =>
        desktopEventSchema.parse({
          kind: 'mail-changed',
          requestId: 'mailrovers:committed-changes',
          mailboxId: 'mailbox-1',
          changes: { conversations: true },
          [leaked]: 'must-not-cross-ipc',
        }),
      ).toThrow('Unrecognized key')
  })
})
