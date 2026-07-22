import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPkce, GmailOAuthConnector, type GmailOAuthEndpoints } from '../src/index.js'

const endpoints: GmailOAuthEndpoints = {
  authorization: 'https://accounts.example.test/authorize',
  token: 'https://accounts.example.test/token',
  tokenInfo: 'https://accounts.example.test/tokeninfo',
  gmailApi: 'https://gmail.example.test/v1',
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Gmail installed-app OAuth', () => {
  it('creates an S256 PKCE verifier and challenge', () => {
    const pkce = createPkce()
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pkce.verifier.length).toBeLessThanOrEqual(128)
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'))
  })

  it('uses loopback, state, PKCE, scope verification, and account identity', async () => {
    let authorization: URL | undefined
    let tokenBody: URLSearchParams | undefined
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url)
      if (url.href === endpoints.token) {
        if (!(init?.body instanceof URLSearchParams)) throw new Error('Unexpected token body')
        tokenBody = init.body
        return json({
          access_token: 'access-token',
          expires_in: 3600,
          refresh_token: 'refresh-token',
          id_token: 'identity-token',
          scope: 'openid email https://www.googleapis.com/auth/gmail.modify',
        })
      }
      if (url.origin + url.pathname === endpoints.tokenInfo)
        return json({
          sub: 'google-account-1',
          email: 'person@example.test',
          email_verified: 'true',
          aud: 'desktop-client-id',
        })
      if (url.href === `${endpoints.gmailApi}/users/me/profile`)
        return json({ emailAddress: 'person@example.test', historyId: '123' })
      throw new Error(`Unexpected request to ${url.href}`)
    }
    const connector = new GmailOAuthConnector({
      clientId: 'desktop-client-id',
      endpoints,
      fetch: fetchImplementation,
      async openExternal(value) {
        authorization = new URL(value)
        const redirect = authorization.searchParams.get('redirect_uri')
        const state = authorization.searchParams.get('state')
        if (!redirect || !state) throw new Error('Missing OAuth redirect values')
        expect(new URL(redirect).hostname).toBe('127.0.0.1')
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
        expect(authorization.searchParams.get('scope')).toContain(
          'https://www.googleapis.com/auth/gmail.modify',
        )
        await fetch(`${redirect}?code=authorization-code&state=${encodeURIComponent(state)}`)
      },
    })

    await expect(connector.authorize({ signal: new AbortController().signal })).resolves.toEqual({
      providerAccountId: 'google-account-1',
      emailAddress: 'person@example.test',
      displayName: 'person@example.test',
      refreshToken: 'refresh-token',
      historyId: '123',
    })
    expect(tokenBody?.get('code')).toBe('authorization-code')
    expect(tokenBody?.get('code_verifier')).toHaveLength(86)
    expect(tokenBody?.get('client_secret')).toBeNull()
    expect(tokenBody?.get('redirect_uri')).toBe(authorization?.searchParams.get('redirect_uri'))
  })

  it('includes an optional client secret in the token exchange', async () => {
    let tokenBody: URLSearchParams | undefined
    const connector = new GmailOAuthConnector({
      clientId: 'desktop-client-id',
      clientSecret: 'desktop-client-secret',
      endpoints,
      fetch: async (input, init) => {
        const url =
          typeof input === 'string'
            ? new URL(input)
            : input instanceof URL
              ? input
              : new URL(input.url)
        if (url.href === endpoints.token) {
          if (!(init?.body instanceof URLSearchParams)) throw new Error('Unexpected token body')
          tokenBody = init.body
          return json({
            access_token: 'access-token',
            expires_in: 3600,
            refresh_token: 'refresh-token',
            id_token: 'identity-token',
            scope: 'openid email https://www.googleapis.com/auth/gmail.modify',
          })
        }
        if (url.origin + url.pathname === endpoints.tokenInfo)
          return json({
            sub: 'google-account-1',
            email: 'person@example.test',
            aud: 'desktop-client-id',
          })
        return json({ emailAddress: 'person@example.test', historyId: '123' })
      },
      async openExternal(value) {
        const authorization = new URL(value)
        const redirect = authorization.searchParams.get('redirect_uri')
        const state = authorization.searchParams.get('state')
        if (!redirect || !state) throw new Error('Missing OAuth redirect values')
        await fetch(`${redirect}?code=authorization-code&state=${encodeURIComponent(state)}`)
      },
    })

    await expect(connector.authorize({ signal: new AbortController().signal })).resolves.toEqual(
      expect.objectContaining({ providerAccountId: 'google-account-1' }),
    )
    expect(tokenBody?.get('client_secret')).toBe('desktop-client-secret')
  })

  it('maps a missing client secret to a MailRovers-owned error', async () => {
    const connector = new GmailOAuthConnector({
      clientId: 'desktop-client-id',
      endpoints,
      fetch: async (input) => {
        const url =
          typeof input === 'string'
            ? new URL(input)
            : input instanceof URL
              ? input
              : new URL(input.url)
        if (url.href === endpoints.token)
          return json({ error: 'invalid_request', error_description: 'client_secret is missing.' }, 400)
        throw new Error(`Unexpected request to ${url.href}`)
      },
      async openExternal(value) {
        const authorization = new URL(value)
        const redirect = authorization.searchParams.get('redirect_uri')
        const state = authorization.searchParams.get('state')
        if (!redirect || !state) throw new Error('Missing OAuth redirect values')
        await fetch(`${redirect}?code=authorization-code&state=${encodeURIComponent(state)}`)
      },
    })

    await expect(connector.authorize({ signal: new AbortController().signal })).rejects.toThrow(
      'Google OAuth client secret is required',
    )
  })

  it('ignores an unrelated callback without consuming the authorization attempt', async () => {
    let unrelatedStatus: number | undefined
    const connector = new GmailOAuthConnector({
      clientId: 'desktop-client-id',
      endpoints,
      timeoutMs: 1_000,
      fetch: async (input) => {
        const url =
          typeof input === 'string'
            ? new URL(input)
            : input instanceof URL
              ? input
              : new URL(input.url)
        if (url.href === endpoints.token)
          return json({
            access_token: 'access-token',
            expires_in: 3600,
            refresh_token: 'refresh-token',
            id_token: 'identity-token',
            scope: 'openid email https://www.googleapis.com/auth/gmail.modify',
          })
        if (url.origin + url.pathname === endpoints.tokenInfo)
          return json({
            sub: 'google-account-1',
            email: 'person@example.test',
            aud: 'desktop-client-id',
          })
        return json({ emailAddress: 'person@example.test', historyId: '123' })
      },
      async openExternal(value) {
        const authorization = new URL(value)
        const redirect = authorization.searchParams.get('redirect_uri')
        const state = authorization.searchParams.get('state')
        if (!redirect || !state) throw new Error('Missing OAuth redirect values')
        const unrelated = await fetch(`${redirect}?code=authorization-code&state=wrong`)
        unrelatedStatus = unrelated.status
        await fetch(`${redirect}?code=authorization-code&state=${encodeURIComponent(state)}`)
      },
    })
    await expect(connector.authorize({ signal: new AbortController().signal })).resolves.toEqual(
      expect.objectContaining({ providerAccountId: 'google-account-1' }),
    )
    expect(unrelatedStatus).toBe(400)
  })
})
