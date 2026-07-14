import { describe, expect, it } from 'vitest'
import {
  createStructuredLogger,
  redactLogValue,
  redactedJson,
  stableErrorCode,
} from '../src/structured-logger.js'

const canaries = {
  apiKey: 'sk-live-canary',
  token: 'access-token-canary',
  authUrl: 'https://accounts.google.com/o/oauth2/auth?code=oauth-canary',
  prompt: 'private prompt canary',
  generatedContent: 'generated canary',
  body: 'body canary',
  subject: 'subject canary',
  address: 'reader@example.test',
  attachmentFilename: 'payroll-canary.pdf',
  attachmentContent: 'attachment bytes canary',
}

function expectNoCanaries(value: unknown): void {
  const output = JSON.stringify(value)
  for (const canary of Object.values(canaries)) expect(output).not.toContain(canary)
}

describe('structured logging redaction', () => {
  it('recursively removes every sensitive canary, including nested errors', () => {
    const cause = new Error(`failed for ${canaries.address}`)
    Object.assign(cause, { code: 'NOT_AN_ALLOWED_CODE', token: canaries.token })
    const error = new Error(
      `provider failed: ${canaries.subject}; ${canaries.body}; ${canaries.attachmentFilename}`,
      { cause },
    )
    Object.assign(error, { code: 'AI_PROVIDER_UNAVAILABLE' })
    const value = {
      ...canaries,
      nested: {
        attachment: { filename: canaries.attachmentFilename, content: canaries.attachmentContent },
      },
      error,
    }
    const redacted = redactLogValue(value)
    expectNoCanaries(redacted)
    expect(redacted).toMatchObject({
      error: {
        code: 'AI_PROVIDER_UNAVAILABLE',
        message: '[REDACTED]',
        cause: '[REDACTED]',
        stack: '[REDACTED]',
      },
    })
  })

  it('bounds cycles, depth, strings, arrays, objects, and typed arrays', () => {
    const cyclic: Record<string, unknown> = { value: 'x'.repeat(50), bytes: new Uint8Array([1, 2]) }
    cyclic.self = cyclic
    cyclic.deep = { one: { two: { three: true } } }
    cyclic.items = Array.from({ length: 10 }, (_, index) => index)
    const redacted = redactLogValue(cyclic, {
      maxDepth: 3,
      maxStringLength: 5,
      maxArrayLength: 3,
      maxObjectKeys: 4,
    })
    const output = JSON.stringify(redacted)
    expect(output).toContain('[CIRCULAR]')
    expect(output).toContain('[BINARY]')
    expect(output).toContain('[DEPTH_LIMIT]')
    expect(output.length).toBeLessThan(500)
  })

  it('redacts sensitive values across varied nesting and collection shapes', () => {
    const shapes: unknown[] = [
      canaries.authUrl,
      [canaries.address, { password: canaries.apiKey }],
      { a: { b: { prompt: canaries.prompt } } },
      new Error(`request URL ${canaries.authUrl}`),
    ]
    expect(shapes).toHaveLength(4)
    for (const shape of shapes) expectNoCanaries(redactLogValue(shape))
  })

  it('emits allowlisted metadata and maps error codes to stable values', () => {
    const lines: string[] = []
    const logger = createStructuredLogger({
      component: 'desktop',
      sink: (line) => lines.push(line),
      now: () => new Date('2026-07-14T00:00:00.000Z'),
    })
    logger.error('operation-failed', {
      code: 'unknown-provider-detail',
      stage: 'startup',
      detail: { apiKey: canaries.apiKey },
      // Verify runtime callers cannot smuggle arbitrary metadata even if they bypass TypeScript.
      arbitrary: canaries.body,
    } as never)
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-07-14T00:00:00.000Z',
      level: 'error',
      event: 'desktop.operation-failed',
      metadata: { code: 'INTERNAL_ERROR', stage: 'startup', detail: { apiKey: '[REDACTED]' } },
    })
    expect(stableErrorCode('INVALID_REQUEST')).toBe('INVALID_REQUEST')
    expect(stableErrorCode('raw-provider-error')).toBe('INTERNAL_ERROR')
    expect(redactedJson(canaries)).not.toContain('canary')
  })
})
