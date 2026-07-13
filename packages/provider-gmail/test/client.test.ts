import { describe, expect, it } from 'vitest'
import { GmailHttpClient, type AccessTokenSource } from '../src/index.js'

function tokenSource(): AccessTokenSource {
  return { get: async () => 'token', invalidate() {} }
}

describe('Gmail HTTP client', () => {
  it('backs off and retries rate limits without exposing provider payloads', async () => {
    let calls = 0
    const waits: number[] = []
    const client = new GmailHttpClient({
      accessTokens: tokenSource(),
      endpoints: {
        authorization: 'https://accounts.example.test/authorize',
        token: 'https://accounts.example.test/token',
        tokenInfo: 'https://accounts.example.test/tokeninfo',
        gmailApi: 'https://gmail.example.test/v1',
      },
      random: () => 0,
      wait: async (milliseconds) => {
        waits.push(milliseconds)
      },
      fetch: async () => {
        calls += 1
        if (calls === 1)
          return new Response(
            JSON.stringify({
              error: { errors: [{ reason: 'userRateLimitExceeded' }], message: 'secret detail' },
            }),
            { status: 429 },
          )
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })

    await expect(
      client.request('/users/me/messages', { signal: new AbortController().signal }),
    ).resolves.toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(waits).toEqual([1_000])
  })
})
