import type { GmailAuthorization, GmailConnector } from '@mailrovers/mail-application'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { tokenInfoSchema, tokenResponseSchema, profileSchema } from './schemas.js'

const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const DEFAULT_SCOPES = ['openid', 'email', GMAIL_MODIFY_SCOPE]

export type GmailOAuthEndpoints = {
  authorization: string
  token: string
  tokenInfo: string
  gmailApi: string
}

export const defaultGmailOAuthEndpoints: GmailOAuthEndpoints = {
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  tokenInfo: 'https://oauth2.googleapis.com/tokeninfo',
  gmailApi: 'https://gmail.googleapis.com/gmail/v1',
}

export type GmailOAuthConnectorOptions = {
  clientId: string
  /** Google may require this even for Desktop clients; treat as non-confidential. */
  clientSecret?: string | undefined
  openExternal(url: string): Promise<void>
  fetch?: typeof fetch | undefined
  endpoints?: GmailOAuthEndpoints | undefined
  timeoutMs?: number | undefined
}

export function oauthTokenBody(input: {
  clientId: string
  clientSecret?: string | undefined
  entries: Record<string, string>
}): URLSearchParams {
  const body = new URLSearchParams({
    client_id: input.clientId,
    ...input.entries,
  })
  if (input.clientSecret !== undefined && input.clientSecret.length > 0)
    body.set('client_secret', input.clientSecret)
  return body
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function abortError(): Error {
  return new DOMException('The operation was cancelled', 'AbortError')
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (typeof address === 'object' && address !== null) resolve(address.port)
      else reject(new Error('OAuth listener did not bind to a TCP port'))
    })
  })
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function isMissingClientSecret(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const description =
    'error_description' in body &&
    typeof (body as { error_description: unknown }).error_description === 'string'
      ? (body as { error_description: string }).error_description
      : undefined
  return description !== undefined && /client_secret is missing/i.test(description)
}

async function parseResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text()
  let body: unknown
  try {
    body = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
    throw new Error(`${label} returned invalid JSON`)
  }
  if (!response.ok) {
    if (isMissingClientSecret(body)) throw new Error('Google OAuth client secret is required')
    throw new Error(`${label} failed with HTTP ${response.status}`)
  }
  return body
}

export class GmailOAuthConnector implements GmailConnector {
  private readonly fetchImplementation: typeof fetch
  private readonly endpoints: GmailOAuthEndpoints
  private readonly timeoutMs: number

  constructor(private readonly options: GmailOAuthConnectorOptions) {
    if (options.clientId.length === 0) throw new Error('Google OAuth client ID is required')
    this.fetchImplementation = options.fetch ?? fetch
    this.endpoints = options.endpoints ?? defaultGmailOAuthEndpoints
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000
  }

