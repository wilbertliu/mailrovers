import { mailboxId, utcTimestamp, workspaceId } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIME_BUDGET,
  translateMessage,
  type GmailMessage,
  type GmailMessagePart,
  type MimeBudget,
} from '../src/index.js'

const encode = (value: string) => Buffer.from(value).toString('base64url')
const budget = (override: Partial<MimeBudget>): MimeBudget => ({
  ...DEFAULT_MIME_BUDGET,
  ...override,
})

function message(payload: GmailMessagePart): GmailMessage {
  return {
    id: 'message-budget',
    threadId: 'thread-budget',
    labelIds: ['INBOX'],
    snippet: 'metadata remains available',
    internalDate: '1783900800000',
    sizeEstimate: 100,
    payload: {
      ...payload,
      headers: [
        { name: 'From', value: 'sender@example.test' },
        { name: 'Subject', value: 'Budget test' },
        ...(payload.headers ?? []),
      ],
    },
  }
}

function normalize(payload: GmailMessagePart, customBudget: MimeBudget, signal?: AbortSignal) {
  return translateMessage({
    workspaceId: workspaceId('workspace-personal'),
    mailboxId: mailboxId('gmail:budget'),
    message: message(payload),
    now: utcTimestamp('2026-07-14T00:00:00.000Z'),
    budget: customBudget,
    ...(signal ? { signal } : {}),
  })
}

function expectMetadataOnly(
  normalized: ReturnType<typeof normalize>,
  dimension: keyof MimeBudget,
): void {
  expect(normalized.mime).toEqual(
    expect.objectContaining({
      kind: 'metadata-only',
      diagnostic: expect.objectContaining({ code: 'MIME_BUDGET_EXCEEDED', dimension }),
    }),
  )
  expect(normalized.textBody).toBeUndefined()
  expect(normalized.sanitizedHtmlBody).toBeUndefined()
  expect(normalized.attachments).toEqual([])
  expect(normalized.subject).toBe('Budget test')
}

describe('shared iterative MIME budget', () => {
  it('rejects deeply nested payloads without recursion or partial bodies', () => {
    expect.hasAssertions()
    let payload: GmailMessagePart = { mimeType: 'text/plain', body: { data: encode('deep') } }
    for (let depth = 0; depth < 40; depth += 1)
      payload = { mimeType: 'multipart/mixed', parts: [payload] }
    expectMetadataOnly(normalize(payload, budget({ depth: 16 })), 'depth')
  })

  it('accounts for wide and many-small payloads in the same parts budget', () => {
    expect.hasAssertions()
    const wide = {
      mimeType: 'multipart/mixed',
      parts: Array.from({ length: 20 }, (_, index) => ({
        mimeType: 'text/plain',
        body: { data: encode(`part-${index}`) },
      })),
    }
    expectMetadataOnly(normalize(wide, budget({ parts: 10 })), 'parts')

    const manySmall = {
      mimeType: 'multipart/mixed',
      parts: Array.from({ length: 12 }, (_, index) => ({
        partId: String(index),
        mimeType: 'application/octet-stream',
        filename: `${index}.bin`,
        body: { attachmentId: `a-${index}`, size: 1 },
      })),
    }
    expectMetadataOnly(normalize(manySmall, budget({ attachments: 8 })), 'attachments')
  })

  it('separately accounts encoded and decoded UTF-8 bytes', () => {
    expect.hasAssertions()
    expectMetadataOnly(
      normalize(
        { mimeType: 'text/plain', body: { data: encode('encoded input') } },
        budget({ encoded_bytes: 4 }),
      ),
      'encoded_bytes',
    )
    expectMetadataOnly(
      normalize(
        { mimeType: 'text/plain', body: { data: encode('🙂🙂🙂') } },
        budget({ decoded_utf8_bytes: 8 }),
      ),
      'decoded_utf8_bytes',
    )
  })

  it('accounts sanitized HTML output and attachment metadata bytes', () => {
    expect.hasAssertions()
    expectMetadataOnly(
      normalize(
        { mimeType: 'text/html', body: { data: encode('<p>safe output</p>') } },
        budget({ sanitized_html_bytes: 4 }),
      ),
      'sanitized_html_bytes',
    )
    expectMetadataOnly(
      normalize(
        {
          mimeType: 'application/pdf',
          filename: 'a-very-long-document-name.pdf',
          body: { attachmentId: 'provider-attachment', size: 12 },
        },
        budget({ attachment_metadata_bytes: 8 }),
      ),
      'attachment_metadata_bytes',
    )
  })

  it('never reports a partial earlier body as complete after later overflow', () => {
    expect.hasAssertions()
    const normalized = normalize(
      {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: encode('would otherwise be partial') } },
          { mimeType: 'text/html', body: { data: encode('<p>overflow</p>') } },
        ],
      },
      budget({ sanitized_html_bytes: 3 }),
    )
    expectMetadataOnly(normalized, 'sanitized_html_bytes')
  })

  it('honors cancellation before walking the payload', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() =>
      normalize(
        { mimeType: 'text/plain', body: { data: encode('body') } },
        budget({}),
        controller.signal,
      ),
    ).toThrow(expect.objectContaining({ name: 'AbortError' }))
  })
})
