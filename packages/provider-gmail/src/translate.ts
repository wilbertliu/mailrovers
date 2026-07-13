import {
  attachmentId,
  conversationId,
  draftId,
  labelId,
  messageId,
  utcTimestamp,
  type MailAddress,
  type MailboxId,
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

function decode(data: string | undefined): string | undefined {
  if (!data) return undefined
  try {
    return Buffer.from(data, 'base64url').toString('utf8')
  } catch {
    return undefined
  }
}

function cleanHtml(value: string): string {
  return sanitizeHtml(value, {
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
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  })
}

type BodyParts = { text?: string | undefined; html?: string | undefined }

function collectBodyParts(part: GmailMessagePart, result: BodyParts): void {
  const filename = part.filename ?? ''
  if (filename.length === 0) {
    const value = decode(part.body?.data)
    if (value !== undefined && part.mimeType === 'text/plain' && result.text === undefined)
      result.text = value
    if (value !== undefined && part.mimeType === 'text/html' && result.html === undefined)
      result.html = cleanHtml(value)
  }
  for (const child of part.parts ?? []) collectBodyParts(child, result)
}

function collectAttachments(
  mailbox: MailboxId,
  providerMessageId: string,
  localMessageId: ReturnType<typeof messageId>,
  part: GmailMessagePart,
  result: NormalizedAttachment[],
): void {
  const partHeaders = headers(part)
  const filename = part.filename ?? ''
  const disposition = partHeaders.get('content-disposition')
  const isAttachment =
    filename.length > 0 ||
    part.body?.attachmentId !== undefined ||
    disposition?.toLowerCase().includes('attachment') === true
  if (isAttachment) {
    const partIdentity = part.partId ?? String(result.length)
    result.push({
      id: attachmentId(`gmail:${mailbox}:message:${providerMessageId}:part:${partIdentity}`),
      messageId: localMessageId,
      ...(part.body?.attachmentId === undefined
        ? {}
        : { providerAttachmentId: part.body.attachmentId }),
      filename,
      mediaType: part.mimeType ?? 'application/octet-stream',
      sizeBytes: part.body?.size ?? 0,
      ...(partHeaders.get('content-id') === undefined
        ? {}
        : { contentId: partHeaders.get('content-id') }),
      ...(disposition === undefined ? {} : { disposition }),
    })
  }
  for (const child of part.parts ?? [])
    collectAttachments(mailbox, providerMessageId, localMessageId, child, result)
}

export function translateMessage(input: {
  workspaceId: WorkspaceId
  mailboxId: MailboxId
  message: GmailMessage
  now: ReturnType<typeof utcTimestamp>
}): NormalizedMessage {
  const messageHeaders = headers(input.message.payload)
  const receivedAt = utcTimestamp(new Date(Number(input.message.internalDate)).toISOString())
  const dateHeader = messageHeaders.get('date')
  const parsedSentAt = dateHeader === undefined ? Number.NaN : Date.parse(dateHeader)
  const localMessageId = messageId(`gmail:${input.mailboxId}:message:${input.message.id}`)
  const body: BodyParts = {}
  collectBodyParts(input.message.payload, body)
  const attachments: NormalizedAttachment[] = []
  collectAttachments(
    input.mailboxId,
    input.message.id,
    localMessageId,
    input.message.payload,
    attachments,
  )
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
    ...(body.text === undefined ? {} : { textBody: body.text }),
    ...(body.html === undefined ? {} : { sanitizedHtmlBody: body.html }),
    sizeBytes: input.message.sizeEstimate,
    isDraft: input.message.labelIds.includes('DRAFT'),
    providerLabelIds: input.message.labelIds,
    attachments,
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
}): NormalizedDraft {
  const normalized = translateMessage(input)
  return {
    id: draftId(`gmail:${input.mailboxId}:draft:${input.providerDraftId}`),
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    conversationId: normalized.conversationId,
    providerDraftId: input.providerDraftId,
    providerMessageId: input.message.id,
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
