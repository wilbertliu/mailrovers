import type { Draft } from '@mailrovers/mail-contracts'
import type { MailAddress } from '@mailrovers/mail-domain'
import { createMimeMessage } from 'mimetext/node'

function safeHeader(value: string): string {
  if (value.includes('\r') || value.includes('\n')) throw new Error('Header contains a line break')
  return value
}

function mailbox(value: MailAddress): { addr: string; name: string } | { addr: string } {
  const address = safeHeader(value.address.trim())
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new Error(`Invalid email address: ${address}`)
  return { addr: address, ...(value.name ? { name: safeHeader(value.name) } : {}) }
}

export function serializeDraft(input: {
  draft: Draft
  sender: MailAddress
  internetMessageId: string
  replyInternetMessageId?: string | undefined
}): string {
  const message = createMimeMessage()
  message.setSender(mailbox(input.sender))
  message.setTo(input.draft.to.map(mailbox))
  if (input.draft.cc.length > 0) message.setCc(input.draft.cc.map(mailbox))
  if (input.draft.bcc.length > 0) message.setBcc(input.draft.bcc.map(mailbox))
  message.setSubject(safeHeader(input.draft.subject))
  message.setHeader('Message-ID', safeHeader(input.internetMessageId))
  if (input.replyInternetMessageId) {
    message.setHeader('In-Reply-To', safeHeader(input.replyInternetMessageId))
    message.setHeader('References', safeHeader(input.replyInternetMessageId))
  }
  message.addMessage({ contentType: 'text/plain', data: input.draft.textBody })
  if (input.draft.htmlBody)
    message.addMessage({ contentType: 'text/html', data: input.draft.htmlBody })
  return message.asRaw()
}

export function base64UrlMime(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}
