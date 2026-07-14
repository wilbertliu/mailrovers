import {
  attachmentId,
  conversationId,
  draftId,
  fingerprintDraftRevision,
  labelId,
  messageId,
  utcTimestamp,
  type MailAddress,
  type MailboxId,
  type MimeBudgetDimension,
  type MimeNormalization,
  type NormalizedAttachment,
  type NormalizedDraft,
  type NormalizedLabel,
  type NormalizedMessage,
  type WorkspaceId,
} from '@mailrovers/mail-domain'
import sanitizeHtml from 'sanitize-html'
import type { GmailMessage, GmailMessagePart } from './schemas.js'

function splitAddresses(value: string): string[] {
  const values: string[] = []
  let start = 0
  let quoted = false
  let angleDepth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"' && value[index - 1] !== '\\') quoted = !quoted
    else if (!quoted && character === '<') angleDepth += 1
    else if (!quoted && character === '>') angleDepth = Math.max(0, angleDepth - 1)
    else if (!quoted && angleDepth === 0 && character === ',') {
      values.push(value.slice(start, index))
      start = index + 1
    }
  }
  values.push(value.slice(start))
  return values.map((item) => item.trim()).filter(Boolean)
}

export function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return []
  return splitAddresses(value).flatMap((item) => {
    const angle = /^(.*?)<([^<>]+)>$/.exec(item)
    const address = (angle?.[2] ?? item).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) return []
    const rawName = angle?.[1]?.trim().replace(/^"|"$/g, '')
    return [{ address, ...(rawName ? { name: rawName } : {}) }]
  })
}

function headers(part: GmailMessagePart): Map<string, string> {
  const result = new Map<string, string>()
  for (const header of part.headers ?? []) result.set(header.name.toLowerCase(), header.value)
  return result
}

function decode(data: string): string | undefined {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data)) return undefined
  try {
    return Buffer.from(data, 'base64url').toString('utf8')
  } catch {
    return undefined
  }
}

