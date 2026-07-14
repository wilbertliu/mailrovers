import type { MailProvider } from '@mailrovers/mail-application'
import { GMAIL_CAPABILITIES } from '@mailrovers/mail-contracts'
import { mailboxId, workspaceId } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import { GmailHttpClient, GmailProvider, type AccessTokenSource } from '../src/index.js'

const mailbox = mailboxId('gmail:provider-contract')
const maximumAttachmentBytes = 32 * 1024 * 1024
const tokens: AccessTokenSource = { get: async () => 'token', invalidate() {} }

function attachmentStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function fakeProvider(): MailProvider {
  return {
    getCapabilities: () => GMAIL_CAPABILITIES,
    getCurrentCursor: async (signal) => {
      signal.throwIfAborted()
      return '100'
    },
    importMailbox: async function* () {},
    pullChanges: async () => ({ changes: {}, historyId: '100' }),
    executeCommand: async () => ({ changes: {} }),
    reconcileCommand: async () => ({ kind: 'not-applied' }),
    getAttachment: async (input) => {
      input.signal.throwIfAborted()
      if (input.expectedSizeBytes > maximumAttachmentBytes)
        throw new Error('Attachment exceeds the safe download size limit')
      return attachmentStream(
        Uint8Array.from({ length: input.expectedSizeBytes }, (_, index) => index + 1),
      )
    },
  }
}

function gmailProvider(): MailProvider {
  const encoded = Buffer.from([1, 2, 3]).toString('base64url')
  return new GmailProvider({
    client: new GmailHttpClient({
      accessTokens: tokens,
      fetch: async () =>
        new Response(JSON.stringify({ data: encoded, size: 3 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      endpoints: {
        authorization: 'https://accounts.example.test/authorize',
        token: 'https://accounts.example.test/token',
        tokenInfo: 'https://accounts.example.test/tokeninfo',
        gmailApi: 'https://gmail.example.test/v1',
      },
      wait: async () => undefined,
    }),
    workspaceId: workspaceId('workspace-personal'),
  })
}

async function bytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    chunks.push(next.value)
    length += next.value.byteLength
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function mailProviderContract(name: string, create: () => MailProvider): void {
  describe(`${name} MailProvider contract`, () => {
    it('reports transport-safe Gmail capabilities', () => {
      expect(create().getCapabilities()).toEqual(GMAIL_CAPABILITIES)
    })

    it('returns only an attachment matching its declared bounded size', async () => {
      const stream = await create().getAttachment({
        mailboxId: mailbox,
        providerMessageId: 'provider-message',
        providerAttachmentId: 'provider-attachment',
        expectedSizeBytes: 3,
        signal: new AbortController().signal,
      })
      expect([...(await bytes(stream))]).toEqual([1, 2, 3])
      await expect(
        create().getAttachment({
          mailboxId: mailbox,
          providerMessageId: 'provider-message',
          providerAttachmentId: 'provider-attachment',
          expectedSizeBytes: maximumAttachmentBytes + 1,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('Attachment exceeds the safe download size limit')
    })

    it('does not infer uncertain reconciliation for set-like commands', async () => {
      await expect(
        create().reconcileCommand({
          mailboxId: mailbox,
          command: {
            kind: 'set-thread-read',
            conversationId: 'conversation-1' as never,
            read: true,
          },
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ kind: 'not-applied' })
    })

    it('honors a cancelled operation before making a provider request', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(create().getCurrentCursor(controller.signal)).rejects.toThrow(
        expect.objectContaining({ name: 'AbortError' }),
      )
    })
  })
}

mailProviderContract('Gmail', gmailProvider)
mailProviderContract('Fake', fakeProvider)
