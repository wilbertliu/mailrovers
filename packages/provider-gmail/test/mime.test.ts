import type { Draft } from '@mailrovers/mail-contracts'
import { draftId, mailboxId, utcTimestamp } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import { base64UrlMime, serializeDraft } from '../src/index.js'

const draft: Draft = {
  id: draftId('draft-one'),
  mailboxId: mailboxId('gmail:one'),
  to: [{ name: 'Ada Lovelace', address: 'ada@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Re: Engine ✓',
  textBody: 'Thanks for the notes.',
  htmlBody: '<p>Thanks for the <strong>notes</strong>.</p>',
  version: 1,
  syncState: 'local',
  updatedAt: utcTimestamp('2026-07-13T00:00:00.000Z'),
}

describe('outbound MIME', () => {
  it('keeps message identity and reply headers stable', () => {
    const first = serializeDraft({
      draft,
      sender: { address: 'owner@example.test', name: 'Owner' },
      internetMessageId: '<stable@mailrovers.local>',
      replyInternetMessageId: '<parent@example.test>',
    })
    const second = serializeDraft({
      draft,
      sender: { address: 'owner@example.test', name: 'Owner' },
      internetMessageId: '<stable@mailrovers.local>',
      replyInternetMessageId: '<parent@example.test>',
    })
    expect(second).toContain('Message-ID: <stable@mailrovers.local>')
    expect(first).toContain('Message-ID: <stable@mailrovers.local>')
    expect(first).toContain('In-Reply-To: <parent@example.test>')
    expect(first).toContain('References: <parent@example.test>')
    expect(first).toContain('Content-Type: multipart/alternative')
    expect(base64UrlMime(first)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects header injection', () => {
    expect(() =>
      serializeDraft({
        draft: { ...draft, subject: 'Hello\r\nBcc: attacker@example.test' },
        sender: { address: 'owner@example.test' },
        internetMessageId: '<stable@mailrovers.local>',
      }),
    ).toThrow('Header contains a line break')
  })
})
