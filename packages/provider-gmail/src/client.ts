import { setTimeout as delay } from 'node:timers/promises'
import { tokenResponseSchema } from './schemas.js'
import { defaultGmailOAuthEndpoints, type GmailOAuthEndpoints } from './oauth.js'

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'GmailApiError'
  }
}

export interface AccessTokenSource {
  get(signal: AbortSignal): Promise<string>
  invalidate(): void
}

export class RefreshTokenAccessTokenSource implements AccessTokenSource {
  private cached?: { token: string; expiresAt: number } | undefined
  private readonly fetchImplementation: typeof fetch
  private readonly endpoints: GmailOAuthEndpoints

  constructor(
    private readonly input: {
      clientId: string
      getRefreshToken(): Promise<string>
      fetch?: typeof fetch | undefined
      endpoints?: GmailOAuthEndpoints | undefined
      now?: (() => number) | undefined
    },
  ) {
    this.fetchImplementation = input.fetch ?? fetch
    this.endpoints = input.endpoints ?? defaultGmailOAuthEndpoints
  }

  async get(signal: AbortSignal): Promise<string> {
    const now = this.input.now?.() ?? Date.now()
    if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token
    const refreshToken = await this.input.getRefreshToken()
    const response = await this.fetchImplementation(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.input.clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal,
    })
    if (!response.ok) throw new GmailApiError('Google token refresh failed', response.status)
    const unknownBody: unknown = await response.json()
    const token = tokenResponseSchema.parse(unknownBody)
    this.cached = { token: token.access_token, expiresAt: now + token.expires_in * 1000 }
    return token.access_token
  }

  invalidate(): void {
    this.cached = undefined
  }
}

type ErrorPayload = { error?: { errors?: Array<{ reason?: string }> } }

async function errorReason(response: Response): Promise<string | undefined> {
  try {
    const value: unknown = await response.json()
    if (typeof value !== 'object' || value === null || !('error' in value)) return undefined
    const error = (value as ErrorPayload).error
    return error?.errors?.[0]?.reason
  } catch {
    return undefined
  }
}

function retryable(status: number, reason?: string): boolean {
  return (
    status === 429 ||
    status >= 500 ||
    (status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'))
  )
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > 64 * 1024 * 1024)
    throw new Error('Invalid Gmail response size limit')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw new GmailApiError('Gmail response exceeded the safe size limit', 413)
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new GmailApiError('Gmail response exceeded the safe size limit', 413)
    }
    chunks.push(result.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export class GmailHttpClient {
  private readonly fetchImplementation: typeof fetch
  private readonly gmailApi: string

  constructor(
    private readonly input: {
      accessTokens: AccessTokenSource
      fetch?: typeof fetch | undefined
      endpoints?: GmailOAuthEndpoints | undefined
      random?: (() => number) | undefined
      wait?: ((milliseconds: number, signal: AbortSignal) => Promise<void>) | undefined
    },
  ) {
    this.fetchImplementation = input.fetch ?? fetch
    this.gmailApi = (input.endpoints ?? defaultGmailOAuthEndpoints).gmailApi
  }

  async request(
    path: string,
    input: { signal: AbortSignal; allowNotFound?: boolean | undefined },
  ): Promise<unknown> {
    return this.performRequest(path, { ...input, method: 'GET', retrySafe: true })
  }

  async requestBounded(
    path: string,
    input: {
      signal: AbortSignal
      maximumResponseBytes: number
      allowNotFound?: boolean | undefined
    },
  ): Promise<unknown> {
    return this.performRequest(path, {
      ...input,
      method: 'GET',
      retrySafe: true,
    })
  }

  async mutateSetLike(
    path: string,
    input: { signal: AbortSignal; body: unknown },
  ): Promise<unknown> {
    return this.performRequest(path, {
      signal: input.signal,
      method: 'POST',
      body: input.body,
      retrySafe: true,
    })
  }

  async mutateOnce(
    path: string,
    input: { signal: AbortSignal; method: 'POST' | 'PUT' | 'DELETE'; body?: unknown },
  ): Promise<unknown> {
    return this.performRequest(path, { ...input, retrySafe: false })
  }

  private async performRequest(
    path: string,
    input: {
      signal: AbortSignal
      method: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: unknown
      allowNotFound?: boolean | undefined
      maximumResponseBytes?: number | undefined
      retrySafe: boolean
    },
  ): Promise<unknown> {
    let refreshed = false
    const attempts = input.retrySafe ? 5 : 2
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      input.signal.throwIfAborted()
      try {
        const token = await this.input.accessTokens.get(input.signal)
        const response = await this.fetchImplementation(`${this.gmailApi}${path}`, {
          method: input.method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          signal: input.signal,
        })
        if (response.ok)
          return response.status === 204
            ? undefined
            : input.maximumResponseBytes === undefined
              ? await response.json()
              : await boundedJson(response, input.maximumResponseBytes)
        if (response.status === 404 && input.allowNotFound) return undefined
        if (response.status === 401 && !refreshed) {
          refreshed = true
          this.input.accessTokens.invalidate()
          continue
        }
        const reason = await errorReason(response)
        if (!input.retrySafe || !retryable(response.status, reason) || attempt === attempts - 1)
          throw new GmailApiError(
            `Gmail request failed with HTTP ${response.status}`,
            response.status,
            reason,
          )
      } catch (error) {
        if (input.signal.aborted) throw error
        if (error instanceof GmailApiError && !retryable(error.status, error.reason)) throw error
        if (!input.retrySafe || attempt === attempts - 1) throw error
      }
      const jitter = Math.floor((this.input.random?.() ?? Math.random()) * 1000)
      const milliseconds = Math.min(2 ** attempt * 1000 + jitter, 32_000)
      if (this.input.wait) await this.input.wait(milliseconds, input.signal)
      else await delay(milliseconds, undefined, { signal: input.signal })
    }
    throw new Error('Gmail request retry loop ended unexpectedly')
  }
}