function cleanHtml(value: string): string | undefined {
  const cleaned = sanitizeHtml(value, {
    allowedTags: [
      'a',
      'abbr',
      'b',
      'blockquote',
      'br',
      'code',
      'div',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'hr',
      'i',
      'li',
      'ol',
      'p',
      'pre',
      'span',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'u',
      'ul',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  })
  return cleaned === '' ? undefined : cleaned
}

type BodyParts = { text?: string | undefined; html?: string | undefined }

/**
 * Conservative defaults cap one Gmail payload before decoding or sanitizing. The single iterative
 * walk is atomic: crossing any limit discards all body and attachment results as incomplete.
 */
export const DEFAULT_MIME_BUDGET = {
  parts: 1_000,
  depth: 32,
  encoded_bytes: 8 * 1024 * 1024,
  decoded_utf8_bytes: 8 * 1024 * 1024,
  sanitized_html_bytes: 4 * 1024 * 1024,
  attachments: 500,
  attachment_metadata_bytes: 512 * 1024,
} as const satisfies Record<MimeBudgetDimension, number>

export type MimeBudget = Record<MimeBudgetDimension, number>

type MimeCollection = {
  body: BodyParts
  attachments: NormalizedAttachment[]
  mime: MimeNormalization
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('MIME normalization was cancelled', 'AbortError')
}

function collectMime(input: {
  mailboxId: MailboxId
  providerMessageId: string
  localMessageId: ReturnType<typeof messageId>
  root: GmailMessagePart
  budget: MimeBudget
  signal?: AbortSignal | undefined
}): MimeCollection {
  const usage: Record<MimeBudgetDimension, number> = {
    parts: 0,
    depth: 0,
    encoded_bytes: 0,
    decoded_utf8_bytes: 0,
    sanitized_html_bytes: 0,
    attachments: 0,
    attachment_metadata_bytes: 0,
  }
  const body: BodyParts = {}
  const attachments: NormalizedAttachment[] = []
  const stack: Array<{ part: GmailMessagePart; depth: number }> = [{ part: input.root, depth: 0 }]
  const overflow = (dimension: MimeBudgetDimension, observed: number): MimeCollection => ({
    body: {},
    attachments: [],
    mime: {
      kind: 'metadata-only',
      diagnostic: {
        code: 'MIME_BUDGET_EXCEEDED',
        dimension,
        limit: input.budget[dimension],
        observed,
      },
      usage: { ...usage, [dimension]: observed },
    },
  })
  const add = (dimension: MimeBudgetDimension, amount: number): MimeCollection | undefined => {
    const observed = usage[dimension] + amount
    usage[dimension] = observed
    return observed > input.budget[dimension] ? overflow(dimension, observed) : undefined
  }

  while (stack.length > 0) {
    abortIfRequested(input.signal)
    const current = stack.pop()!
    const partOverflow = add('parts', 1)
    if (partOverflow) return partOverflow
    usage.depth = Math.max(usage.depth, current.depth)
    if (current.depth > input.budget.depth) return overflow('depth', current.depth)

    const part = current.part
    const partHeaders = headers(part)
    const filename = part.filename ?? ''
    const disposition = partHeaders.get('content-disposition')
    const isAttachment =
      filename.length > 0 ||
      part.body?.attachmentId !== undefined ||
      disposition?.toLowerCase().includes('attachment') === true
    if (isAttachment) {
      const attachmentOverflow = add('attachments', 1)
      if (attachmentOverflow) return attachmentOverflow
      const providerAttachmentId = part.body?.attachmentId
      const mediaType = part.mimeType ?? 'application/octet-stream'
      const contentId = partHeaders.get('content-id')
      const metadataBytes =
        Buffer.byteLength(part.partId ?? '') +
        Buffer.byteLength(filename) +
        Buffer.byteLength(mediaType) +
        Buffer.byteLength(providerAttachmentId ?? '') +
        Buffer.byteLength(contentId ?? '') +
        Buffer.byteLength(disposition ?? '') +
        16
      const metadataOverflow = add('attachment_metadata_bytes', metadataBytes)
      if (metadataOverflow) return metadataOverflow
      const partIdentity = part.partId ?? String(attachments.length)
      attachments.push({
        id: attachmentId(
          `gmail:${input.mailboxId}:message:${input.providerMessageId}:part:${partIdentity}`,
        ),
        messageId: input.localMessageId,
        ...(providerAttachmentId === undefined ? {} : { providerAttachmentId }),
        filename,
        mediaType,
        sizeBytes: part.body?.size ?? 0,
        ...(contentId === undefined ? {} : { contentId }),
        ...(disposition === undefined ? {} : { disposition }),
      })
    }

    const data = part.body?.data
    if (data !== undefined) {
      const encodedOverflow = add('encoded_bytes', Buffer.byteLength(data))
      if (encodedOverflow) return encodedOverflow
      if (!isAttachment && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
        const value = decode(data)
        if (value !== undefined) {
          const decodedBytes = Buffer.byteLength(value)
          const decodedOverflow = add('decoded_utf8_bytes', decodedBytes)
          if (decodedOverflow) return decodedOverflow
          if (part.mimeType === 'text/plain' && body.text === undefined) body.text = value
          if (part.mimeType === 'text/html') {
            abortIfRequested(input.signal)
            const cleaned = cleanHtml(value)
            const sanitizedBytes = Buffer.byteLength(cleaned ?? '')
            const sanitizedOverflow = add('sanitized_html_bytes', sanitizedBytes)
            if (sanitizedOverflow) return sanitizedOverflow
            if (body.html === undefined) body.html = cleaned
          }
        }
      }
    }

    const children = part.parts ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child !== undefined) stack.push({ part: child, depth: current.depth + 1 })
    }
  }
  abortIfRequested(input.signal)
  return { body, attachments, mime: { kind: 'complete', usage } }
}

