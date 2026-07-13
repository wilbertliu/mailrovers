import type { Draft } from '@mailrovers/mail-contracts'
import { draftId, mailboxId, utcTimestamp, workspaceId } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import { GmailHttpClient, GmailProvider, type AccessTokenSource } from '../src/index.js'

const tokenSource: AccessTokenSource = { get: async () => 'token', invalidate() {} }
const mailbox = mailboxId('gmail:commands')
const draft: Draft = {
  id: draftId('local-draft'),
  mailboxId: mailbox,
  to: [{ address: 'reader@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Hello',
  textBody: 'Message body',
  version: 1,
  syncState: 'local',
  updatedAt: utcTimestamp('2026-07-13T00:00:00.000Z'),
}

function gmailMessage(id: string, labels: string[] = ['DRAFT']) {
  return {
    id,
    threadId: 'thread-one',
    labelIds: labels,
    snippet: 'Message body',
    internalDate: '1783900800000',
    sizeEstimate: 100,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Message-ID', value: '<stable@mailrovers.local>' },
        { name: 'To', value: 'reader@example.test' },
        { name: 'Subject', value: 'Hello' },
      ],
      body: { data: Buffer.from('Message body').toString('base64url'), size: 12 },
    },
  }
}

function provider(fetchImplementation: typeof fetch) {
  return new GmailProvider({
    client: new GmailHttpClient({
      accessTokens: tokenSource,
      fetch: fetchImplementation,
      endpoints: {
        authorization: 'https://accounts.example.test/authorize',
        token: 'https://accounts.example.test/token',
        tokenInfo: 'https://accounts.example.test/tokeninfo',
        gmailApi: 'https://gmail.example.test/v1',
      },
      wait: async () => undefined,
    }),
    workspaceId: workspaceId('workspace-personal'),
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  })
}

describe('Gmail draft commands', () => {
  it('creates a draft with stable MIME identity and adopts provider IDs', async () => {
    let requestBody = ''
    const gmail = provider(async (_url, init) => {
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return new Response(
        JSON.stringify({ id: 'provider-draft', message: gmailMessage('message-one') }),
        {
          status: 200,
        },
      )
    })
    const result = await gmail.executeCommand({
      mailboxId: mailbox,
      command: { kind: 'sync-draft', draftId: draft.id, version: 1 },
      draft,
      sender: { address: 'owner@example.test' },
      internetMessageId: '<stable@mailrovers.local>',
      signal: new AbortController().signal,
    })
    const body: unknown = JSON.parse(requestBody)
    expect(body).toEqual(
      expect.objectContaining({ message: expect.objectContaining({ raw: expect.any(String) }) }),
    )
    expect(result.draftIdentity).toEqual({
      draftId: draft.id,
      providerDraftId: 'provider-draft',
      providerMessageId: 'message-one',
    })
  })

  it('reconciles an ambiguous draft create by RFC Message-ID', async () => {
    const gmail = provider(async (url) => {
      const value = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (value.includes('/drafts?'))
        return new Response(
          JSON.stringify({
            drafts: [
              { id: 'provider-draft', message: { id: 'message-one', threadId: 'thread-one' } },
            ],
          }),
          { status: 200 },
        )
      return new Response(
        JSON.stringify({ id: 'provider-draft', message: gmailMessage('message-one') }),
        { status: 200 },
      )
    })
    const result = await gmail.reconcileCommand({
      mailboxId: mailbox,
      command: { kind: 'sync-draft', draftId: draft.id, version: 1 },
      draft,
      sender: { address: 'owner@example.test' },
      internetMessageId: '<stable@mailrovers.local>',
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('applied')
  })
})
