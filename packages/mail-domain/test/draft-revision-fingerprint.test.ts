import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeDraftRevision, fingerprintDraftRevision } from '../src/index.js'

const revision = {
  internetMessageId: '<stable@mailrovers.local>',
  sender: { name: 'Owner', address: 'OWNER@example.test' },
  to: [{ address: 'first@example.test' }, { address: 'second@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Reply',
  textBody: 'Line one\r\nLine two',
  providerThreadId: 'thread-1',
  inReplyTo: '<parent@example.test>',
  references: ['<parent@example.test>'],
}

describe('draft revision fingerprint', () => {
  it('uses SHA-256 over the versioned canonical representation', () => {
    expect(fingerprintDraftRevision(revision)).toBe(
      createHash('sha256').update(canonicalizeDraftRevision(revision)).digest('hex'),
    )
  })

  it('normalizes line endings, Unicode, and address casing', () => {
    expect(fingerprintDraftRevision(revision)).toBe(
      fingerprintDraftRevision({
        ...revision,
        sender: { name: 'Owner', address: 'owner@example.test' },
        textBody: 'Line one\nLine two',
      }),
    )
  })

  it('treats empty HTML as omitted because Gmail does not serialize an empty MIME part', () => {
    expect(fingerprintDraftRevision({ ...revision, htmlBody: '' })).toBe(
      fingerprintDraftRevision(revision),
    )
  })

  it('changes for every provider-visible revision field and preserves recipient order', () => {
    const original = fingerprintDraftRevision(revision)
    const variants = [
      { ...revision, subject: 'Different' },
      { ...revision, textBody: 'Different' },
      { ...revision, htmlBody: '<p>Different</p>' },
      { ...revision, providerThreadId: 'thread-2' },
      { ...revision, inReplyTo: '<other@example.test>' },
      { ...revision, references: ['<other@example.test>'] },
      { ...revision, to: [...revision.to].reverse() },
      { ...revision, cc: [{ address: 'copy@example.test' }] },
      { ...revision, bcc: [{ address: 'blind@example.test' }] },
      { ...revision, internetMessageId: '<different@mailrovers.local>' },
      { ...revision, sender: { address: 'other@example.test' } },
    ]
    for (const variant of variants) expect(fingerprintDraftRevision(variant)).not.toBe(original)
  })
})