export function translateMessage(input: {
  workspaceId: WorkspaceId
  mailboxId: MailboxId
  message: GmailMessage
  now: ReturnType<typeof utcTimestamp>
  budget?: MimeBudget | undefined
  signal?: AbortSignal | undefined
}): NormalizedMessage {
  const messageHeaders = headers(input.message.payload)
  const receivedAt = utcTimestamp(new Date(Number(input.message.internalDate)).toISOString())
  const dateHeader = messageHeaders.get('date')
  const parsedSentAt = dateHeader === undefined ? Number.NaN : Date.parse(dateHeader)
  const localMessageId = messageId(`gmail:${input.mailboxId}:message:${input.message.id}`)
  const collected = collectMime({
    mailboxId: input.mailboxId,
    providerMessageId: input.message.id,
    localMessageId,
    root: input.message.payload,
    budget: input.budget ?? DEFAULT_MIME_BUDGET,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  return {
    id: localMessageId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    conversationId: conversationId(
      `gmail:${input.mailboxId}:conversation:${input.message.threadId}`,
    ),
    providerThreadId: input.message.threadId,
    providerMessageId: input.message.id,
    ...(messageHeaders.get('message-id') === undefined
      ? {}
      : { internetMessageId: messageHeaders.get('message-id') }),
    ...(input.message.historyId === undefined
      ? {}
      : { providerHistoryId: input.message.historyId }),
    sender: parseAddressList(messageHeaders.get('from'))[0] ?? { address: 'unknown@invalid' },
    recipients: {
      to: parseAddressList(messageHeaders.get('to')),
      cc: parseAddressList(messageHeaders.get('cc')),
      bcc: parseAddressList(messageHeaders.get('bcc')),
    },
    subject: messageHeaders.get('subject') ?? '',
    ...(Number.isNaN(parsedSentAt)
      ? {}
      : { sentAt: utcTimestamp(new Date(parsedSentAt).toISOString()) }),
    receivedAt,
    snippet: input.message.snippet,
    ...(collected.body.text === undefined ? {} : { textBody: collected.body.text }),
    ...(collected.body.html === undefined ? {} : { sanitizedHtmlBody: collected.body.html }),
    sizeBytes: input.message.sizeEstimate,
    isDraft: input.message.labelIds.includes('DRAFT'),
    providerLabelIds: input.message.labelIds,
    attachments: collected.attachments,
    mime: collected.mime,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function translateDraft(input: {
  workspaceId: WorkspaceId
  mailboxId: MailboxId
  providerDraftId: string
  message: GmailMessage
  now: ReturnType<typeof utcTimestamp>
  budget?: MimeBudget | undefined
  signal?: AbortSignal | undefined
}): NormalizedDraft {
  const normalized = translateMessage(input)
  const messageHeaders = headers(input.message.payload)
  const internetMessageId =
    messageHeaders.get('message-id') ?? `<gmail-draft-${input.providerDraftId}@mailrovers.local>`
  const sender = normalized.sender
  const inReplyTo = messageHeaders.get('in-reply-to')
  const references = (messageHeaders.get('references') ?? '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const revision = {
    internetMessageId,
    sender,
    to: normalized.recipients.to,
    cc: normalized.recipients.cc,
    bcc: normalized.recipients.bcc,
    subject: normalized.subject,
    textBody: normalized.textBody ?? '',
    ...(normalized.sanitizedHtmlBody === undefined
      ? {}
      : { htmlBody: normalized.sanitizedHtmlBody }),
    providerThreadId: input.message.threadId,
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
    references,
  }
  return {
    id: draftId(`gmail:${input.mailboxId}:draft:${input.providerDraftId}`),
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    conversationId: normalized.conversationId,
    providerDraftId: input.providerDraftId,
    providerMessageId: input.message.id,
    providerThreadId: input.message.threadId,
    internetMessageId,
    sender,
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
    references,
    providerFingerprint: fingerprintDraftRevision(revision),
    to: normalized.recipients.to,
    cc: normalized.recipients.cc,
    bcc: normalized.recipients.bcc,
    subject: normalized.subject,
    textBody: normalized.textBody ?? '',
    ...(normalized.sanitizedHtmlBody === undefined
      ? {}
      : { htmlBody: normalized.sanitizedHtmlBody }),
    updatedAt: input.now,
  }
}

export function translateLabel(input: {
  mailboxId: MailboxId
  providerLabel: {
    id: string
    name: string
    type: 'system' | 'user'
    color?: { backgroundColor?: string | undefined; textColor?: string | undefined } | undefined
  }
  now: ReturnType<typeof utcTimestamp>
}): NormalizedLabel {
  return {
    id: labelId(`gmail:${input.mailboxId}:label:${input.providerLabel.id}`),
    mailboxId: input.mailboxId,
    providerLabelId: input.providerLabel.id,
    name: input.providerLabel.name,
    kind: input.providerLabel.type,
    ...(input.providerLabel.color === undefined ? {} : { color: input.providerLabel.color }),
    updatedAt: input.now,
  }
}
