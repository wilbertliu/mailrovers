import type { Draft } from '@mailrovers/mail-contracts'
import {
  draftId,
  fingerprintDraftRevision,
  mailboxId,
  utcTimestamp,
  workspaceId,
} from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import { GmailHttpClient, GmailProvider, type AccessTokenSource } from '../src/index.js'

const tokenSource: AccessTokenSource = { get: async () => 'token', invalidate() {} }
const mailbox = mailboxId('gmail:commands')
const outboundRevision = {
  internetMessageId: '<stable@mailrovers.local>',
  sender: { address: 'owner@example.test' },
  to: [{ address: 'reader@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Hello',
  textBody: 'Message body',
  providerThreadId: 'thread-one',
  references: [],
}
const revisionFingerprint = fingerprintDraftRevision(outboundRevision)
const draftCommand = {
  kind: 'sync-draft' as const,
  draftId: draftId('local-draft'),
  expectedVersion: 1,
  outboundRevisionFingerprint: revisionFingerprint,
}
const draft: Draft = {
  id: draftId('local-draft'),
  mailboxId: mailbox,
  to: [{ address: 'reader@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Hello',
  textBody: 'Message body',
  version: 1,
  revisionFingerprint,
  syncState: 'local',
  updatedAt: utcTimestamp('2026-07-13T00:00:00.000Z'),
}

function gmailMessage(id: string, labels: string[] = ['DRAFT'], body = 'Message body') {
  return {
    id,
    threadId: 'thread-one',
    labelIds: labels,
    snippet: body,
    internalDate: '1783900800000',
    sizeEstimate: 100,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Message-ID', value: '<stable@mailrovers.local>' },
        { name: 'From', value: 'owner@example.test' },
        { name: 'To', value: 'reader@example.test' },
        { name: 'Subject', value: 'Hello' },
      ],
      body: { data: Buffer.from(body).toString('base64url'), size: Buffer.byteLength(body) },
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
      command: {
        kind: 'sync-draft',
        draftId: draft.id,
        expectedVersion: 1,
        outboundRevisionFingerprint: revisionFingerprint,
      },
      draft,
      outboundRevision,
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
      providerFingerprint: revisionFingerprint,
    })
  })

  it('reconciles an ambiguous draft create by exact RFC Message-ID and revision', async () => {
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
      command: {
        kind: 'sync-draft',
        draftId: draft.id,
        expectedVersion: 1,
        outboundRevisionFingerprint: revisionFingerprint,
      },
      draft,
      outboundRevision,
      sender: { address: 'owner@example.test' },
      internetMessageId: '<stable@mailrovers.local>',
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('applied')
  })

  it('selects only the exact revision when candidates share a Message-ID', async () => {
    const gmail = provider(async (url) => {
      const value = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (value.includes('/drafts?'))
        return new Response(
          JSON.stringify({
            drafts: [
              { id: 'prior', message: { id: 'message-prior', threadId: 'thread-one' } },
              { id: 'exact', message: { id: 'message-exact', threadId: 'thread-one' } },
            ],
          }),
          { status: 200 },
        )
      const exact = value.includes('/drafts/exact')
      return new Response(
        JSON.stringify({
          id: exact ? 'exact' : 'prior',
          message: gmailMessage(
            exact ? 'message-exact' : 'message-prior',
            ['DRAFT'],
            exact ? 'Message body' : 'Prior body',
          ),
        }),
        { status: 200 },
      )
    })
    const result = await gmail.reconcileCommand({
      mailboxId: mailbox,
      command: draftCommand,
      draft,
      outboundRevision,
      sender: outboundRevision.sender,
      internetMessageId: outboundRevision.internetMessageId,
      signal: new AbortController().signal,
    })
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'applied',
        result: expect.objectContaining({
          draftIdentity: expect.objectContaining({ providerDraftId: 'exact' }),
        }),
      }),
    )
  })

  it('keeps duplicate exact and nonmatching revisions uncertain', async () => {
    for (const bodies of [
      ['Message body', 'Message body'],
      ['Prior one', 'Prior two'],
    ]) {
      const gmail = provider(async (url) => {
        const value = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
        if (value.includes('/drafts?'))
          return new Response(
            JSON.stringify({
              drafts: bodies.map((_body, index) => ({
                id: `candidate-${index}`,
                message: { id: `message-${index}`, threadId: 'thread-one' },
              })),
            }),
            { status: 200 },
          )
        const index = value.includes('candidate-1') ? 1 : 0
        return new Response(
          JSON.stringify({
            id: `candidate-${index}`,
            message: gmailMessage(`message-${index}`, ['DRAFT'], bodies[index]),
          }),
          { status: 200 },
        )
      })
      const result = await gmail.reconcileCommand({
        mailboxId: mailbox,
        command: draftCommand,
        draft,
        outboundRevision,
        sender: outboundRevision.sender,
        internetMessageId: outboundRevision.internetMessageId,
        signal: new AbortController().signal,
      })
      expect(result.kind).toBe('uncertain')
    }
  })
})