  async authorize(input: {
    loginHint?: string | undefined
    signal: AbortSignal
  }): Promise<GmailAuthorization> {
    input.signal.throwIfAborted()
    const { verifier, challenge } = createPkce()
    const state = randomBytes(32).toString('base64url')
    let settleCallback: ((value: { code: string; redirectUri: string }) => void) | undefined
    let rejectCallback: ((error: Error) => void) | undefined
    const callback = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      settleCallback = resolve
      rejectCallback = reject
    })
    void callback.catch(() => undefined)
    let settled = false
    const server = createServer((request, response) => {
      const respond = (status: number, message: string) => {
        response.writeHead(status, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        response.end(message)
      }
      if (settled) {
        respond(409, 'This authorization request is already complete.')
        return
      }
      if (request.method !== 'GET' || !request.url) {
        respond(405, 'This listener only accepts the Google authorization callback.')
        return
      }
      let callbackUrl: URL
      try {
        callbackUrl = new URL(request.url, 'http://127.0.0.1')
      } catch {
        respond(400, 'Invalid callback URL.')
        return
      }
      if (callbackUrl.pathname !== '/oauth/callback') {
        respond(404, 'Callback path not found.')
        return
      }
      if (callbackUrl.searchParams.get('state') !== state) {
        respond(400, 'Authorization state did not match.')
        return
      }
      const providerError = callbackUrl.searchParams.get('error')
      if (providerError) {
        settled = true
        respond(400, 'Google authorization was declined. Return to MailRovers.')
        rejectCallback?.(new Error(`Google authorization was declined: ${providerError}`))
        return
      }
      const code = callbackUrl.searchParams.get('code')
      if (!code) {
        respond(400, 'Authorization code was missing.')
        return
      }
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        respond(500, 'OAuth listener address is unavailable.')
        return
      }
      settled = true
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end(
        '<!doctype html><meta charset="utf-8"><title>MailRovers connected</title><p>MailRovers is connected. You can close this window.</p>',
      )
      settleCallback?.({ code, redirectUri: `http://127.0.0.1:${address.port}/oauth/callback` })
    })

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      rejectCallback?.(new Error('Google authorization timed out'))
    }, this.timeoutMs)
    const onAbort = () => {
      if (settled) return
      settled = true
      rejectCallback?.(abortError())
    }
    input.signal.addEventListener('abort', onAbort, { once: true })

    try {
      const port = await listen(server)
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`
      const authorizationUrl = new URL(this.endpoints.authorization)
      authorizationUrl.searchParams.set('client_id', this.options.clientId)
      authorizationUrl.searchParams.set('redirect_uri', redirectUri)
      authorizationUrl.searchParams.set('response_type', 'code')
      authorizationUrl.searchParams.set('scope', DEFAULT_SCOPES.join(' '))
      authorizationUrl.searchParams.set('access_type', 'offline')
      authorizationUrl.searchParams.set('prompt', 'consent')
      authorizationUrl.searchParams.set('code_challenge', challenge)
      authorizationUrl.searchParams.set('code_challenge_method', 'S256')
      authorizationUrl.searchParams.set('state', state)
      if (input.loginHint) authorizationUrl.searchParams.set('login_hint', input.loginHint)
      await this.options.openExternal(authorizationUrl.toString())
      const result = await callback
      input.signal.throwIfAborted()

      const tokenBody = oauthTokenBody({
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
        entries: {
          code: result.code,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: result.redirectUri,
        },
      })
      const tokenResponse = await this.fetchImplementation(this.endpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
        signal: input.signal,
      })
      const tokens = tokenResponseSchema.parse(
        await parseResponse(tokenResponse, 'Google token exchange'),
      )
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token')
      if (!tokens.id_token) throw new Error('Google did not return an identity token')
      if (tokens.scope) {
        const granted = new Set(tokens.scope.split(' '))
        if (!granted.has(GMAIL_MODIFY_SCOPE)) throw new Error('Gmail access was not granted')
      }

      const tokenInfoUrl = new URL(this.endpoints.tokenInfo)
      tokenInfoUrl.searchParams.set('id_token', tokens.id_token)
      const tokenInfoResponse = await this.fetchImplementation(tokenInfoUrl, {
        signal: input.signal,
      })
      const identity = tokenInfoSchema.parse(
        await parseResponse(tokenInfoResponse, 'Google identity verification'),
      )
      if (identity.aud !== this.options.clientId)
        throw new Error('Google identity token was issued for another client')

      const profileResponse = await this.fetchImplementation(
        `${this.endpoints.gmailApi}/users/me/profile`,
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: input.signal,
        },
      )
      const profile = profileSchema.parse(
        await parseResponse(profileResponse, 'Gmail profile request'),
      )
      if (profile.emailAddress.toLowerCase() !== identity.email.toLowerCase())
        throw new Error('Google identity did not match the Gmail profile')

      return {
        providerAccountId: identity.sub,
        emailAddress: profile.emailAddress,
        displayName: profile.emailAddress,
        refreshToken: tokens.refresh_token,
        historyId: profile.historyId,
      }
    } finally {
      clearTimeout(timeout)
      input.signal.removeEventListener('abort', onAbort)
      await close(server)
    }
  }
}
