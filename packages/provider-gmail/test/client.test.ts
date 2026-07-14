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

  it('retries only explicitly set-like mutations', async () => {
    let safeCalls = 0
    const safe = new GmailHttpClient({
      accessTokens: tokenSource(),
      endpoints: {
        authorization: 'https://accounts.example.test/authorize',
        token: 'https://accounts.example.test/token',
        tokenInfo: 'https://accounts.example.test/tokeninfo',
        gmailApi: 'https://gmail.example.test/v1',
      },
      random: () => 0,
      wait: async () => undefined,
      fetch: async () => {
        safeCalls += 1
        return safeCalls === 1
          ? new Response(JSON.stringify({ error: {} }), { status: 500 })
          : new Response(JSON.stringify({ id: 'thread' }), { status: 200 })
      },
    })
    await expect(
      safe.mutateSetLike('/users/me/threads/thread/modify', {
        signal: new AbortController().signal,
        body: { removeLabelIds: ['INBOX'] },
      }),
    ).resolves.toEqual({ id: 'thread' })
    expect(safeCalls).toBe(2)

    let unsafeCalls = 0
    const unsafe = new GmailHttpClient({
      accessTokens: tokenSource(),
      endpoints: {
        authorization: 'https://accounts.example.test/authorize',
        token: 'https://accounts.example.test/token',
        tokenInfo: 'https://accounts.example.test/tokeninfo',
        gmailApi: 'https://gmail.example.test/v1',
      },
      wait: async () => undefined,
      fetch: async () => {
        unsafeCalls += 1
        return new Response(JSON.stringify({ error: {} }), { status: 500 })
      },
    })
    await expect(
      unsafe.mutateOnce('/users/me/drafts', {
        signal: new AbortController().signal,
        method: 'POST',
        body: { message: { raw: 'encoded' } },
      }),
    ).rejects.toMatchObject({ status: 500 })
    expect(unsafeCalls).toBe(1)
  })

  it('bounds attachment metadata responses before buffering them', async () => {
    let calls = 0
    const client = new GmailHttpClient({
      accessTokens: tokenSource(),
      endpoints: {
        authorization: 'https://accounts.example.test/authorize',
        token: 'https://accounts.example.test/token',
        tokenInfo: 'https://accounts.example.test/tokeninfo',
        gmailApi: 'https://gmail.example.test/v1',
      },
      wait: async () => undefined,
      fetch: async () => {
        calls += 1
        return new Response(JSON.stringify({ data: 'oversized' }), {
          status: 200,
          headers: { 'content-length': '1000' },
        })
      },
    })

    await expect(
      client.requestBounded('/users/me/messages/message/attachments/attachment', {
        signal: new AbortController().signal,
        maximumResponseBytes: 32,
      }),
    ).rejects.toThrow('exceeded the safe size limit')
    expect(calls).toBe(1)
  })
})
