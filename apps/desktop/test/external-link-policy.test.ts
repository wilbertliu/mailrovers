import { describe, expect, it } from 'vitest'
import { allowedExternalUrl } from '../electron/external-links.js'

const attackUrls = [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'https://user:secret@example.test/',
  '//example.test/path',
  'not a url',
]

describe('external link policy', () => {
  it.each(attackUrls)('rejects %s', (value) => {
    expect(allowedExternalUrl(value)).toBeUndefined()
  })

  it('allows credential-free HTTP and HTTPS links', () => {
    expect(allowedExternalUrl('https://example.test/path?q=1')).toBe(
      'https://example.test/path?q=1',
    )
    expect(allowedExternalUrl('http://example.test/')).toBe('http://example.test/')
  })
})
