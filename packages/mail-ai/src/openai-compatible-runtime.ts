import type {
  AiProviderConfiguration,
  AiRequest,
  AiRuntime,
  AiRuntimeEvent,
  AiRuntimeFactory,
} from '@mailrovers/mail-application'
import { parseChatCompletionStream } from './chat-completions-stream.js'
import { AiProviderError } from './errors.js'
import { buildChatMessages } from './request-policy.js'

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function chatCompletionsUrl(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new AiProviderError('AI_CONFIGURATION_INVALID', 'AI base URL is invalid')
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname)))
    throw new AiProviderError(
      'AI_CONFIGURATION_INVALID',
      'AI base URL must use HTTPS or loopback HTTP',
    )
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new AiProviderError('AI_CONFIGURATION_INVALID', 'AI base URL contains unsupported parts')
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/chat/completions`
  return parsed.toString()
}

function responseError(status: number): AiProviderError {
  if (status === 401 || status === 403)
    return new AiProviderError(
      'AI_AUTHENTICATION_FAILED',
      'AI provider rejected the API key',
      status,
    )
  if (status === 429)
    return new AiProviderError(
      'AI_PROVIDER_THROTTLED',
      'AI provider is throttling requests',
      status,
    )
  if (status >= 500)
    return new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable', status)
  return new AiProviderError('AI_CONFIGURATION_INVALID', 'AI provider rejected the request', status)
}

function textFromCompletion(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('choices' in value)) return undefined
  if (!Array.isArray(value.choices) || value.choices.length !== 1) return undefined
  const choice = value.choices[0]
  if (typeof choice !== 'object' || choice === null || !('message' in choice)) return undefined
  const message = choice.message
  if (typeof message !== 'object' || message === null || !('content' in message)) return undefined
  return typeof message.content === 'string' ? message.content : undefined
}

const MAX_VALIDATION_RESPONSE_BYTES = 64 * 1024

type ReadBoundedJsonInput = {
  response: Response
  maxBytes: number
  signal: AbortSignal
}

async function readBoundedJson({
  response,
  maxBytes,
  signal,
}: ReadBoundedJsonInput): Promise<unknown> {
  signal.throwIfAborted()
  const body = response.body
  if (!body)
    throw new AiProviderError('AI_RESPONSE_INVALID', 'AI provider returned no response body')

  const contentLength = response.headers.get('Content-Length')
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    BigInt(contentLength) > BigInt(maxBytes)
  ) {
    await body.cancel().catch(() => undefined)
    signal.throwIfAborted()
    throw new AiProviderError('AI_RESPONSE_INVALID', 'AI provider response exceeded size limit')
  }

  const reader = body.getReader()
  let rejectAbort: ((reason?: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined)
    rejectAbort?.(signal.reason)
  }
  signal.addEventListener('abort', abort, { once: true })

  try {
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        signal.throwIfAborted()
        throw new AiProviderError('AI_RESPONSE_INVALID', 'AI provider response exceeded size limit')
      }
      chunks.push(value)
    }

    signal.throwIfAborted()
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

export class OpenAiCompatibleRuntime implements AiRuntime {
  private readonly fetchImplementation: typeof fetch
  private readonly endpoint: string

  constructor(
    private readonly configuration: AiProviderConfiguration,
    input: { fetch?: typeof fetch | undefined } = {},
  ) {
    if (configuration.model.trim().length === 0 || configuration.apiKey.length === 0)
      throw new AiProviderError('AI_CONFIGURATION_INVALID', 'AI model and API key are required')
    this.fetchImplementation = input.fetch ?? fetch
    this.endpoint = chatCompletionsUrl(configuration.baseUrl)
  }

  async *stream(request: AiRequest, signal: AbortSignal): AsyncIterable<AiRuntimeEvent> {
    signal.throwIfAborted()
    let response: Response
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.configuration.model,
          stream: true,
          messages: buildChatMessages(request),
        }),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider could not be reached')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw responseError(response.status)
    }
    if (!response.body)
      throw new AiProviderError('AI_RESPONSE_INVALID', 'AI provider returned no stream')
    for await (const event of parseChatCompletionStream(response.body)) {
      if (event.kind === 'completed') yield { ...event, model: this.configuration.model }
      else yield event
    }
  }

  async validateConfiguration(signal: AbortSignal): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.configuration.model,
          stream: false,
          messages: [
            {
              role: 'system',
              content: 'Return plain text only. Do not call tools.',
            },
            { role: 'user', content: 'Reply with OK.' },
          ],
        }),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider could not be reached')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw responseError(response.status)
    }
    let value: unknown
    try {
      value = await readBoundedJson({
        response,
        maxBytes: MAX_VALIDATION_RESPONSE_BYTES,
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof AiProviderError) throw error
      throw new AiProviderError('AI_RESPONSE_INVALID', 'AI provider returned invalid JSON')
    }
    if (textFromCompletion(value) === undefined)
      throw new AiProviderError('AI_RESPONSE_INVALID', 'AI provider returned no text')
  }
}

export class OpenAiCompatibleRuntimeFactory implements AiRuntimeFactory {
  constructor(private readonly input: { fetch?: typeof fetch | undefined } = {}) {}

  create(configuration: AiProviderConfiguration): AiRuntime {
    return new OpenAiCompatibleRuntime(configuration, this.input)
  }
}
