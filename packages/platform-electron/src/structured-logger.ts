import { stableErrorCodes, type StableErrorCode } from '@mailrovers/mail-contracts'

const REDACTED = '[REDACTED]'
const CIRCULAR = '[CIRCULAR]'
const DEPTH_LIMIT = '[DEPTH_LIMIT]'
const BINARY = '[BINARY]'

export { stableErrorCodes, type StableErrorCode }

const stableErrorCodeSet = new Set<string>(stableErrorCodes)

export function stableErrorCode(value: unknown, fallback: StableErrorCode = 'INTERNAL_ERROR') {
  return typeof value === 'string' && stableErrorCodeSet.has(value)
    ? (value as StableErrorCode)
    : fallback
}

const sensitiveKey =
  /(?:api[-_]?key|secret|password|passphrase|credential|authorization|cookie|token|auth[-_]?url|oauth|prompt|instruction|generated|completion|content|body|subject|address|recipient|sender|attachment|filename|stack)/i
const authUrl =
  /(?:[?&#](?:code|token|access_token|refresh_token|id_token|client_secret)=|\/oauth|accounts\.google\.com\/o\/oauth)/i
const secretInText =
  /(?:bearer\s+\S+|(?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password)\s*[:=]\s*\S+)/gi
const emailAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

export type RedactionOptions = {
  maxDepth?: number
  maxStringLength?: number
  maxArrayLength?: number
  maxObjectKeys?: number
}

function redactString(value: string, maxStringLength: number): string {
  if (authUrl.test(value)) return REDACTED
  const scrubbed = value.replace(secretInText, REDACTED).replace(emailAddress, REDACTED)
  return scrubbed.length > maxStringLength
    ? `${scrubbed.slice(0, maxStringLength)}…[TRUNCATED]`
    : scrubbed
}

/** Recursively produces a JSON-safe, bounded value suitable for logs and diagnostics. */
export function redactLogValue(value: unknown, options: RedactionOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 6
  const maxStringLength = options.maxStringLength ?? 1_000
  const maxArrayLength = options.maxArrayLength ?? 50
  const maxObjectKeys = options.maxObjectKeys ?? 50
  const ancestors = new WeakSet<object>()

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key !== undefined && sensitiveKey.test(key)) return REDACTED
    if (current === null || typeof current === 'boolean' || typeof current === 'number')
      return current
    if (typeof current === 'string') return redactString(current, maxStringLength)
    if (typeof current === 'bigint') return current.toString()
    if (typeof current === 'undefined') return '[UNDEFINED]'
    if (typeof current === 'symbol' || typeof current === 'function') return `[${typeof current}]`
    if (depth >= maxDepth) return DEPTH_LIMIT
    if (typeof current !== 'object') return '[UNSUPPORTED]'
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) return BINARY
    if (ancestors.has(current)) return CIRCULAR

    ancestors.add(current)
    try {
      if (current instanceof Error) {
        const errorWithCause = current as Error & { cause?: unknown; code?: unknown }
        const result: Record<string, unknown> = {
          name: redactString(current.name, maxStringLength),
          code: stableErrorCode(errorWithCause.code),
          // Error text regularly includes provider payloads. It is never safe log metadata.
          message: REDACTED,
          stack: REDACTED,
        }
        if ('cause' in errorWithCause) result.cause = REDACTED
        return result
      }
      if (Array.isArray(current)) {
        const items = current.slice(0, maxArrayLength).map((item) => visit(item, depth + 1))
        if (current.length > maxArrayLength) items.push(`[${current.length - maxArrayLength} MORE]`)
        return items
      }
      const result: Record<string, unknown> = {}
      const entries = Object.entries(current).slice(0, maxObjectKeys)
      for (const [entryKey, entryValue] of entries)
        result[entryKey] = visit(entryValue, depth + 1, entryKey)
      if (Object.keys(current).length > maxObjectKeys)
        result.__truncatedKeys = Object.keys(current).length - maxObjectKeys
      return result
    } finally {
      ancestors.delete(current)
    }
  }

  return visit(value, 0)
}

export const logMetadataKeys = [
  'channel',
  'code',
  'databaseHost',
  'detail',
  'durationMs',
  'elapsedMs',
  'error',
  'mode',
  'operation',
  'path',
  'pid',
  'stage',
  'status',
] as const

type LogMetadataKey = (typeof logMetadataKeys)[number]
export type LogMetadata = Partial<Record<LogMetadataKey, unknown>>
const metadataKeySet = new Set<string>(logMetadataKeys)

export type StructuredLogRecord = {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  event: string
  metadata: Record<string, unknown>
}

export type LogSink = (line: string) => void

function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`)
}

export function createStructuredLogger(input: {
  component: string
  sink?: LogSink
  now?: () => Date
}) {
  const sink = input.sink ?? defaultSink
  const now = input.now ?? (() => new Date())
  const write = (
    level: StructuredLogRecord['level'],
    event: string,
    metadata: LogMetadata = {},
  ): StructuredLogRecord => {
    const allowed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (metadataKeySet.has(key)) allowed[key] = redactLogValue(value, { maxDepth: 5 })
    }
    if ('code' in allowed) allowed.code = stableErrorCode(allowed.code)
    const record = {
      timestamp: now().toISOString(),
      level,
      event: `${input.component}.${event}`,
      metadata: allowed,
    } satisfies StructuredLogRecord
    sink(JSON.stringify(record))
    return record
  }
  return {
    info: (event: string, metadata?: LogMetadata) => write('info', event, metadata),
    warn: (event: string, metadata?: LogMetadata) => write('warn', event, metadata),
    error: (event: string, metadata?: LogMetadata) => write('error', event, metadata),
  }
}

/** Writes one redacted JSON object without changing its machine-readable shape. */
export function writeRedactedJsonLine(value: unknown, sink: LogSink = defaultSink): void {
  sink(JSON.stringify(redactLogValue(value)))
}

export function redactedJson(value: unknown, space?: number): string {
  return JSON.stringify(redactLogValue(value), null, space)
}
