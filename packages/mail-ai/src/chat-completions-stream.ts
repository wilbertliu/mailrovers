import type { AiRuntimeEvent } from '@mailrovers/mail-application'
import { AiProviderError } from './errors.js'

const MAX_STREAM_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024

type RuntimeUsage = {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  totalTokens?: number | undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function usage(value: unknown): RuntimeUsage | undefined {
  const record = object(value)
  if (!record) return undefined
  const prompt = record.prompt_tokens
  const completion = record.completion_tokens
  const total = record.total_tokens
  return {
    ...(typeof prompt === 'number' ? { inputTokens: prompt } : {}),
    ...(typeof completion === 'number' ? { outputTokens: completion } : {}),
    ...(typeof total === 'number' ? { totalTokens: total } : {}),
  }
}

export async function* parseChatCompletionStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<AiRuntimeEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamBytes = 0
  let outputBytes = 0
  let finishReason: string | undefined
  let finalUsage: ReturnType<typeof usage>
  let done = false

  try {
    while (!done) {
      const next = await reader.read()
      if (next.done) break
      streamBytes += next.value.byteLength
      if (streamBytes > MAX_STREAM_BYTES)
        throw new AiProviderError('AI_RESPONSE_INVALID', 'AI stream exceeded its size limit')
      buffer += decoder.decode(next.value, { stream: true }).replaceAll('\r\n', '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data === '[DONE]') {
          done = true
          break
        }
        if (data.length > 0) {
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            throw new AiProviderError('AI_RESPONSE_INVALID', 'AI stream contained invalid JSON')
          }
          const chunk = object(parsed)
          if (!chunk)
            throw new AiProviderError('AI_RESPONSE_INVALID', 'AI stream contained an invalid event')
          const choices = chunk.choices
          if (!Array.isArray(choices))
            throw new AiProviderError('AI_RESPONSE_INVALID', 'AI stream omitted choices')
          if (choices.length > 1)
            throw new AiProviderError('AI_RESPONSE_INVALID', 'AI stream returned multiple choices')
          const choice = object(choices[0])
          if (choice) {
            const delta = object(choice.delta)
            if (delta?.tool_calls !== undefined || delta?.function_call !== undefined)
              throw new AiProviderError('AI_UNSAFE_OUTPUT', 'AI provider attempted a tool call')
            if (typeof delta?.content === 'string' && delta.content.length > 0) {
              outputBytes += new TextEncoder().encode(delta.content).byteLength
              if (outputBytes > MAX_OUTPUT_BYTES)
                throw new AiProviderError(
                  'AI_RESPONSE_INVALID',
                  'AI output exceeded its size limit',
                )
              yield { kind: 'delta', text: delta.content }
            }
            if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
          }
          finalUsage = usage(chunk.usage) ?? finalUsage
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
    if (!done) throw new AiProviderError('AI_RESPONSE_INVALID', 'AI stream ended before completion')
    yield {
      kind: 'completed',
      model: '',
      ...(finishReason === undefined ? {} : { finishReason }),
      ...(finalUsage === undefined ? {} : { usage: finalUsage }),
    }
  } finally {
    reader.releaseLock()
  }
}
